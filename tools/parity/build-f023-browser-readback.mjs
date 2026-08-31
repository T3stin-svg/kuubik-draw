#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (name) => JSON.parse(await readFile(resolve(artifactRoot, name), "utf8"));
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-renderer/src/index.ts",
  "packages/cad-renderer/src/selection.ts",
  "e2e/f023-extend.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/parity/capture-f023-browser.mjs",
  "tools/parity/build-f023-browser-readback.mjs",
];

const [standard, quickShift, options, spline, sourceDxfBytes, dxfBytes, kdrawBytes] = await Promise.all([
  json("F-023-browser-standard.json"),
  json("F-023-browser-quick-shift.json"),
  json("F-023-browser-options.json"),
  json("F-023-browser-spline.json"),
  readFile(resolve(artifactRoot, "F-023-browser-spline-source.dxf")),
  readFile(resolve(artifactRoot, "F-023-browser-spline.dxf")),
  readFile(resolve(artifactRoot, "F-023-browser-spline.kdraw")),
]);
const sourceDxf = new DxfParser().parseSync(sourceDxfBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const sourceSpline = sourceDxf?.entities.find((entity) => entity.type === "SPLINE");
const outputSpline = dxf?.entities.find((entity) => entity.type === "SPLINE");
const expectedControls = [[0, 0], [1, 1], [2, 1], [3, 0], [3.621334927543, -0.621334927543], [4.628726947271, -1.821755493363], [6.000000000002, -3.567997608689]];
const expectedKnots = [0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543];
const expectedWeights = [1, 1, 2, 2, 2, 2, 2];
const dxfSplineGroupNumbers = (bytes, group) => {
  const lines = bytes.toString("utf8").split(/\r?\n/u);
  const values = [];
  let inSpline = false;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    const value = lines[index + 1].trim();
    if (code === 0) {
      if (inSpline) break;
      inSpline = value === "SPLINE";
    } else if (inSpline && code === group) values.push(Number(value));
  }
  return values;
};
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Math.abs(left - right) <= tolerance;
const controlsMatch = (points, expected) => Array.isArray(points) && points.length === expected.length
  && points.every((point, index) => close(point.x, expected[index][0]) && close(point.y, expected[index][1]));
const numbersMatch = (values, expected) => Array.isArray(values) && values.length === expected.length
  && values.every((value, index) => close(value, expected[index]));
const pointMatch = (point, expected) => point && close(point.x, expected[0]) && close(point.y, expected[1]);
const entityLineMatches = (entity, expected) => entity?.kind === "line"
  && ((pointMatch(entity.start, expected[0]) && pointMatch(entity.end, expected[1]))
    || (pointMatch(entity.start, expected[1]) && pointMatch(entity.end, expected[0])));
const entityLineSetMatches = (document, handles, expected) => Array.isArray(handles) && handles.length === expected.length
  && expected.every((line) => handles.filter((handle) => entityLineMatches(document?.entities?.find((entity) => entity.handle === handle), line)).length === 1);
const allErrors = [standard, quickShift, options, spline].flatMap((item) => item.consoleErrors ?? []);

