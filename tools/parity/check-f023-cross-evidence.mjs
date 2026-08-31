#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const artifactPaths = {
  autocad: "evidence/artifacts/F-023-autocad-readback.json",
  browser: "evidence/artifacts/F-023-browser-readback.json",
  readback: "evidence/artifacts/F-023-independent-readback.json",
  oracles: "evidence/artifacts/F-023-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-023.json");

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
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-core/test/extend.test.ts",
  "packages/cad-core/test/f023-mutation-proven.test.ts",
  "packages/cad-dxf/test/f023-extend-roundtrip.test.ts",
  "e2e/f023-extend.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/autocad/f023-standard-matrix.ps1",
  "tools/autocad/f022-shift-click.ps1",
  "tools/autocad/run-f023.mjs",
  "tools/autocad/run-f023-core.mjs",
  "parity/autocad/F-023-core.scr",
  "tools/autocad/f023-runner.test.mjs",
  "tools/autocad/process-ownership.test.mjs",
  "tools/parity/capture-f023-browser.mjs",
  "tools/parity/build-f023-browser-readback.mjs",
  "tools/parity/run-f023-readback.mjs",
  "tools/oracles/freecad-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f023-oracles.mjs",
  "parity/F-023-scope.md",
  "parity/expected/F-023.json",
  "tools/parity/check-f023-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const recordedMaps = [autocad.implementationSha256, browser.implementationSha256, readback.implementationSha256, oracles.implementationSha256].filter(Boolean);
const checkerOwnedPaths = new Set(["parity/F-023-scope.md", "parity/expected/F-023.json", "tools/parity/check-f023-cross-evidence.mjs"]);
const allRecordedSourcesCurrent = recordedMaps.every((map) => Object.entries(map).every(([path, hash]) => implementationSha256[path] === hash));
const everyRuntimeSourceRecorded = Object.entries(implementationSha256).every(([path, hash]) => checkerOwnedPaths.has(path) || recordedMaps.some((map) => map[path] === hash));

const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const listClose = (left, right, tolerance = 1e-9) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
  && left.every((value, index) => Array.isArray(value)
    ? listClose(value, right[index], tolerance)
    : close(value, right[index], tolerance));
const points = (value) => value?.map((point) => Array.isArray(point) ? point.slice(0, 2) : [point.x, point.y]);
const spline = (value) => ({
  degree: value?.degree ?? value?.degreeOfSplineCurve,
  controlPoints: points(value?.controlPoints),
  knots: value?.knots ?? value?.knotValues,
  weights: value?.weights,
  rational: value?.rational ?? Array.isArray(value?.weights),
});
const splineMatches = (actual, wanted, yOffset = 0) => {
  const normalized = spline(actual);
  const normalizedPoints = normalized.controlPoints?.map(([x, y]) => [x, y - yOffset]);
  return normalized.degree === wanted.degree && normalized.rational === true
    && listClose(normalizedPoints, wanted.controlPoints)
    && listClose(normalized.knots, wanted.knots)
    && listClose(normalized.weights, wanted.weights);
};
const stateLineMatches = (state, wanted) => state?.objectName === "AcDbLine"
  && ((listClose(state.details?.start, wanted[0], 0.002) && listClose(state.details?.end, wanted[1], 0.002))
    || (listClose(state.details?.start, wanted[1], 0.002) && listClose(state.details?.end, wanted[0], 0.002)));
const lineSetMatches = (states, wanted) => Array.isArray(states) && states.length === wanted.length
  && wanted.every((line) => states.filter((state) => stateLineMatches(state, line)).length === 1);
const entityLineMatches = (entity, wanted) => entity?.kind === "line"
  && ((listClose([entity.start.x, entity.start.y], wanted[0]) && listClose([entity.end.x, entity.end.y], wanted[1]))
    || (listClose([entity.start.x, entity.start.y], wanted[1]) && listClose([entity.end.x, entity.end.y], wanted[0])));
