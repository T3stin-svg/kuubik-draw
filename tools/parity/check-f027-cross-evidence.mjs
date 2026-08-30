#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const markerNumbers = (report, name) => (report.markers?.[name]?.match(/-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?/g) ?? []).map(Number);
async function currentReceiptMap(receipts) {
  const entries = await Promise.all(Object.entries(receipts ?? {}).map(async ([path, expected]) => {
    const bytes = await readFile(resolve(root, path));
    return [path, { expected, actual: sha256(bytes), byteLength: bytes.length }];
  }));
  return Object.fromEntries(entries);
}
const receiptsExact = (receipts) => Object.values(receipts).every(({ expected, actual }) => expected === actual);
const pointMatches = (actual, expected) => close(actual?.x, expected?.[0]) && close(actual?.y, expected?.[1]);
function dxfEntityMatchesNative(dxf, native) {
  const type = { AcDbLine: "LINE", AcDbPolyline: "LWPOLYLINE", AcDbCircle: "CIRCLE", AcDbArc: "ARC", AcDbEllipse: "ELLIPSE" }[native?.objectName];
  if (!dxf || !native || dxf.type !== type || dxf.handle !== native.handle || dxf.layer !== native.layer
    || dxf.colorIndex !== native.color || dxf.lineweight !== native.lineweight
    || String(dxf.lineType).toLowerCase() !== String(native.linetype).toLowerCase()) return false;
  const details = native.details ?? {};
  if (type === "LINE") return dxf.vertices?.length === 2 && pointMatches(dxf.vertices[0], details.start) && pointMatches(dxf.vertices[1], details.end);
  if (type === "LWPOLYLINE") return dxf.closed === details.closed && dxf.vertices?.length === details.vertices?.length
    && dxf.vertices.every((vertex, index) => pointMatches(vertex, details.vertices[index])
      && close(vertex.bulge, details.bulges[index]) && close(vertex.startWidth, details.widths[index][0]) && close(vertex.endWidth, details.widths[index][1]));
  if (type === "CIRCLE") return pointMatches(dxf.center, details.center) && close(dxf.radius, details.radius);
  if (type === "ARC") return pointMatches(dxf.center, details.center) && close(dxf.radius, details.radius)
    && close(dxf.startAngle, details.startAngle) && close(dxf.endAngle, details.endAngle);
  if (type === "ELLIPSE") return pointMatches(dxf.center, details.center) && pointMatches(dxf.majorAxisEndPoint, details.majorAxis)
    && close(dxf.axisRatio, details.ratio) && close(dxf.startAngle, details.startParameter) && close(dxf.endAngle, details.endParameter);
  return false;
}
function desktopDxfMatchesAllNativeStates(report) {
  const observations = report.observations ?? {};
  const nativeStates = [
    observations.line, observations.crossingPolygon, observations.polyline, observations.arc,
    observations.arcCenter, observations.ellipse, observations.wrapped, observations.ellipseMidpoint,
    observations.fullEllipse, observations.circle, observations.individual,
    ...(observations.globalUndoRedo?.committed ?? []), observations.locked,
  ];
  const entities = report.dxfReadback?.entities ?? [];
  if (nativeStates.length !== 14 || report.dxfReadback?.entityCount !== 14 || entities.length !== 14) return false;
  const byHandle = new Map(entities.map((entity) => [entity.handle, entity]));
  return byHandle.size === 14 && nativeStates.every((native) => dxfEntityMatchesNative(byHandle.get(native.handle), native));
}

