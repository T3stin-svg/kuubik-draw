import { assertKDrawDocumentV1, type CadBlockDefinition, type CadBlockReference, type CadEntity, type CadPoint2, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import { replaceDrawingContent, type CadChange, type EntityChange } from "../transaction.js";
import { readBlockAttributes, withBlockAttributes, type BlockAttributeDefinition, type KuubikBlockDefinition } from "./contracts.js";
import { transformBlockPoint, transformExplodedEntity } from "./transform.js";

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function ensureWritableLayer(document: KDrawDocumentV1, layerId: string, label: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${layerId}.`);
  if (layer.locked) throw new RangeError(`${label} is on locked layer: ${layerId}.`);
}

function validateAttributeDefinitions(document: KDrawDocumentV1, attributes: readonly BlockAttributeDefinition[]): void {
  const tags = new Set<string>();
  for (const attribute of attributes) {
    const tag = attribute.tag.trim().toLocaleUpperCase("en-US");
    if (!tag || tags.has(tag)) throw new RangeError(`Duplicate or empty block attribute tag: ${attribute.tag}.`);
    tags.add(tag);
    finitePoint(attribute.position, `Attribute ${tag} position`);
    if (!Number.isFinite(attribute.height) || attribute.height <= 0 || (attribute.rotationRad !== undefined && !Number.isFinite(attribute.rotationRad))) throw new RangeError(`Attribute ${tag} dimensions must be valid.`);
    if (attribute.textStyleId && !document.textStyles.some((style) => style.id === attribute.textStyleId)) throw new RangeError(`Unknown text style: ${attribute.textStyleId}.`);
  }
}

export function assertAcyclicBlocks(blocks: readonly CadBlockDefinition[]): void {
  const ids = new Set<string>(); const names = new Set<string>(); const handles = new Set<string>();
  for (const block of blocks) {
    const id = block.id.toLocaleUpperCase("en-US"); const name = block.name.toLocaleUpperCase("en-US");
    if (!block.id.trim() || ids.has(id)) throw new RangeError(`Duplicate or empty block id: ${block.id}.`);
    if (!block.name.trim() || names.has(name)) throw new RangeError(`Duplicate or empty block name: ${block.name}.`);
    ids.add(id); names.add(name);
    for (const entity of block.entities) {
      const handle = entity.handle.toLocaleUpperCase("en-US");
      if (!entity.handle.trim() || handles.has(handle)) throw new RangeError(`Duplicate or empty block member handle: ${entity.handle}.`);
      handles.add(handle);
    }
  }
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const permanent = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (permanent.has(id)) return;
    if (active.has(id)) throw new RangeError(`Block cycle rejected: ${[...trail, id].join(" -> ")}.`);
    active.add(id);
    const block = byId.get(id);
    if (!block) throw new RangeError(`Missing nested block definition: ${id}.`);
    for (const entity of block.entities) if (entity.kind === "blockRef") visit(entity.blockId, [...trail, id]);
    active.delete(id);
    permanent.add(id);
  };
  for (const block of blocks) visit(block.id, []);
}

function assertNoProxyChildren(blocks: readonly CadBlockDefinition[], blockId: string, seen = new Set<string>()): void {
  if (seen.has(blockId)) return;
  seen.add(blockId);
  const definition = blocks.find((block) => block.id === blockId);
  if (!definition) throw new RangeError(`Missing nested block definition: ${blockId}.`);
  for (const entity of definition.entities) {
    if (entity.kind === "proxy") throw new RangeError(`Proxy child is not supported in block definition: ${entity.handle}.`);
    if (entity.kind === "blockRef") assertNoProxyChildren(blocks, entity.blockId, seen);
  }
}

function validateDefinitionIdentity(document: KDrawDocumentV1, id: string, name: string, replacingId?: string): void {
  if (!id.trim() || !name.trim()) throw new TypeError("Block id and name are required.");
  const conflict = document.blocks.find((block) => block.id !== replacingId && (block.id === id || block.name.toLocaleUpperCase("en-US") === name.toLocaleUpperCase("en-US")));
  if (conflict) throw new RangeError(`Block id or name already exists: ${name}.`);
}

function drawingReplacement(document: KDrawDocumentV1, entities: CadEntity[], blocks: CadBlockDefinition[]): CadChange[] {
  const candidate = { ...structuredClone(document), entities: structuredClone(entities), blocks: structuredClone(blocks) };
  assertAcyclicBlocks(candidate.blocks);
  assertKDrawDocumentV1(candidate);
  return [replaceDrawingContent(candidate)];
}

function blockDefinition(document: KDrawDocumentV1, args: { id: string; name: string; basePoint: CadPoint2; entities: CadEntity[]; attributes?: BlockAttributeDefinition[]; releasedModelHandles?: readonly string[] }, replacingId?: string): KuubikBlockDefinition {
  validateDefinitionIdentity(document, args.id, args.name, replacingId);
  validateAttributeDefinitions(document, args.attributes ?? []);
  if (!args.entities.length) throw new RangeError("Block definition requires at least one entity.");
  const handles = new Set<string>();
  const released = new Set((args.releasedModelHandles ?? []).map((handle) => handle.toLocaleUpperCase("en-US")));
  const occupied = new Set([
    ...document.entities.filter((entity) => !released.has(entity.handle.toLocaleUpperCase("en-US"))),
    ...document.blocks.filter((block) => block.id !== replacingId).flatMap((block) => block.entities),
  ].map((entity) => entity.handle.toLocaleUpperCase("en-US")));
  for (const entity of args.entities) {
    if (entity.kind === "proxy") throw new RangeError(`Proxy child is not supported in block definition: ${entity.handle}.`);
    const handle = entity.handle.toLocaleUpperCase("en-US");
    if (!entity.handle.trim() || handles.has(handle) || occupied.has(handle)) throw new RangeError(`Duplicate or empty block member handle: ${entity.handle}.`);
    handles.add(handle);
    ensureWritableLayer(document, entity.layerId, `Block member ${entity.handle}`);
  }
  const definition = withBlockAttributes({ id: args.id, name: args.name, basePoint: finitePoint(args.basePoint, "Block base point"), entities: structuredClone(args.entities) }, args.attributes ?? []);
  const blocks = replacingId ? document.blocks.map((block) => block.id === replacingId ? definition : block) : [...document.blocks, definition];
  assertAcyclicBlocks(blocks);
  assertNoProxyChildren(blocks, definition.id);
  return definition;
}

function defaultAttributeValues(definition: CadBlockDefinition, values: Readonly<Record<string, string>> = {}): Record<string, string> | undefined {
  const attributes = readBlockAttributes(definition);
  const known = new Map(attributes.map((attribute) => [attribute.tag.toLocaleUpperCase("en-US"), attribute]));
  for (const key of Object.keys(values)) if (!known.has(key.toLocaleUpperCase("en-US"))) throw new RangeError(`Unknown block attribute: ${key}.`);
  if (!attributes.length) return undefined;
  return Object.fromEntries(attributes.map((attribute) => {
    const supplied = Object.entries(values).find(([key]) => key.toLocaleUpperCase("en-US") === attribute.tag.toLocaleUpperCase("en-US"))?.[1];
    return [attribute.tag, attribute.constant ? attribute.defaultValue : supplied ?? attribute.defaultValue];
  }));
}

export function createBlockInsert(document: KDrawDocumentV1, args: { handle: string; layerId: string; blockId: string; insertion: CadPoint2; scale?: CadPoint2; rotationRad?: number; attributes?: Record<string, string> }): CadBlockReference {
  const handle = args.handle.toLocaleUpperCase("en-US");
  if (!args.handle.trim() || [...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle.toLocaleUpperCase("en-US") === handle)) throw new RangeError(`Invalid or duplicate INSERT handle: ${args.handle}.`);
  ensureWritableLayer(document, args.layerId, `INSERT ${args.handle}`);
  const definition = document.blocks.find((block) => block.id === args.blockId);
  if (!definition) throw new RangeError(`Unknown block: ${args.blockId}.`);
  assertAcyclicBlocks(document.blocks);
  assertNoProxyChildren(document.blocks, definition.id);
  const scale = args.scale ?? { x: 1, y: 1 };
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y) || Math.abs(scale.x) <= 1e-12 || Math.abs(scale.y) <= 1e-12 || !Number.isFinite(args.rotationRad ?? 0)) throw new RangeError("INSERT scale must be finite and non-zero and rotation finite.");
  const attributes = defaultAttributeValues(definition, args.attributes);
  return {
    kind: "blockRef", handle: args.handle, layerId: args.layerId, blockId: args.blockId,
    insertion: finitePoint(args.insertion, "INSERT point"), scale: structuredClone(scale), rotationRad: args.rotationRad ?? 0,
    ...(attributes ? { attributes } : {}),
  };
}

export function defineBlockFromSelection(document: KDrawDocumentV1, args: { id: string; name: string; basePoint: CadPoint2; selectedHandles: string[]; insertHandle: string; layerId?: string; attributes?: BlockAttributeDefinition[] }): { changes: CadChange[]; definition: CadBlockDefinition; insert: CadBlockReference } {
  const selected = [...new Set(args.selectedHandles)];
  if (!selected.length) throw new RangeError("BLOCK requires a non-empty selection.");
  const entities = selected.map((handle) => {
    const entity = document.entities.find((candidate) => candidate.handle === handle);
    if (!entity) throw new RangeError(`Selected entity does not exist: ${handle}.`);
    const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
    if (layer?.locked) throw new RangeError(`Cannot define BLOCK from locked-layer entity: ${handle}.`);
    return entity;
  });
  const definition = blockDefinition(document, { id: args.id, name: args.name, basePoint: args.basePoint, entities, releasedModelHandles: selected, ...(args.attributes ? { attributes: args.attributes } : {}) });
  const remaining = document.entities.filter((entity) => !selected.includes(entity.handle));
  const provisional = { ...structuredClone(document), entities: remaining, blocks: [...document.blocks, definition] };
  const insert = createBlockInsert(provisional, { handle: args.insertHandle, layerId: args.layerId ?? document.currentLayerId, blockId: definition.id, insertion: args.basePoint });
  return { changes: drawingReplacement(document, [...remaining, insert], [...document.blocks, definition]), definition, insert };
}

function synchronizedAttributeValues(definition: CadBlockDefinition, values: Readonly<Record<string, string>> = {}): Record<string, string> | undefined {
  const attributes = readBlockAttributes(definition);
  if (!attributes.length) return undefined;
  return Object.fromEntries(attributes.map((attribute) => {
    const existing = Object.entries(values).find(([tag]) => tag.toLocaleUpperCase("en-US") === attribute.tag.toLocaleUpperCase("en-US"))?.[1];
    return [attribute.tag, attribute.constant ? attribute.defaultValue : existing ?? attribute.defaultValue];
  }));
}

function withSynchronizedAttributes(insert: CadBlockReference, definition: CadBlockDefinition): CadBlockReference {
  const next = structuredClone(insert);
  const attributes = synchronizedAttributeValues(definition, insert.attributes);
  if (attributes) next.attributes = attributes;
  else delete next.attributes;
  return next;
}

export function redefineBlock(document: KDrawDocumentV1, args: { blockId: string; basePoint: CadPoint2; entities: CadEntity[]; attributes?: BlockAttributeDefinition[]; syncAttributes?: boolean }): { changes: CadChange[]; definition: CadBlockDefinition; affectedInsertHandles: string[] } {
  const existing = document.blocks.find((block) => block.id === args.blockId);
  if (!existing) throw new RangeError(`Unknown block: ${args.blockId}.`);
  const definition = blockDefinition(document, { id: existing.id, name: existing.name, basePoint: args.basePoint, entities: args.entities, attributes: args.attributes ?? readBlockAttributes(existing) }, existing.id);
  const newTags = new Set(readBlockAttributes(definition).map((attribute) => attribute.tag.toLocaleUpperCase("en-US")));
  const affectedInsertHandles: string[] = [];
  const entities = document.entities.map((entity) => {
    if (entity.kind !== "blockRef" || entity.blockId !== existing.id) return entity;
    affectedInsertHandles.push(entity.handle);
    ensureWritableLayer(document, entity.layerId, `INSERT ${entity.handle}`);
    if (args.syncAttributes) return withSynchronizedAttributes(entity, definition);
    const removed = Object.keys(entity.attributes ?? {}).find((tag) => !newTags.has(tag.toLocaleUpperCase("en-US")));
    if (removed) throw new RangeError(`Cannot remove attribute ${removed}; existing INSERT ${entity.handle} still stores a value. Use attribute sync.`);
    return entity;
  });
  const blocks = document.blocks.map((block) => block.id === existing.id ? definition : block);
  return { changes: drawingReplacement(document, entities, blocks), definition, affectedInsertHandles };
}

function handleAllocator(document: KDrawDocumentV1): () => string {
  const used = new Set([...document.entities, ...document.blocks.flatMap((block) => block.entities)].map((entity) => entity.handle.toLocaleUpperCase("en-US")));
  let next = 0xfn;
  for (const handle of used) if (/^[0-9A-F]+$/u.test(handle)) next = BigInt(`0x${handle}`) > next ? BigInt(`0x${handle}`) : next;
  return () => {
    let candidate: string;
    do { next += 1n; candidate = next.toString(16).toUpperCase(); } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };
}

export type ExplodeNestedMode = "preserve" | "recursive";

function explodeDefinition(
  document: KDrawDocumentV1,
  definition: CadBlockDefinition,
  insert: CadBlockReference,
  mode: ExplodeNestedMode,
  allocate: () => string,
): CadEntity[] {
  const exploded: CadEntity[] = [];
  for (const entity of definition.entities) {
    if (entity.kind === "proxy") throw new RangeError(`Cannot EXPLODE proxy child: ${entity.handle}.`);
    ensureWritableLayer(document, entity.layerId, `Block member ${entity.handle}`);
    const transformed = transformExplodedEntity(entity, definition, insert);
    if (transformed.kind === "blockRef" && mode === "recursive") {
      const nested = document.blocks.find((block) => block.id === transformed.blockId);
      if (!nested) throw new RangeError(`Missing nested block definition: ${transformed.blockId}.`);
      exploded.push(...explodeDefinition(document, nested, transformed, mode, allocate));
    } else exploded.push({ ...transformed, handle: allocate() } as CadEntity);
  }
  for (const attribute of readBlockAttributes(definition)) {
    if (attribute.invisible) continue;
    const text = insert.attributes?.[attribute.tag] ?? attribute.defaultValue;
    exploded.push({
      kind: "text", handle: allocate(), layerId: insert.layerId,
      position: transformBlockPoint(attribute.position, definition, insert), text,
      height: attribute.height * Math.sqrt(Math.abs(insert.scale.x * insert.scale.y)), rotationRad: (attribute.rotationRad ?? 0) + insert.rotationRad,
      ...(attribute.textStyleId ? { styleId: attribute.textStyleId } : {}),
    });
  }
  return exploded;
}

export function explodeBlockReference(document: KDrawDocumentV1, handle: string, mode: ExplodeNestedMode = "preserve"): { changes: EntityChange[]; resultHandles: string[] } {
  const insert = document.entities.find((entity): entity is CadBlockReference => entity.handle === handle && entity.kind === "blockRef");
  if (!insert) throw new RangeError(`Unknown INSERT: ${handle}.`);
  const layer = document.layers.find((candidate) => candidate.id === insert.layerId);
  if (layer?.locked) throw new RangeError(`Cannot EXPLODE INSERT on locked layer: ${handle}.`);
  const definition = document.blocks.find((block) => block.id === insert.blockId);
  if (!definition) throw new RangeError(`Missing block definition: ${insert.blockId}.`);
  assertAcyclicBlocks(document.blocks);
  const allocate = handleAllocator(document);
  const exploded = explodeDefinition(document, definition, insert, mode, allocate);
  return { changes: [{ type: "delete", handle }, ...exploded.map((entity) => ({ type: "put" as const, entity }))], resultHandles: exploded.map((entity) => entity.handle) };
}

export function editBlockAttributes(document: KDrawDocumentV1, handle: string, values: Record<string, string>): EntityChange {
  const insert = document.entities.find((entity): entity is CadBlockReference => entity.handle === handle && entity.kind === "blockRef");
  if (!insert) throw new RangeError(`Unknown INSERT: ${handle}.`);
  ensureWritableLayer(document, insert.layerId, `INSERT ${handle}`);
  const definition = document.blocks.find((block) => block.id === insert.blockId);
  if (!definition) throw new RangeError(`Missing block definition: ${insert.blockId}.`);
  const merged = { ...(insert.attributes ?? {}), ...values };
  const attributes = defaultAttributeValues(definition, merged);
  return { type: "put", entity: { ...structuredClone(insert), ...(attributes ? { attributes } : {}) } };
}

export function syncBlockAttributes(document: KDrawDocumentV1, blockId: string): { changes: EntityChange[]; resultHandles: string[] } {
  const definition = document.blocks.find((block) => block.id === blockId);
  if (!definition) throw new RangeError(`Unknown block: ${blockId}.`);
  validateAttributeDefinitions(document, readBlockAttributes(definition));
  const changes: EntityChange[] = [];
  const resultHandles: string[] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "blockRef" || entity.blockId !== blockId) continue;
    ensureWritableLayer(document, entity.layerId, `INSERT ${entity.handle}`);
    const next = withSynchronizedAttributes(entity, definition);
    if (JSON.stringify(next) !== JSON.stringify(entity)) changes.push({ type: "put", entity: next });
    resultHandles.push(entity.handle);
  }
  if (!resultHandles.length) throw new RangeError(`ATTSYNC found no INSERT for block: ${blockId}.`);
  return { changes, resultHandles };
}
