#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeF109HatchTopology, roundF109Number } from "./f109-semantics.mjs";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-109-autocad-readback.json",
  browser: "evidence/artifacts/F-109-browser-readback.json",
  readback: "evidence/artifacts/F-109-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-109.json"), "utf8"));
const sourcePaths = {
  exporter: "packages/cad-dxf/src/index.ts",
  plotStyle: "packages/cad-core/src/plot-style.ts",
  aciPalette: "packages/cad-core/src/aci-palette.ts",
  exportTests: "packages/cad-dxf/test/f109-export.test.ts",
  mutationTests: "packages/cad-dxf/test/f109-mutation-proven.test.ts",
  fixture: "parity/fixtures/f109-document.ts",
  expected: "parity/expected/F-109.json",
  autocadScript: "parity/autocad/F-109.scr",
  autocadCore: "tools/autocad/run-f109.mjs",
  autocadDesktopMatrix: "tools/autocad/f109-desktop-readback.ps1",
  autocadDesktop: "tools/autocad/run-f109-desktop.mjs",
  autocadAciMatrix: "tools/autocad/f109-aci-palette.ps1",
  autocadAciRunner: "tools/autocad/run-f109-aci-palette.mjs",
  autocadAll: "tools/autocad/run-f109-all.mjs",
  browserE2e: "e2e/f109-dxf-export.spec.ts",
  browserCapture: "tools/parity/capture-f109-browser.mjs",
  browserBuilder: "tools/parity/build-f109-browser-readback.mjs",
  independentReader: "tools/parity/read-f109-dxf.py",
  readbackRunner: "tools/parity/run-f109-readback.mjs",
  scope: "parity/F-109-scope.md",
  app: "apps/web/src/App.tsx",
  packageLock: "package-lock.json",
  crossChecker: "tools/parity/check-f109-cross-evidence.mjs",
  semanticNormalizer: "tools/parity/f109-semantics.mjs",
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
const independentSemanticHashes = semanticHashes(readback.independent?.semanticEntities);
const browserSemanticHashes = semanticHashes(readback.browserIndependent?.semanticEntities);
const expectedHandles = Object.keys(expected.semanticSha256ByHandle).sort();
const nativeGeometryDisagreements = expectedHandles.filter((handle) => {
  const independent = readback.independent?.semanticEntities?.[handle];
  if (independent?.type === "HATCH") return JSON.stringify(normalizeF109HatchTopology(independent)) !== JSON.stringify(autocad.core?.hatchTopology?.[handle]);
  return JSON.stringify(independentGeometry(independent)) !== JSON.stringify(desktopGeometry(autocad.desktop?.nativeRecords?.[handle]));
});
const closePoint = (left, right, tolerance = 0.001) => Array.isArray(left) && Array.isArray(right) && left.length === 2 && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const sourceMaps = [browser.sourceSha256, readback.sourceSha256, autocad.implementationSha256, autocad.core?.implementationSha256, autocad.desktop?.implementationSha256].filter(Boolean);
const everyRecordedSourceIsCurrent = sourceMaps.every((sourceMap) => Object.entries(sourceMap).every(([key, value]) => implementationSha256[key] === value));
const everyCurrentSourceIsCovered = Object.entries(implementationSha256).every(([key, value]) => sourceMaps.some((sourceMap) => sourceMap[key] === value));
const fileSha = readback.sha256;
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.passed === true,
  exactSameProductionBytes: /^[a-f0-9]{64}$/u.test(fileSha) && browser.dxf?.sha256 === fileSha && readback.independent?.sha256 === fileSha && readback.browserIndependent?.sha256 === fileSha && autocad.sourceSha256 === fileSha && autocad.core?.sourceSha256 === fileSha && autocad.desktop?.sourceSha256 === fileSha,
  exactFortyEntityManifest: exactEntities(readback.independent?.entities) && exactEntities(readback.browserIndependent?.entities) && exactEntities(autocad.core?.entities) && exactNativeEntities(autocad.desktop?.entities) && readback.independent?.totalEntities === 40 && autocad.desktop?.totalEntities === 40,
  unitsBulgesAndStyles: readback.independent?.units === 4 && readback.independent?.bulgedPolylines === 2 && autocad.core?.units === 4 && autocad.core?.bulgedPolylines === 2 && autocad.desktop?.units === 4 && readback.independent?.styles?.includes("NORMAL") && readback.independent?.styles?.includes("Standard") && autocad.desktop?.styles?.includes("NORMAL") && autocad.desktop?.styles?.includes("Standard"),
  layersAgree: layerMatches(readback.independent?.layers) && layerMatches(autocad.core?.layers) && layerMatches(autocad.desktop?.layers),
  strictIndependentAudit: readback.independent?.auditErrors === 0 && readback.independent?.auditFixes === 0 && readback.browserIndependent?.auditErrors === 0 && readback.browserIndependent?.auditFixes === 0,
  visibleBrowserExactByteWorkflow: browser.matrix?.viewport?.width === 1920 && browser.matrix?.viewport?.height === 1080 && browser.matrix?.exactProductionBytes === true && browser.matrix?.entityCount === 40 && browser.matrix?.consoleErrors?.length === 0 && Object.values(browser.checks ?? {}).every((value) => value === true),
  nativeCoreAndDesktop: autocad.core?.engineVersion?.startsWith("24.3") && autocad.desktop?.engineVersion?.startsWith("24.3") && Object.values(autocad.desktop?.checks ?? {}).every((value) => value === true),
  exactSemanticGolden: JSON.stringify(independentSemanticHashes) === JSON.stringify(expected.semanticSha256ByHandle) && JSON.stringify(browserSemanticHashes) === JSON.stringify(expected.semanticSha256ByHandle) && JSON.stringify(readback.semanticSha256ByHandle) === JSON.stringify(expected.semanticSha256ByHandle),
  allNativeHandlesAndGeometryAgree: JSON.stringify(Object.keys(autocad.desktop?.nativeRecords ?? {}).sort()) === JSON.stringify(expectedHandles) && nativeGeometryDisagreements.length === 0,
  exactNativeHatchTopology: JSON.stringify(autocad.core?.hatchTopology) === JSON.stringify(expected.nativeHatchTopology) && Object.entries(expected.nativeHatchTopology).every(([handle, topology]) => JSON.stringify(normalizeF109HatchTopology(readback.independent?.semanticEntities?.[handle])) === JSON.stringify(topology)),
  extentsAreNativeAndHeaderIsNotStale: readback.independent?.headerExtents === null && readback.browserIndependent?.headerExtents === null && closePoint(autocad.core?.extents?.min, expected.autoCadExtents?.min) && closePoint(autocad.core?.extents?.max, expected.autoCadExtents?.max) && closePoint(autocad.desktop?.extents?.min, expected.autoCadExtents?.min) && closePoint(autocad.desktop?.extents?.max, expected.autoCadExtents?.max),
  exactAutoCadProperties: autocad.core?.layers?.VIIRUTUS?.trueColor === 12632256 && autocad.core?.layers?.VIIRUTUS?.transparencyRaw === 33554636 && autocad.core?.semanticRecords?.["1000"]?.color === 30 && autocad.core?.semanticRecords?.["1000"]?.transparencyRaw === 33554585 && autocad.core?.semanticRecords?.["1001"]?.color === 152 && autocad.core?.semanticRecords?.["1001"]?.trueColor === 681180 && autocad.core?.semanticRecords?.["1001"]?.transparencyRaw === 33554649 && autocad.core?.semanticRecords?.["1209"]?.text === "MÕÕT ŠŽ€ 10" && autocad.core?.dimensionTextStyleHandle === "401",
  exactLiveAciPalette: autocad.palette?.livePaletteSha256 === "5ff10c83691cd9934aecef90345b7435d4bbbc9e435a2853e9863cead6092d88" && autocad.palette?.checkedInPaletteSha256 === autocad.palette?.livePaletteSha256 && autocad.palette?.palette?.length === 255 && Object.values(autocad.palette?.checks ?? {}).every((value) => value === true),
  desktopProcessSafety: autocad.desktop?.automationProcessOwned === true && autocad.desktop?.automationProcessTerminated === true && autocad.desktop?.processSetRestored === true && autocad.desktop?.openedReadOnly === true && autocad.desktop?.closedWithoutSaving === true,
  mutationAndCurrentSources: implementationSha256.mutationTests?.length === 64 && everyRecordedSourceIsCurrent && everyCurrentSourceIsCovered,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-109 cross-evidence mismatch: ${JSON.stringify({ checks, nativeGeometryDisagreements })}`);
const result = {
  schemaVersion: 1,
  rowId: "F-109",
  source: "Exact Kuubik browser production DXF bytes cross-read by strict ezdxf, AutoCAD 2024 Core Console and an owned visible AutoCAD 2024 desktop process",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  productionDxf: { bytes: readback.bytes, sha256: fileSha },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifacts, "F-109-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-109 AutoCAD/Chromium/ezdxf cross-evidence PASS.");
