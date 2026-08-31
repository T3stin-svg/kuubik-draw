import { profileCadSpatialIndexes } from "../../../packages/cad-renderer/src/selection-index.js";
import { entityParticipates } from "../../../packages/cad-core/src/layer-policy.js";

const layers = [
  { id: "normal", name: "normal", visible: true, frozen: false, locked: false, plottable: true },
  { id: "locked", name: "locked", visible: true, frozen: false, locked: true, plottable: true },
  { id: "off", name: "off", visible: false, frozen: false, locked: false, plottable: true },
  { id: "frozen", name: "frozen", visible: true, frozen: true, locked: false, plottable: true },
] as const;

const entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: index.toString(16).toUpperCase(),
  layerId: layers[index % layers.length]!.id,
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));

const result = profileCadSpatialIndexes(entities, {
  selectionPoint: { x: 5, y: 0 },
  selectionTolerance: 6,
  snap: {
    modes: ["endpoint", "midpoint", "center", "quadrant", "intersection", "extension", "insertion", "perpendicular", "tangent", "nearest", "geometricCenter", "parallel"],
    cursor: { x: 5, y: 0 }, aperture: 6, referencePoint: { x: 5, y: 5 }, referenceHandles: ["0"],
  },
  eligible: (entity) => entityParticipates(entity, layers, "snap").participates,
  queryIterations: 100,
});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  profile: result.profile,
  firstSelectionHandle: result.selection[0]?.handle ?? null,
}, null, 2)}\n`);
