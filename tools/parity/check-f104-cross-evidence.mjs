#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-104-autocad-readback.json", browser: "evidence/artifacts/F-104-browser-readback.json",
  readback: "evidence/artifacts/F-104-independent-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8")); const browser = JSON.parse(artifactBytes.browser.toString("utf8")); const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const sourcePaths = {
  autocadMarker: "parity/autocad/F-104.scr", autocadMatrix: "tools/autocad/f104-vector-output.ps1", autocadRunner: "tools/autocad/run-f104.mjs",
  browserE2e: "e2e/f104-vector-output.spec.ts", fixture: "parity/fixtures/f104-document.ts", browserCapture: "tools/parity/capture-f104-browser.mjs",
  browserBuilder: "tools/parity/build-f104-browser-readback.mjs", readbackRunner: "tools/parity/run-f104-readback.mjs",
  svgRenderer: "tools/parity/render-f104-svg.mjs", pdfReader: "tools/parity/read-f104-pdf.py", pixelReader: "tools/parity/read-f104-rendered-png.py", app: "apps/web/src/App.tsx",
  style: "apps/web/src/style.css", cadCoreLayouts: "packages/cad-core/src/layouts.ts", cadRenderer: "packages/cad-renderer/src/renderer.ts",
  cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json", scope: "parity/F-104-scope.md", crossChecker: "tools/parity/check-f104-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const autoFirst = autocad.beforeSave?.viewports?.find((viewport) => viewport.handle === autocad.handles?.firstViewport);
const autoSecond = autocad.beforeSave?.viewports?.find((viewport) => viewport.handle === autocad.handles?.secondViewport);
const autoReopenFirst = autocad.afterReopen?.viewports?.find((viewport) => viewport.handle === autocad.handles?.firstViewport);
const autoReopenSecond = autocad.afterReopen?.viewports?.find((viewport) => viewport.handle === autocad.handles?.secondViewport);
const browserViewports = browser.kdraw?.layout?.viewports ?? []; const readbackViewports = readback.kdraw?.layout?.viewports ?? [];
const autoPdf = autocad.independentPdfReadback?.documents?.native; const autoReopenPdf = autocad.independentPdfReadback?.documents?.reopen;
const browserPdf = browser.independentPdfReadback?.documents?.browser; const readbackPdf = readback.independentPdfReadback?.documents?.independent;
const wordsContain = (document, words) => words.every((word) => document?.pdfplumber?.words?.includes(word));
const close = (actual, expected, tolerance = 1e-6) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  sameA3LayoutContract: close(autocad.beforeSave?.paper?.widthMm, 420, 0.001) && close(autocad.beforeSave?.paper?.heightMm, 297, 0.001) && browser.kdraw?.layout?.paper?.widthMm === 420 && browser.kdraw?.layout?.paper?.heightMm === 297 && readback.kdraw?.layout?.paper?.widthMm === 420 && readback.kdraw?.layout?.paper?.heightMm === 297,
  sameTwoViewportScales: close(autoFirst?.customScale, 0.02) && close(autoSecond?.customScale, 0.01) && browserViewports[0]?.viewHeight === 12350 && browserViewports[0]?.height === 247 && browserViewports[1]?.viewHeight === 24700 && browserViewports[1]?.height === 247 && readbackViewports[0]?.viewHeight === 12350 && readbackViewports[1]?.viewHeight === 24700,
  sameTargetsLocksAndClips: close(autoFirst?.target?.x, 0) && close(autoSecond?.target?.x, 20000) && autoFirst?.displayLocked === true && autoSecond?.displayLocked === true && autoFirst?.clipped === false && autoSecond?.clipped === true && browserViewports[0]?.viewCenter?.x === 0 && browserViewports[1]?.viewCenter?.x === 20000 && browserViewports.every((viewport) => viewport.locked === true) && !browserViewports[0]?.clipBoundary && browserViewports[1]?.clipBoundary?.length === 4 && JSON.stringify(browserViewports) === JSON.stringify(readbackViewports),
  nativeDwgReopenStable: autocad.dwg?.bytes > 0 && autoReopenFirst?.customScale === autoFirst?.customScale && autoReopenSecond?.customScale === autoSecond?.customScale && autoReopenFirst?.displayLocked === true && autoReopenSecond?.displayLocked === true && autoReopenFirst?.clipped === false && autoReopenSecond?.clipped === true && autocad.renderedPixels?.images?.native?.sha256 === autocad.renderedPixels?.images?.reopen?.sha256,
  vectorPdfWithoutImages: autoPdf?.pypdf?.pages === 1 && autoReopenPdf?.pypdf?.pages === 1 && autoPdf?.pypdf?.imageXObjects === 0 && autoReopenPdf?.pypdf?.imageXObjects === 0 && browserPdf?.pypdf?.strictParsed === true && browserPdf?.pypdf?.pages === 1 && browserPdf?.pypdf?.imageXObjects === 0 && readbackPdf?.pypdf?.strictParsed === true && readbackPdf?.pypdf?.pages === 1 && readbackPdf?.pypdf?.imageXObjects === 0 && browser.pdf?.images === 0 && readback.outputs?.pdf?.images === 0,
  autoCadCatalogDefectRecorded: autoPdf?.pypdf?.strictParsed === false && autoReopenPdf?.pypdf?.strictParsed === false && /Multiple definitions/u.test(autoPdf?.pypdf?.strictError ?? "") && /Multiple definitions/u.test(autoReopenPdf?.pypdf?.strictError ?? ""),
  physicalTitleAndContentReadBack: wordsContain(autoPdf, ["VIEW", "1", "1:50", "2", "1:100", "KUUBIK", "F-104", "VECTOR", "LAYOUT"]) && wordsContain(browserPdf, ["VIEW", "1", "1:50", "2", "1:100", "KUUBIK", "F-104", "VECTOR", "LAYOUT"]) && wordsContain(readbackPdf, ["VIEW", "1", "1:50", "2", "1:100", "KUUBIK", "F-104", "VECTOR", "LAYOUT"]),
  renderedViewportContent: autocad.renderedPixels?.images?.native?.counts?.leftRed > 0 && autocad.renderedPixels?.images?.native?.counts?.rightBlue > 0 && browser.renderedPixels?.images?.browserPdf?.counts?.leftRed > 0 && browser.renderedPixels?.images?.browserPdf?.counts?.rightBlue > 0 && browser.renderedPixels?.images?.browserPdf?.counts?.redAlphaOnWhite > 0 && browser.renderedPixels?.images?.browserSvg?.counts?.leftRed > 0 && browser.renderedPixels?.images?.browserSvg?.counts?.rightBlue > 0 && browser.renderedPixels?.images?.browserSvg?.counts?.redAlphaOnWhite > 0 && readback.renderedPixels?.images?.independentPdf?.counts?.leftRed > 0 && readback.renderedPixels?.images?.independentPdf?.counts?.rightBlue > 0 && readback.renderedPixels?.images?.independentSvg?.counts?.leftRed > 0 && readback.renderedPixels?.images?.independentSvg?.counts?.rightBlue > 0,
  browserAndProductionBytesAgree: browser.svg?.sha256 === readback.outputs?.svg?.sha256 && browser.pdf?.sha256 === readback.outputs?.pdf?.sha256 && browser.renderedPixels?.images?.browserPdf?.sha256 === readback.renderedPixels?.images?.independentPdf?.sha256 && browser.renderedPixels?.images?.browserSvg?.sha256 === readback.renderedPixels?.images?.independentSvg?.sha256,
  deterministicAndMutationSensitive: browser.matrix?.deterministicReload?.svgSha256 === browser.svg?.sha256 && browser.matrix?.deterministicReload?.pdfSha256 === browser.pdf?.sha256 && readback.outputs?.deterministic?.svg === readback.outputs?.svg?.sha256 && readback.outputs?.deterministic?.pdf === readback.outputs?.pdf?.sha256 && readback.outputs?.mutations?.scale?.svg !== readback.outputs?.svg?.sha256 && readback.outputs?.mutations?.scale?.pdf !== readback.outputs?.pdf?.sha256 && readback.outputs?.mutations?.clip?.svg !== readback.outputs?.svg?.sha256 && readback.outputs?.mutations?.clip?.pdf !== readback.outputs?.pdf?.sha256,
  noBrowserErrorsAndPersistentKdraw: browser.matrix?.consoleErrors?.length === 0 && browser.kdraw?.revision === 0 && readback.kdraw?.revision === 0 && browser.matrix?.outputs?.kdraw?.sha256 === browser.kdraw?.sha256,
  evidenceMatchesCurrentSources:
    autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner && autocad.pdfReaderSha256 === implementationSha256.pdfReader && autocad.pixelReaderSha256 === implementationSha256.pixelReader &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.fixture === implementationSha256.fixture && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.svgRenderer === implementationSha256.svgRenderer && browser.sourceSha256?.pdfReader === implementationSha256.pdfReader && browser.sourceSha256?.pixelReader === implementationSha256.pixelReader && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.cadCoreLayouts === implementationSha256.cadCoreLayouts && browser.sourceSha256?.cadRenderer === implementationSha256.cadRenderer && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.packageLock === implementationSha256.packageLock &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.fixture === implementationSha256.fixture && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.cadPrint === implementationSha256.cadPrint && readback.sourceSha256?.svgRenderer === implementationSha256.svgRenderer && readback.sourceSha256?.pdfReader === implementationSha256.pdfReader && readback.sourceSha256?.pixelReader === implementationSha256.pixelReader && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-104 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-104", source: "AutoCAD native A3/DWG/PDF, Chromium/IndexedDB/SVG/PDF/KDRAW1 and independent strict/tolerant PDF/XML/Poppler read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])), implementationSha256, checks, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-104-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-104 AutoCAD/Chromium/vector-output cross-evidence PASS.");
