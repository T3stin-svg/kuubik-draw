#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const artifactPaths = {
  autocad: "evidence/artifacts/F-025-autocad-readback.json",
  browser: "evidence/artifacts/F-025-browser-readback.json",
  browserConstruction: "evidence/artifacts/F-025-browser-construction.json",
  browserConstructionDxf: "evidence/artifacts/F-025-browser-construction.dxf",
  browserConstructionKdraw: "evidence/artifacts/F-025-browser-construction.kdraw",
  browserZero: "evidence/artifacts/F-025-browser-zero.json",
  browserZeroDxf: "evidence/artifacts/F-025-browser-zero.dxf",
  browserZeroKdraw: "evidence/artifacts/F-025-browser-zero.kdraw",
  browserDistanceTooLarge: "evidence/artifacts/F-025-browser-distance-too-large.json",
  browserDistanceTooLargeDxf: "evidence/artifacts/F-025-browser-distance-too-large.dxf",
  browserDistanceTooLargeKdraw: "evidence/artifacts/F-025-browser-distance-too-large.kdraw",
  readback: "evidence/artifacts/F-025-independent-readback.json",
  readbackConstructionDxf: "evidence/artifacts/F-025-kuubik-construction.dxf",
  readbackConstructionKdraw: "evidence/artifacts/F-025-kuubik-construction.kdraw",
  readbackZeroDxf: "evidence/artifacts/F-025-kuubik-zero.dxf",
  readbackZeroKdraw: "evidence/artifacts/F-025-kuubik-zero.kdraw",
  readbackDistanceTooLargeDxf: "evidence/artifacts/F-025-kuubik-distance-too-large.dxf",
  readbackDistanceTooLargeKdraw: "evidence/artifacts/F-025-kuubik-distance-too-large.kdraw",
  oracles: "evidence/artifacts/F-025-oracles.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const browserConstruction = JSON.parse(artifactBytes.browserConstruction.toString("utf8"));
const browserZero = JSON.parse(artifactBytes.browserZero.toString("utf8"));
const browserDistanceTooLarge = JSON.parse(artifactBytes.browserDistanceTooLarge.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const oracles = JSON.parse(artifactBytes.oracles.toString("utf8"));
const expected = await json("parity/expected/F-025.json");

const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/chamfer.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/chamfer.test.ts",
  "packages/cad-core/test/f025-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f025-chamfer-roundtrip.test.ts",
  "e2e/f025-chamfer.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/autocad/f025-standard-matrix.ps1",
  "tools/autocad/f025-runner.test.mjs",
  "tools/autocad/process-ownership.mjs",
  "tools/autocad/f022-shift-click.ps1",
  "tools/autocad/run-f025.mjs",
  "tools/parity/capture-f025-browser.mjs",
  "tools/parity/build-f025-browser-readback.mjs",
  "tools/parity/run-f025-readback.mjs",
  "tools/oracles/freecad-f025-headless.py",
  "tools/oracles/network-isolation.mjs",
  "tools/oracles/probe-tools.mjs",
  "tools/oracles/run-fixtures.mjs",
  "tools/oracles/run-f025-oracles.mjs",
  "parity/F-025-scope.md",
  "parity/expected/F-025.json",
  "tools/parity/check-f025-cross-evidence.mjs",
];
const implementationSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const recordedMaps = [autocad.implementationSha256, browser.sourceSha256, readback.implementationSha256, oracles.implementationSha256].filter(Boolean);
const checkerOwnedPaths = new Set(["parity/F-025-scope.md", "parity/expected/F-025.json", "tools/parity/check-f025-cross-evidence.mjs"]);
const staleRecordedSources = recordedMaps.flatMap((map) => Object.entries(map)
  .filter(([path, hash]) => implementationSha256[path] !== hash)
  .map(([path]) => path)).filter((path, index, values) => values.indexOf(path) === index);
const uncoveredRuntimeSources = Object.entries(implementationSha256)
  .filter(([path, hash]) => !checkerOwnedPaths.has(path) && !recordedMaps.some((map) => map[path] === hash))
  .map(([path]) => path);
const allRecordedSourcesCurrent = recordedMaps.every((map) => Object.entries(map).every(([path, hash]) => implementationSha256[path] === hash));
const everyRuntimeSourceRecorded = Object.entries(implementationSha256).every(([path, hash]) => checkerOwnedPaths.has(path) || recordedMaps.some((map) => map[path] === hash));

