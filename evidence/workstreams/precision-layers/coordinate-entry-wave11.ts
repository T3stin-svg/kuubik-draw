import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "../../../apps/web/src/features/precision/coordinate-entry-adapter.js";
import { PrecisionLayersShellContract } from "../../../apps/web/src/features/precision/shell-contract.js";

const document = createEmptyDocument({ documentId: "coordinate-wave11", now: "2026-08-31T00:00:00Z" });
document.entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: `H${index}`,
  layerId: "0",
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));

const buildStarted = performance.now();
const shell = new PrecisionLayersShellContract(document, {
  settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
  units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
  inputFormat: { decimalSeparator: ",", defaultAngleUnit: "deg" },
  initialPrecision: { ortho: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
});
const buildMs = performance.now() - buildStarted;

const timings: number[] = [];
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  const resolved = shell.preparePointer({ basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.1, y: 0.01 }, input: "5" }).resolve();
  if (JSON.stringify(resolved.preview) !== JSON.stringify(resolved.commit)) throw new Error("Preview/commit mismatch.");
  timings.push(performance.now() - started);
}
const sorted = [...timings].sort((first, second) => first - second);
const p95Ms = sorted[Math.floor(sorted.length * 0.95)]!;
const zero = shell.preparePointer({ basePoint: { x: 123.25, y: 456.75 }, cursorPoint: { x: 0, y: 0 }, input: "-0" }).resolve();
const negativePolar = shell.preparePointer({ basePoint: { x: 5, y: 5 }, cursorPoint: { x: 999, y: 999 }, input: "@10<-450" }).resolve();

const session = new CadSession(document);
const revisions: number[] = [];
const entry = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input), {
  opIdPrefix: "wave11", now: () => "2026-08-31T00:01:00Z", onDocumentChange: (value) => revisions.push(value.revision),
});
entry.start({ basePoint: { x: 100, y: 100 }, cursorPoint: { x: 999, y: 999 } });
const invalid = entry.preview("@1,5,2,5");
const preview = entry.retry("@1,5m;-250,25mm");
const committed = entry.commit((point) => ({
  commandId: "LINE_BY_COORDINATE",
  changes: [{ type: "put", entity: { kind: "line", handle: "CREATED", layerId: "0", start: { x: 100, y: 100 }, end: point } }],
  resultHandles: ["CREATED"],
}));
entry.undo();
const undoRestored = !entry.document.entities.some((entity) => entity.handle === "CREATED");
entry.redo();
const redoRestored = entry.document.entities.at(-1)?.handle === "CREATED";

console.log(JSON.stringify({
  baselineCommit: "608ce72ff9ab5ecf699ecd6026051e11be275b85",
  featureRows: ["F-041", "F-042", "F-044"],
  entityCount: 50_000,
  queryIterations: timings.length,
  buildMs: Number(buildMs.toFixed(3)),
  p95Ms: Number(p95Ms.toFixed(3)),
  retryStatus: invalid.status,
  localeUnitsPoint: preview.preview?.point,
  previewEqualsCommit: JSON.stringify(committed.preview) === JSON.stringify(committed.pointCommit),
  committedRevision: committed.committed.committedRevision,
  revisions,
  undoRestored,
  redoRestored,
  zeroDistancePoint: zero.commit.point,
  zeroDistanceCandidateCount: zero.snapCandidateIds.length,
  negativePolarPoint: negativePolar.commit.point,
  autocadLiveReadback: "NOT_RUN",
  kuubikBrowserLiveReadback: "NOT_RUN",
  appCommandLineIntegration: "BLOCKED_INTEGRATION_OWNER",
  parityScoresChanged: false,
}, null, 2));