const documentLineSetMatches = (document, handles, wanted) => Array.isArray(handles) && handles.length === wanted.length
  && wanted.every((line) => handles.filter((handle) => entityLineMatches(document?.entities?.find((entity) => entity.handle === handle), line)).length === 1);
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const outputExpected = expected.autoCad.rationalSpline.output;
const nativeRational = autocad.observations?.rationalSpline;
const autoCadComSpline = nativeRational?.after?.[0]?.details;
const autoCadDxfSpline = autocad.rationalSplineDxfReadback?.output?.[0];
const browserSpline = browser.spline?.committed?.find((entity) => entity.kind === "spline");
const browserKdrawSpline = browser.spline?.kdrawRestored?.find((entity) => entity.kind === "spline");
const readbackSpline = readback.output?.expectedSemantics?.find((entity) => entity.kind === "spline");
const strictSpline = readback.output?.strictSemantics?.find((entity) => entity.kind === "spline");
const independentSpline = readback.output?.independentSemantics?.find((entity) => entity.kind === "spline");
const viewport = autocad.observations?.shiftPhysicalInput?.viewport;
const screenSize = autocad.observations?.shiftPhysicalInput?.screenSize;
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const browserDxfBytes = await readFile(resolve(artifactRoot, "F-023-browser-spline.dxf"));
const browserKdrawBytes = await readFile(resolve(artifactRoot, "F-023-browser-spline.kdraw"));
const readbackDxfBytes = await readFile(resolve(artifactRoot, "F-023-kuubik.dxf"));
const readbackKdrawBytes = await readFile(resolve(artifactRoot, "F-023-kuubik.kdraw"));

