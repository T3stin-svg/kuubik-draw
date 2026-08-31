#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exactDirectFamilyGeometry } from "../autocad/f024-dxf-verifier.mjs";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const artifactPaths = {
  autocad: "evidence/artifacts/F-024-autocad-readback.json",
  browser: "evidence/artifacts/F-024-browser-readback.json",
  readback: "evidence/artifacts/F-024-independent-readback.json",
  oracles: "evidence/artifacts/F-024-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-024.json");

const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/fillet.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/f024-mutation-proven.test.ts",
  "packages/cad-core/test/fillet.test.ts",
  "packages/cad-renderer/src/bounds.ts",
  "packages/cad-renderer/src/renderer.ts",
  "packages/cad-renderer/src/selection.ts",
  "packages/cad-renderer/test/renderer.test.ts",
  "packages/cad-renderer/test/selection.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f024-fillet-roundtrip.test.ts",
  "packages/cad-print/src/index.ts",
  "packages/cad-print/test/vector-output.test.ts",
  "package-lock.json",
  "e2e/f024-fillet.spec.ts",
  "e2e/helpers/model-space.ts",
  "evidence/artifacts/F-024-browser-parametric-source.dxf",
  "tools/autocad/f024-runner.test.mjs",
  "tools/autocad/f024-dxf-verifier.mjs",
  "tools/autocad/f024-standard-matrix.ps1",
  "tools/autocad/f022-shift-click.ps1",
  "tools/autocad/run-f024.mjs",
  "tools/parity/run-f024-readback.mjs",
  "tools/parity/capture-f024-browser.mjs",
  "tools/parity/build-f024-browser-readback.mjs",
  "tools/oracles/freecad-f024-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f024-oracles.mjs",
  "parity/F-024-scope.md",
  "parity/expected/F-024.json",
  "tools/parity/check-f024-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const recordedMaps = [autocad.implementationSha256, browser.implementationSha256, readback.implementationSha256, oracles.implementationSha256].filter(Boolean);
const checkerOwnedPaths = new Set(["parity/F-024-scope.md", "parity/expected/F-024.json", "tools/parity/check-f024-cross-evidence.mjs"]);
const staleRecordedSources = recordedMaps.flatMap((map) => Object.entries(map)
  .filter(([path, hash]) => implementationSha256[path] !== hash)
  .map(([path]) => path)).filter((path, index, values) => values.indexOf(path) === index);
const uncoveredRuntimeSources = Object.entries(implementationSha256)
  .filter(([path, hash]) => !checkerOwnedPaths.has(path) && !recordedMaps.some((map) => map[path] === hash))
  .map(([path]) => path);
const allRecordedSourcesCurrent = recordedMaps.every((map) => Object.entries(map).every(([path, hash]) => implementationSha256[path] === hash));
const everyRuntimeSourceRecorded = Object.entries(implementationSha256).every(([path, hash]) => checkerOwnedPaths.has(path) || recordedMaps.some((map) => map[path] === hash));

const close = (left, right, tolerance = 1e-7) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const listClose = (left, right, tolerance = 1e-7) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
  && left.every((value, index) => Array.isArray(value) ? listClose(value, right[index], tolerance) : close(value, right[index], tolerance));
const normalizeWeights = (weights) => Array.isArray(weights) && weights.length > 0 && Math.abs(weights[0]) > 1e-12
  ? weights.map((weight) => weight / weights[0]) : null;
const splinePoint = (spline, fraction) => {
  const degree = spline?.degree ?? spline?.degreeOfSplineCurve; const controlPoints = spline?.controlPoints;
  const knots = spline?.knots ?? spline?.knotValues; const weights = spline?.weights;
  if (!Number.isInteger(degree) || !Array.isArray(controlPoints) || !Array.isArray(knots) || !Array.isArray(weights)
    || controlPoints.length !== weights.length || knots.length !== controlPoints.length + degree + 1) return null;
  const last = controlPoints.length - 1; const start = knots[degree]; const end = knots[last + 1]; const parameter = start + (end - start) * fraction;
  let span = last; if (parameter < end) { span = degree; while (span < last && !(parameter >= knots[span] && parameter < knots[span + 1])) span += 1; }
  const values = Array.from({ length: degree + 1 }, (_, index) => { const sourceIndex = span - degree + index; const point = controlPoints[sourceIndex]; const weight = weights[sourceIndex]; return { x: point.x * weight, y: point.y * weight, weight }; });
  for (let level = 1; level <= degree; level += 1) for (let index = degree; index >= level; index -= 1) {
    const sourceIndex = span - degree + index; const denominator = knots[sourceIndex + degree - level + 1] - knots[sourceIndex];
    const alpha = denominator === 0 ? 0 : (parameter - knots[sourceIndex]) / denominator; const before = values[index - 1]; const current = values[index];
    values[index] = { x: before.x * (1 - alpha) + current.x * alpha, y: before.y * (1 - alpha) + current.y * alpha, weight: before.weight * (1 - alpha) + current.weight * alpha };
  }
  const result = values[degree]; return result && Math.abs(result.weight) > 1e-12 ? [result.x / result.weight, result.y / result.weight] : null;
};
const splineProbes = (spline) => [0, 0.25, 0.5, 0.75, 1].map((fraction) => splinePoint(spline, fraction));
const splineMatches = (left, right) => (left?.degree ?? left?.degreeOfSplineCurve) === (right?.degree ?? right?.degreeOfSplineCurve)
  && listClose((left?.controlPoints ?? []).map(({ x, y }) => [x, y]), (right?.controlPoints ?? []).map(({ x, y }) => [x, y]))
  && listClose(left?.knots ?? left?.knotValues, right?.knots ?? right?.knotValues)
  && listClose(normalizeWeights(left?.weights), normalizeWeights(right?.weights))
  && listClose(splineProbes(left), splineProbes(right));
