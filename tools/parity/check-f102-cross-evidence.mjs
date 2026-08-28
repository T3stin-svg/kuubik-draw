#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts"); const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const paths = {
  autocad: resolve(artifactRoot, "F-102-autocad-readback.json"),
  browser: resolve(artifactRoot, "F-102-browser-readback.json"),
  readback: resolve(artifactRoot, "F-102-readback.json"),
};
const sourceBytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path)])));
const implementationPaths = {
  autocadMarker: resolve(root, "parity/autocad/F-102.scr"),
  autocadMatrix: resolve(root, "tools/autocad/f102-page-setup.ps1"),
  autocadRunner: resolve(root, "tools/autocad/run-f102.mjs"),
  browserE2e: resolve(root, "e2e/f102-page-setup.spec.ts"),
  browserCapture: resolve(root, "tools/parity/capture-f102-browser.mjs"),
  browserBuilder: resolve(root, "tools/parity/build-f102-browser-readback.mjs"),
  readbackRunner: resolve(root, "tools/parity/run-f102-readback.mjs"),
  app: resolve(root, "apps/web/src/App.tsx"),
  style: resolve(root, "apps/web/src/style.css"),
  cadCore: resolve(root, "packages/cad-core/src/layouts.ts"),
  cadPrint: resolve(root, "packages/cad-print/src/index.ts"),
  packageLock: resolve(root, "package-lock.json"),
};
const implementationBytes = Object.fromEntries(await Promise.all(Object.entries(implementationPaths).map(async ([key, path]) => [key, await readFile(path)])));
const implementationSha256 = Object.fromEntries(Object.entries(implementationBytes).map(([key, value]) => [key, sha256(value)]));
const autocad = JSON.parse(sourceBytes.autocad); const browser = JSON.parse(sourceBytes.browser); const readback = JSON.parse(sourceBytes.readback);
const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const nativeViewport = autocad.configured?.viewport; const kuubikViewport = readback.window?.layout?.viewports?.[0];
const browserDisplay = browser.matrix?.display?.source; const nativeDisplay = autocad.displayWindow?.window; const readbackDisplay = readback.display?.displayWindow;
const sameRect = (a, b, tolerance = 1e-6) => close(a?.x, b?.x, tolerance) && close(a?.y, b?.y, tolerance) && close(a?.width, b?.width, tolerance) && close(a?.height, b?.height, tolerance);
const samePoint = (a, b, tolerance = 1e-6) => close(a?.x, b?.x, tolerance) && close(a?.y, b?.y, tolerance);
const sameWindow = (a, b, tolerance = 1e-6) => a === null || b === null
  ? a === b
  : samePoint(a?.lowerLeft, b?.lowerLeft, tolerance) && samePoint(a?.upperRight, b?.upperRight, tolerance);
