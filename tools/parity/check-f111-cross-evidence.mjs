#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeF109HatchTopology, roundF109Number } from "./f109-semantics.mjs";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-111-autocad-readback.json",
  browser: "evidence/artifacts/F-111-browser-readback.json",
  readback: "evidence/artifacts/F-111-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-109.json"), "utf8"));

const sourcePaths = {
  importer: "packages/cad-dxf/src/import.ts",
  exporter: "packages/cad-dxf/src/index.ts",
  transaction: "packages/cad-core/src/transaction.ts",
  app: "apps/web/src/App.tsx",
  unitTests: "packages/cad-dxf/test/f111-roundtrip.test.ts",
  mutationTests: "packages/cad-dxf/test/f111-mutation-proven.test.ts",
  transactionTests: "packages/cad-core/test/transaction.test.ts",
  browserE2e: "e2e/f111-dxf-roundtrip.spec.ts",
  browserCapture: "tools/parity/capture-f111-browser.mjs",
  independentReader: "tools/parity/read-f109-dxf.py",
  readbackRunner: "tools/parity/run-f111-readback.mjs",
  fixture: "parity/fixtures/f109-document.ts",
  expected: "parity/expected/F-109.json",
  scope: "parity/F-111-scope.md",
  autocadScript: "parity/autocad/F-109.scr",
  autocadCore: "tools/autocad/run-f111-core.mjs",
  autocadDesktopMatrix: "tools/autocad/f109-desktop-readback.ps1",
  autocadDesktop: "tools/autocad/run-f111-desktop.mjs",
  autocadAll: "tools/autocad/run-f111-all.mjs",
  packageLock: "package-lock.json",
  crossChecker: "tools/parity/check-f111-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const exactEntities = (entities) => JSON.stringify(entities) === JSON.stringify({ CIRCLE: 1, DIMENSION: 1, HATCH: 7, LINE: 12, LWPOLYLINE: 9, TEXT: 10 });
const exactNativeEntities = (entities) => entities?.AcDbLine === 12 && entities?.AcDbPolyline === 9 && entities?.AcDbText === 10 && entities?.AcDbHatch === 7 && entities?.AcDbCircle === 1 && entities?.AcDbAlignedDimension === 1;
const layerMatches = (layers) => layers?.JOONED?.color === 7 && layers?.JOONED?.lineweight === 25 && layers?.JOONED?.linetype?.toUpperCase() === "CONTINUOUS" && layers?.TELJED?.color === 4 && layers?.TELJED?.lineweight === 13 && layers?.TELJED?.linetype?.toUpperCase() === "DASHDOT" && layers?.SEINAD?.color === 6 && layers?.SEINAD?.lineweight === 50 && layers?.SEINAD?.linetype?.toUpperCase() === "DASHED" && layers?.VIIRUTUS?.color === 9 && layers?.VIIRUTUS?.lineweight === 13 && layers?.VIIRUTUS?.linetype?.toUpperCase() === "CONTINUOUS";
const rounded = roundF109Number;
const point = (value) => value?.slice(0, 2).map(rounded);
function independentGeometry(record) {
  switch (record?.type) {
    case "LINE": return { type: "AcDbLine", start: point(record.start), end: point(record.end) };
    case "LWPOLYLINE": return { type: "AcDbPolyline", closed: record.closed, vertices: record.vertices.map((value) => [rounded(value[0]), rounded(value[1]), rounded(value[4] ?? 0)]) };
    case "TEXT": return { type: "AcDbText", insert: point(record.insert), text: record.text, height: rounded(record.height), style: record.style, rotation: rounded(record.rotation * Math.PI / 180) };
    case "HATCH": return { type: "AcDbHatch", pattern: record.pattern, associative: record.associative, loopCount: record.loops.length };
    case "CIRCLE": return { type: "AcDbCircle", center: point(record.center), radius: rounded(record.radius) };
    case "DIMENSION": return { type: "AcDbAlignedDimension", first: point(record.first), second: point(record.second), textPosition: point(record.textPosition), text: record.text, measurement: rounded(record.measurement), style: record.style };
    default: return null;
  }
}
function desktopGeometry(record) {
  switch (record?.type) {
    case "AcDbLine": return { type: record.type, start: point(record.start), end: point(record.end) };
    case "AcDbPolyline": return { type: record.type, closed: record.closed, vertices: record.vertices.map((value) => [rounded(value[0]), rounded(value[1]), rounded(value[2] ?? 0)]) };
    case "AcDbText": return { type: record.type, insert: point(record.insert), text: record.text, height: rounded(record.height), style: record.style, rotation: rounded(record.rotation) };
    case "AcDbHatch": return { type: record.type, pattern: record.pattern, associative: record.associative, loopCount: record.loopCount };
    case "AcDbCircle": return { type: record.type, center: point(record.center), radius: rounded(record.radius) };
    case "AcDbAlignedDimension": return { type: record.type, first: point(record.first), second: point(record.second), textPosition: point(record.textPosition), text: record.text, measurement: rounded(record.measurement), style: record.style };
    default: return null;
  }
}
const semanticHashes = (records) => Object.fromEntries(Object.entries(records ?? {}).map(([handle, record]) => [handle, sha256(JSON.stringify(record))]));
const expectedHandles = Object.keys(expected.semanticSha256ByHandle).sort();
const sourceRecords = readback.sourceReadback?.semanticEntities;
const roundtripRecords = readback.roundtripReadback?.semanticEntities;
const browserRecords = readback.browserReadback?.semanticEntities;
const nativeGeometryDisagreements = expectedHandles.filter((handle) => {
  const independent = browserRecords?.[handle];
  if (independent?.type === "HATCH") return JSON.stringify(normalizeF109HatchTopology(independent)) !== JSON.stringify(autocad.core?.hatchTopology?.[handle]);
  return JSON.stringify(independentGeometry(independent)) !== JSON.stringify(desktopGeometry(autocad.desktop?.nativeRecords?.[handle]));
});
const closePoint = (left, right, tolerance = 0.001) => Array.isArray(left) && Array.isArray(right) && left.length === 2 && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const sourceMaps = [browser.implementationSha256, readback.implementationSha256, autocad.implementationSha256, autocad.core?.implementationSha256, autocad.desktop?.implementationSha256].filter(Boolean);
const everyRecordedSourceIsCurrent = sourceMaps.every((sourceMap) => Object.entries(sourceMap).every(([key, value]) => implementationSha256[key] === value));
const everyCurrentSourceIsCovered = Object.entries(implementationSha256).every(([key, value]) => sourceMaps.some((sourceMap) => sourceMap[key] === value));
const fileSha = readback.browser?.sha256;
const audits = [readback.sourceReadback, readback.roundtripReadback, readback.browserReadback];
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.passed === true && readback.passed === true,
  exactSameProductionBytes: /^[a-f0-9]{64}$/u.test(fileSha) && readback.exactByteAgreement === true && readback.source?.sha256 === fileSha && readback.roundtrip?.sha256 === fileSha && browser.matrix?.source?.sha256 === fileSha && browser.matrix?.roundtrip?.sha256 === fileSha && browser.independent?.sha256 === fileSha && autocad.sourceSha256 === fileSha && autocad.core?.sourceSha256 === fileSha && autocad.desktop?.sourceSha256 === fileSha,
  exactFortyEntityManifest: audits.every((audit) => exactEntities(audit?.entities) && audit?.totalEntities === 40) && exactEntities(autocad.core?.entities) && exactNativeEntities(autocad.desktop?.entities) && autocad.core?.totalEntities === 40 && autocad.desktop?.totalEntities === 40,
  unitsBulgesAndStyles: audits.every((audit) => audit?.units === 4 && audit?.bulgedPolylines === 2 && audit?.styles?.includes("NORMAL") && audit?.styles?.includes("Standard")) && autocad.core?.units === 4 && autocad.core?.bulgedPolylines === 2 && autocad.desktop?.units === 4 && autocad.desktop?.styles?.includes("NORMAL") && autocad.desktop?.styles?.includes("Standard"),
  layersAgree: audits.every((audit) => layerMatches(audit?.layers)) && layerMatches(autocad.core?.layers) && layerMatches(autocad.desktop?.layers),
  strictIndependentAudit: audits.every((audit) => audit?.auditErrors === 0 && audit?.auditFixes === 0 && audit?.passed === true),
  visibleBrowserWorkflow: browser.matrix?.viewport?.width === 1920 && browser.matrix?.viewport?.height === 1080 && browser.matrix?.roundtrip?.exactProductionBytes === true && browser.matrix?.revision === 5 && browser.matrix?.entityCount === 40 && JSON.stringify(browser.matrix?.layers) === JSON.stringify(["0", "JOONED", "TELJED", "SEINAD", "VIIRUTUS"]) && browser.matrix?.consoleErrors?.length === 0,
  exactSemanticGolden: [sourceRecords, roundtripRecords, browserRecords].every((records) => JSON.stringify(semanticHashes(records)) === JSON.stringify(expected.semanticSha256ByHandle)) && JSON.stringify(readback.semanticSha256ByHandle) === JSON.stringify(expected.semanticSha256ByHandle),
  nativeCoreAndDesktop: autocad.core?.engineVersion?.startsWith("24.3") && autocad.desktop?.engineVersion?.startsWith("24.3") && Object.values(autocad.desktop?.checks ?? {}).every((value) => value === true),
  allNativeHandlesAndGeometryAgree: JSON.stringify(Object.keys(autocad.desktop?.nativeRecords ?? {}).sort()) === JSON.stringify(expectedHandles) && nativeGeometryDisagreements.length === 0,
  exactNativeHatchTopology: JSON.stringify(autocad.core?.hatchTopology) === JSON.stringify(expected.nativeHatchTopology) && Object.entries(expected.nativeHatchTopology).every(([handle, topology]) => JSON.stringify(normalizeF109HatchTopology(browserRecords?.[handle])) === JSON.stringify(topology)),
  extentsAreNative: closePoint(autocad.core?.extents?.min, expected.autoCadExtents?.min) && closePoint(autocad.core?.extents?.max, expected.autoCadExtents?.max) && closePoint(autocad.desktop?.extents?.min, expected.autoCadExtents?.min) && closePoint(autocad.desktop?.extents?.max, expected.autoCadExtents?.max),
  desktopProcessSafety: autocad.desktop?.automationProcessOwned === true && autocad.desktop?.automationProcessTerminated === true && autocad.desktop?.processSetRestored === true && autocad.desktop?.openedReadOnly === true && autocad.desktop?.closedWithoutSaving === true,
  mutationAndCurrentSources: /^[a-f0-9]{64}$/u.test(implementationSha256.mutationTests) && everyRecordedSourceIsCurrent && everyCurrentSourceIsCovered,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-111 cross-evidence mismatch: ${JSON.stringify({ checks, nativeGeometryDisagreements })}`);
const result = {
  schemaVersion: 1,
  rowId: "F-111",
  source: "Exact Chromium DXF import/edit/persist/export bytes cross-read by strict ezdxf, AutoCAD 2024 Core Console and an owned visible AutoCAD 2024 desktop process",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  productionDxf: { bytes: readback.browser.bytes, sha256: fileSha },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifacts, "F-111-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-111 AutoCAD/Chromium/ezdxf cross-evidence PASS.");