const relativeVertices = (vertices) => {
  const points = vertices?.map((point) => Array.isArray(point) ? point : [point.x, point.y]); const origin = points?.[0];
  return origin ? points.map(([x, y]) => [x - origin[0], y - origin[1]]) : null;
};
const polylineDetails = (entity) => entity?.details ?? {
  vertices: entity?.vertices?.map(({ x, y }) => [x, y]), closed: entity?.closed,
  bulges: entity?.vertices?.map(({ bulge }) => bulge ?? 0), widths: entity?.vertices?.map(({ startWidth, endWidth }) => [startWidth ?? 0, endWidth ?? 0]),
};
const polylineMatches = (left, right, relative = false) => {
  const first = polylineDetails(left); const second = polylineDetails(right);
  const firstVertices = relative ? relativeVertices(first.vertices) : first.vertices; const secondVertices = relative ? relativeVertices(second.vertices) : second.vertices;
  return first.closed === second.closed && listClose(firstVertices, secondVertices) && listClose(first.bulges, second.bulges) && listClose(first.widths, second.widths);
};
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const rawRecord = (layer) => autocad.dxfReadback?.selectedRawConstructionRecords?.[layer]?.[0];
const rawPoint = (record, firstCode, secondCode) => [Number(record?.groups?.[firstCode]), Number(record?.groups?.[secondCode])];
const browserEntity = (handle) => browser.construction?.committed?.entities?.find((entity) => entity.handle === handle);
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const browserConstructionDxfBytes = await readFile(resolve(artifactRoot, "F-024-browser-construction.dxf"));
const browserConstructionKdrawBytes = await readFile(resolve(artifactRoot, "F-024-browser-construction.kdraw"));
const readbackDxfBytes = await readFile(resolve(artifactRoot, "F-024-kuubik.dxf"));
const readbackKdrawBytes = await readFile(resolve(artifactRoot, "F-024-kuubik.kdraw"));

