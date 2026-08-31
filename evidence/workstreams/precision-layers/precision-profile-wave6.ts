import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "../../../apps/web/src/features/precision/shell-contract.js";

const document = createEmptyDocument({ documentId: "precision-profile-wave6" });
document.entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: index.toString(16).toUpperCase(),
  layerId: "0",
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));

const buildStarted = performance.now();
const contract = new PrecisionLayersShellContract(document, {
  settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
  units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
  inputFormat: { decimalSeparator: ",", defaultAngleUnit: "deg" },
  initialPrecision: { ortho: true, polar: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
});
const buildMs = performance.now() - buildStarted;
const timings: number[] = [];
let previewCommitEqual = true;
let firstReadback: ReturnType<ReturnType<typeof contract.preparePointer>["resolve"]> | undefined;
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  const resolved = contract.preparePointer({
    basePoint: { x: -5, y: 0 },
    cursorPoint: { x: 0.1, y: 0.01 },
    input: "5",
  }).resolve();
  timings.push(performance.now() - started);
  firstReadback ??= resolved;
  previewCommitEqual &&= JSON.stringify(resolved.preview) === JSON.stringify(resolved.commit)
    && JSON.stringify(resolved.dynamicInput.point) === JSON.stringify(resolved.commit.point);
}

const localeReadback = contract.preparePointer({
  basePoint: { x: 100, y: 100 },
  cursorPoint: { x: 999, y: 999 },
  input: "@1,5m;-250,25mm",
}).resolve();
const sorted = [...timings].sort((first, second) => first - second);

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  profile: {
    entityCount: document.entities.length,
    queryIterations: timings.length,
    buildMs,
    p50QueryMs: sorted[Math.floor(sorted.length * 0.5)],
    p95QueryMs: sorted[Math.floor(sorted.length * 0.95)],
    maxQueryMs: sorted.at(-1),
  },
  contracts: {
    previewCommitDynamicEqual: previewCommitEqual,
    directDistanceSource: firstReadback?.commit.source,
    directDistancePoint: firstReadback?.commit.point,
    localeParsedInput: localeReadback.request.input,
    localeCommittedPoint: localeReadback.commit.point,
    explicitInputSnapCandidates: localeReadback.snapCandidateIds.length,
  },
}, null, 2)}\n`);