const checks = {
  exactAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  exactAutoCadVersionOptionsAndFamilies: autocad.engineVersion?.startsWith(expected.autoCad.engineVersionPrefix)
    && autocad.benchmark === expected.benchmark
    && autocad.automationProcessIdentity?.executableName?.toLowerCase() === expected.autoCad.executableName
    && autocad.automationProcessIdentity?.fileVersion === expected.autoCad.executableFileVersion
    && autocad.automationProcessIdentity?.productVersion === expected.autoCad.executableProductVersion
    && /^[a-f0-9]{64}$/u.test(autocad.automationProcessIdentity?.executableSha256 ?? "")
    && /^[a-f0-9]{64}$/u.test(autocad.automationProcessIdentity?.startTimeSha256 ?? "")
    && autocad.installedUpdateIdentity?.displayName === expected.autoCad.installedUpdateDisplayName
    && autocad.installedUpdateIdentity?.displayVersion === expected.autoCad.installedUpdateDisplayVersion
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "executablePath")
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "startTimeUtc")
    && expected.autoCad.options.every((name) => autocad.options?.[name] === true)
    && expected.autoCad.projectModes.every((name) => autocad.options?.project?.[name] === true)
    && expected.autoCad.families.every((name) => autocad.familyChecks?.[name] === true)
    && autocad.propertiesPreserved === true && autocad.cmdNamesAfter === "",
  physicalAutoCadShiftTrim: autocad.options?.shiftSelectTrim === true
    && lineSetMatches(autocad.observations?.shiftTrim, expected.autoCad.shiftTrimmedLines)
    && listClose(autocad.observations?.shiftFixture?.target, expected.browser.shiftTargetLine)
    && listClose(autocad.observations?.shiftFixture?.boundaries, expected.browser.shiftBoundaryLines)
    && listClose(autocad.observations?.shiftFixture?.pick, expected.browser.shiftPickPoint)
    && listClose(autocad.observations?.shiftPhysicalInput?.world, expected.browser.shiftPickPoint)
    && Array.isArray(viewport) && Array.isArray(screenSize)
    && viewport[2] - viewport[0] === screenSize[0] && viewport[3] - viewport[1] === screenSize[1]
    && autocad.observations.shiftPhysicalInput.x >= viewport[0] && autocad.observations.shiftPhysicalInput.x <= viewport[2]
    && autocad.observations.shiftPhysicalInput.y >= viewport[1] && autocad.observations.shiftPhysicalInput.y <= viewport[3],
  nativeAtomicUndoRedo: autocad.options?.globalUndoRedo === true
    && lineSetMatches(autocad.observations?.globalUndoRedo?.committed, expected.autoCad.globalUndoRedo.committed)
    && lineSetMatches(autocad.observations?.globalUndoRedo?.undone, expected.autoCad.globalUndoRedo.undone)
    && lineSetMatches(autocad.observations?.globalUndoRedo?.redone, expected.autoCad.globalUndoRedo.redone),
  autoCadLayerAndProcessSafety: autocad.lockedLayer?.behavior === expected.autoCad.lockedLayerBehavior && autocad.lockedLayer?.passed === true
    && autocad.hiddenLayer?.behavior === expected.autoCad.hiddenLayerBehavior && autocad.hiddenLayer?.passed === true
    && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true
    && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  exactNativeRationalSplineAndDxf: splineMatches(nativeRational?.before?.[0]?.details, expected.autoCad.rationalSpline.source)
    && splineMatches(autoCadComSpline, outputExpected)
    && splineMatches(autoCadDxfSpline, outputExpected)
    && autocad.rationalSplineDxfReadback?.sourceSha256 === browser.downloads?.source?.sha256
    && autocad.rationalSplineDxfReadback?.outputSha256 === nativeRational?.outputSha256
    && /^[a-f0-9]{64}$/u.test(nativeRational?.outputSha256 ?? ""),
  nativeDistanceShapeAndStartProbeMatrix: (() => {
    const distances = nativeRational?.boundaryDistanceProbe;
    const shapes = nativeRational?.shapeProbe;
    const start = nativeRational?.startEndpointProbe?.details;
    return Array.isArray(distances) && distances.length === expected.autoCad.rationalSpline.distanceProbes.length
      && distances.every((probe, index) => {
        const wanted = expected.autoCad.rationalSpline.distanceProbes[index];
        return close(probe.boundaryX, wanted[0]) && close(probe.after?.details?.knots?.at(-1), wanted[1])
          && close(probe.after?.details?.controlPoints?.at(-1)?.[0], wanted[0])
          && close(probe.after?.details?.controlPoints?.at(-1)?.[1], wanted[2]);
      })
      && Array.isArray(shapes) && shapes.length === Object.keys(expected.autoCad.rationalSpline.shapeProbes).length
      && shapes.every((probe) => {
        const wanted = expected.autoCad.rationalSpline.shapeProbes[probe.name];
        return wanted && listClose(probe.after?.details?.controlPoints?.slice(-3), wanted.tail)
          && close(probe.after?.details?.knots?.at(-1), wanted.endKnot)
          && listClose(probe.after?.details?.weights, wanted.weights);
      })
      && listClose(start?.controlPoints?.slice(0, 3), expected.autoCad.rationalSpline.startProbe.head)
      && close(start?.knots?.[0], expected.autoCad.rationalSpline.startProbe.startKnot)
      && listClose(start?.weights, expected.autoCad.rationalSpline.startProbe.weights);
  })(),
  browserStandardQuickPhysicalShiftAndUndo: browser.checks && allTrue(browser.checks)
    && JSON.stringify(browser.standard?.operation?.targetHandles) === JSON.stringify(expected.browser.standardTargetHandles)
    && JSON.stringify(browser.standard?.operation?.resultHandles) === JSON.stringify(expected.browser.standardResultHandles)
    && JSON.stringify(browser.quickShift?.quick?.operation?.args?.boundaryEdgeHandles) === JSON.stringify(expected.browser.quickBoundaryHandles)
    && browser.quickShift?.physicalInput?.modifier === expected.browser.shiftModifier
    && browser.quickShift?.physicalInput?.action === expected.browser.shiftAction
    && JSON.stringify(browser.quickShift?.shiftTrim?.operation?.args?.boundaryEdgeHandles) === JSON.stringify(expected.browser.shiftBoundaryHandles)
    && listClose([browser.quickShift?.shiftTrim?.operation?.args?.targets?.[0]?.pickPoint?.x, browser.quickShift?.shiftTrim?.operation?.args?.targets?.[0]?.pickPoint?.y], expected.browser.shiftPickPoint, 0.002)
    && JSON.stringify(browser.quickShift?.shiftTrim?.operation?.resultHandles) === JSON.stringify(expected.browser.shiftResultHandles)
    && entityLineMatches(browser.quickShift?.shiftTrim?.source?.entities?.find((entity) => entity.handle === "10"), expected.browser.shiftTargetLine)
    && documentLineSetMatches(browser.quickShift?.shiftTrim?.source, expected.browser.shiftBoundaryHandles, expected.browser.shiftBoundaryLines)
    && documentLineSetMatches(browser.quickShift?.shiftTrim?.committed, browser.quickShift?.shiftTrim?.operation?.resultHandles, expected.browser.shiftTrimmedLines)
    && lineSetMatches(autocad.observations?.shiftTrim, expected.browser.shiftTrimmedLines)
    && browser.standard?.restored?.revision === 2 && browser.standard?.redone?.revision === 3
    && JSON.stringify(browser.standard?.redone?.entities) === JSON.stringify(browser.standard?.committed?.entities)
    && [browser.standard, browser.quickShift, browser.options, browser.spline].flatMap((item) => item?.consoleErrors ?? []).length === 0,
  browserOptionMatrixMatchesExpected: JSON.stringify(browser.options?.crossing?.operation?.targetHandles) === JSON.stringify(expected.browser.crossingTargetHandles)
    && listClose(browser.options?.crossing?.document?.entities?.slice(0, 2).map((entity) => [entity.end.x, entity.end.y]), expected.browser.crossingExtendedEnds)
    && listClose([browser.options?.edge?.noExtend?.entities?.[0]?.end?.x, browser.options?.edge?.noExtend?.entities?.[0]?.end?.y], expected.browser.edgeNoExtendEnd)
    && listClose([browser.options?.edge?.extend?.document?.entities?.[0]?.end?.x, browser.options?.edge?.extend?.document?.entities?.[0]?.end?.y], expected.browser.edgeExtendEnd)
    && browser.options?.edge?.extend?.operation?.args?.edgeMode === "extend"
    && browser.options?.edge?.restored?.revision === 2
    && expected.browser.projectModes.every((mode) => browser.options?.projects?.[mode]?.operation?.args?.projectMode === mode
      && listClose([browser.options?.projects?.[mode]?.document?.entities?.[0]?.end?.x, browser.options?.projects?.[mode]?.document?.entities?.[0]?.end?.y], expected.browser.projectExtendedEnd))
    && JSON.stringify(browser.options?.refusals?.rejected?.map(({ handle, reason }) => [handle, reason])) === JSON.stringify(expected.browser.layerRefusals)
    && browser.options?.refusals?.operationCount === 0,
  autoCadBrowserAndKdrawSameRationalOutput: splineMatches(browserSpline, outputExpected)
    && splineMatches(browserKdrawSpline, outputExpected)
    && JSON.stringify(browser.downloads?.dxf?.types) === JSON.stringify(expected.browser.downloadTypes)
    && browser.downloads?.dxf?.sha256 === sha256(browserDxfBytes)
    && browser.downloads?.kdraw?.sha256 === sha256(browserKdrawBytes),
  productionReadbackExact: JSON.stringify(readback.command?.targetHandles) === JSON.stringify(expected.readback.targetHandles)
    && JSON.stringify(readback.command?.resultHandles) === JSON.stringify(expected.readback.resultHandles)
    && JSON.stringify(readback.command?.changes?.map((change) => change.entity.kind)) === JSON.stringify(expected.readback.resultKinds)
    && JSON.stringify(readback.dxf?.emittedHandles) === JSON.stringify(expected.readback.emittedHandles)
    && readback.output?.strictMismatch === null && readback.output?.independentMismatch === null
    && splineMatches(readbackSpline, outputExpected, 1100)
    && splineMatches(strictSpline, outputExpected, 1100)
    && splineMatches(independentSpline, outputExpected, 1100)
    && readback.kdraw?.exactDocument === true && readback.undo?.present === true && readback.undo?.revision === 2 && readback.undo?.restored === true
    && readback.redo?.present === true && readback.redo?.revision === 3 && readback.redo?.restored === true,
  exactOutputBytes: readback.dxf?.sha256 === sha256(readbackDxfBytes) && readback.dxf?.byteLength === readbackDxfBytes.byteLength
    && readback.kdraw?.sha256 === sha256(readbackKdrawBytes) && readback.kdraw?.byteLength === readbackKdrawBytes.byteLength,
  secondaryOraclesHonestAndPinned: oracles.certificationAuthority === expected.oracles.certificationAuthority
    && oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE"
    && oracles.sourceArtifactSha256 === sha256(browserDxfBytes)
    && oracleByName.librecad?.expected === expected.oracles.librecad && oracleByName.freecad?.expected === expected.oracles.freecad
    && oracleByName.librecad?.fixtureReport?.inputSha256 === sha256(browserDxfBytes)
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  currentSourceHashCoverage: allRecordedSourcesCurrent && everyRuntimeSourceRecorded,
};

if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-023 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1,
  rowId: "F-023",
  source: "AutoCAD 2024.1.2 physical desktop workflow + Chromium physical Shift-click workflow + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-023-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-023 AutoCAD/Chromium/DXF/KDRAW1 cross-evidence PASS.");
