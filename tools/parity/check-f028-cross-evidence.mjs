#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const pointMatches = (actual, expected) => close(actual?.[0] ?? actual?.x, expected?.x) && close(actual?.[1] ?? actual?.y, expected?.y);
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const arraysMatch = (actual, expected, predicate = close) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => predicate(value, expected[index]));
async function currentReceiptMap(receipts) {
  const entries = await Promise.all(Object.entries(receipts ?? {}).map(async ([path, expected]) => {
    const bytes = await readFile(resolve(root, path));
    return [path, { expected, actual: sha256(bytes), byteLength: bytes.length }];
  }));
  return Object.fromEntries(entries);
}
const receiptsExact = (receipts) => Object.values(receipts).every(({ expected, actual }) => expected === actual);

const artifactPaths = {
  nativeDesktop: "evidence/artifacts/F-028-autocad-readback.json",
  browser: "evidence/artifacts/F-028-browser-readback.json",
  readback: "evidence/artifacts/F-028-independent-readback.json",
  sourceDxf: "evidence/artifacts/F-028-source.dxf",
  productionDxf: "evidence/artifacts/F-028-kuubik.dxf",
  productionKdraw: "evidence/artifacts/F-028-kuubik.kdraw",
  oracles: "evidence/artifacts/F-028-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const nativeDesktop = JSON.parse(artifactBytes.nativeDesktop.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-028.json");
