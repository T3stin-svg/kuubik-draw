import type { CadLayer, CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { CadSession, type CommittedOperation } from "../../../../../packages/cad-core/src/transaction.js";
import {
  planCreateLayer,
  planDeleteLayer,
  planRenameLayer,
  planSetCurrentLayer,
  planSetEntityLayerProperties,
  planSetLayerAppearance,
  planSetLayerToggle,
  readCadLayerContract,
  CadLayerError,
  type CadLayerAppearancePatch,
  type CadEntityLayerPropertiesPatch,
  type CadLayerPlan,
  type CadLayerToggle,
} from "../../../../../packages/cad-core/src/layers.js";
import { planDrawOrderChanges, type CadDrawOrderAction } from "../../../../../packages/cad-core/src/draw-order.js";

export interface LayerManagerPropertyPatch extends CadLayerAppearancePatch {
  visible?: boolean;
  frozen?: boolean;
  locked?: boolean;
  plottable?: boolean;
}

export type LayerManagerCommand =
  | { type: "create"; name: string; requestedId?: string }
  | { type: "rename"; layerId: string; name: string }
  | { type: "delete"; layerId: string }
  | { type: "current"; layerId: string }
  | { type: "toggle"; layerId: string; property: CadLayerToggle; value: boolean }
  | { type: "appearance"; layerId: string; patch: CadLayerAppearancePatch }
  | { type: "batch-properties"; layerIds: readonly string[]; patch: LayerManagerPropertyPatch }
  | { type: "entity-properties"; handles: readonly string[]; patch: CadEntityLayerPropertiesPatch }
  | { type: "draw-order"; handles: readonly string[]; action: CadDrawOrderAction; referenceHandle?: string };

export interface LayerManagerPlan {
  commandId: string;
  args: Record<string, unknown>;
  changes: CadLayerPlan["changes"];
  targetHandles: string[];
  resultHandles: string[];
  orderedHandles?: string[];
}

export interface LayerManagerCommit {
  committed: CommittedOperation;
  document: KDrawDocumentV1;
  orderedHandles?: string[];
}

export interface LayerManagerControllerOptions {
  opIdPrefix?: string;
  now?: () => string;
}

const TOGGLE_PROPERTIES: readonly CadLayerToggle[] = ["visible", "frozen", "locked", "plottable"];
const APPEARANCE_PROPERTIES: readonly (keyof CadLayerAppearancePatch)[] = [
  "color", "colorMethod", "aciIndex", "linetypeId", "lineweightMm", "transparency",
];

function requireBatchLayer(document: KDrawDocumentV1, layerId: string): CadLayer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new CadLayerError(`Layer ${layerId} does not exist.`);
  return layer;
}

function replaceWorkingLayer(document: KDrawDocumentV1, plan: CadLayerPlan): CadLayer {
  const changes = plan.changes.filter((change) => change.type === "put-layer");
  if (changes.length !== 1 || plan.changes.length !== 1) {
    throw new TypeError("A layer property planner must produce exactly one put-layer change.");
  }
  const layer = structuredClone(changes[0]!.layer);
  const index = document.layers.findIndex((candidate) => candidate.id === layer.id);
  if (index < 0) throw new CadLayerError(`Layer ${layer.id} does not exist.`);
  document.layers[index] = layer;
  return layer;
}

function appearanceDiffers(layer: CadLayer, patch: CadLayerAppearancePatch): boolean {
  return APPEARANCE_PROPERTIES.some((property) => {
    const requested = patch[property];
    if (requested === undefined) return false;
    const current = layer.appearance?.[property];
    return requested === null ? current !== undefined : current !== requested;
  });
}

