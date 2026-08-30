#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const artifactPaths = {
  autocad: "evidence/artifacts/F-022-autocad-readback.json",
  browser: "evidence/artifacts/F-022-browser-readback.json",
  readback: "evidence/artifacts/F-022-independent-readback.json",
  oracles: "evidence/artifacts/F-022-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-022.json");

const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-renderer/src/index.ts",
  "packages/cad-renderer/src/selection.ts",
  "packages/cad-renderer/test/selection.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-core/test/trim.test.ts",
  "packages/cad-core/test/f022-mutation-proven.test.ts",
  "packages/cad-dxf/test/f022-trim-roundtrip.test.ts",
  "e2e/f022-trim.spec.ts",
  "tools/autocad/f022-standard-matrix.ps1",
  "tools/autocad/f022-shift-click.ps1",
  "tools/autocad/f022-runner.test.mjs",
  "tools/autocad/run-f022.mjs",
  "tools/autocad/process-ownership.test.mjs",
  "tools/parity/capture-f022-browser.mjs",
  "tools/parity/build-f022-browser-readback.mjs",
  "tools/parity/run-f022-readback.mjs",
  "tools/oracles/freecad-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f022-oracles.mjs",
  "package-lock.json",
  "parity/F-022-scope.md",
  "parity/expected/F-022.json",
  "tools/parity/check-f022-cross-evidence.mjs"
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const recordedMaps = [autocad.implementationSha256, browser.implementationSha256, readback.implementationSha256, oracles.implementationSha256].filter(Boolean);
const checkerOwnedPaths = new Set(["parity/F-022-scope.md", "parity/expected/F-022.json", "tools/parity/check-f022-cross-evidence.mjs"]);
const allRecordedSourcesCurrent = recordedMaps.every((map) => Object.entries(map).every(([path, hash]) => implementationSha256[path] === hash));
const everyRuntimeSourceRecorded = Object.entries(implementationSha256).every(([path, hash]) => checkerOwnedPaths.has(path) || recordedMaps.some((map) => map[path] === hash));
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const pointsEqual = (left, right, tolerance = 0.002) => Array.isArray(left) && Array.isArray(right) && left.length === 2 && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const statePoint = (state, name) => state?.details?.[name];
const lineStateMatches = (state, expectedLine) => state?.objectName === "AcDbLine"
  && ((pointsEqual(statePoint(state, "start"), expectedLine[0]) && pointsEqual(statePoint(state, "end"), expectedLine[1]))
    || (pointsEqual(statePoint(state, "start"), expectedLine[1]) && pointsEqual(statePoint(state, "end"), expectedLine[0])));
const lineSetMatches = (states, expectedLines) => Array.isArray(states) && states.length === expectedLines.length
  && expectedLines.every((line) => states.filter((state) => lineStateMatches(state, line)).length === 1);
const pointListMatches = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && actual.every((point, index) => pointsEqual(point, expected[index]));
const numberListMatches = (actual, expected, tolerance = 0.002) => Array.isArray(actual) && actual.length === expected.length
  && actual.every((value, index) => Array.isArray(value)
    ? numberListMatches(value, expected[index], tolerance)
    : Math.abs(value - expected[index]) <= tolerance);
const splineSemantics = (value) => ({
  degree: value?.degree,
  knots: value?.knots,
  weights: value?.weights,
  controlPoints: value?.controlPoints?.map((point) => Array.isArray(point) ? point : [point.x, point.y]),
  rational: value?.rational ?? Array.isArray(value?.weights),
});
const splineSemanticMatches = (actual, expectedSpline) => actual?.degree === expectedSpline?.degree
  && actual?.rational === true && expectedSpline?.rational === true
  && numberListMatches(actual?.knots, expectedSpline?.knots, 1e-9)
  && numberListMatches(actual?.weights, expectedSpline?.weights, 1e-9)
  && numberListMatches(actual?.controlPoints, expectedSpline?.controlPoints, 1e-9);
const expectedOptions = expected.autoCad.options;
const autoCadIdentity = autocad.automationProcessIdentity;
const autoCadShift = autocad.observations?.shiftExtend?.[0];
const viewport = autocad.observations?.shiftPhysicalInput?.viewport;
const screenSize = autocad.observations?.shiftPhysicalInput?.screenSize;
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const browserErrors = [browser.standard, browser.quick, browser.shiftExtend, browser.options, browser.composite, browser.closedCurves, browser.spline].flatMap((item) => item?.consoleErrors ?? []);
const readbackKinds = readback.command?.resultHandles?.map((handle) => readback.committed?.handles?.includes(handle)
  ? readback.committed.kinds[readback.committed.handles.indexOf(handle)]
  : null);