const checks = {
  allFourBrowserWorkflowsPassed: [standard, quickShift, options, spline].every((item) => item.rowId === "F-023" && item.status === "PASS") && allErrors.length === 0,
  standardFenceCommandAndGlobalUndo: standard.committed?.revision === 1
    && standard.operation?.commandId === "EXTEND"
    && JSON.stringify(standard.operation?.targetHandles) === JSON.stringify(["10", "11"])
    && JSON.stringify(standard.operation?.resultHandles) === JSON.stringify(["10", "11"])
    && standard.operation?.args?.mode === "standard"
    && standard.operation?.args?.edgeMode === "no-extend"
    && standard.operation?.args?.projectMode === "none"
    && standard.committed?.entities?.[0]?.end?.x === 1000
    && standard.committed?.entities?.[1]?.end?.x === 1000
    && standard.restored?.revision === 2
    && standard.restored?.entities?.[0]?.end?.x === 800
    && standard.redone?.revision === 3
    && JSON.stringify(standard.redone?.entities) === JSON.stringify(standard.committed?.entities),
  quickAllObjectBoundary: quickShift.quick?.committed?.entities?.[0]?.end?.x === 1000
    && quickShift.quick?.operation?.commandId === "EXTEND"
    && quickShift.quick?.operation?.args?.mode === "quick"
    && quickShift.quick?.operation?.args?.boundaryEdgeHandles?.length === 0,
  physicalShiftTrim: quickShift.physicalInput?.modifier === "Shift"
    && quickShift.physicalInput?.action === "trim"
    && Number.isFinite(quickShift.physicalInput?.pointer?.x)
    && Number.isFinite(quickShift.physicalInput?.pointer?.y)
    && JSON.stringify(quickShift.shiftTrim?.operation?.args?.boundaryEdgeHandles) === JSON.stringify(["20", "21"])
    && close(quickShift.shiftTrim?.operation?.args?.targets?.[0]?.pickPoint?.x, 500, 0.002)
    && close(quickShift.shiftTrim?.operation?.args?.targets?.[0]?.pickPoint?.y, 0, 0.002)
    && quickShift.shiftTrim?.operation?.args?.targets?.[0]?.action === "trim"
    && JSON.stringify(quickShift.shiftTrim?.operation?.resultHandles) === JSON.stringify(["10", "22"])
    && entityLineSetMatches(quickShift.shiftTrim?.committed, quickShift.shiftTrim?.operation?.resultHandles, [[[0, 0], [250, 0]], [[750, 0], [1000, 0]]]),
  crossingSelectionAndCommit: JSON.stringify(options.crossing?.operation?.targetHandles) === JSON.stringify(["10", "11"])
    && options.crossing?.operation?.args?.mode === "standard"
    && options.crossing?.document?.entities?.[0]?.end?.x === 1000
    && options.crossing?.document?.entities?.[1]?.end?.x === 1000,
  edgeExtendAndNoExtend: options.edge?.noExtend?.revision === 0
    && options.edge?.noExtend?.entities?.[0]?.end?.x === 80
    && options.edge?.extend?.operation?.args?.edgeMode === "extend"
    && options.edge?.extend?.document?.entities?.[0]?.end?.x === 100
    && options.edge?.restored?.revision === 2
    && options.edge?.restored?.entities?.[0]?.end?.x === 80,
  projectModesExact: ["none", "ucs", "view"].every((mode) => options.projects?.[mode]?.operation?.args?.projectMode === mode
    && options.projects?.[mode]?.document?.entities?.[0]?.end?.x === 1000),
  lockedAndHiddenRefusedWithoutMutation: JSON.stringify(options.refusals?.rejected?.map(({ handle, reason }) => [handle, reason]))
      === JSON.stringify([["10", "locked-layer"], ["11", "hidden-layer"]])
    && options.refusals?.operationCount === 0
    && options.refusals?.source?.revision === 0,
  exactRationalSplineCommit: controlsMatch(spline.committed?.[0]?.controlPoints, expectedControls)
    && numbersMatch(spline.committed?.[0]?.knots, expectedKnots)
    && numbersMatch(spline.committed?.[0]?.weights, expectedWeights)
    && JSON.stringify(spline.kdrawRestored) === JSON.stringify(spline.committed),
  productionDownloadsParseExactly: JSON.stringify(sourceDxf?.entities.map((entity) => entity.type)) === JSON.stringify(["SPLINE", "LINE"])
    && JSON.stringify(dxf?.entities.map((entity) => entity.type)) === JSON.stringify(["SPLINE", "LINE"])
    && sourceSpline?.degreeOfSplineCurve === 3 && sourceSpline?.controlPoints?.length === 4
    && numbersMatch(dxfSplineGroupNumbers(sourceDxfBytes, 41), [1, 1, 2, 2])
    && outputSpline?.degreeOfSplineCurve === 3 && controlsMatch(outputSpline?.controlPoints, expectedControls)
    && numbersMatch(outputSpline?.knotValues, expectedKnots)
    && numbersMatch(dxfSplineGroupNumbers(dxfBytes, 41), expectedWeights)
    && kdrawBytes.subarray(0, 7).toString("utf8") === "KDRAW1\n",
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-023 browser read-back mismatch: ${JSON.stringify(checks)}`);

const result = {
  schemaVersion: 1,
  rowId: "F-023",
  source: "Chromium 1920x1080 visible controls, physical Shift-click, IndexedDB and production DXF/KDRAW1 downloads",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  standard,
  quickShift,
  options,
  spline,
  downloads: {
    source: { sha256: sha256(sourceDxfBytes), byteLength: sourceDxfBytes.byteLength, types: sourceDxf?.entities.map((entity) => entity.type) },
    dxf: { sha256: sha256(dxfBytes), byteLength: dxfBytes.byteLength, types: dxf?.entities.map((entity) => entity.type) },
    kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength },
  },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-023-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-023 Chromium Standard/Quick/Fence/Crossing/Edge/Project/layer-refusal/physical Shift-Trim/rational-SPLINE read-back PASS.");