const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const listClose = (left, right, tolerance = 1e-8) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
  && left.every((value, index) => Array.isArray(value) ? listClose(value, right[index], tolerance) : close(value, right[index], tolerance));
const allTrue = (value) => Object.values(value ?? {}).every((item) => item === true);
const stateVertices = (state) => state?.details?.vertices;
const rawRecord = (layer, type) => autocad.dxfReadback?.rawConstructionRecords?.[layer]?.find((record) => record.type === type);
const rawPoint = (record, xCode, yCode) => [Number(record?.groups?.[xCode]), Number(record?.groups?.[yCode])];
const lineRecord = (layer, expectedVertices) => autocad.dxfReadback?.selectedLayerEntities?.[layer]?.some((entity) => entity.type === "LINE"
  && listClose(entity.vertices?.map(({ x, y }) => [x, y]), expectedVertices));
const selectedRecord = (layer, handle) => autocad.dxfReadback?.selectedLayerEntities?.[layer]?.find((entity) => entity.handle === handle);
const rawLayerRecord = (layer, handle) => autocad.dxfReadback?.rawLayerRecords?.[layer]?.find((record) => record.handle === handle);
const persistedState = (layer, state) => {
  const entity = selectedRecord(layer, state?.handle);
  if (!entity || entity.layer !== layer) return false;
  if (state.objectName === "AcDbLine") return entity.type === "LINE" && listClose(entity.vertices?.map(({ x, y }) => [x, y]), [state.details?.start, state.details?.end]);
  if (state.objectName === "AcDbPolyline") return entity.type === "LWPOLYLINE" && listClose(entity.vertices?.map(({ x, y }) => [x, y]), state.details?.vertices);
  return false;
};
const persistedLayerMatches = (layer, states) => Array.isArray(states)
  && (autocad.dxfReadback?.selectedLayerEntities?.[layer]?.length ?? -1) === states.length
  && states.every((state) => persistedState(layer, state));
const normalizedTransparency = (record) => {
  const encoded = Number(record?.groups?.["440"]);
  if (!Number.isInteger(encoded)) return "ByLayer";
  return String(Math.round((1 - (encoded & 0xff) / 255) * 100));
};
const inheritedPropertyRecord = (layer, state, lineweight, transparency) => {
  const record = rawLayerRecord(layer, state?.handle);
  return record?.type === "LINE" && record.groups?.["8"] === layer
    && (record.groups?.["62"] === undefined ? 256 : Number(record.groups["62"])) === 256
    && (record.groups?.["6"] ?? "ByLayer") === "ByLayer"
    && Number(record.groups?.["370"]) === lineweight
    && normalizedTransparency(record) === transparency;
};
const relativePoint = (point, origin) => [point?.[0] - origin[0], point?.[1] - origin[1]];
const stateLine = (state) => [state?.details?.start, state?.details?.end];
const normalizedVector = (vector) => {
  const length = Math.hypot(vector?.[0] ?? Number.NaN, vector?.[1] ?? Number.NaN);
  return length > 0 ? [vector[0] / length, vector[1] / length] : null;
};
const oracleByName = Object.fromEntries((oracles.reports ?? []).map((report) => [report.oracle, report]));
const browserDxfBytes = await readFile(resolve(artifactRoot, "F-025-browser.dxf"));
const browserKdrawBytes = await readFile(resolve(artifactRoot, "F-025-browser.kdraw"));
const readbackDxfBytes = await readFile(resolve(artifactRoot, "F-025-kuubik.dxf"));
const readbackKdrawBytes = await readFile(resolve(artifactRoot, "F-025-kuubik.kdraw"));
const global = autocad.observations?.globalUndoRedo;
const shift = autocad.observations?.physicalShift;
const distanceOperation = JSON.parse(await readFile(resolve(artifactRoot, "F-025-browser-matrix.json"), "utf8")).operation;
const browserConstructionByHandle = (handle) => browserConstruction.committed?.entities?.find((entity) => entity.handle === handle);
const browserConstructionPoint = (handle, key) => {
  const value = browserConstructionByHandle(handle)?.[key];
  return value ? [value.x, value.y] : null;
};
const nativeForwardHorizontal = autocad.observations?.rayForward?.find((state) => state.objectName === "AcDbRay" && close(state.details?.basePoint?.[1], 800));
const nativeForwardVertical = autocad.observations?.rayForward?.find((state) => state.objectName === "AcDbRay" && close(state.details?.basePoint?.[0], 100));
const nativeReverseLine = autocad.dxfReadback?.selectedLayerEntities?.F025_RAY?.find((entity) => entity.type === "LINE" && listClose(entity.vertices?.map(({ x, y }) => [x, y]), expected.autoCad.construction.reverseRayLine));
const nativeSamePropertyConnector = autocad.observations?.sameLayerProperties?.find((state) => state.objectName === "AcDbLine" && listClose(stateLine(state), [[90, 3000], [100, 3020]]));

