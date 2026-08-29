import {
  assertKDrawDocumentV1,
  type CadBlockDefinition,
  type CadDocumentMetadata,
  type CadDimensionStyle,
  type CadEntity,
  type CadLayer,
  type CadLayout,
  type CadLinetype,
  type CadOperation,
  type CadTextStyle,
  type CadUnits,
  type KDrawDocumentV1,
} from "@kuubik/cad-schema";
import { assertLayoutCollection } from "./layouts.js";

export type EntityChange =
  | { type: "put"; entity: CadEntity }
  | { type: "delete"; handle: string };

export type CadChange =
  | EntityChange
  | { type: "put-layer"; layer: CadLayer }
  | { type: "delete-layer"; layerId: string }
  | { type: "set-current-layer"; layerId: string }
  | DrawingContentChange
  | { type: "set-layouts"; layouts: CadLayout[] }
  | { type: "set-metadata"; metadata: CadDocumentMetadata }
  | { type: "undo-mark" };

export interface DrawingContentChange {
  type: "replace-drawing-content";
  units: CadUnits;
  currentLayerId: string;
  entities: CadEntity[];
  layers: CadLayer[];
  linetypes: CadLinetype[];
  textStyles: CadTextStyle[];
  dimensionStyles: CadDimensionStyle[];
  blocks: CadBlockDefinition[];
}