function planBatchProperties(
  document: KDrawDocumentV1,
  layerIds: readonly string[],
  patch: LayerManagerPropertyPatch,
): CadLayerPlan {
  const uniqueLayerIds = [...new Set(layerIds)];
  if (uniqueLayerIds.length === 0) throw new CadLayerError("Layer property batch requires at least one layer.");
  if (Object.values(patch).every((value) => value === undefined)) throw new CadLayerError("Layer property batch requires a property change.");
  const working = structuredClone(document);
  const finalLayers: CadLayer[] = [];
  const { visible, frozen, locked, plottable, ...appearance } = patch;
  const toggles: Readonly<Record<CadLayerToggle, boolean | undefined>> = { visible, frozen, locked, plottable };

  for (const layerId of uniqueLayerIds) {
    const original = requireBatchLayer(working, layerId);
    for (const property of TOGGLE_PROPERTIES) {
      const value = toggles[property];
      const current = requireBatchLayer(working, layerId);
      if (value === undefined || current[property] === value) continue;
      replaceWorkingLayer(working, planSetLayerToggle(working, layerId, property, value));
    }
    const current = requireBatchLayer(working, layerId);
    if (appearanceDiffers(current, appearance)) {
      replaceWorkingLayer(working, planSetLayerAppearance(working, layerId, appearance));
    }
    const finalLayer = requireBatchLayer(working, layerId);
    if (JSON.stringify(finalLayer) !== JSON.stringify(original)) finalLayers.push(structuredClone(finalLayer));
  }

  if (finalLayers.length === 0) throw new CadLayerError("Layer property batch makes no semantic change.");
  return {
    commandId: "LAYER_BATCH_PROPERTIES",
    args: { layerIds: uniqueLayerIds, patch: structuredClone(patch) },
    changes: finalLayers.map((layer) => ({ type: "put-layer", layer })),
  };
}

/** Plans first, then commits the complete layer or draw-order change in one revision. */
export class LayerManagerController {
  readonly #session: CadSession;
  readonly #opIdPrefix: string;
  readonly #now: () => string;
  #sequence = 0;

  constructor(document: KDrawDocumentV1, options: LayerManagerControllerOptions = {}) {
    readCadLayerContract(document);
    this.#session = new CadSession(document);
    this.#opIdPrefix = options.opIdPrefix ?? "layer-manager";
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get document(): KDrawDocumentV1 {
    return this.#session.document;
  }

  get canUndo(): boolean { return this.#session.canUndo; }
  get canRedo(): boolean { return this.#session.canRedo; }

  plan(command: LayerManagerCommand): LayerManagerPlan {
    const document = this.#session.document;
    if (command.type === "draw-order") {
      const planned = planDrawOrderChanges(document, command.handles, command.action, command.referenceHandle);
      return {
        commandId: planned.commandId,
        args: planned.args,
        changes: planned.changes,
        targetHandles: [...planned.args.handles as string[]],
        resultHandles: [...planned.args.handles as string[]],
        orderedHandles: planned.orderedHandles,
      };
    }
    if (command.type === "entity-properties") {
      const planned = planSetEntityLayerProperties(document, command.handles, command.patch);
      return {
        commandId: planned.commandId,
        args: planned.args,
        changes: planned.changes,
        targetHandles: planned.targetHandles,
        resultHandles: planned.resultHandles,
      };
    }
    let planned: CadLayerPlan;
    switch (command.type) {
      case "create": planned = planCreateLayer(document, command.name, command.requestedId); break;
      case "rename": planned = planRenameLayer(document, command.layerId, command.name); break;
      case "delete": planned = planDeleteLayer(document, command.layerId); break;
      case "current": planned = planSetCurrentLayer(document, command.layerId); break;
      case "toggle": planned = planSetLayerToggle(document, command.layerId, command.property, command.value); break;
      case "appearance": planned = planSetLayerAppearance(document, command.layerId, command.patch); break;
      case "batch-properties": planned = planBatchProperties(document, command.layerIds, command.patch); break;
    }
    return { ...planned, targetHandles: [], resultHandles: [] };
  }

  execute(command: LayerManagerCommand): LayerManagerCommit {
    const planned = this.plan(command);
    const operation: CadOperation = {
      opId: `${this.#opIdPrefix}:${this.document.revision}:${++this.#sequence}:${planned.commandId}`,
      baseRevision: this.document.revision,
      commandId: planned.commandId,
      args: planned.args,
      targetHandles: planned.targetHandles,
      resultHandles: planned.resultHandles,
    };
    const committed = this.#session.commit(operation, planned.changes, this.#now());
    return { committed, document: this.document, ...(planned.orderedHandles ? { orderedHandles: planned.orderedHandles } : {}) };
  }

  undo(): LayerManagerCommit | null {
    const committed = this.#session.undo(this.#now());
    return committed ? { committed, document: this.document } : null;
  }

  redo(): LayerManagerCommit | null {
    const committed = this.#session.redo(this.#now());
    return committed ? { committed, document: this.document } : null;
  }
}