const nativeTrimmedXline = rawRecord("F025_RAY", "RAY");
const nativeForwardRays = autocad.dxfReadback?.rawConstructionRecords?.F025_RAY_FORWARD ?? [];
const nativeReverseXline = rawRecord("F025_XLINE_LINE", "RAY");
const nativeNoTrimRay = rawRecord("F025_RAY_NOTRIM", "RAY");
const nativeNoTrimXline = rawRecord("F025_RAY_NOTRIM", "XLINE");
const checks = {
  exactAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  exactAutoCadIdentityAndProcessSafety: autocad.benchmark === expected.benchmark
    && autocad.engineVersion?.startsWith(expected.autoCad.engineVersionPrefix)
    && autocad.automationProcessIdentity?.executableName?.toLowerCase() === expected.autoCad.executableName
    && autocad.automationProcessIdentity?.fileVersion === expected.autoCad.executableFileVersion
    && autocad.automationProcessIdentity?.productVersion === expected.autoCad.executableProductVersion
    && autocad.installedUpdateIdentity?.displayName === expected.autoCad.installedUpdateDisplayName
    && autocad.installedUpdateIdentity?.displayVersion === expected.autoCad.installedUpdateDisplayVersion
    && /^[a-f0-9]{64}$/u.test(autocad.automationProcessIdentity?.executableSha256 ?? "")
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "executablePath")
    && !Object.hasOwn(autocad.automationProcessIdentity ?? {}, "startTimeUtc")
    && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true
    && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true
    && autocad.userDocument?.blankRestored === true && autocad.cmdNamesAfter === ""
    && Array.isArray(autocad.preExistingProcesses) && autocad.preExistingProcesses.length === autocad.preExistingProcessIds?.length
    && autocad.preExistingProcesses.every((identity, index) => identity.processId === autocad.preExistingProcessIds[index]
      && typeof identity.executablePath === "string" && identity.executablePath.toLowerCase().endsWith("\\acad.exe")
      && typeof identity.startTimeUtc === "string" && identity.startTimeUtc.length > 0),
  completeNativeMatrix: allTrue(autocad.checks),
  exactNativeGlobalUndoRedo: listClose([global?.committed?.length, global?.undone?.length, global?.redone?.length], expected.autoCad.globalUndoRedoCounts)
    && autocad.checks?.globalUndoRedo === true,
  exactNativePolylineMatrix: listClose(stateVertices(autocad.observations?.adjacent?.entities?.[0]), expected.autoCad.polylines.adjacent)
    && listClose(stateVertices(autocad.observations?.separated?.entities?.[0]), expected.autoCad.polylines.separated)
    && autocad.observations?.openClose?.entities?.[0]?.details?.closed === true
    && listClose(stateVertices(autocad.observations?.openClose?.entities?.[0]), expected.autoCad.polylines.openClose)
    && listClose(stateVertices(autocad.observations?.polylineOverlap?.[0]), expected.autoCad.polylines.overlap)
    && autocad.observations?.seamForward?.entities?.[0]?.details?.closed === true
    && listClose(stateVertices(autocad.observations?.seamForward?.entities?.[0]), expected.autoCad.polylines.seamForward)
    && autocad.observations?.seamReverse?.entities?.[0]?.details?.closed === true
    && listClose(stateVertices(autocad.observations?.seamReverse?.entities?.[0]), expected.autoCad.polylines.seamReverse),
  exactNativeZeroPolylineAndPairs: autocad.checks?.polylineZeroIdentity === true && autocad.checks?.samePolylineZeroIdentity === true
    && listClose(stateVertices(autocad.observations?.polylineZero?.entities?.[0]), expected.autoCad.polylines.polylineZero)
    && listClose(stateVertices(autocad.observations?.pairZero?.entities?.[0]), expected.autoCad.polylines.pairZero)
    && listClose(stateVertices(autocad.observations?.pairZeroSeam?.entities?.[0]), expected.autoCad.polylines.pairZeroSeam)
    && autocad.observations?.polylineZero?.before?.handle === autocad.observations?.polylineZero?.entities?.[0]?.handle
    && autocad.observations?.pairZero?.before?.handle === autocad.observations?.pairZero?.entities?.[0]?.handle
    && autocad.observations?.pairZeroSeam?.before?.handle === autocad.observations?.pairZeroSeam?.entities?.[0]?.handle,
  exactNativeDistanceTooLargePolylineUnchanged: autocad.checks?.selectedPolylineDistanceTooLargeUnchanged === true
    && listClose(stateVertices(autocad.observations?.pairTooShort?.entities?.[0]), expected.autoCad.polylines.pairTooShort)
    && autocad.observations?.pairTooShort?.before?.handle === autocad.observations?.pairTooShort?.entities?.[0]?.handle
    && JSON.stringify(autocad.observations?.pairTooShort?.before) === JSON.stringify(autocad.observations?.pairTooShort?.entities?.[0]),
  exactNativePersistedCorrectionDxf: persistedLayerMatches("F025_POLY_OVERLAP", autocad.observations?.polylineOverlap)
    && persistedLayerMatches("F025_POLY_OVERLAP_NOTRIM", autocad.observations?.polylineOverlapNoTrim)
    && persistedLayerMatches("F025_POLY_SHORT_NOTRIM", autocad.observations?.polylineShortNoTrim)
    && persistedLayerMatches("F025_SEAM_FORWARD", autocad.observations?.seamForward?.entities)
    && persistedLayerMatches("F025_SEAM_REVERSE", autocad.observations?.seamReverse?.entities)
    && persistedLayerMatches("F025_POLY_ZERO", autocad.observations?.polylineZero?.entities)
    && persistedLayerMatches("F025_PAIR_ZERO", autocad.observations?.pairZero?.entities)
    && persistedLayerMatches("F025_PAIR_ZERO_SEAM", autocad.observations?.pairZeroSeam?.entities)
    && persistedLayerMatches("F025_PAIR_TOO_SHORT", autocad.observations?.pairTooShort?.entities),
  exactNativeCreatedProperties: autocad.observations?.crossLayer?.current?.[0]?.color === expected.autoCad.createdProperties.color
    && autocad.observations?.crossLayer?.current?.[0]?.linetype === expected.autoCad.createdProperties.linetype
    && autocad.observations?.crossLayer?.current?.[0]?.lineweight === expected.autoCad.createdProperties.sameAndCrossLineweight
    && autocad.observations?.crossLayer?.current?.[0]?.transparency === expected.autoCad.createdProperties.sameAndCrossTransparency
    && autocad.observations?.sameLayerProperties?.some((entity) => entity.color === expected.autoCad.createdProperties.color
      && entity.linetype === expected.autoCad.createdProperties.linetype
      && entity.lineweight === expected.autoCad.createdProperties.sameAndCrossLineweight
      && entity.transparency === expected.autoCad.createdProperties.sameAndCrossTransparency)
    && autocad.observations?.crossLayerReverse?.current?.[0]?.color === expected.autoCad.createdProperties.color
    && autocad.observations?.crossLayerReverse?.current?.[0]?.linetype === expected.autoCad.createdProperties.linetype
    && autocad.observations?.crossLayerReverse?.current?.[0]?.lineweight === expected.autoCad.createdProperties.reverseLineweight
    && autocad.observations?.crossLayerReverse?.current?.[0]?.transparency === expected.autoCad.createdProperties.reverseTransparency,
  exactNativePersistedCreatedProperties: inheritedPropertyRecord("F025_CROSS_OUT", autocad.observations?.crossLayer?.current?.[0], expected.autoCad.createdProperties.sameAndCrossLineweight, expected.autoCad.createdProperties.sameAndCrossTransparency)
    && inheritedPropertyRecord("F025_SAME_PROP", nativeSamePropertyConnector, expected.autoCad.createdProperties.sameAndCrossLineweight, expected.autoCad.createdProperties.sameAndCrossTransparency)
    && inheritedPropertyRecord("F025_CROSS_REVERSE_OUT", autocad.observations?.crossLayerReverse?.current?.[0], expected.autoCad.createdProperties.reverseLineweight, expected.autoCad.createdProperties.reverseTransparency),
  physicalShiftIsSharpAndNonPersistent: shift?.input?.shiftSecond === true && shift?.entities?.length === 2
    && close(shift?.distanceAAfter, 10) && close(shift?.distanceBAfter, 20)
    && autocad.checks?.physicalShiftSharpCorner === true,
  exactNativeConstructionDxf: lineRecord("F025_RAY", expected.autoCad.construction.reverseRayLine)
    && nativeTrimmedXline?.type === "RAY"
    && listClose(rawPoint(nativeTrimmedXline, "10", "20"), expected.autoCad.construction.trimmedXlineRay.basePoint)
    && listClose(rawPoint(nativeTrimmedXline, "11", "21"), expected.autoCad.construction.trimmedXlineRay.direction)
    && nativeForwardRays.some((record) => listClose(rawPoint(record, "10", "20"), expected.autoCad.construction.forwardRay.basePoint)
      && listClose(rawPoint(record, "11", "21"), expected.autoCad.construction.forwardRay.direction))
    && nativeReverseXline?.type === "RAY"
    && listClose(rawPoint(nativeReverseXline, "10", "20"), expected.autoCad.construction.reverseXlineRay.basePoint)
    && listClose(rawPoint(nativeReverseXline, "11", "21"), expected.autoCad.construction.reverseXlineRay.direction)
    && nativeNoTrimRay?.type === "RAY" && nativeNoTrimXline?.type === "XLINE"
    && listClose(rawPoint(nativeNoTrimRay, "10", "20"), expected.autoCad.construction.noTrimRay.basePoint)
    && listClose(rawPoint(nativeNoTrimRay, "11", "21"), expected.autoCad.construction.noTrimRay.direction)
    && listClose(rawPoint(nativeNoTrimXline, "10", "20"), expected.autoCad.construction.noTrimXline.basePoint)
    && listClose(rawPoint(nativeNoTrimXline, "11", "21"), expected.autoCad.construction.noTrimXline.direction),
  exactConstructionBrowserAutoCadCross: browserConstruction.status === "PASS" && browserConstruction.consoleErrors?.length === 0
    && browserConstructionByHandle("10")?.kind === "line"
    && listClose(browserConstructionPoint("10", "start"), relativePoint(nativeReverseLine?.vertices?.map(({ x, y }) => [x, y])?.[0], [0, 600]))
    && listClose(browserConstructionPoint("10", "end"), relativePoint(nativeReverseLine?.vertices?.map(({ x, y }) => [x, y])?.[1], [0, 600]))
    && browserConstructionByHandle("20")?.kind === "ray"
    && listClose(browserConstructionPoint("20", "basePoint"), relativePoint(rawPoint(nativeTrimmedXline, "10", "20"), [0, 600]))
    && listClose(browserConstructionPoint("20", "direction"), rawPoint(nativeTrimmedXline, "11", "21"))
    && browserConstructionByHandle("30")?.kind === "ray" && browserConstructionByHandle("40")?.kind === "ray"
    && listClose(relativePoint(browserConstructionPoint("30", "basePoint"), [300, 200]), relativePoint(nativeForwardHorizontal?.details?.basePoint, [100, 800]))
    && listClose(relativePoint(browserConstructionPoint("40", "basePoint"), [300, 200]), relativePoint(nativeForwardVertical?.details?.basePoint, [100, 800]))
    && browserConstructionByHandle("50")?.kind === "ray"
    && listClose(relativePoint(browserConstructionPoint("50", "basePoint"), [500, 400]), relativePoint(rawPoint(nativeReverseXline, "10", "20"), [0, 1000]))
    && listClose(browserConstructionPoint("50", "direction"), rawPoint(nativeReverseXline, "11", "21"))
    && browserConstructionByHandle("70")?.kind === "ray" && browserConstructionByHandle("80")?.kind === "xline"
    && listClose(normalizedVector(browserConstructionPoint("70", "direction")), normalizedVector(rawPoint(nativeNoTrimRay, "11", "21")))
    && listClose(normalizedVector(browserConstructionPoint("80", "direction")), normalizedVector(rawPoint(nativeNoTrimXline, "11", "21")))
    && listClose([browserConstructionByHandle("81")?.start?.x, browserConstructionByHandle("81")?.start?.y, browserConstructionByHandle("81")?.end?.x, browserConstructionByHandle("81")?.end?.y], [-10, 0, 0, 20])
    && listClose([browserConstructionByHandle("82")?.start?.x - 200, browserConstructionByHandle("82")?.start?.y + 600, browserConstructionByHandle("82")?.end?.x - 200, browserConstructionByHandle("82")?.end?.y + 600], [110, 800, 100, 820])
    && listClose([browserConstructionByHandle("83")?.start?.x - 500, browserConstructionByHandle("83")?.start?.y + 600, browserConstructionByHandle("83")?.end?.x - 500, browserConstructionByHandle("83")?.end?.y + 600], [-10, 1000, 0, 1020])
    && JSON.stringify(browserConstruction.operations?.[0]?.resultHandles) === JSON.stringify(["10", "20", "81", "30", "40", "82", "50", "60", "83"])
    && JSON.stringify(browserConstruction.operations?.[1]?.resultHandles) === JSON.stringify(["84"]),
  zeroIdentityCrossAuthority: browserZero.status === "PASS" && JSON.stringify(browserZero.restored) === JSON.stringify(browserZero.source)
    && JSON.stringify(browserZero.operations) === "[]"
    && JSON.stringify(browserZero.source?.entities?.[0]?.vertices?.map(({ x, y }) => [x, y])) === JSON.stringify(expected.browser.zeroPolylineVertices)
    && readback.edgeCases?.zeroIdentity?.polyline?.changes?.length === 0 && readback.edgeCases?.zeroIdentity?.pair?.changes?.length === 0
    && autocad.checks?.polylineZeroIdentity === true && autocad.checks?.samePolylineZeroIdentity === true,
  distanceTooLargeCrossAuthority: browserDistanceTooLarge.status === "PASS"
    && JSON.stringify(browserDistanceTooLarge.restored) === JSON.stringify(browserDistanceTooLarge.source)
    && JSON.stringify(browserDistanceTooLarge.operations) === "[]"
    && JSON.stringify(browserDistanceTooLarge.source?.entities?.map(({ handle }) => handle)) === JSON.stringify(expected.browser.distanceTooLargeHandles)
    && JSON.stringify(browserDistanceTooLarge.source?.entities?.[0]?.vertices?.map(({ x, y }) => [x, y])) === JSON.stringify(expected.browser.distanceTooLargePolylineVertices)
    && readback.edgeCases?.distanceTooLarge?.result?.changes?.length === 0
    && readback.edgeCases?.distanceTooLarge?.result?.steps?.length === 0
    && readback.edgeCases?.distanceTooLarge?.result?.rejected?.length === 3
    && readback.edgeCases?.distanceTooLarge?.result?.rejected?.every(({ reason }) => reason === "distance-too-large")
    && readback.edgeCases?.distanceTooLarge?.canUndo === false
    && autocad.checks?.selectedPolylineDistanceTooLargeUnchanged === true,
  browserWorkflowAndExactOperation: allTrue(browser.checks)
    && JSON.stringify(distanceOperation?.targetHandles) === JSON.stringify(expected.browser.distanceTargetHandles)
    && JSON.stringify(distanceOperation?.resultHandles) === JSON.stringify(expected.browser.distanceResultHandles)
    && JSON.stringify(distanceOperation?.args?.specification) === JSON.stringify(expected.browser.distanceSpecification),
  productionReadbackExact: readback.output?.strictMismatch === null && readback.output?.independentMismatch === null
    && JSON.stringify(readback.output?.expectedSemantics?.map((entity) => entity.kind)) === JSON.stringify(expected.readback.entityKinds)
    && readback.kdraw?.manifestEntryCount === 1 && readback.kdraw?.attachmentCount === 0
    && readback.undoRedo?.exactSourceRestored === true && readback.undoRedo?.exactCommittedRestored === true
    && readback.undoRedo?.undoStates?.every(({ present }) => present === true)
    && readback.undoRedo?.redoStates?.every(({ present }) => present === true)
    && readback.edgeCases?.construction?.strictMismatch === null
    && Object.values(readback.edgeCases?.construction?.rawChecks ?? {}).every((value) => value === true)
    && JSON.stringify(readback.edgeCases?.construction?.expectedSemantics?.map((entity) => entity.kind)) === JSON.stringify(expected.readback.constructionKinds)
    && readback.edgeCases?.zeroIdentity?.polyline?.changes?.length === 0
    && readback.edgeCases?.zeroIdentity?.pair?.changes?.length === 0
    && JSON.stringify(readback.edgeCases?.distanceTooLarge?.expectedSemantics?.map((entity) => entity.kind)) === JSON.stringify(expected.readback.distanceTooLargeKinds)
    && JSON.stringify(readback.edgeCases?.distanceTooLarge?.strictSemantics) === JSON.stringify(readback.edgeCases?.distanceTooLarge?.expectedSemantics)
    && JSON.stringify(readback.edgeCases?.distanceTooLarge?.independentSemantics) === JSON.stringify(readback.edgeCases?.distanceTooLarge?.expectedSemantics),
  exactOutputBytes: browser.artifacts?.["evidence/artifacts/F-025-browser.dxf"]?.sha256 === sha256(browserDxfBytes)
    && browser.artifacts?.["evidence/artifacts/F-025-browser.kdraw"]?.sha256 === sha256(browserKdrawBytes)
    && readback.dxf?.sha256 === sha256(readbackDxfBytes) && readback.dxf?.byteLength === readbackDxfBytes.byteLength
    && readback.kdraw?.sha256 === sha256(readbackKdrawBytes) && readback.kdraw?.byteLength === readbackKdrawBytes.byteLength
    && browser.artifacts?.["evidence/artifacts/F-025-browser-construction.dxf"]?.sha256 === sha256(artifactBytes.browserConstructionDxf)
    && browser.artifacts?.["evidence/artifacts/F-025-browser-construction.kdraw"]?.sha256 === sha256(artifactBytes.browserConstructionKdraw)
    && browser.artifacts?.["evidence/artifacts/F-025-browser-zero.dxf"]?.sha256 === sha256(artifactBytes.browserZeroDxf)
    && browser.artifacts?.["evidence/artifacts/F-025-browser-zero.kdraw"]?.sha256 === sha256(artifactBytes.browserZeroKdraw)
    && browser.artifacts?.["evidence/artifacts/F-025-browser-distance-too-large.dxf"]?.sha256 === sha256(artifactBytes.browserDistanceTooLargeDxf)
    && browser.artifacts?.["evidence/artifacts/F-025-browser-distance-too-large.kdraw"]?.sha256 === sha256(artifactBytes.browserDistanceTooLargeKdraw)
    && readback.edgeCases?.construction?.dxfSha256 === sha256(artifactBytes.readbackConstructionDxf)
    && readback.edgeCases?.construction?.kdrawSha256 === sha256(artifactBytes.readbackConstructionKdraw)
    && readback.edgeCases?.zeroIdentity?.dxfSha256 === sha256(artifactBytes.readbackZeroDxf)
    && readback.edgeCases?.zeroIdentity?.kdrawSha256 === sha256(artifactBytes.readbackZeroKdraw)
    && readback.edgeCases?.distanceTooLarge?.dxfSha256 === sha256(artifactBytes.readbackDistanceTooLargeDxf)
    && readback.edgeCases?.distanceTooLarge?.kdrawSha256 === sha256(artifactBytes.readbackDistanceTooLargeKdraw),
  secondaryOraclesHonestAndPinned: oracles.certificationAuthority === expected.oracles.certificationAuthority
    && oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.sourceArtifactSha256 === sha256(browserDxfBytes)
    && oracleByName.librecad?.expected === expected.oracles.librecad && oracleByName.freecad?.expected === expected.oracles.freecad
    && [oracleByName.librecad, oracleByName.freecad].every((report) => report?.certificationAuthority === false
      && report?.versionMatchesPin === true && report?.executableSha256MatchesPin === true && allTrue(report?.fixtureReport?.checks)),
  currentSourceHashCoverage: allRecordedSourcesCurrent && everyRuntimeSourceRecorded,
};

if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-025 cross-evidence mismatch: ${JSON.stringify({ checks, staleRecordedSources, uncoveredRuntimeSources })}`);
const result = {
  schemaVersion: 1,
  rowId: "F-025",
  source: "AutoCAD 2024.1.2 live COM/raw DXF + Chromium workflow + production DXF/KDRAW1 read-back + secondary LibreCAD/FreeCAD reports",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-025-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-025 AutoCAD/Chromium/DXF/KDRAW1 cross-evidence PASS.");
