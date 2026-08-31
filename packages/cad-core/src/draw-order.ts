import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange } from "./transaction.js";

export type CadDrawOrderAction = "front" | "back" | "above" | "below";

function uniqueHandles(handles: readonly string[]): string[] {
  return [...new Set(handles)];
}

export function reorderedCadEntities(
  entities: readonly CadEntity[],
  handles: readonly string[],
  action: CadDrawOrderAction,
  referenceHandle?: string,
): CadEntity[] {
  const selected = uniqueHandles(handles);
  if (selected.length === 0) throw new TypeError("Draw order requires at least one handle.");
  const selectedSet = new Set(selected);
  if (selected.some((handle) => !entities.some((entity) => entity.handle === handle))) throw new RangeError("Draw order contains a missing handle.");
  if ((action === "above" || action === "below") && (!referenceHandle || selectedSet.has(referenceHandle))) throw new TypeError("Relative draw order requires an unselected reference handle.");
  const moving = entities.filter((entity) => selectedSet.has(entity.handle));
  const remaining = entities.filter((entity) => !selectedSet.has(entity.handle));
  let index = action === "front" ? remaining.length : 0;
  if (action === "above" || action === "below") {
    const referenceIndex = remaining.findIndex((entity) => entity.handle === referenceHandle);
    if (referenceIndex < 0) throw new RangeError(`Reference handle ${referenceHandle} does not exist.`);
    index = referenceIndex + (action === "above" ? 1 : 0);
  }
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
}

/** Minimal atomic delete/reinsert changes; transaction inverse preserves original indices. */
export function planDrawOrderChanges(
  document: KDrawDocumentV1,
  handles: readonly string[],
  action: CadDrawOrderAction,
  referenceHandle?: string,
): { commandId: "DRAWORDER"; args: Record<string, unknown>; changes: CadChange[]; orderedHandles: string[] } {
  const ordered = reorderedCadEntities(document.entities, handles, action, referenceHandle);
  const before = document.entities.map((entity) => entity.handle);
  const after = ordered.map((entity) => entity.handle);
  if (before.every((handle, index) => handle === after[index])) throw new TypeError("Draw order makes no semantic change.");
  // Rebuild only the model-space order. Stable handles and entity values remain unchanged.
  const changes: CadChange[] = [
    ...document.entities.map((entity) => ({ type: "delete" as const, handle: entity.handle })),
    ...ordered.map((entity, index) => ({ type: "put" as const, entity: structuredClone(entity), index })),
  ];
  return { commandId: "DRAWORDER", args: { action, handles: uniqueHandles(handles), ...(referenceHandle ? { referenceHandle } : {}) }, changes, orderedHandles: after };
}