const dxfBytes = await readFile(resolve(root, "evidence/artifacts/F-022-kuubik.dxf"));
const kdrawBytes = await readFile(resolve(root, "evidence/artifacts/F-022-kuubik.kdraw"));

const checks = {
  exactAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  exactAutoCadVersionAndMatrix: autocad.engineVersion?.startsWith(expected.autoCad.engineVersionPrefix)
    && autocad.benchmark === expected.benchmark
    && autoCadIdentity?.executableName?.toLowerCase() === expected.autoCad.executableName
    && autoCadIdentity?.fileVersion === expected.autoCad.executableFileVersion
    && autoCadIdentity?.productVersion === expected.autoCad.executableProductVersion
    && /^[a-f0-9]{64}$/u.test(autoCadIdentity?.executableSha256 ?? "")
    && /^[a-f0-9]{64}$/u.test(autoCadIdentity?.startTimeSha256 ?? "")
    && autocad.installedUpdateIdentity?.displayName === expected.autoCad.installedUpdateDisplayName
    && autocad.installedUpdateIdentity?.displayVersion === expected.autoCad.installedUpdateDisplayVersion
    && !Object.hasOwn(autoCadIdentity ?? {}, "executablePath") && !Object.hasOwn(autoCadIdentity ?? {}, "startTimeUtc")
    && expectedOptions.every((name) => autocad.options?.[name] === true)
    && expected.autoCad.projectModes.every((name) => autocad.options?.project?.[name] === true)
    && expected.autoCad.families.every((name) => autocad.familyChecks?.[name] === true),
  physicalAutoCadShiftSelect: autocad.options?.shiftSelectExtend === true
    && pointsEqual(statePoint(autoCadShift, "start"), expected.autoCad.shiftExtendedLine.start)
    && pointsEqual(statePoint(autoCadShift, "end"), expected.autoCad.shiftExtendedLine.end)
    && Array.isArray(viewport) && Array.isArray(screenSize) && viewport[2] - viewport[0] === screenSize[0] && viewport[3] - viewport[1] === screenSize[1]
    && autocad.observations.shiftPhysicalInput.x >= viewport[0] && autocad.observations.shiftPhysicalInput.x <= viewport[2]
    && autocad.observations.shiftPhysicalInput.y >= viewport[1] && autocad.observations.shiftPhysicalInput.y <= viewport[3],
  autoCadLockedAndProcessSafety: autocad.lockedLayer?.behavior === expected.autoCad.lockedLayerBehavior && autocad.lockedLayer?.passed === true
    && autocad.hiddenLayer?.behavior === expected.autoCad.hiddenLayerBehavior && autocad.hiddenLayer?.passed === true
    && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true
    && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  autoCadQuickCompositeAndHiddenMatrix: (() => {
    const polyline = autocad.observations?.familyAfter?.polyline?.[0]?.details;
    return lineSetMatches(autocad.observations?.quickTrim, expected.autoCad.quickTrimmedLines)
      && pointListMatches(polyline?.vertices, expected.autoCad.closedPolyline.vertices)
      && numberListMatches(polyline?.bulges, expected.autoCad.closedPolyline.bulges)
      && numberListMatches(polyline?.widths, expected.autoCad.closedPolyline.widths)
      && polyline?.closed === false
      && lineSetMatches(autocad.observations?.hatchTarget, expected.autoCad.hatchUnchangedLines)
      && lineSetMatches(autocad.observations?.nestedBlockTarget, expected.autoCad.nestedBlockTrimmedLines)
      && lineSetMatches(autocad.observations?.nestedBlockChildLayerTargets?.inherited, expected.autoCad.nestedBlockChildLayerLines.inherited)
      && lineSetMatches(autocad.observations?.nestedBlockChildLayerTargets?.hidden, expected.autoCad.nestedBlockChildLayerLines.hidden)
      && lineSetMatches(autocad.observations?.nestedBlockChildLayerTargets?.frozen, expected.autoCad.nestedBlockChildLayerLines.frozen)
      && lineSetMatches(autocad.observations?.hidden, [[[0, 6200], [1000, 6200]]]);
  })(),
  autoCadAndBrowserRationalSplineSameFixture: (() => {
    const browserSplines = (browser.spline?.committed?.entities ?? []).filter((entity) => entity.kind === "spline")
      .map(splineSemantics).sort((left, right) => left.controlPoints[0][0] - right.controlPoints[0][0]);
    const autoCadComSplines = (autocad.observations?.rationalSpline?.after ?? []).map((state) => splineSemantics(state.details));
    const autoCadDxfSplines = (autocad.rationalSplineDxfReadback?.splines ?? []).map(splineSemantics);
    const before = splineSemantics(autocad.observations?.rationalSpline?.before?.[0]?.details);
    const sourceExpected = splineSemantics({
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      weights: [2, 2, 2, 2],
      controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 100 }, { x: 200 / 3, y: -100 }, { x: 100, y: 0 }],
    });
    return autocad.options?.rationalSplineSameFixture === true
      && autocad.rationalSplineDxfReadback?.sourceSha256 === browser.downloads?.spline?.sourceSha256
      && autocad.rationalSplineDxfReadback?.outputSha256 === autocad.observations?.rationalSpline?.outputSha256
      && /^[a-f0-9]{64}$/u.test(autocad.rationalSplineDxfReadback?.outputSha256 ?? "")
      && splineSemanticMatches(before, sourceExpected)
      && browserSplines.length === 2 && autoCadComSplines.length === 2 && autoCadDxfSplines.length === 2
      && browserSplines.every((expectedSpline, index) => splineSemanticMatches(autoCadComSplines[index], expectedSpline) && splineSemanticMatches(autoCadDxfSplines[index], expectedSpline));
  })(),
  browserStandardAndUndo: JSON.stringify(browser.standard?.committed?.entities?.map((entity) => entity.handle)) === JSON.stringify(expected.browser.standardHandles)
    && JSON.stringify(browser.standard?.operation?.resultHandles) === JSON.stringify(expected.browser.standardResultHandles)
    && browser.standard?.operation?.commandId === "TRIM" && browser.standard?.restored?.revision === 2
    && browser.standard?.committed?.entities?.[0]?.appearance?.color === "#ff4040" && browser.standard?.committed?.entities?.[0]?.extensionData?.rowId === "F-022",
  browserQuickAndPhysicalShift: JSON.stringify(browser.quick?.committed?.entities?.map((entity) => entity.handle)) === JSON.stringify(expected.browser.quickHandles)
    && JSON.stringify(browser.quick?.trimmed?.entities?.map((entity) => entity.handle)) === JSON.stringify(expected.browser.quickTrimHandles)
    && JSON.stringify(browser.quick?.trimOperation?.resultHandles) === JSON.stringify(expected.browser.quickTrimResultHandles)
    && browser.quick?.trimOperation?.args?.mode === "quick" && browser.quick?.trimOperation?.args?.cuttingEdgeHandles?.length === 0
    && browser.shiftExtend?.physicalInput?.modifier === expected.browser.shiftModifier
    && pointsEqual([browser.shiftExtend?.committed?.entities?.[0]?.end?.x, browser.shiftExtend?.committed?.entities?.[0]?.end?.y], expected.browser.shiftExtendedEnd, 1e-9)
    && browser.shiftExtend?.operation?.args?.targets?.[0]?.action === "extend",
  browserOptionsAndRefusals: browser.options?.noExtendRevision === 0
    && expected.browser.projectModes.every((mode) => browser.options?.projects?.[mode]?.entities?.[0]?.start?.x === 50)
    && JSON.stringify(browser.options?.rejected) === JSON.stringify(expected.browser.refusals)
    && JSON.stringify(browser.options?.erased?.entities?.map((entity) => entity.handle)) === JSON.stringify(["20"]),
  browserCompositeBoundariesAndPolyline: (() => {
    const polyline = browser.composite?.polyline?.entities?.find((entity) => entity.handle === "10");
    const hatchLines = browser.composite?.hatch?.entities?.filter((entity) => entity.kind === "line");
    const blockLine = browser.composite?.block?.entities?.find((entity) => entity.handle === "10");
    const layeredInherited = browser.composite?.layeredBlock?.entities?.find((entity) => entity.handle === "10");
    const layeredHidden = browser.composite?.layeredBlock?.entities?.find((entity) => entity.handle === "11");
    const layeredFrozen = browser.composite?.layeredBlock?.entities?.find((entity) => entity.handle === "12");
    return polyline?.kind === "polyline" && polyline.closed === false
      && JSON.stringify(polyline.vertices) === JSON.stringify(expected.browser.composite.polylineVertices)
      && JSON.stringify(hatchLines?.map((entity) => entity.handle)) === JSON.stringify(expected.browser.composite.hatchLineHandles)
      && hatchLines?.[0]?.start?.x === 0 && hatchLines?.[0]?.end?.x === 100
      && pointsEqual([blockLine?.start?.x, blockLine?.start?.y], expected.browser.composite.nestedBlockTrimmedStart, 1e-9)
      && blockLine?.end?.x === 100
      && browser.composite?.cycle?.revision === expected.browser.composite.cycleRevision
      && JSON.stringify(browser.composite?.cycle?.entities?.map((entity) => entity.handle)) === JSON.stringify(["10", "21"])
      && pointsEqual([layeredInherited?.start?.x, layeredInherited?.start?.y], expected.browser.composite.layeredInheritedTrimStart, 1e-9)
      && pointsEqual([layeredInherited?.end?.x, layeredInherited?.end?.y], [100, 0], 1e-9)
      && pointsEqual([layeredHidden?.start?.x, layeredHidden?.start?.y], expected.browser.composite.layeredHiddenLine[0], 1e-9)
      && pointsEqual([layeredHidden?.end?.x, layeredHidden?.end?.y], expected.browser.composite.layeredHiddenLine[1], 1e-9)
      && pointsEqual([layeredFrozen?.start?.x, layeredFrozen?.start?.y], expected.browser.composite.layeredFrozenLine[0], 1e-9)
      && pointsEqual([layeredFrozen?.end?.x, layeredFrozen?.end?.y], expected.browser.composite.layeredFrozenLine[1], 1e-9);
  })(),
  browserFamiliesAndDownloads: JSON.stringify(browser.closedCurves?.circle?.map((entity) => entity.kind)) === JSON.stringify(["arc", "line"])
    && JSON.stringify(browser.closedCurves?.ellipse?.map((entity) => entity.kind)) === JSON.stringify(["ellipse", "line"])
    && browser.spline?.committed?.entities?.filter((entity) => entity.kind === "spline").length === 2
    && Object.entries(expected.browser.downloadTypes).every(([name, types]) => JSON.stringify(browser.downloads?.[name]?.types) === JSON.stringify(types))
    && browserErrors.length === 0,
  productionReadbackExact: JSON.stringify(readbackKinds) === JSON.stringify(expected.readback.resultKinds)
    && JSON.stringify(readback.dxf?.independentTypes) === JSON.stringify(expected.readback.independentTypes)
    && JSON.stringify(readback.command?.resultHandles) === JSON.stringify(expected.readback.resultHandles)
    && JSON.stringify(readback.dxf?.semanticFields) === JSON.stringify(expected.readback.semanticFields)
    && readback.dxf?.checks?.exactStrictSemantics === true && readback.dxf?.checks?.exactIndependentSemantics === true
    && readback.dxf?.mismatches && Object.keys(readback.dxf.mismatches).length === 0
    && readback.dxf?.report?.skipped?.length === 0 && readback.undo?.present === true && readback.undo?.revision === 2,
  exactOutputBytes: readback.dxf?.sha256 === sha256(dxfBytes) && readback.dxf?.byteLength === dxfBytes.byteLength
    && readback.kdraw?.sha256 === sha256(kdrawBytes) && readback.kdraw?.byteLength === kdrawBytes.byteLength,
  secondaryOraclesHonestAndPinned: oracles.certificationAuthority === expected.oracles.certificationAuthority
    && oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE"
    && oracles.sourceArtifactSha256 === sha256(dxfBytes)
    && oracleByName.librecad?.expected === expected.oracles.librecad && oracleByName.freecad?.expected === expected.oracles.freecad
    && oracleByName.librecad?.fixtureReport?.inputSha256 === sha256(dxfBytes)
    && oracleByName.freecad?.fixtureReport?.inputSha256 === expected.oracles.freecadInputSha256
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  currentSourceHashCoverage: allRecordedSourcesCurrent && everyRuntimeSourceRecorded,
};

if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-022 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1,
  rowId: "F-022",
  source: "AutoCAD 2024.1.2 physical desktop workflow + Chromium physical Shift-click workflow + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-022-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-022 AutoCAD/Chromium/DXF/KDRAW1 cross-evidence PASS.");
