import { assertKDrawDocumentV1, type CadEntity, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import { entityParticipates } from "./layer-policy.js";
import type { CadChange } from "./transaction.js";

export type CadDrawOrderAction = "front" | "back" | "above" | "below";

function uniqueHandles(handles: readonly string[]): string[] {
  return [...new Set(handles)];
}

const DRAW_ORDER_ACTIONS: ReadonlySet<string> = new Set(["front", "back", "above", "below"]);

function validatedHandles(handles: readonly string[]): string[] {
  if (!Array.isArray(handles) || handles.length === 0) throw new TypeError("Draw order requires at least one handle.");
  if (handles.some((handle) => typeof handle !== "string" || handle.length === 0)) {
    throw new TypeError("Draw order handles must be non-empty strings.");
  }
  return uniqueHandles(handles);
}

function validateRequest(
  entities: readonly CadEntity[],
  handles: readonly string[],
  action: CadDrawOrderAction,
  referenceHandle?: string,
): { selectedSet: Set<string>; moving: CadEntity[] } {
  if (!DRAW_ORDER_ACTIONS.has(action)) throw new TypeError(`Unsupported draw-order action: ${String(action)}.`);
  const selected = validatedHandles(handles);
  const entityHandles = new Set<string>();
  for (const entity of entities) {
    if (entityHandles.has(entity.handle)) throw new TypeError(`Draw order contains duplicate entity handle ${entity.handle}.`);
    entityHandles.add(entity.handle);
  }
  const selectedSet = new Set(selected);
  if (selected.some((handle) => !entityHandles.has(handle))) throw new RangeError("Draw order contains a missing handle.");
  const relative = action === "above" || action === "below";
  if (relative && (!referenceHandle || selectedSet.has(referenceHandle))) {
    throw new TypeError("Relative draw order requires an unselected reference handle.");
  }
  if (!relative && referenceHandle !== undefined) throw new TypeError("Front/back draw order does not accept a reference handle.");
  if (relative && !entityHandles.has(referenceHandle!)) throw new RangeError(`Reference handle ${referenceHandle} does not exist.`);
  return { selectedSet, moving: entities.filter((entity) => selectedSet.has(entity.handle)) };
}

export function reorderedCadEntities(
  entities: readonly CadEntity[],
  handles: readonly string[],
  action: CadDrawOrderAction,
  referenceHandle?: string,
): CadEntity[] {
  const { selectedSet, moving } = validateRequest(entities, handles, action, referenceHandle);
  const remaining = entities.filter((entity) => !selectedSet.has(entity.handle));
  let index = action === "front" ? remaining.length : 0;
  if (action === "above" || action === "below") {
    const referenceIndex = remaining.findIndex((entity) => entity.handle === referenceHandle);
    index = referenceIndex + (action === "above" ? 1 : 0);
  }
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
}

export interface CadDrawOrderReadback {
  orderedHandles: string[];
  backHandle: string | null;
  frontHandle: string | null;
}

/** Fail-closed JSON reopen boundary for the model-space draw stack. */
export function readCadDrawOrderContract(document: KDrawDocumentV1): CadDrawOrderReadback {
  assertKDrawDocumentV1(document);
  const layerIds = new Set(document.layers.map((layer) => layer.id));
  const orderedHandles: string[] = [];
  const seen = new Set<string>();
  for (const entity of document.entities) {
    if (seen.has(entity.handle)) throw new TypeError(`Draw order contains duplicate entity handle ${entity.handle}.`);
    if (!layerIds.has(entity.layerId)) throw new RangeError(`Draw-order entity ${entity.handle} references missing layer ${entity.layerId}.`);
    seen.add(entity.handle);
    orderedHandles.push(entity.handle);
  }
  return {
    orderedHandles,
    backHandle: orderedHandles[0] ?? null,
    frontHandle: orderedHandles.at(-1) ?? null,
  };
}

/** Minimal atomic delete/reinsert changes; transaction inverse preserves original indices. */
export function planDrawOrderChanges(
  document: KDrawDocumentV1,
  handles: readonly string[],
  action: CadDrawOrderAction,
  referenceHandle?: string,
): { commandId: "DRAWORDER"; args: Record<string, unknown>; changes: CadChange[]; orderedHandles: string[] } {
  readCadDrawOrderContract(document);
  const ordered = reorderedCadEntities(document.entities, handles, action, referenceHandle);
  const before = document.entities.map((entity) => entity.handle);
  const after = ordered.map((entity) => entity.handle);
  const layers = new Map(document.layers.map((layer) => [layer.id, layer]));
  const requestedHandles = new Set(handles);
  const moving = ordered.filter((entity) => requestedHandles.has(entity.handle));
  for (const entity of moving) {
    const eligibility = entityParticipates(entity, layers, "edit");
    if (!eligibility.participates) throw new TypeError(`Entity ${entity.handle} cannot change draw order: ${eligibility.reason}.`);
  }
  if (before.every((handle, index) => handle === after[index])) throw new TypeError("Draw order makes no semantic change.");
  const movingHandles = moving.map((entity) => entity.handle);
  const movingSet = new Set(movingHandles);
  const insertionIndex = after.findIndex((handle) => movingSet.has(handle));
  // Delete/reinsert only the moving stable group; inverse changes restore exact indices.
  const changes: CadChange[] = [
    ...movingHandles.map((handle) => ({ type: "delete" as const, handle })),
    ...moving.map((entity, offset) => ({ type: "put" as const, entity: structuredClone(entity), index: insertionIndex + offset })),
  ];
  return { commandId: "DRAWORDER", args: { action, handles: movingHandles, ...(referenceHandle ? { referenceHandle } : {}) }, changes, orderedHandles: after };
}
