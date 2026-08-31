import type { CadEntity, CadLayer } from "@kuubik/cad-schema";

export type CadLayerPurpose = "render" | "select" | "snap" | "print" | "edit";

export interface CadLayerParticipation {
  participates: boolean;
  reason: "ok" | "missing-layer" | "layer-off" | "layer-frozen" | "not-plottable" | "layer-locked";
}

/**
 * Single layer-state contract:
 * off/frozen => no render, selection, snap or print;
 * locked => visible/selectable/snappable/printable but not editable;
 * non-plottable => only print is suppressed.
 */
export function layerParticipation(layer: CadLayer | undefined, purpose: CadLayerPurpose): CadLayerParticipation {
  if (!layer) return { participates: false, reason: "missing-layer" };
  if (!layer.visible) return { participates: false, reason: "layer-off" };
  if (layer.frozen) return { participates: false, reason: "layer-frozen" };
  if (purpose === "print" && !layer.plottable) return { participates: false, reason: "not-plottable" };
  if (purpose === "edit" && layer.locked) return { participates: false, reason: "layer-locked" };
  return { participates: true, reason: "ok" };
}

export function entityParticipates(
  entity: CadEntity,
  layers: readonly CadLayer[] | ReadonlyMap<string, CadLayer>,
  purpose: CadLayerPurpose,
): CadLayerParticipation {
  const layer = Array.isArray(layers)
    ? layers.find((candidate: CadLayer) => candidate.id === entity.layerId)
    : (layers as ReadonlyMap<string, CadLayer>).get(entity.layerId);
  return layerParticipation(layer, purpose);
}

export function filterCadEntitiesForPurpose(
  entities: readonly CadEntity[],
  layers: readonly CadLayer[] | ReadonlyMap<string, CadLayer>,
  purpose: CadLayerPurpose,
): CadEntity[] {
  return entities.filter((entity) => entityParticipates(entity, layers, purpose).participates);
}
