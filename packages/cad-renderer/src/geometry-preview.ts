import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import { pickCadEntity, type CadPickHit } from "./selection.js";

export interface GeometryPreviewSnapshot {
  commandId: string;
  entities: CadEntity[];
}

export function createGeometryPreview(commandId: string, entities: readonly CadEntity[]): GeometryPreviewSnapshot {
  if (commandId.trim() === "") throw new TypeError("Preview command id must not be empty.");
  const handles = new Set<string>();
  for (const entity of entities) {
    if (handles.has(entity.handle)) throw new TypeError(`Preview entity handle ${entity.handle} is duplicated.`);
    handles.add(entity.handle);
  }
  return { commandId, entities: structuredClone([...entities]) };
}

export function hitTestGeometryPreview(
  preview: GeometryPreviewSnapshot,
  point: CadPoint2,
  tolerance: number,
): CadPickHit | null {
  let closest: CadPickHit | null = null;
  for (const entity of preview.entities) {
    const hit = pickCadEntity(entity, point, tolerance);
    if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
  }
  return closest ? structuredClone(closest) : null;
}
