import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { generateCadSnapCandidates } from "../../../packages/cad-renderer/src/snap.js";
import { PrecisionLayersShellContract } from "../../../apps/web/src/features/precision/shell-contract.js";

const modes = [
  "endpoint", "midpoint", "center", "quadrant", "intersection", "apparentIntersection",
  "extension", "insertion", "perpendicular", "tangent", "nearest", "geometricCenter", "parallel",
] as const;

const horizontal = { kind: "line" as const, handle: "B", layerId: "0", start: { x: 0, y: 0 }, end: { x: 4, y: 0 } };
const vertical = { kind: "line" as const, handle: "A", layerId: "0", start: { x: 10, y: 5 }, end: { x: 10, y: 9 } };
const apparent = generateCadSnapCandidates([horizontal, vertical], {
  modes: ["intersection", "apparentIntersection"], cursor: { x: 10, y: 0 }, aperture: 0,
});

const document = createEmptyDocument({ documentId: "precision-snaps-wave12" });
document.entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: `H${index}`,
  layerId: "0",
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));

const buildStarted = performance.now();
const shell = new PrecisionLayersShellContract(document, {
  settings: {
    polarIncrementRad: Math.PI / 4,
    gridSpacingX: 1,
    gridSpacingY: 1,
    aperture: 999,
    aperturePixels: 10,
    worldUnitsPerCssPixel: 0.025,
  },
  units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
  initialPrecision: { ortho: true, polar: true, grid: true, snap: true, osnap: true, otrack: true, osnapModes: modes },
});
const buildMs = performance.now() - buildStarted;
const timings: number[] = [];
let previewEqualsCommit = true;
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  const frame = shell.preparePointer({ basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.1, y: 0.01 }, input: "5" }).resolve();
  timings.push(performance.now() - started);
  previewEqualsCommit &&= JSON.stringify(frame.preview) === JSON.stringify(frame.commit);
}
const sorted = [...timings].sort((first, second) => first - second);
const selection = shell.select({ x: 5, y: 0 }, 6);

console.log(JSON.stringify({
  baselineCommit: "633d32ae052951ac475696e7e900cd3170cb59bd",
  branch: "work12/reio-precision-snaps",
  featureRows: ["F-045", "F-046", "F-047", "F-048", "F-049", "F-050", "F-051"],
  osnapModeCount: modes.length,
  apparentIntersection: apparent[0],
  gridReadback: shell.precisionModeReadback().grid,
  apertureReadback: shell.precisionModeReadback().snap,
  entityCount: document.entities.length,
  queryIterations: timings.length,
  buildMs: Number(buildMs.toFixed(3)),
  p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3)),
  maxMs: Number(sorted.at(-1)!.toFixed(3)),
  selectionHits: selection.length,
  previewEqualsCommit,
  autocadLiveReadback: "NOT_RUN",
  kuubikBrowserLiveReadback: "NOT_RUN",
  gridVisualIntegration: "BLOCKED_VISUAL_OWNER",
  parityScoresChanged: false,
}, null, 2));