const browserSourceReceipts = await currentReceiptMap(browser.sourceSha256);
const browserArtifactReceipts = await currentReceiptMap(Object.fromEntries(Object.entries(browser.artifacts ?? {}).map(([path, receipt]) => [path, receipt.sha256])));
const browserArtifactLengthsExact = Object.entries(browser.artifacts ?? {}).every(([path, receipt]) => browserArtifactReceipts[path]?.byteLength === receipt.byteLength);
const productionSourceReceipts = await currentReceiptMap(readback.implementationSha256);
const desktopSourceReceipts = await currentReceiptMap({
  "tools/autocad/f028-standard-matrix.ps1": nativeDesktop.matrixScriptSha256,
  "tools/autocad/run-f028.mjs": nativeDesktop.runnerSha256,
  "tools/autocad/owned-desktop-matrix.mjs": nativeDesktop.sharedRunnerSha256,
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
  "packages/cad-core/src/lengthen.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/test/lengthen.test.ts",
  "packages/cad-core/test/f028-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f028-lengthen-roundtrip.test.ts",
  "e2e/f028-lengthen.spec.ts",
  "tools/autocad/f028-runner.test.mjs",
  "tools/autocad/f028-standard-matrix.ps1",
  "tools/autocad/owned-desktop-matrix.mjs",
  "tools/autocad/process-ownership.mjs",
  "tools/autocad/run-f028.mjs",
  "tools/oracles/freecad-f028-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f028-oracles.mjs",
  "tools/parity/build-f028-browser-readback.mjs",
  "tools/parity/capture-f028-browser.mjs",
  "tools/parity/run-f028-readback.mjs",
  "parity/F-028-scope.md",
  "parity/expected/F-028.json",
  "tools/parity/check-f028-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const checkerOwned = new Set(["parity/F-028-scope.md", "parity/expected/F-028.json", "tools/autocad/f028-runner.test.mjs", "tools/parity/check-f028-cross-evidence.mjs"]);
const stageReceiptMaps = [browserSourceReceipts, productionSourceReceipts, desktopSourceReceipts, oracleSourceReceipts];
const coveredPaths = new Set([...checkerOwned, ...stageReceiptMaps.flatMap((receipts) => Object.keys(receipts))]);
const uncoveredRuntimeSources = Object.keys(implementationSha256).filter((path) => !coveredPaths.has(path));

const nativeDelta = nativeDesktop.observations?.delta?.committed ?? [];
const nativeByHandle = Object.fromEntries(nativeDelta.map((state) => [state.handle, state]));
const expectedByHandle = Object.fromEntries((readback.expected ?? []).map((entity) => [entity.handle, entity]));
const line = nativeByHandle["10"]?.details; const arc = nativeByHandle["20"]?.details; const polyline = nativeByHandle["30"]?.details;
const ellipse = nativeDesktop.observations?.ellipseDynamic?.committed?.details;
const spline = nativeDesktop.observations?.controlSplineDynamic?.committed?.details;
const expectedLine = expectedByHandle["10"]; const expectedArc = expectedByHandle["20"]; const expectedPolyline = expectedByHandle["30"]; const expectedEllipse = expectedByHandle["40"]; const expectedSpline = expectedByHandle["50"];
const normalized = (values) => values?.map((value) => value / values[0]);
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
    && nativeDesktop.userDocument?.blankRestored === true && nativeDesktop.userDocument?.sourceDocumentSynthetic === true
    && nativeDesktop.cmdNamesAfter === "" && allTrue(nativeDesktop.checks)
    && nativeDesktop.dxfReadback?.sha256 === nativeDesktop.dxfOutputSha256 && nativeDesktop.dxfReadback?.fullStateMatchesNative === true,
  nativeDesktopSourcesCurrent: receiptsExact(desktopSourceReceipts),
  exactSourceDxfShared: nativeDesktop.sourceDxfArtifact === artifactPaths.sourceDxf
    && nativeDesktop.sourceDxfSha256 === sha256(artifactBytes.sourceDxf)
    && readback.sourceDxf?.sha256 === sha256(artifactBytes.sourceDxf) && readback.sourceDxf?.byteLength === artifactBytes.sourceDxf.length,
  browserWorkflow: browser.status === "PASS" && allTrue(browser.checks),
  browserNestedArtifactsCurrent: receiptsExact(browserArtifactReceipts) && browserArtifactLengthsExact,
  browserSourcesCurrent: receiptsExact(browserSourceReceipts),
  physicalDynamicCanvas: browser.checks?.physicalDynamicCanvas === true && browser.checks?.exactAtomicOperation === true,
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
  crossGeometryExact: pointMatches(line?.start, expectedLine?.start) && pointMatches(line?.end, expectedLine?.end)
    && pointMatches(arc?.center, expectedArc?.center) && close(arc?.radius, expectedArc?.radius) && close(arc?.startAngle, expectedArc?.startAngleRad) && close(arc?.endAngle, expectedArc?.endAngleRad)
    && arraysMatch(polyline?.vertices, expectedPolyline?.vertices, pointMatches)
    && arraysMatch(polyline?.widths, expectedPolyline?.vertices, (actual, value) => close(actual?.[0], value?.startWidth ?? 0) && close(actual?.[1], value?.endWidth ?? 0))
    && arraysMatch(polyline?.bulges, expectedPolyline?.vertices, (actual, value) => close(actual, value?.bulge ?? 0))
    && pointMatches(ellipse?.center, expectedEllipse?.center) && pointMatches(ellipse?.majorAxis, expectedEllipse?.majorAxis)
    && close(ellipse?.ratio, expectedEllipse?.ratio) && close(ellipse?.startParameter, expectedEllipse?.startParameter) && close(ellipse?.endParameter, expectedEllipse?.endParameter)
    && spline?.degree === expectedSpline?.degree && arraysMatch(spline?.controlPoints, expectedSpline?.controlPoints, pointMatches)
    && arraysMatch(spline?.knots, expectedSpline?.knots) && arraysMatch(normalized(spline?.weights), normalized(expectedSpline?.weights)),
  modeMatrixEquivalent: nativeDesktop.checks?.percent150 === true && nativeDesktop.checks?.total80 === true
    && nativeDesktop.checks?.dynamicEndpoint === true && nativeDesktop.checks?.totalAngle180 === true
    && nativeDesktop.checks?.commandLocalUndo === true && readback.checks?.modeMatrix === true && browser.checks?.physicalDynamicCanvas === true,
  visibilityBehaviorMatches: expected.nativeVisibilityBehavior !== null
    && JSON.stringify(nativeDesktop.observations?.visibility?.behavior) === JSON.stringify(expected.nativeVisibilityBehavior),
  sourceHashCoverage: uncoveredRuntimeSources.length === 0,
  fitPointSplineDependencyClosed: expected.fitPointSpline?.status === "PASS",
  independentReviewPassed: expected.independentReview?.status === "PASS" && expected.independentReview?.p0 === 0 && expected.independentReview?.p1 === 0,
  certificationRequirementsClosed: expected.remainingCertificationRequirements.length === 0,
};
checks.requiredCertificationChecksExact = Array.isArray(expected.requiredCertificationChecks) && expected.requiredCertificationChecks.length > 0
  && expected.requiredCertificationChecks.every((name) => checks[name] === true);
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-028 cross-evidence mismatch: ${JSON.stringify({ checks, uncoveredRuntimeSources })}`);
const result = {
  schemaVersion: 1,
  rowId: "F-028",
  source: "owned AutoCAD 2024.1.2 Desktop over exact Kuubik source DXF + Chromium Dynamic/LENGTHEN + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  nestedReceipts: { browserArtifacts: browserArtifactReceipts, browserSources: browserSourceReceipts, productionSources: productionSourceReceipts, desktopSources: desktopSourceReceipts, oracleInputsAndSources: oracleSourceReceipts },
  checks,
  remainingCertificationRequirements: expected.remainingCertificationRequirements,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-028-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-028 AutoCAD/Chromium/DXF/KDRAW/oracle cross-evidence PASS; independent review 0 P0 / 0 P1.");
