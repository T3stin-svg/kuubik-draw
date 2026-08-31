#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-106-autocad-readback.json", browser: "evidence/artifacts/F-106-browser-readback.json", readback: "evidence/artifacts/F-106-independent-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8")); const browser = JSON.parse(artifactBytes.browser.toString("utf8")); const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const sourcePaths = {
  autocadMarker: "parity/autocad/F-106.scr", autocadMatrix: "tools/autocad/f106-model-print.ps1", autocadRunner: "tools/autocad/run-f106.mjs",
  browserE2e: "e2e/f106-model-print.spec.ts", fixture: "parity/fixtures/f106-document.ts", browserCapture: "tools/parity/capture-f106-browser.mjs",
  modelSpace: "e2e/helpers/model-space.ts",
  browserBuilder: "tools/parity/build-f106-browser-readback.mjs", readbackRunner: "tools/parity/run-f106-readback.mjs", pdfReader: "tools/parity/read-f106-pdf.py",
  pixelReader: "tools/parity/read-f106-rendered-png.py", app: "apps/web/src/App.tsx", style: "apps/web/src/style.css",
  layouts: "packages/cad-core/src/layouts.ts", cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json", scope: "parity/F-106-scope.md",
  crossChecker: "tools/parity/check-f106-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const close = (actual, expected, tolerance = 0.001) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const rectClose = (left, right, tolerance = 0.2) => {
  if (left == null || right == null) {
    return left === right;
  }

  return ["x", "y", "width", "height"].every((key) => close(left[key], right[key], tolerance));
};
const sameStoredOrigin = (left, right) => left?.centerPlot === true && right?.centerPlot === true || close(left?.plotOriginMm?.x, right?.plotOriginMm?.x, 0.01) && close(left?.plotOriginMm?.y, right?.plotOriginMm?.y, 0.01);
const sameModelPageSetup = (left, right) => left?.name === right?.name && left?.configName === right?.configName && left?.configName === "DWG To PDF.pc3" && left?.canonicalMediaName === right?.canonicalMediaName && Boolean(left?.canonicalMediaName) && left?.plotType === right?.plotType && left?.useStandardScale === right?.useStandardScale && left?.standardScale === right?.standardScale && close(left?.customScale?.paperUnits, right?.customScale?.paperUnits, 1e-6) && close(left?.customScale?.drawingUnits, right?.customScale?.drawingUnits, 1e-6) && close(left?.customScale?.denominator, right?.customScale?.denominator, 1e-6) && left?.centerPlot === right?.centerPlot && sameStoredOrigin(left, right) && close(left?.paper?.widthMm, right?.paper?.widthMm, 0.01) && close(left?.paper?.heightMm, right?.paper?.heightMm, 0.01) && close(left?.paper?.rawWidthMm, right?.paper?.rawWidthMm, 0.01) && close(left?.paper?.rawHeightMm, right?.paper?.rawHeightMm, 0.01) && left?.paper?.rotation === right?.paper?.rotation && rectClose(left?.window, right?.window, 0.01) && left?.tileMode === right?.tileMode;
const autoDocs = autocad.independentPdfReadback?.documents; const browserDocs = browser.independentPdfReadback?.documents; const independentDocs = readback.independentPdfReadback?.documents;
const vectorOnly = (documents) => [documents?.extents, documents?.window, documents?.display].every((document) => document?.pages === 1 && document.imageXObjects === 0 && document.plumberImages === 0 && document.operators?.W >= 1 && document.operators?.cm >= 1);
const displaySource = autocad.display?.modelView?.window;
const displayScale = 0.01;
const displayDestination = { x: (210 - (displaySource?.width ?? Number.NaN) * displayScale) / 2, y: (297 - (displaySource?.height ?? Number.NaN) * displayScale) / 2 };
const visibleDisplayLine = { startX: Math.max(1000, displaySource?.x ?? Number.NaN), endX: Math.min(5000, (displaySource?.x ?? Number.NaN) + (displaySource?.width ?? Number.NaN)), y: 2000 };
const expectedDisplayLine = { startX: displayDestination.x + (visibleDisplayLine.startX - (displaySource?.x ?? Number.NaN)) * displayScale, endX: displayDestination.x + (visibleDisplayLine.endX - (displaySource?.x ?? Number.NaN)) * displayScale, y: displayDestination.y + (visibleDisplayLine.y - (displaySource?.y ?? Number.NaN)) * displayScale };
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  sameExtentsContract: autocad.extents?.plotType === 1 && close(autocad.extents?.paper?.widthMm, 210) && close(autocad.extents?.paper?.heightMm, 297) && close(autocad.extents?.customScale?.denominator, 50, 1e-6) && autocad.extents?.centerPlot === true && browser.matrix?.outputs?.extents?.summary?.a4Portrait === true && browser.matrix?.storedPageSetup?.plotArea?.kind === "display" && readback.outputs?.extents?.placement?.setup?.plotArea?.kind === "extents" && close(readback.outputs?.extents?.placement?.scaleFactor, 0.02, 1e-9),
  sameWindowContract: autocad.window?.plotType === 4 && autocad.window?.useStandardScale === true && autocad.window?.standardScale === 0 && close(autocad.window?.paper?.widthMm, 420) && close(autocad.window?.paper?.heightMm, 297) && rectClose(autocad.window?.window, { x: -100, y: 200, width: 8000, height: 5000 }, 0.001) && close(autocad.window?.plotOriginMm?.x, 4) && close(autocad.window?.plotOriginMm?.y, 6) && rectClose(browser.matrix?.outputs?.window?.placement?.source, autocad.window?.window) && close(readback.outputs?.window?.placement?.scaleFactor, 0.05, 1e-9),
  sameDisplayContract: autocad.display?.plotType === 0 && close(autocad.display?.paper?.widthMm, 210) && close(autocad.display?.paper?.heightMm, 297) && close(autocad.display?.customScale?.denominator, 100, 1e-6) && autocad.display?.centerPlot === true && autocad.display?.modelView?.width > 0 && autocad.display?.modelView?.height > 0 && rectClose(browserDocs?.display?.placement?.source, browser.matrix?.displayWindow) && rectClose(independentDocs?.display?.placement?.source, browser.matrix?.displayWindow),
  nativeDwgReopenStable: autocad.dwg?.bytes > 0 && autocad.reopenDeviceRefreshed === true && sameModelPageSetup(autocad.display, autocad.afterReopen),
  nativePdfGeometryReadback: close(autoDocs?.extents?.primaryLineMm?.lengthMm, 80, 0.2) && close(autoDocs?.extents?.primaryCurveBoundsMm?.width, 40, 0.2) && close(autoDocs?.extents?.primaryCurveBoundsMm?.height, 40, 0.2) && close(autoDocs?.window?.primaryLineMm?.lengthMm, 200, 0.2) && close(autoDocs?.display?.primaryLineMm?.lengthMm, expectedDisplayLine.endX - expectedDisplayLine.startX, 0.2),
  nativeCenterAndOffsetPlacement: close(autoDocs?.extents?.primaryLineMm?.startMm?.x, 65, 1) && close(autoDocs?.extents?.primaryLineMm?.endMm?.x, 145, 1) && close(autoDocs?.extents?.primaryLineMm?.midpointMm?.x, 105, 0.5) && close(autoDocs?.window?.primaryLineMm?.startMm?.x, 69, 3) && close(autoDocs?.window?.primaryLineMm?.endMm?.x, 269, 3) && close(autoDocs?.window?.primaryLineMm?.startMm?.y, 106, 8) && close(autoDocs?.display?.primaryLineMm?.startMm?.x, expectedDisplayLine.startX, 0.3) && close(autoDocs?.display?.primaryLineMm?.endMm?.x, expectedDisplayLine.endX, 0.3) && close(autoDocs?.display?.primaryLineMm?.startMm?.y, expectedDisplayLine.y, 0.3),
  allVectorNoRaster: vectorOnly(autoDocs) && vectorOnly(browserDocs) && vectorOnly(independentDocs),
  allPopplerRendersPainted: [autocad, browser, readback].every((authority) => ["extents", "window", "display"].every((name) => authority.renderedPixels?.images?.[name]?.counts?.black > 0 && authority.renderedPixels?.images?.[name]?.counts?.nonWhite > 0)),
  browserAndProductionBytesAgree: browser.outputs?.extents?.sha256 === readback.outputs?.extents?.sha256 && browser.outputs?.svg?.sha256 === readback.outputs?.svg?.sha256 && browser.outputs?.window?.sha256 === readback.outputs?.window?.sha256 && browser.outputs?.display?.sha256 === readback.outputs?.display?.sha256,
  deterministicAndMutationSensitive: readback.outputs?.deterministic === readback.outputs?.extents?.sha256 && readback.outputs?.mutations?.scale !== readback.outputs?.extents?.sha256 && readback.outputs?.mutations?.geometry !== readback.outputs?.extents?.sha256,
  persistedAtomicBrowserWorkflow: browser.matrix?.consoleErrors?.length === 0 && browser.matrix?.storedRevision === 4 && browser.matrix?.storedPageSetup?.plotArea?.kind === "display" && browser.matrix?.storedPageSetup?.plotScale?.drawingUnits === 100,
  evidenceMatchesCurrentSources:
    autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner && autocad.pdfReaderSha256 === implementationSha256.pdfReader && autocad.pixelReaderSha256 === implementationSha256.pixelReader &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.modelSpace === implementationSha256.modelSpace && browser.sourceSha256?.fixture === implementationSha256.fixture && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.pdfReader === implementationSha256.pdfReader && browser.sourceSha256?.pixelReader === implementationSha256.pixelReader && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.layouts === implementationSha256.layouts && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.packageLock === implementationSha256.packageLock &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.fixture === implementationSha256.fixture && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.layouts === implementationSha256.layouts && readback.sourceSha256?.cadPrint === implementationSha256.cadPrint && readback.sourceSha256?.pdfReader === implementationSha256.pdfReader && readback.sourceSha256?.pixelReader === implementationSha256.pixelReader && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-106 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-106", source: "AutoCAD native Model Extents/Window/Display and Chromium/production SVG/PDF with independent pypdf/pdfplumber/Poppler read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])), implementationSha256, checks, status: "PASS",
};
await writeFile(resolve(artifacts, "F-106-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-106 AutoCAD/Chromium/Model-plot cross-evidence PASS.");
