#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const pointMatches = (actual, expected) => close(actual?.[0] ?? actual?.x, expected?.x) && close(actual?.[1] ?? actual?.y, expected?.y);
const pointSetMatches = (actual, expected) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
  && actual.every((point, index) => pointMatches(point, expected[index]));
const numberSetMatches = (actual, expected) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
  && actual.every((value, index) => close(value, expected[index]));
function normalizeWeights(values) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(values[0]) || Math.abs(values[0]) <= 1e-12) return null;
  return values.map((value) => value / values[0]);
}
async function currentReceiptMap(receipts) {
  const entries = await Promise.all(Object.entries(receipts ?? {}).map(async ([path, expected]) => {
    const bytes = await readFile(resolve(root, path)); return [path, { expected, actual: sha256(bytes), byteLength: bytes.length }];
  }));
  return Object.fromEntries(entries);
}
const receiptsExact = (receipts) => Object.values(receipts).every(({ expected, actual }) => expected === actual);

const artifactPaths = {
  nativeDesktop: "evidence/artifacts/F-029-autocad-readback.json",
  browser: "evidence/artifacts/F-029-browser-readback.json",
  readback: "evidence/artifacts/F-029-independent-readback.json",
  productionDxf: "evidence/artifacts/F-029-kuubik.dxf",
  productionKdraw: "evidence/artifacts/F-029-kuubik.kdraw",
  oracles: "evidence/artifacts/F-029-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const nativeDesktop = JSON.parse(artifactBytes.nativeDesktop.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-029.json");
const browserSourceReceipts = await currentReceiptMap(browser.sourceSha256);
const browserArtifactReceipts = await currentReceiptMap(Object.fromEntries(Object.entries(browser.artifacts ?? {}).map(([path, receipt]) => [path, receipt.sha256])));
const browserArtifactLengthsExact = Object.entries(browser.artifacts ?? {}).every(([path, receipt]) => browserArtifactReceipts[path]?.byteLength === receipt.byteLength);
const productionSourceReceipts = await currentReceiptMap(readback.implementationSha256);
const desktopSourceReceipts = await currentReceiptMap({
  "tools/autocad/f029-standard-matrix.ps1": nativeDesktop.matrixScriptSha256,
  "tools/autocad/run-f029.mjs": nativeDesktop.runnerSha256,
  "tools/autocad/process-ownership.mjs": nativeDesktop.processOwnershipSha256,
});
const oracleSourceReceipts = await currentReceiptMap({
  [oracles.sourceArtifact]: oracles.sourceArtifactSha256,
  [oracles.readbackArtifact]: oracles.readbackArtifactSha256,
  ...oracles.implementationSha256,
});
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/style.css",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/test/align.test.ts",
  "packages/cad-core/test/f029-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f029-align-roundtrip.test.ts",
  "e2e/f029-align.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/autocad/f029-runner.test.mjs",
  "tools/autocad/f029-standard-matrix.ps1",
  "tools/autocad/process-ownership.mjs",
  "tools/autocad/run-f029.mjs",
  "tools/parity/capture-f029-browser.mjs",
  "tools/parity/build-f029-browser-readback.mjs",
  "tools/parity/run-f029-readback.mjs",
  "tools/oracles/freecad-f029-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f029-oracles.mjs",
  "parity/F-029-scope.md",
  "parity/expected/F-029.json",
  "tools/parity/check-f029-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const checkerOwned = new Set(["parity/F-029-scope.md", "parity/expected/F-029.json", "tools/autocad/f029-runner.test.mjs", "tools/parity/check-f029-cross-evidence.mjs"]);
