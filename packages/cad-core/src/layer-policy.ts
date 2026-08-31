import type { CadAppearance, CadEntity, CadLayer, CadLinetype } from "@kuubik/cad-schema";
import { assertCadAppearance } from "./plot-style.js";

export type CadLayerPurpose = "render" | "select" | "snap" | "print" | "edit";

export interface CadLayerParticipation {
  participates: boolean;
  reason: "ok" | "missing-layer" | "layer-off" | "layer-frozen" | "not-plottable" | "layer-locked";
}

export type CadLayerPropertySource = "entity" | "layer" | "default";

export interface CadLayerPropertyIndex {
  layers: ReadonlyMap<string, CadLayer>;
  linetypes: ReadonlyMap<string, CadLinetype>;
}

export interface ResolvedCadLayerProperties {
  layerId: string;
  color: string | null;
  colorMethod: "aci" | "trueColor" | null;
  aciIndex: number | null;
  linetypeId: string | null;
  linetypeScale: number;
  lineweightMm: number | null;
  transparency: number | null;
  sources: {
    color: CadLayerPropertySource;
    linetype: CadLayerPropertySource;
    linetypeScale: CadLayerPropertySource;
    lineweight: CadLayerPropertySource;
    transparency: CadLayerPropertySource;
  };
}

function indexedById<T extends { id: string }>(values: readonly T[], label: string): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) throw new TypeError(`Duplicate ${label} id ${value.id}.`);
    result.set(value.id, value);
  }
  return result;
}

/** Builds the lookup contract reused by ByLayer and 50k-entity consumers. */
export function createCadLayerPropertyIndex(
  layers: readonly CadLayer[],
  linetypes: readonly CadLinetype[],
): CadLayerPropertyIndex {
  return { layers: indexedById(layers, "layer"), linetypes: indexedById(linetypes, "linetype") };
}

function appearanceSource(entityValue: unknown, layerValue: unknown): CadLayerPropertySource {
  if (entityValue !== undefined) return "entity";
  if (layerValue !== undefined) return "layer";
  return "default";
}

/** Resolves every F-076..F-078 ByLayer property from one indexed contract. */
export function resolveCadEntityLayerProperties(
  entity: Pick<CadEntity, "layerId" | "appearance">,
  index: CadLayerPropertyIndex,
): ResolvedCadLayerProperties {
  const layer = index.layers.get(entity.layerId);
  if (!layer) throw new RangeError(`Layer ${entity.layerId} does not exist.`);
  assertCadAppearance(entity.appearance, "Entity appearance");
  assertCadAppearance(layer.appearance, `Layer ${layer.name} appearance`);

  const entityColor = entity.appearance?.color;
  const layerColor = layer.appearance?.color;
  const colorSource = appearanceSource(entityColor, layerColor);
  const colorAppearance: CadAppearance | undefined = colorSource === "entity"
    ? entity.appearance
    : colorSource === "layer"
      ? layer.appearance
      : undefined;
  const linetypeId = entity.appearance?.linetypeId ?? layer.appearance?.linetypeId ?? null;
  if (linetypeId !== null && !index.linetypes.has(linetypeId)) {
    throw new RangeError(`Linetype ${linetypeId} does not exist.`);
  }

  return {
    layerId: layer.id,
    color: colorAppearance?.color ?? null,
    colorMethod: colorAppearance?.color === undefined ? null : colorAppearance.colorMethod ?? "aci",
    aciIndex: colorAppearance?.aciIndex ?? null,
    linetypeId,
    linetypeScale: entity.appearance?.linetypeScale ?? layer.appearance?.linetypeScale ?? 1,
    lineweightMm: entity.appearance?.lineweightMm ?? layer.appearance?.lineweightMm ?? null,
    transparency: entity.appearance?.transparency ?? layer.appearance?.transparency ?? null,
    sources: {
      color: colorSource,
      linetype: appearanceSource(entity.appearance?.linetypeId, layer.appearance?.linetypeId),
      linetypeScale: appearanceSource(entity.appearance?.linetypeScale, layer.appearance?.linetypeScale),
      lineweight: appearanceSource(entity.appearance?.lineweightMm, layer.appearance?.lineweightMm),
      transparency: appearanceSource(entity.appearance?.transparency, layer.appearance?.transparency),
    },
  };
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