export interface CommittedOperation {
  operation: CadOperation;
  changes: CadChange[];
  inverseChanges: CadChange[];
  committedRevision: number;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Revision conflict: operation targets ${expectedRevision}, document is ${actualRevision}.`);
    this.name = "RevisionConflictError";
  }
}

export class NoOpOperationError extends Error {
  constructor(message = "Operation makes no semantic document change.") {
    super(message);
    this.name = "NoOpOperationError";
  }
}

export class DuplicateOperationError extends Error {
  constructor(readonly opId: string) {
    super(`Operation ${opId} has already been applied.`);
    this.name = "DuplicateOperationError";
  }
}

function cloneEntity(entity: CadEntity): CadEntity {
  return structuredClone(entity);
}

export function replaceDrawingContent(document: KDrawDocumentV1): DrawingContentChange {
  return {
    type: "replace-drawing-content",
    units: structuredClone(document.units),
    currentLayerId: document.currentLayerId,
    entities: structuredClone(document.entities),
    layers: structuredClone(document.layers),
    linetypes: structuredClone(document.linetypes),
    textStyles: structuredClone(document.textStyles),
    dimensionStyles: structuredClone(document.dimensionStyles),
    blocks: structuredClone(document.blocks),
  };
}

interface LayoutResourceRefs {
  layers: Set<string>;
  linetypes: Set<string>;
  textStyles: Set<string>;
  dimensionStyles: Set<string>;
  blocks: Set<string>;
}

interface ResourcePlan<T extends { id: string; name: string }> {
  idMap: Map<string, string>;
  additions: T[];
}

function planRetainedResources<T extends { id: string; name: string }>(
  imported: readonly T[],
  source: readonly T[],
  required: ReadonlySet<string>,
  remapDependencies: (item: T) => T = (item) => item,
  forceDuplicateOnIdCollision = false,
): ResourcePlan<T> {
  const importedById = new Map(imported.map((item) => [item.id, item]));
  const usedIds = new Set(imported.map((item) => item.id));
  const usedNames = new Set(imported.map((item) => item.name.toLocaleUpperCase("en-US")));
  const idMap = new Map<string, string>();
  const additions: T[] = [];
  for (const sourceItem of source.filter((item) => required.has(item.id))) {
    const remappedSourceItem = remapDependencies(structuredClone(sourceItem));
    const sameId = importedById.get(sourceItem.id);
    if (!forceDuplicateOnIdCollision && sameId && JSON.stringify(sameId) === JSON.stringify(remappedSourceItem)) {
      idMap.set(sourceItem.id, sourceItem.id);
      continue;
    }
    let id = sourceItem.id;
    for (let suffix = 1; usedIds.has(id); suffix += 1) id = `${sourceItem.id}$paper${suffix}`;
    let name = sourceItem.name;
    for (let suffix = 1; usedNames.has(name.toLocaleUpperCase("en-US")); suffix += 1) name = `${sourceItem.name} [paper ${suffix}]`;
    usedIds.add(id);
    usedNames.add(name.toLocaleUpperCase("en-US"));
    idMap.set(sourceItem.id, id);
    additions.push({ ...remappedSourceItem, id, name });
  }
  return { idMap, additions };
}

function retainedHandleAllocator(imported: KDrawDocumentV1): (preferred: string) => string {
  const used = new Set([
    ...imported.entities.map((entity) => entity.handle.toUpperCase()),
    ...imported.blocks.flatMap((block) => block.entities.map((entity) => entity.handle.toUpperCase())),
  ]);
  let maximum = 0xfn;
  for (const handle of used) {
    if (!/^[0-9A-F]+$/u.test(handle)) continue;
    const value = BigInt(`0x${handle}`);
    if (value > maximum) maximum = value;
  }
  return (preferred) => {
    const normalized = preferred.toUpperCase();
    if (!used.has(normalized)) {
      used.add(normalized);
      return preferred;
    }
    do maximum += 1n; while (used.has(maximum.toString(16).toUpperCase()));
    const allocated = maximum.toString(16).toUpperCase();
    used.add(allocated);
    return allocated;
  };
}

/**
 * Replace model-space DXF content while retaining the exact resources needed
 * by Kuubik-owned paper-space layouts. Imported model handles stay canonical;
 * colliding paper resources and handles are remapped deterministically.
 */
export function replaceDrawingContentPreservingLayouts(
  source: KDrawDocumentV1,
  imported: KDrawDocumentV1,
): CadChange[] {
  const hasRetainedUnitSensitiveLayoutState = source.layouts.some((layout) => (
    (layout.entities?.length ?? 0) > 0 || layout.viewports.length > 0 || layout.pageSetup !== undefined
  ));
  if (source.units.linear !== imported.units.linear && hasRetainedUnitSensitiveLayoutState) {
    throw new RangeError(`DXF units ${imported.units.linear} cannot replace ${source.units.linear} model units while unit-sensitive layout state exists.`);
  }
  const refs: LayoutResourceRefs = {
    layers: new Set(),
    linetypes: new Set(),
    textStyles: new Set(),
    dimensionStyles: new Set(),
    blocks: new Set(),
  };
  const sourceBlocks = new Map(source.blocks.map((block) => [block.id, block]));
  const visitingBlocks = new Set<string>();
  const collectAppearance = (appearance: CadEntity["appearance"]): void => {
    if (appearance?.linetypeId) refs.linetypes.add(appearance.linetypeId);
  };
  const collectEntity = (entity: CadEntity): void => {
    refs.layers.add(entity.layerId);
    collectAppearance(entity.appearance);
    if ((entity.kind === "text" || entity.kind === "mtext") && entity.styleId) refs.textStyles.add(entity.styleId);
    if (entity.kind === "dimension") refs.dimensionStyles.add(entity.styleId);
    if (entity.kind !== "blockRef" || refs.blocks.has(entity.blockId)) return;
    refs.blocks.add(entity.blockId);
    if (visitingBlocks.has(entity.blockId)) return;
    const definition = sourceBlocks.get(entity.blockId);
    if (!definition) return;
    visitingBlocks.add(entity.blockId);
    definition.entities.forEach(collectEntity);
    visitingBlocks.delete(entity.blockId);
  };
  for (const layout of source.layouts) {
    (layout.entities ?? []).forEach(collectEntity);
    for (const viewport of layout.viewports) {
      for (const [layerId, appearance] of Object.entries(viewport.layerOverrides ?? {})) {
        refs.layers.add(layerId);
        collectAppearance(appearance);
      }
    }
  }
  for (const layer of source.layers.filter((item) => refs.layers.has(item.id))) collectAppearance(layer.appearance);
  for (const style of source.dimensionStyles.filter((item) => refs.dimensionStyles.has(item.id))) {
    if (style.textStyleId) refs.textStyles.add(style.textStyleId);
  }

  const linetypePlan = planRetainedResources(imported.linetypes, source.linetypes, refs.linetypes);
  const remapAppearance = <T extends CadEntity["appearance"]>(appearance: T): T => {
    if (!appearance?.linetypeId) return structuredClone(appearance);
    return { ...structuredClone(appearance), linetypeId: linetypePlan.idMap.get(appearance.linetypeId) ?? appearance.linetypeId } as T;
  };
  const textStylePlan = planRetainedResources(imported.textStyles, source.textStyles, refs.textStyles);
  const dimensionStylePlan = planRetainedResources(
    imported.dimensionStyles,
    source.dimensionStyles,
    refs.dimensionStyles,
    (style) => ({
      ...style,
      ...(style.textStyleId ? { textStyleId: textStylePlan.idMap.get(style.textStyleId) ?? style.textStyleId } : {}),
    }),
  );
  const layerPlan = planRetainedResources(
    imported.layers,
    source.layers,
    refs.layers,
    (layer) => ({ ...layer, ...(layer.appearance ? { appearance: remapAppearance(layer.appearance) } : {}) }),
  );
  // A block can depend transitively on every other resource family, including
  // nested blocks. Keeping an imported same-id block would therefore be lossy
  // whenever any descendant dependency is remapped. A collision is rare and
  // duplicating it is the conservative deterministic choice.
  const blockPlan = planRetainedResources(imported.blocks, source.blocks, refs.blocks, undefined, true);
  const allocateHandle = retainedHandleAllocator(imported);
  const remapEntity = (entity: CadEntity): CadEntity => {
    const next = structuredClone(entity);
    next.handle = allocateHandle(entity.handle);
    next.layerId = layerPlan.idMap.get(entity.layerId) ?? entity.layerId;
    if (next.appearance) next.appearance = remapAppearance(next.appearance);
    if ((next.kind === "text" || next.kind === "mtext") && next.styleId) next.styleId = textStylePlan.idMap.get(next.styleId) ?? next.styleId;
    if (next.kind === "dimension") next.styleId = dimensionStylePlan.idMap.get(next.styleId) ?? next.styleId;
    if (next.kind === "blockRef") next.blockId = blockPlan.idMap.get(next.blockId) ?? next.blockId;
    return next;
  };
  const retainedBlocks = blockPlan.additions.map((block) => ({ ...block, entities: block.entities.map(remapEntity) }));
  const layouts = source.layouts.map((layout) => ({
    ...structuredClone(layout),
    entities: (layout.entities ?? []).map(remapEntity),
    viewports: layout.viewports.map((viewport) => ({
      ...structuredClone(viewport),
      ...(viewport.layerOverrides ? {
        layerOverrides: Object.fromEntries(Object.entries(viewport.layerOverrides).map(([layerId, appearance]) => [
          layerPlan.idMap.get(layerId) ?? layerId,
          remapAppearance(appearance),
        ])),
      } : {}),
    })),
  }));
  const replacement: KDrawDocumentV1 = {
    ...structuredClone(imported),
    linetypes: [...structuredClone(imported.linetypes), ...linetypePlan.additions],
    textStyles: [...structuredClone(imported.textStyles), ...textStylePlan.additions],
    dimensionStyles: [...structuredClone(imported.dimensionStyles), ...dimensionStylePlan.additions],
    layers: [...structuredClone(imported.layers), ...layerPlan.additions],
    blocks: [...structuredClone(imported.blocks), ...retainedBlocks],
  };
  return [replaceDrawingContent(replacement), { type: "set-layouts", layouts }];
}

export function applyAtomicOperation(
  source: KDrawDocumentV1,
  operation: CadOperation,
  changes: readonly CadChange[],
  now = new Date().toISOString(),
): { document: KDrawDocumentV1; committed: CommittedOperation } {
  if (operation.baseRevision !== source.revision) {
    throw new RevisionConflictError(operation.baseRevision, source.revision);
  }
  if (operation.opId.length === 0 || operation.commandId.length === 0) {
    throw new TypeError("Operation id and command id are required.");
  }
  if (changes.length === 0) throw new NoOpOperationError();

  const entities = new Map(source.entities.map((entity) => [entity.handle, cloneEntity(entity)]));
  const layers = new Map(source.layers.map((layer) => [layer.id, structuredClone(layer)]));
  let units = structuredClone(source.units);
  let linetypes = structuredClone(source.linetypes);
  let textStyles = structuredClone(source.textStyles);
  let dimensionStyles = structuredClone(source.dimensionStyles);
  let blocks = structuredClone(source.blocks);
  let currentLayerId = source.currentLayerId;
  let layouts = structuredClone(source.layouts);
  let metadata = structuredClone(source.metadata);
  const inverseChanges: CadChange[] = [];
  for (const change of changes) {
    if (change.type === "undo-mark") {
      inverseChanges.unshift({ type: "undo-mark" });
      continue;
    }
    if (change.type === "put") {
      const before = entities.get(change.entity.handle);
      inverseChanges.unshift(before ? { type: "put", entity: cloneEntity(before) } : { type: "delete", handle: change.entity.handle });
      entities.set(change.entity.handle, cloneEntity(change.entity));
      continue;
    }
    if (change.type === "delete") {
      const before = entities.get(change.handle);
      if (!before) throw new RangeError(`Cannot delete missing entity ${change.handle}.`);
      inverseChanges.unshift({ type: "put", entity: cloneEntity(before) });
      entities.delete(change.handle);
      continue;
    }
    if (change.type === "put-layer") {
      const before = layers.get(change.layer.id);
      inverseChanges.unshift(before ? { type: "put-layer", layer: structuredClone(before) } : { type: "delete-layer", layerId: change.layer.id });
      layers.set(change.layer.id, structuredClone(change.layer));
      continue;
    }
    if (change.type === "replace-drawing-content") {
      inverseChanges.unshift(replaceDrawingContent({
        ...structuredClone(source),
        units,
        currentLayerId,
        entities: [...entities.values()],
        layers: [...layers.values()],
        linetypes,
        textStyles,
        dimensionStyles,
        blocks,
      }));
      units = structuredClone(change.units);
      currentLayerId = change.currentLayerId;
      entities.clear();
      for (const entity of change.entities) entities.set(entity.handle, cloneEntity(entity));
      layers.clear();
      for (const layer of change.layers) layers.set(layer.id, structuredClone(layer));
      linetypes = structuredClone(change.linetypes);
      textStyles = structuredClone(change.textStyles);
      dimensionStyles = structuredClone(change.dimensionStyles);
      blocks = structuredClone(change.blocks);
      continue;
    }
    if (change.type === "set-layouts") {
      assertLayoutCollection(change.layouts);
      inverseChanges.unshift({ type: "set-layouts", layouts: structuredClone(layouts) });
      layouts = structuredClone(change.layouts);
      continue;
    }
    if (change.type === "set-metadata") {
      inverseChanges.unshift({ type: "set-metadata", metadata: structuredClone(metadata) });
      metadata = structuredClone(change.metadata);
      continue;
    }
    if (change.type === "delete-layer") {
      const before = layers.get(change.layerId);
      if (!before) throw new RangeError(`Cannot delete missing layer ${change.layerId}.`);
      if (currentLayerId === change.layerId || [...entities.values()].some((entity) => entity.layerId === change.layerId)) {
        throw new RangeError(`Cannot delete active or referenced layer ${change.layerId}.`);
      }
      inverseChanges.unshift({ type: "put-layer", layer: structuredClone(before) });
      layers.delete(change.layerId);
      continue;
    }
    if (!layers.has(change.layerId)) throw new RangeError(`Cannot activate missing layer ${change.layerId}.`);
    inverseChanges.unshift({ type: "set-current-layer", layerId: currentLayerId });
    currentLayerId = change.layerId;
  }

  const document: KDrawDocumentV1 = {
    ...structuredClone(source),
    revision: source.revision + 1,
    units,
    entities: [...entities.values()],
    layers: [...layers.values()],
    linetypes,
    textStyles,
    dimensionStyles,
    blocks,
    layouts,
    currentLayerId,
    metadata: { ...metadata, updatedAt: now },
  };
  if (
    JSON.stringify(document.entities) === JSON.stringify(source.entities) &&
    JSON.stringify(document.layers) === JSON.stringify(source.layers) &&
    JSON.stringify(document.units) === JSON.stringify(source.units) &&
    JSON.stringify(document.linetypes) === JSON.stringify(source.linetypes) &&
    JSON.stringify(document.textStyles) === JSON.stringify(source.textStyles) &&
    JSON.stringify(document.dimensionStyles) === JSON.stringify(source.dimensionStyles) &&
    JSON.stringify(document.blocks) === JSON.stringify(source.blocks) &&
    JSON.stringify(document.layouts) === JSON.stringify(source.layouts) &&
    JSON.stringify(metadata) === JSON.stringify(source.metadata) &&
    document.currentLayerId === source.currentLayerId &&
    !changes.some((change) => change.type === "undo-mark")
  ) throw new NoOpOperationError();
  assertKDrawDocumentV1(document);
  return {
    document,
    committed: {
      operation: structuredClone(operation),
      changes: structuredClone([...changes]),
      inverseChanges,
      committedRevision: document.revision,
    },
  };
}

export class CadSession {
  #document: KDrawDocumentV1;
  #undo: CommittedOperation[] = [];
  #redo: CommittedOperation[] = [];
  #sequence = 0;
  readonly #appliedOperationIds: Set<string>;

  constructor(document: KDrawDocumentV1, appliedOperationIds: Iterable<string> = []) {
    assertKDrawDocumentV1(document);
    assertLayoutCollection(document.layouts);
    this.#document = structuredClone(document);
    this.#appliedOperationIds = new Set(appliedOperationIds);
  }

  get document(): KDrawDocumentV1 {
    return structuredClone(this.#document);
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get nextUndoCommandId(): string | null {
    return this.#undo.at(-1)?.operation.commandId ?? null;
  }

  get nextRedoCommandId(): string | null {
    return this.#redo.at(-1)?.operation.commandId ?? null;
  }

  fork(): CadSession {
    const fork = new CadSession(this.#document, this.#appliedOperationIds);
    fork.#undo = structuredClone(this.#undo);
    fork.#redo = structuredClone(this.#redo);
    fork.#sequence = this.#sequence;
    return fork;
  }

  commit(operation: CadOperation, changes: readonly CadChange[], now?: string): CommittedOperation {
    if (this.#appliedOperationIds.has(operation.opId)) throw new DuplicateOperationError(operation.opId);
    const result = applyAtomicOperation(this.#document, operation, changes, now);
    this.#document = result.document;
    this.#undo.push(result.committed);
    this.#redo = [];
    this.#appliedOperationIds.add(operation.opId);
    return structuredClone(result.committed);
  }

  undo(now?: string): CommittedOperation | null {
    const prior = this.#undo.pop();
    if (!prior) return null;
    const operation: CadOperation = {
      opId: `${prior.operation.opId}:undo:${++this.#sequence}`,
      baseRevision: this.#document.revision,
      commandId: "UNDO",
      args: { originalOpId: prior.operation.opId },
      targetHandles: [...prior.operation.resultHandles],
      resultHandles: [...prior.operation.targetHandles],
    };
    const result = applyAtomicOperation(this.#document, operation, prior.inverseChanges, now);
    this.#document = result.document;
    this.#redo.push(prior);
    return structuredClone(result.committed);
  }

  redo(now?: string): CommittedOperation | null {
    const prior = this.#redo.pop();
    if (!prior) return null;
    const operation: CadOperation = {
      ...structuredClone(prior.operation),
      opId: `${prior.operation.opId}:redo:${++this.#sequence}`,
      baseRevision: this.#document.revision,
    };
    const result = applyAtomicOperation(this.#document, operation, prior.changes, now);
    this.#document = result.document;
    this.#undo.push(prior);
    return structuredClone(result.committed);
  }
}
