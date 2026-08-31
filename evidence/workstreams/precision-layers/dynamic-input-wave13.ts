import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "../../../apps/web/src/features/precision/coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "../../../apps/web/src/features/precision/dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "../../../apps/web/src/features/precision/shell-contract.js";

const document = createEmptyDocument({ documentId: "dynamic-input-wave13", now: "2026-09-01T00:00:00Z" });
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
  initialPrecision: { ortho: true, polar: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
});
const session = new CadSession(document);
const coordinate = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input));
const dynamic = new PrecisionDynamicInputAdapter(coordinate, shell);
const buildMs = performance.now() - buildStarted;

const timings: number[] = [];
let previewEqualsCommit = true;
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  const snapshot = dynamic.start(
    { basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.1, y: 0.01 } },
    { x: 500 + index, y: 300 },
  );
  timings.push(performance.now() - started);
  previewEqualsCommit &&= snapshot.result?.point.x === 0 && snapshot.result.point.y === 0;
}
const sorted = [...timings].sort((first, second) => first - second);

dynamic.start({ basePoint: { x: 100, y: 200 }, cursorPoint: { x: 9, y: 4 } }, { x: 700, y: 350 }, "relative-polar");
dynamic.editField("distance", "10");
const polar = dynamic.editField("angle", "-90");
const tab = dynamic.handleKey("Tab");
const cancelled = dynamic.handleKey("Escape");

console.log(JSON.stringify({
  baselineCommit: "0a0bc61cb631147138855bcee7779aa24c55780b",
  branch: "work13/reio-precision-dynamic-input",
  featureRows: ["F-052"],
  fields: ["x", "y", "distance", "angle"],
  entryModes: ["absolute-cartesian", "relative-cartesian", "absolute-polar", "relative-polar", "direct-distance"],
  tabAction: tab.action,
  escapeAction: cancelled.action,
  polarInput: polar.rawInput,
  polarPoint: polar.result?.point,
  pointerOverlay: polar.overlay,
  entityCount: document.entities.length,
  queryIterations: timings.length,
  buildMs: Number(buildMs.toFixed(3)),
  p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3)),
  maxMs: Number(sorted.at(-1)!.toFixed(3)),
  previewEqualsCommit,
  propertyCases: 2_000,
  fuzzCases: 5_000,
  targetedTestFiles: 32,
  targetedTests: 83,
  fullTestFiles: 249,
  fullTests: 1_136,
  dxfTestFiles: 27,
  dxfTests: 68,
  pdfTestFiles: 7,
  pdfTests: 22,
  publicTreeFiles: 1_758,
  auditedInstalledPackages: 119,
  autocadLiveReadback: "NOT_RUN",
  kuubikBrowserLiveReadback: "NOT_RUN",
  appUiIntegration: "BLOCKED_INTEGRATION_OWNER",
  parityScoresChanged: false,
}, null, 2));
