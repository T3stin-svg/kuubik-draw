import { profileCadSpatialIndexes } from "../../../packages/cad-renderer/src/selection-index.js";

const entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: index.toString(16).toUpperCase(),
  layerId: "0",
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));

const result = profileCadSpatialIndexes(entities, {
  selectionPoint: { x: 5, y: 0 },
  selectionTolerance: 6,
  snap: { modes: ["endpoint", "midpoint", "nearest", "intersection"], cursor: { x: 5, y: 0 }, aperture: 6 },
  queryIterations: 100,
});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  profile: result.profile,
  firstSelectionHandle: result.selection[0]?.handle ?? null,
}, null, 2)}\n`);
