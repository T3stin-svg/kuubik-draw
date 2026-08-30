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

const artifactPaths = {
  nativeCore: "evidence/artifacts/F-027-autocad-core.json",
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
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-027.json");

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
const recordedMaps = [browser.sourceSha256, readback.implementationSha256, oracles.implementationSha256].filter(Boolean);
const directlyRecorded = new Map([
  ["parity/autocad/F-027-core-measure.scr", nativeCore.scriptSha256],
  ["tools/autocad/F027StretchPoints.cs", nativeCore.pluginSourceSha256],
  ["tools/autocad/run-f027-core.mjs", nativeCore.runnerSha256],
]);
const checkerOwned = new Set(["parity/F-027-scope.md", "parity/expected/F-027.json", "tools/parity/check-f027-cross-evidence.mjs"]);
const sourceCovered = (path, hash) => checkerOwned.has(path) || directlyRecorded.get(path) === hash || recordedMaps.some((map) => map[path] === hash);
const uncoveredRuntimeSources = Object.entries(implementationSha256).filter(([path, hash]) => !sourceCovered(path, hash)).map(([path]) => path);

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
  browserWorkflow: browser.status === "PASS" && allTrue(browser.checks),
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
    && readback.dxf?.sha256 === sha256(artifactBytes.productionDxf) && readback.kdraw?.sha256 === sha256(artifactBytes.productionKdraw),
  secondaryOracles: oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.certificationAuthority === false
    && oracles.sourceArtifactSha256 === sha256(artifactBytes.productionDxf)
    && oracleByName.librecad?.expected === "2.2.1.5" && oracleByName.freecad?.expected === "1.1.3"
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  sourceHashCoverage: uncoveredRuntimeSources.length === 0,
  certificationStillClosed: expected.remainingCertificationRequirements.includes("isolatedOwnedAutoCadDesktopLive")
    && expected.remainingCertificationRequirements.includes("independentZeroP0P1Review"),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-027 candidate cross-evidence mismatch: ${JSON.stringify({ checks, uncoveredRuntimeSources })}`);

const result = {
  schemaVersion: 1,
  rowId: "F-027",
  source: "AutoCAD 2024 Core reference + Chromium crossing window/polygon + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  remainingCertificationRequirements: expected.remainingCertificationRequirements,
  status: "CANDIDATE_PASS_DESKTOP_AND_REVIEW_REQUIRED",
};
await writeFile(resolve(artifactRoot, "F-027-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-027 candidate cross-evidence PASS; isolated AutoCAD Desktop live and independent 0 P0/P1 review remain required.");