const nativeXlineRay = rawRecord("F024_XLINE_LINE");
const nativePairRay = rawRecord("F024_RAY_XLINE");
const nativeRayNoTrim = rawRecord("F024_RAY_LINE_NO_TRIM");
const nativeXlineNoTrim = rawRecord("F024_XLINE_LINE_NO_TRIM");
const browserTrimOperation = browser.construction?.operations?.[0];
const browserNoTrimOperation = browser.construction?.operations?.[1];
const nativeMixed = Array.isArray(autocad.observations?.mixed) ? autocad.observations.mixed[0] : autocad.observations?.mixed;
const nativeFpa0NoTrimEntities = Array.isArray(autocad.observations?.filletPolyArc0NoTrim) ? autocad.observations.filletPolyArc0NoTrim : [autocad.observations?.filletPolyArc0NoTrim].filter(Boolean);
const nativeFpa0NoTrimPolyline = nativeFpa0NoTrimEntities.find((entity) => entity.objectName === "AcDbPolyline");
const nativeFpa0NoTrimArcs = nativeFpa0NoTrimEntities.filter((entity) => entity.objectName === "AcDbArc");
const browserMixed = browser.matrix?.joined?.entities?.find((entity) => entity.handle === "10");
const browserFpa0NoTrimPolyline = browser.matrix?.committed?.entities?.find((entity) => entity.handle === "50");
const browserFpa0NoTrimArcs = browser.matrix?.committed?.entities?.filter((entity) => entity.kind === "arc") ?? [];
const nativeMixedDxf = autocad.dxfReadback?.selectedLayerEntities?.F024_MIXED?.find((entity) => entity.type === "LWPOLYLINE");
const nativeFpa0NoTrimDxf = autocad.dxfReadback?.selectedLayerEntities?.F024_FPA0_NO_TRIM ?? [];
const browserSourceSpline = browser.parametric?.source?.entities?.find((entity) => entity.handle === "40");
const browserOutputSpline = browser.parametric?.committed?.entities?.find((entity) => entity.handle === "40");
const nativeSourceSpline = autocad.parametricSourceDxfReadback?.spline;
const nativeOutputSpline = autocad.parametricDxfReadback?.selectedLayerEntities?.["0"]?.find((entity) => entity.type === "SPLINE");
const nativeDirectFamilyObservations = {
  F024_LINE_CIRCLE: autocad.observations?.lineCircle,
  F024_LINE_ARC: autocad.observations?.lineArc,
  F024_LINE_CIRCLE_TRIM: autocad.observations?.lineCircleTrim,
  F024_LINE_ELLIPSE: autocad.observations?.lineEllipse,
  F024_LINE_SPLINE: autocad.observations?.lineSpline,
};
const checks = {
  exactAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  exactAutoCadIdentity: autocad.benchmark === expected.benchmark
    && autocad.engineVersion?.startsWith(expected.autoCad.engineVersionPrefix)
    && autocad.automationProcessIdentity?.executableName?.toLowerCase() === expected.autoCad.executableName
    && autocad.automationProcessIdentity?.fileVersion === expected.autoCad.executableFileVersion
    && autocad.automationProcessIdentity?.productVersion === expected.autoCad.executableProductVersion
    && autocad.installedUpdateIdentity?.displayName === expected.autoCad.installedUpdateDisplayName
    && autocad.installedUpdateIdentity?.displayVersion === expected.autoCad.installedUpdateDisplayVersion
    && /^[a-f0-9]{64}$/u.test(autocad.automationProcessIdentity?.executableSha256 ?? "")
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "executablePath")
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "startTimeUtc"),
  completeNativeMatrixAndProcessSafety: allTrue(autocad.checks)
    && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true
    && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true
    && autocad.userDocument?.blankRestored === true && autocad.cmdNamesAfter === "",
  exactNativeConstructionLineDxf: nativeXlineRay?.type === "RAY"
    && listClose(rawPoint(nativeXlineRay, "10", "20"), expected.autoCad.construction.xlineLineTrimRay.basePoint)
    && listClose(rawPoint(nativeXlineRay, "11", "21"), expected.autoCad.construction.xlineLineTrimRay.direction)
    && nativePairRay?.type === "RAY"
    && listClose(rawPoint(nativePairRay, "10", "20"), expected.autoCad.construction.rayXlineTrimRay.basePoint)
    && listClose(rawPoint(nativePairRay, "11", "21"), expected.autoCad.construction.rayXlineTrimRay.direction)
    && nativeRayNoTrim?.type === "RAY"
    && listClose(rawPoint(nativeRayNoTrim, "10", "20"), expected.autoCad.construction.rayLineNoTrim.basePoint)
    && listClose(rawPoint(nativeRayNoTrim, "11", "21"), expected.autoCad.construction.rayLineNoTrim.direction)
    && nativeXlineNoTrim?.type === "XLINE"
    && listClose(rawPoint(nativeXlineNoTrim, "10", "20"), expected.autoCad.construction.xlineLineNoTrim.basePoint)
    && listClose(rawPoint(nativeXlineNoTrim, "11", "21"), expected.autoCad.construction.xlineLineNoTrim.direction),
  exactNativeDirectFamilyDxf: exactDirectFamilyGeometry(
    autocad.dxfReadback,
    nativeDirectFamilyObservations,
    expected.autoCad.directFamilies,
  ),
  browserWorkflowAndExactOperations: allTrue(browser.checks)
    && JSON.stringify(browserTrimOperation?.targetHandles) === JSON.stringify(expected.browser.trimTargetHandles)
    && JSON.stringify(browserTrimOperation?.resultHandles) === JSON.stringify(expected.browser.trimResultHandles)
    && JSON.stringify(browserNoTrimOperation?.targetHandles) === JSON.stringify(expected.browser.noTrimTargetHandles)
    && JSON.stringify(browserNoTrimOperation?.resultHandles) === JSON.stringify(expected.browser.noTrimResultHandles)
    && [browser.matrix, browser.families, browser.parametric, browser.construction].flatMap((item) => item?.consoleErrors ?? []).length === 0,
  autoCadBrowserConstructionAgreement: browserEntity("20")?.kind === "ray"
    && listClose([browserEntity("20")?.basePoint?.x, browserEntity("20")?.basePoint?.y], expected.autoCad.construction.xlineLineTrimRay.basePoint)
    && listClose([browserEntity("20")?.direction?.x, browserEntity("20")?.direction?.y], expected.autoCad.construction.xlineLineTrimRay.direction)
    && browserEntity("51")?.kind === "ray"
    && listClose([browserEntity("51")?.basePoint?.x, browserEntity("51")?.basePoint?.y], expected.autoCad.construction.rayXlineTrimRay.basePoint)
    && listClose([browserEntity("51")?.direction?.x, browserEntity("51")?.direction?.y], expected.autoCad.construction.rayXlineTrimRay.direction)
    && expected.autoCad.construction.arcCenters.every(([x, y]) => browser.construction?.committed?.entities?.some((entity) => entity.kind === "arc" && close(entity.center?.x, x) && close(entity.center?.y, y) && close(entity.radius, 10))),
  autoCadBrowserExactPolylineAgreement: nativeMixed?.layer === "F024_MIXED" && nativeMixedDxf?.handle === nativeMixed.handle
    && nativeMixedDxf?.layer === "F024_MIXED" && browserMixed?.handle === "10" && browserMixed?.layerId === "0"
    && polylineMatches(nativeMixed, nativeMixedDxf) && polylineMatches(nativeMixed, browserMixed, true)
    && nativeFpa0NoTrimPolyline?.layer === "F024_FPA0_NO_TRIM" && browserFpa0NoTrimPolyline?.handle === "50" && browserFpa0NoTrimPolyline?.layerId === "0"
    && polylineMatches(nativeFpa0NoTrimPolyline, browserFpa0NoTrimPolyline)
    && nativeFpa0NoTrimDxf.some((entity) => entity.handle === nativeFpa0NoTrimPolyline.handle && polylineMatches(nativeFpa0NoTrimPolyline, entity))
    && nativeFpa0NoTrimArcs.length === 2 && browserFpa0NoTrimArcs.length === 2
    && nativeFpa0NoTrimArcs.every((nativeArc) => browserFpa0NoTrimArcs.some((browserArc) => close(nativeArc.details?.center?.[0], browserArc.center?.x)
      && close(nativeArc.details?.center?.[1], browserArc.center?.y) && close(nativeArc.details?.radius, browserArc.radius))),
  autoCadBrowserSameNonUniformRationalSpline: new Set(browserSourceSpline?.weights ?? []).size > 1 && new Set(browserOutputSpline?.weights ?? []).size > 1
    && splineMatches(nativeSourceSpline, browserSourceSpline) && splineMatches(nativeOutputSpline, browserOutputSpline)
    && autocad.parametricSourceDxfReadback?.sha256 === browser.downloads?.parametricSourceDxf?.sha256,
  productionReadbackExact: readback.output?.strictMismatch === null && readback.output?.independentMismatch === null
    && readback.kdraw?.productionDeserializer === true && readback.kdraw?.manifestEntryCount === 1 && readback.kdraw?.attachmentCount === 0
    && readback.kdraw?.exactDocument === true && readback.undo?.fullyRestored === true && readback.redo?.fullyRedone === true
    && readback.undo?.states?.every(({ present }) => present === true) && readback.redo?.states?.every(({ present }) => present === true),
  exactOutputBytes: browser.downloads?.constructionDxf?.sha256 === sha256(browserConstructionDxfBytes)
    && browser.downloads?.constructionKdraw?.sha256 === sha256(browserConstructionKdrawBytes)
    && readback.dxf?.sha256 === sha256(readbackDxfBytes) && readback.dxf?.byteLength === readbackDxfBytes.byteLength
    && readback.kdraw?.sha256 === sha256(readbackKdrawBytes) && readback.kdraw?.byteLength === readbackKdrawBytes.byteLength,
  secondaryOraclesHonestAndPinned: oracles.certificationAuthority === expected.oracles.certificationAuthority
    && oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE"
    && oracleByName.librecad?.expected === expected.oracles.librecad && oracleByName.freecad?.expected === expected.oracles.freecad
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  currentSourceHashCoverage: allRecordedSourcesCurrent && everyRuntimeSourceRecorded,
};

if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-024 cross-evidence mismatch: ${JSON.stringify({ checks, staleRecordedSources, uncoveredRuntimeSources })}`);
const result = {
  schemaVersion: 1,
  rowId: "F-024",
  source: "AutoCAD 2024.1.2 live COM/raw DXF + Chromium physical workflow + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-024-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-024 AutoCAD/Chromium/DXF/KDRAW1 RAY-XLINE cross-evidence PASS.");
