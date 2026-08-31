import { assertKDrawDocumentV1, type CadBlockDefinition, type CadBlockReference, type CadEntity, type CadPoint2, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import { replaceDrawingContent, type CadChange, type EntityChange } from "../transaction.js";
import { readBlockAttributes, withBlockAttributes, type BlockAttributeDefinition, type KuubikBlockDefinition } from "./contracts.js";
import { transformBlockPoint, transformExplodedEntity } from "./transform.js";

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
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

function blockDefinition(document: KDrawDocumentV1, args: { id: string; name: string; basePoint: CadPoint2; entities: CadEntity[]; attributes?: BlockAttributeDefinition[] }, replacingId?: string): KuubikBlockDefinition {
  validateDefinitionIdentity(document, args.id, args.name, replacingId);
  validateAttributeDefinitions(document, args.attributes ?? []);
  if (!args.entities.length) throw new RangeError("Block definition requires at least one entity.");
  const definition = withBlockAttributes({ id: args.id, name: args.name, basePoint: finitePoint(args.basePoint, "Block base point"), entities: structuredClone(args.entities) }, args.attributes ?? []);
  const blocks = replacingId ? document.blocks.map((block) => block.id === replacingId ? definition : block) : [...document.blocks, definition];
  assertAcyclicBlocks(blocks);
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
  if (!args.handle.trim() || [...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle === args.handle)) throw new RangeError(`Invalid or duplicate INSERT handle: ${args.handle}.`);
  if (!document.layers.some((layer) => layer.id === args.layerId)) throw new RangeError(`Unknown layer: ${args.layerId}.`);
  const definition = document.blocks.find((block) => block.id === args.blockId);
  if (!definition) throw new RangeError(`Unknown block: ${args.blockId}.`);
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
  const definition = blockDefinition(document, { id: args.id, name: args.name, basePoint: args.basePoint, entities, ...(args.attributes ? { attributes: args.attributes } : {}) });
  const remaining = document.entities.filter((entity) => !selected.includes(entity.handle));
  const provisional = { ...structuredClone(document), entities: remaining, blocks: [...document.blocks, definition] };
  const insert = createBlockInsert(provisional, { handle: args.insertHandle, layerId: args.layerId ?? document.currentLayerId, blockId: definition.id, insertion: args.basePoint });
  return { changes: drawingReplacement(document, [...remaining, insert], [...document.blocks, definition]), definition, insert };
}

export function redefineBlock(document: KDrawDocumentV1, args: { blockId: string; basePoint: CadPoint2; entities: CadEntity[]; attributes?: BlockAttributeDefinition[] }): { changes: CadChange[]; definition: CadBlockDefinition } {
  const existing = document.blocks.find((block) => block.id === args.blockId);
  if (!existing) throw new RangeError(`Unknown block: ${args.blockId}.`);
  const definition = blockDefinition(document, { id: existing.id, name: existing.name, basePoint: args.basePoint, entities: args.entities, attributes: args.attributes ?? readBlockAttributes(existing) }, existing.id);
  const newTags = new Set(readBlockAttributes(definition).map((attribute) => attribute.tag.toLocaleUpperCase("en-US")));
  for (const insert of document.entities) {
    if (insert.kind !== "blockRef" || insert.blockId !== existing.id) continue;
    const removed = Object.keys(insert.attributes ?? {}).find((tag) => !newTags.has(tag.toLocaleUpperCase("en-US")));
    if (removed) throw new RangeError(`Cannot remove attribute ${removed}; existing INSERT ${insert.handle} still stores a value.`);
  }
  const blocks = document.blocks.map((block) => block.id === existing.id ? definition : block);
  return { changes: drawingReplacement(document, document.entities, blocks), definition };
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

export function explodeBlockReference(document: KDrawDocumentV1, handle: string): { changes: EntityChange[]; resultHandles: string[] } {
  const insert = document.entities.find((entity): entity is CadBlockReference => entity.handle === handle && entity.kind === "blockRef");
  if (!insert) throw new RangeError(`Unknown INSERT: ${handle}.`);
  const layer = document.layers.find((candidate) => candidate.id === insert.layerId);
  if (layer?.locked) throw new RangeError(`Cannot EXPLODE INSERT on locked layer: ${handle}.`);
  const definition = document.blocks.find((block) => block.id === insert.blockId);
  if (!definition) throw new RangeError(`Missing block definition: ${insert.blockId}.`);
  assertAcyclicBlocks(document.blocks);
  const allocate = handleAllocator(document);
  const exploded = definition.entities.map((entity) => ({ ...transformExplodedEntity(entity, definition, insert), handle: allocate() } as CadEntity));
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
  return { changes: [{ type: "delete", handle }, ...exploded.map((entity) => ({ type: "put" as const, entity }))], resultHandles: exploded.map((entity) => entity.handle) };
}

export function editBlockAttributes(document: KDrawDocumentV1, handle: string, values: Record<string, string>): EntityChange {
  const insert = document.entities.find((entity): entity is CadBlockReference => entity.handle === handle && entity.kind === "blockRef");
  if (!insert) throw new RangeError(`Unknown INSERT: ${handle}.`);
  const definition = document.blocks.find((block) => block.id === insert.blockId);
  if (!definition) throw new RangeError(`Missing block definition: ${insert.blockId}.`);
  const merged = { ...(insert.attributes ?? {}), ...values };
  const attributes = defaultAttributeValues(definition, merged);
  return { type: "put", entity: { ...structuredClone(insert), ...(attributes ? { attributes } : {}) } };
}