const artifactPaths = {
  nativeCore: "evidence/artifacts/F-027-autocad-core.json",
  nativeDesktop: "evidence/artifacts/F-027-autocad-readback.json",
  browser: "evidence/artifacts/F-027-browser-readback.json",
  browserEllipseDxf: "evidence/artifacts/F-027-browser-ellipse.dxf",
  browserEllipseKdraw: "evidence/artifacts/F-027-browser-ellipse.kdraw",
  readback: "evidence/artifacts/F-027-independent-readback.json",
  productionDxf: "evidence/artifacts/F-027-kuubik.dxf",
  productionKdraw: "evidence/artifacts/F-027-kuubik.kdraw",
  oracles: "evidence/artifacts/F-027-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const nativeCore = JSON.parse(artifactBytes.nativeCore.toString("utf8"));
const nativeDesktop = JSON.parse(artifactBytes.nativeDesktop.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-027.json");
const browserSourceReceipts = await currentReceiptMap(browser.sourceSha256);
const browserArtifactReceipts = await currentReceiptMap(Object.fromEntries(Object.entries(browser.artifacts ?? {}).map(([path, receipt]) => [path, receipt.sha256])));
const browserArtifactLengthsExact = Object.entries(browser.artifacts ?? {}).every(([path, receipt]) => browserArtifactReceipts[path]?.byteLength === receipt.byteLength);
const productionSourceReceipts = await currentReceiptMap(readback.implementationSha256);
const desktopSourceReceipts = await currentReceiptMap({
  "tools/autocad/f027-standard-matrix.ps1": nativeDesktop.matrixScriptSha256,
  "tools/autocad/run-f027.mjs": nativeDesktop.runnerSha256,
  "tools/autocad/process-ownership.mjs": nativeDesktop.processOwnershipSha256,
  "tools/autocad/send-escape.ps1": nativeDesktop.escapeHelperSha256,
});
const coreSourceReceipts = await currentReceiptMap({
  "evidence/artifacts/F-027-kuubik.dxf": nativeCore.fixtureSha256,
  "parity/autocad/F-027-core-measure.scr": nativeCore.scriptSha256,
  "tools/autocad/F027StretchPoints.cs": nativeCore.pluginSourceSha256,
  "tools/autocad/run-f027-core.mjs": nativeCore.runnerSha256,
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
  "packages/cad-core/src/stretch.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/stretch.test.ts",
  "packages/cad-core/test/f027-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f027-stretch-roundtrip.test.ts",
  "e2e/f027-stretch.spec.ts",
  "parity/autocad/F-027-core-measure.scr",
  "tools/autocad/F027StretchPoints.cs",
  "tools/autocad/run-f027-core.mjs",
  "tools/autocad/f027-standard-matrix.ps1",
  "tools/autocad/run-f027.mjs",
  "tools/autocad/process-ownership.mjs",
  "tools/autocad/send-escape.ps1",
  "tools/autocad/f027-runner.test.mjs",
  "tools/parity/capture-f027-browser.mjs",
  "tools/parity/build-f027-browser-readback.mjs",
  "tools/parity/run-f027-readback.mjs",
  "tools/oracles/freecad-f027-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f027-oracles.mjs",
  "parity/F-027-scope.md",
  "parity/expected/F-027.json",
  "tools/parity/check-f027-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const checkerOwned = new Set(["parity/F-027-scope.md", "parity/expected/F-027.json", "tools/parity/check-f027-cross-evidence.mjs"]);
const stageReceiptMaps = [browserSourceReceipts, productionSourceReceipts, desktopSourceReceipts, coreSourceReceipts, oracleSourceReceipts];
const coveredPaths = new Set([...checkerOwned, ...stageReceiptMaps.flatMap((receipts) => Object.keys(receipts))]);
const uncoveredRuntimeSources = Object.keys(implementationSha256).filter((path) => !coveredPaths.has(path));

const expectedQuarter = expected.quarterEllipse;
const coreQuarter = {
  center: markerNumbers(nativeCore, "ELLIPSE_QUARTER_CENTER").slice(0, 2),
  majorAxis: markerNumbers(nativeCore, "ELLIPSE_QUARTER_MAJOR").slice(0, 2),
  ratio: markerNumbers(nativeCore, "ELLIPSE_QUARTER_RATIO")[0],
  startParameter: markerNumbers(nativeCore, "ELLIPSE_QUARTER_START")[0],
  endParameter: markerNumbers(nativeCore, "ELLIPSE_QUARTER_END")[0],
};
const browserEllipse = browser.checks?.nativeMatchedQuarterEllipseOutput === true;
const productionQuarter = readback.output?.schema?.find(({ handle }) => handle === "61");
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const checks = {
  nativeCoreReference: nativeCore.status === "PASS" && nativeCore.certificationAuthority === false
    && nativeCore.benchmark === expected.benchmark && allTrue(nativeCore.checks)
    && nativeCore.knownImplementationGaps?.every((gap) => !gap.includes("Non-semicircular")),
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
    && nativeDesktop.dxfReadback?.fullStateMatchesNative === true
    && desktopDxfMatchesAllNativeStates(nativeDesktop),
  nativeDesktopSourcesCurrent: receiptsExact(desktopSourceReceipts),
  nativeCoreSourcesCurrent: receiptsExact(coreSourceReceipts),
  browserWorkflow: browser.status === "PASS" && allTrue(browser.checks),
  browserNestedArtifactsCurrent: receiptsExact(browserArtifactReceipts) && browserArtifactLengthsExact,
  browserSourcesCurrent: receiptsExact(browserSourceReceipts),
  physicalCrossingWindow: browser.checks?.physicalCanvasCrossingDrag === true,
  physicalCrossingPolygon: browser.checks?.physicalCanvasCrossingPolygon === true,
  quarterEllipseBrowserDxfKdraw: browserEllipse
    && close(coreQuarter.center[0] - 1000, expectedQuarter.center.x, 1e-10)
    && close(coreQuarter.center[1], expectedQuarter.center.y, 1e-10)
    && close(coreQuarter.majorAxis[0], expectedQuarter.majorAxis.x, 1e-10)
    && close(coreQuarter.majorAxis[1], expectedQuarter.majorAxis.y, 1e-10)
    && close(coreQuarter.ratio, expectedQuarter.ratio, 1e-12)
    && close(coreQuarter.startParameter, expectedQuarter.startParameter, 1e-12)
    && close(coreQuarter.endParameter, expectedQuarter.endParameter, 1e-12)
    && close(productionQuarter?.center?.x - 1000, expectedQuarter.center.x, 1e-9)
    && close(productionQuarter?.center?.y - 500, expectedQuarter.center.y, 1e-9)
    && close(productionQuarter?.ratio, expectedQuarter.ratio, 1e-10),
  productionReadback: readback.status === "PASS" && readback.output?.independentTypes?.includes("61:ELLIPSE")
    && readback.undoRedo?.exactSourceRestored === true && readback.undoRedo?.exactCommittedRestored === true
    && readback.dxf?.sha256 === sha256(artifactBytes.productionDxf) && readback.dxf?.byteLength === artifactBytes.productionDxf.length
    && readback.kdraw?.sha256 === sha256(artifactBytes.productionKdraw) && readback.kdraw?.byteLength === artifactBytes.productionKdraw.length,
  productionSourcesCurrent: receiptsExact(productionSourceReceipts),
  secondaryOracles: oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.certificationAuthority === false
    && oracles.sourceArtifactSha256 === sha256(artifactBytes.productionDxf)
    && oracles.readbackArtifactSha256 === sha256(artifactBytes.readback)
    && oracleByName.librecad?.expected === "2.2.1.5" && oracleByName.freecad?.expected === "1.1.3"
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  oracleInputsAndSourcesCurrent: receiptsExact(oracleSourceReceipts),
  sourceHashCoverage: uncoveredRuntimeSources.length === 0,
  independentReviewPassed: expected.independentReview?.status === "PASS"
    && expected.independentReview?.p0 === 0 && expected.independentReview?.p1 === 0,
  certificationRequirementsClosed: expected.remainingCertificationRequirements.length === 0,
};
checks.requiredCertificationChecksExact = Array.isArray(expected.requiredCertificationChecks)
  && expected.requiredCertificationChecks.length > 0
  && expected.requiredCertificationChecks.every((name) => checks[name] === true);
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-027 cross-evidence mismatch: ${JSON.stringify({ checks, uncoveredRuntimeSources })}`);

const result = {
  schemaVersion: 1,
  rowId: "F-027",
  source: "owned AutoCAD 2024.1.2 Desktop + AutoCAD Core reference + Chromium crossing window/polygon + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  nestedReceipts: {
    browserArtifacts: browserArtifactReceipts,
    browserSources: browserSourceReceipts,
    productionSources: productionSourceReceipts,
    desktopSources: desktopSourceReceipts,
    coreSources: coreSourceReceipts,
    oracleInputsAndSources: oracleSourceReceipts,
  },
  checks,
  remainingCertificationRequirements: expected.remainingCertificationRequirements,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-027-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-027 AutoCAD/Chromium/DXF/KDRAW/oracle cross-evidence PASS; independent review 0 P0 / 0 P1.");