const stageReceiptMaps = [browserSourceReceipts, productionSourceReceipts, desktopSourceReceipts, oracleSourceReceipts];
const coveredPaths = new Set([...checkerOwned, ...stageReceiptMaps.flatMap((receipts) => Object.keys(receipts))]);
const uncoveredRuntimeSources = Object.keys(implementationSha256).filter((path) => !coveredPaths.has(path));
const nativeScale = nativeDesktop.observations?.scale?.committed ?? [];
const expectedByHandle = Object.fromEntries((readback.expected ?? []).map((entity) => [entity.handle, entity]));
const nativeByType = Object.fromEntries(nativeScale.map((state) => [state.objectName, state]));
const line = nativeByType.AcDbLine; const circle = nativeByType.AcDbCircle; const polyline = nativeByType.AcDbPolyline; const spline = nativeByType.AcDbSpline; const text = nativeByType.AcDbText;
const expectedPolyline = expectedByHandle["30"];
const expectedSpline = expectedByHandle["40"];
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const checks = {
  nativeDesktopLive: nativeDesktop.status === "PASS" && nativeDesktop.certificationAuthority === true
    && nativeDesktop.benchmark === expected.benchmark && nativeDesktop.engineVersion?.startsWith("24.3")
    && nativeDesktop.installedUpdateIdentity?.displayName === "Autodesk AutoCAD 2024.1.2 Update"
    && nativeDesktop.installedUpdateIdentity?.displayVersion === "24.3.152.0"
    && nativeDesktop.automationProcessIdentity?.fileVersion === "R24.3.152.0.0"
    && nativeDesktop.automationProcessIdentity?.productVersion === "R24.3.152.0.0"
    && nativeDesktop.automationProcessOwned === true && nativeDesktop.automationProcessTerminated === true
    && nativeDesktop.processSetRestored === true && nativeDesktop.userDocument?.isolatedOwnedProcess === true
    && nativeDesktop.userDocument?.blankRestored === true && nativeDesktop.cmdNamesAfter === ""
    && allTrue(nativeDesktop.checks) && nativeDesktop.dxfReadback?.sha256 === nativeDesktop.dxfOutputSha256
    && nativeDesktop.dxfReadback?.fullStateMatchesNative === true,
  nativeDesktopSourcesCurrent: receiptsExact(desktopSourceReceipts),
  browserWorkflow: browser.status === "PASS" && allTrue(browser.checks),
  browserNestedArtifactsCurrent: receiptsExact(browserArtifactReceipts) && browserArtifactLengthsExact,
  browserSourcesCurrent: receiptsExact(browserSourceReceipts),
  physicalFourPointCanvas: browser.checks?.browserWorkflowPassedWithoutErrors === true && browser.checks?.exactAtomicOperation === true,
  productionReadback: readback.status === "PASS" && allTrue(readback.checks) && allTrue(readback.independentChecks)
    && readback.dxf?.sha256 === sha256(artifactBytes.productionDxf) && readback.dxf?.byteLength === artifactBytes.productionDxf.length
    && readback.kdraw?.sha256 === sha256(artifactBytes.productionKdraw) && readback.kdraw?.byteLength === artifactBytes.productionKdraw.length,
  productionSourcesCurrent: receiptsExact(productionSourceReceipts),
  secondaryOracles: oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.certificationAuthority === false
    && oracles.sourceArtifactSha256 === sha256(artifactBytes.productionDxf) && oracles.readbackArtifactSha256 === sha256(artifactBytes.readback)
    && oracleByName.librecad?.expected === "2.2.1.5" && oracleByName.freecad?.expected === "1.1.3"
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  oracleInputsAndSourcesCurrent: receiptsExact(oracleSourceReceipts),
  crossGeometryExact: pointMatches(line?.details?.start, expectedByHandle["10"]?.start) && pointMatches(line?.details?.end, expectedByHandle["10"]?.end)
    && pointMatches(circle?.details?.center, expectedByHandle["20"]?.center) && close(circle?.details?.radius, expectedByHandle["20"]?.radius)
    && polyline?.details?.closed === expectedPolyline?.closed
    && pointSetMatches(polyline?.details?.vertices, expectedPolyline?.vertices)
    && Array.isArray(polyline?.details?.widths) && polyline.details.widths.length === expectedPolyline?.vertices?.length
    && polyline.details.widths.every((widths, index) => close(widths[0], expectedPolyline.vertices[index]?.startWidth ?? 0) && close(widths[1], expectedPolyline.vertices[index]?.endWidth ?? 0))
    && numberSetMatches(polyline?.details?.bulges, expectedPolyline?.vertices?.map((vertex) => vertex.bulge ?? 0))
    && spline?.details?.degree === expectedSpline?.degree && spline?.details?.controlPointCount === expectedSpline?.controlPoints?.length
    && spline?.details?.fitPointCount === 0 && spline?.details?.rational === true
    && spline?.details?.closed === expectedSpline?.closed && spline?.details?.periodic === expectedSpline?.periodic
    && pointSetMatches(spline?.details?.controlPoints, expectedSpline?.controlPoints)
    && numberSetMatches(spline?.details?.knots, expectedSpline?.knots)
    && numberSetMatches(normalizeWeights(spline?.details?.weights), normalizeWeights(expectedSpline?.weights))
    && pointMatches(text?.details?.position, expectedByHandle["50"]?.position) && close(text?.details?.height, expectedByHandle["50"]?.height)
    && close(text?.details?.rotation, expectedByHandle["50"]?.rotationRad),
  lockedSelectionMatches: nativeDesktop.observations?.locked?.behavior === "unlocked-only",
  sourceHashCoverage: uncoveredRuntimeSources.length === 0,
  independentReviewPassed: expected.independentReview?.status === "PASS" && expected.independentReview?.p0 === 0 && expected.independentReview?.p1 === 0,
  certificationRequirementsClosed: expected.remainingCertificationRequirements.length === 0,
};
checks.requiredCertificationChecksExact = Array.isArray(expected.requiredCertificationChecks) && expected.requiredCertificationChecks.length > 0
  && expected.requiredCertificationChecks.every((name) => checks[name] === true);
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-029 cross-evidence mismatch: ${JSON.stringify({ checks, uncoveredRuntimeSources })}`);
const result = {
  schemaVersion: 1, rowId: "F-029",
  source: "owned AutoCAD 2024.1.2 Desktop + Chromium physical four-point ALIGN + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])), implementationSha256,
  nestedReceipts: { browserArtifacts: browserArtifactReceipts, browserSources: browserSourceReceipts, productionSources: productionSourceReceipts, desktopSources: desktopSourceReceipts, oracleInputsAndSources: oracleSourceReceipts },
  checks, remainingCertificationRequirements: expected.remainingCertificationRequirements, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-029-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-029 AutoCAD/Chromium/DXF/KDRAW/oracle cross-evidence PASS; independent review 0 P0 / 0 P1.");