const sameNativePageSetup = (a, b) =>
  a?.layoutName === b?.layoutName && a?.configName === b?.configName && a?.canonicalMediaName === b?.canonicalMediaName &&
  a?.paperUnits === b?.paperUnits && a?.plotRotation === b?.plotRotation && sameRect({ x: 0, y: 0, width: a?.paper?.widthMm, height: a?.paper?.heightMm }, { x: 0, y: 0, width: b?.paper?.widthMm, height: b?.paper?.heightMm }, 0.001) &&
  close(a?.paper?.rawWidthMm, b?.paper?.rawWidthMm, 0.001) && close(a?.paper?.rawHeightMm, b?.paper?.rawHeightMm, 0.001) &&
  a?.plotType === b?.plotType && a?.useStandardScale === b?.useStandardScale && a?.standardScale === b?.standardScale &&
  close(a?.customScale?.paperUnits, b?.customScale?.paperUnits) && close(a?.customScale?.drawingUnits, b?.customScale?.drawingUnits) &&
  close(a?.customScale?.denominator, b?.customScale?.denominator) && a?.centerPlot === b?.centerPlot &&
  samePoint(a?.plotOrigin, b?.plotOrigin) && sameWindow(a?.window, b?.window) && a?.viewport?.handle === b?.viewport?.handle &&
  samePoint(a?.viewport?.center, b?.viewport?.center) && close(a?.viewport?.width, b?.viewport?.width) && close(a?.viewport?.height, b?.viewport?.height);
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  a4Portrait: close(autocad.configured?.paper?.widthMm, 210, 0.001) && close(autocad.configured?.paper?.heightMm, 297, 0.001) && readback.window?.layout?.paper?.widthMm === 210 && readback.window?.layout?.paper?.heightMm === 297,
  exactWindow: autocad.configured?.plotType === 4 && autocad.configured?.window?.lowerLeft?.x === 10 && autocad.configured?.window?.lowerLeft?.y === 20 && autocad.configured?.window?.upperRight?.x === 190 && autocad.configured?.window?.upperRight?.y === 270 && readback.window?.layout?.pageSetup?.plotArea?.window?.x === 10 && readback.window?.layout?.pageSetup?.plotArea?.window?.width === 180,
  oneToTwoAndOffset: close(autocad.configured?.customScale?.denominator, 2) && !autocad.configured?.centerPlot && close(autocad.configured?.plotOrigin?.x, 0) && close(autocad.configured?.plotOrigin?.y, 0) && readback.window?.layout?.pageSetup?.plotScale?.drawingUnits === 2 && readback.window?.layout?.pageSetup?.plotOriginMm?.x === 0 && readback.window?.placement?.destination?.x === 10 && readback.window?.placement?.destination?.y === 10,
  viewportCoordinatesPersist: autocad.checks?.viewportPaperCoordinatesRemainUnchanged === true && nativeViewport?.center?.x === 210 && nativeViewport?.center?.y === 148.5 && nativeViewport?.width === 390 && nativeViewport?.height === 267 && kuubikViewport?.center?.x === 210 && kuubikViewport?.center?.y === 148.5 && kuubikViewport?.width === 390 && kuubikViewport?.height === 267 && browser.matrix?.configured?.center === "210,148.5" && browser.matrix?.configured?.width === 390,
  dwgAndKdrawPersist: autocad.checks?.pageSetupPersisted === true && sameNativePageSetup(autocad.configured, autocad.afterReopen) && readback.outputs?.kdraw?.revision === 1 && readback.outputs?.kdraw?.layout?.pageSetup?.plotArea?.kind === "window" && browser.outputs?.kdraw?.documentRevision === 1,
  extentsFitCenter: autocad.fit?.plotType === 1 && autocad.fit?.useStandardScale === true && autocad.fit?.standardScale === 0 && autocad.fit?.centerPlot === true && readback.fit?.placement?.setup?.plotScale?.mode === "fit" && readback.fit?.placement?.setup?.centerPlot === true,
  arbitraryWindowCoordinates: autocad.checks?.arbitraryWindowCoordinates === true && autocad.outsideWindow?.plotType === 4 && autocad.outsideWindow?.window?.lowerLeft?.x === -25 && autocad.outsideWindow?.window?.lowerLeft?.y === -40 && readback.outsideWindow?.placement?.source?.x === -25 && readback.outsideWindow?.placement?.source?.y === -40 && browser.matrix?.outsideWindow?.window?.x === -25 && browser.matrix?.outsideWindow?.window?.y === -40,
  displayUsesSameCurrentPaperView: autocad.checks?.displayUsesCurrentView === true && autocad.checks?.displaySameAsBrowserView === true && autocad.display?.plotType === 0 && autocad.displayPdfReadback?.pages === 1 && browser.matrix?.display?.plotArea === "display" && readback.display?.layout?.pageSetup?.plotArea?.kind === "display" && sameRect(nativeDisplay, browserDisplay, 0.01) && sameRect(readbackDisplay, browserDisplay) && sameRect(readback.display?.placement?.source, browserDisplay),
  displayVectorSemantics: close(browser.outputs?.displaySvg?.paperLineDeltaMm?.x, browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.x, 0.001) && close(browser.outputs?.displaySvg?.paperLineDeltaMm?.y, browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.y, 0.001) && close(browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.x, readback.display?.pdf?.summary?.paperLineDeltaMm?.x, 0.001) && close(browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.y, readback.display?.pdf?.summary?.paperLineDeltaMm?.y, 0.001) && close(autocad.displayPdfReadback?.dominantLine?.deltaMm?.x, 180 / autocad.display?.customScale?.denominator, 0.2) && close(autocad.displayPdfReadback?.dominantLine?.deltaMm?.y, 250 / autocad.display?.customScale?.denominator, 0.2) && close(browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.x / browser.outputs?.displayPdf?.summary?.paperLineDeltaMm?.y, 180 / 250, 0.001) && close(autocad.displayPdfReadback?.dominantLine?.deltaMm?.x / autocad.displayPdfReadback?.dominantLine?.deltaMm?.y, 180 / 250, 0.001),
  layoutNormalization: autocad.checks?.layoutCenterUnavailable === true && autocad.restored?.plotType === 5 && close(autocad.restored?.customScale?.denominator, 1) && readback.final?.pageSetup?.plotArea?.kind === "layout" && readback.final?.pageSetup?.centerPlot === false && readback.final?.pageSetup?.plotScale?.drawingUnits === 1 && browser.matrix?.restored?.pageSetup?.plotArea?.kind === "layout",
  physicalA4Outputs: autocad.pdfReadback?.pages === 1 && autocad.pdfReadback?.mediaBoxPt?.x1 === 595 && autocad.pdfReadback?.mediaBoxPt?.y1 === 842 && browser.outputs?.svg?.physicalA4 === true && browser.outputs?.pdf?.summary?.pages === 1 && close(browser.outputs?.pdf?.summary?.mediaBoxPt?.width, 595.275591) && close(browser.outputs?.pdf?.summary?.mediaBoxPt?.height, 841.889764),
  nativeWindowOneToTwoVectors: close(autocad.pdfReadback?.dominantLine?.deltaMm?.x, 90, 0.2) && close(autocad.pdfReadback?.dominantLine?.deltaMm?.y, 125, 0.2) && readback.window?.placement?.destination?.width === 90 && readback.window?.placement?.destination?.height === 125 && browser.matrix?.window?.destination?.width === 90 && browser.matrix?.window?.destination?.height === 125,
  evidenceMatchesCurrentSources: autocad.browserEvidenceSha256 === sha256(sourceBytes.browser) && autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner && browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.cadCore === implementationSha256.cadCore && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.packageLock === implementationSha256.packageLock && readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.browserEvidence === sha256(sourceBytes.browser),
  noConsoleOrOwnedProcessLeak: browser.matrix?.consoleErrors?.length === 0 && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.noResidualAcadProcesses === true,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-102 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-102",
  source: "AutoCAD native PAGESETUP/DWG/PDF, Chromium UI/IndexedDB/downloads, and independent core/SVG/PDF/KDRAW1 read-back",
  sourceSha256: Object.fromEntries(Object.entries(sourceBytes).map(([key, value]) => [key, sha256(value)])),
  implementationSha256,
  checks, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-102-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-102 AutoCAD/Chromium/output cross-evidence PASS.");
