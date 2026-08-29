#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: resolve(artifactRoot, "F-103-autocad-readback.json"),
  browser: resolve(artifactRoot, "F-103-browser-readback.json"),
  readback: resolve(artifactRoot, "F-103-readback.json"),
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(path)])));
const autocad = JSON.parse(artifactBytes.autocad); const browser = JSON.parse(artifactBytes.browser); const readback = JSON.parse(artifactBytes.readback);
const implementationPaths = {
  autocadMarker: "parity/autocad/F-103.scr", autocadMatrix: "tools/autocad/f103-plot-style.ps1", autocadRunner: "tools/autocad/run-f103.mjs", autocadManagedPlugin: "tools/autocad/F103PlotTransparency.cs",
  browserE2e: "e2e/f103-plot-style.spec.ts", browserCapture: "tools/parity/capture-f103-browser.mjs", browserBuilder: "tools/parity/build-f103-browser-readback.mjs",
  readbackRunner: "tools/parity/run-f103-readback.mjs", pixelReader: "tools/parity/read-f103-rendered-png.py", pdfReader: "tools/parity/read-f103-pdf.py", scope: "parity/F-103-scope.md",
  crossChecker: "tools/parity/check-f103-cross-evidence.mjs",
  app: "apps/web/src/App.tsx", style: "apps/web/src/style.css", cadCoreLayouts: "packages/cad-core/src/layouts.ts", cadCorePlotStyle: "packages/cad-core/src/plot-style.ts",
  cadRenderer: "packages/cad-renderer/src/renderer.ts", cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json",
};
const implementationBytes = Object.fromEntries(await Promise.all(Object.entries(implementationPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const implementationSha256 = Object.fromEntries(Object.entries(implementationBytes).map(([key, bytes]) => [key, sha256(bytes)]));
const nativeColor = autocad.pdfReadback?.color; const nativeMono = autocad.pdfReadback?.monochrome; const nativeGray = autocad.pdfReadback?.grayscale;
const nativeNoLineweight = autocad.pdfReadback?.noLineweights; const nativeTransparent = autocad.pdfReadback?.transparent;
const browserColor = browser.summaries?.["color-no-lineweights"]; const browserGray = browser.summaries?.grayscale;
const browserAlpha = browser.summaries?.["color-alpha"]; const browserMono = browser.summaries?.monochrome;
const hasColor = (colors, expected, tolerance = 1e-6) => colors?.some((color) => color.length === 3 && color.every((value, index) => Math.abs(value - expected[index]) <= tolerance));
const trueColor = [10 / 255, 100 / 255, 220 / 255];
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userSettings?.restored === true,
  sourceColorProfilesAgree: hasColor(nativeColor?.strokeColors, [1, 0, 0]) && hasColor(nativeColor?.strokeColors, [0, 1, 0]) && hasColor(nativeColor?.strokeColors, trueColor, 1e-5) && browserColor?.pdf?.red && browserColor?.pdf?.green && browserColor?.pdf?.trueColorBlue && readback.outputs?.colorNoLineweight?.pdfRed && readback.outputs?.colorNoLineweight?.pdfGreen && readback.outputs?.colorNoLineweight?.pdfTrueColorBlue,
  monochromeProfilesAgree: hasColor(nativeMono?.strokeColors, [0, 0, 0]) && hasColor(nativeMono?.strokeColors, trueColor, 1e-5) && browserMono?.pdf?.black && browserMono?.pdf?.trueColorBlue && !browserMono?.pdf?.red && !browserMono?.pdf?.green && readback.outputs?.monochrome?.pdfBlack && readback.outputs?.monochrome?.pdfTrueColorBlue && !readback.outputs?.monochrome?.pdfRed,
  grayscaleProfilesAgree: hasColor(nativeGray?.strokeColors, [0.29804, 0.29804, 0.29804], 1e-5) && hasColor(nativeGray?.strokeColors, [0.58431, 0.58431, 0.58431], 1e-5) && hasColor(nativeGray?.strokeColors, trueColor, 1e-5) && browserGray?.pdf?.grayRed && browserGray?.pdf?.grayGreen && browserGray?.pdf?.trueColorBlue && readback.outputs?.grayscale?.pdfGrayRed && readback.outputs?.grayscale?.pdfGrayGreen && readback.outputs?.grayscale?.pdfTrueColorBlue,
  lineweightToggleAgree: nativeColor?.widthValues?.includes(17) && nativeColor?.widthValues?.includes(8) && nativeColor?.widthValues?.includes(0) && autocad.objectsBefore?.trueColorLine?.lineweight === 0 && nativeNoLineweight?.widthValues?.every((value) => value === 0) && browserColor?.pdf?.hairline && browserAlpha?.pdf?.fullLineweight && browserAlpha?.pdf?.hairline && readback.outputs?.colorNoLineweight?.pdfHairline && readback.outputs?.colorAlpha?.pdfFullLineweight && readback.outputs?.colorAlpha?.pdfHairline,
  previewOffAndOnProven: browser.matrix?.previewState?.initialDisplayPlotStyles === false && browser.matrix?.previewState?.afterFirstApply === true && browser.matrix?.pixels?.initial?.counts?.trueColorBlueRange > 0 && browser.kdraw?.displayPlotStyles === true,
  transparencyVisualSemanticsAgree: autocad.profiles?.color?.layout?.plotTransparency === false && autocad.profiles?.transparent?.layout?.plotTransparency === true && autocad.profiles?.transparent?.layout?.plotTransparencyOverride === 1 && nativeTransparent?.imageObjects > 0 && nativeTransparent?.softMasks > 0 && autocad.renderedPixels?.images?.transparent?.counts?.transparentRedOnWhiteRange > 0 && browser.renderedPixels?.images?.["color-alpha"]?.counts?.transparentRedOnWhiteRange > 0 && browserAlpha?.pdf?.alpha60 && readback.outputs?.colorAlpha?.pdfAlpha60,
  transparentOutputDifferenceDocumented: nativeTransparent?.imageObjects > 0 && browserAlpha?.pdf?.alpha60 === true && browserAlpha?.pdf?.solidFill === true,
  atomicAndPersistent: browser.matrix?.operations?.map((operation) => operation.commandId).join("|") === "PAGESETUP|PAGESETUP|PAGESETUP|UNDO|PAGESETUP|PAGESETUP" && browser.kdraw?.revision === 6 && readback.atomic?.undoCommandId === "UNDO" && readback.atomic?.redoCommandId === "PAGESETUP" && readback.kdraw?.revision === 6,
  finalStateAgree: JSON.stringify(browser.kdraw?.plotStyle) === JSON.stringify({ profile: "monochrome", plotLineweights: true, plotTransparency: true }) && browser.kdraw?.displayPlotStyles === true && JSON.stringify(readback.kdraw?.plotStyle) === JSON.stringify(browser.kdraw?.plotStyle) && readback.kdraw?.displayPlotStyles === true && autocad.reopenedLayout?.styleSheet?.toLowerCase() === "monochrome.ctb" && autocad.reopenedLayout?.plotWithLineweights === true,
  noFalsePatternedHatch: browser.matrix?.consoleErrors?.length === 0 && browser.summaries?.["color-alpha"]?.svg?.solidFill === true && readback.outputs?.colorAlpha?.pdfSolidFill === true,
  evidenceMatchesCurrentSources:
    autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner && autocad.managedPluginSourceSha256 === implementationSha256.autocadManagedPlugin && autocad.renderedPixelReaderSha256 === implementationSha256.pixelReader &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.pixelReader === implementationSha256.pixelReader && browser.sourceSha256?.pdfReader === implementationSha256.pdfReader && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.cadCoreLayouts === implementationSha256.cadCoreLayouts && browser.sourceSha256?.cadCorePlotStyle === implementationSha256.cadCorePlotStyle && browser.sourceSha256?.cadRenderer === implementationSha256.cadRenderer && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.packageLock === implementationSha256.packageLock &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.plotStyle === implementationSha256.cadCorePlotStyle && readback.sourceSha256?.layouts === implementationSha256.cadCoreLayouts && readback.sourceSha256?.cadPrint === implementationSha256.cadPrint && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-103 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-103",
  source: "AutoCAD native plot profiles/DWG/PDF, Chromium preview/IndexedDB/downloads and independent SVG/PDF/rendered-pixel/KDRAW1 read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256, checks, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-103-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-103 AutoCAD/Chromium/output cross-evidence PASS.");
