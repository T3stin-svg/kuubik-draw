#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertF114KuubikPdf } from "./f114-evidence-contract.mjs";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-114-autocad-readback.json",
  browser: "evidence/artifacts/F-114-browser-readback.json",
  readback: "evidence/artifacts/F-114-independent-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const f104SourceBytes = await readFile(resolve(root, "evidence/artifacts/F-104-autocad-readback.json"));
const f104Source = JSON.parse(f104SourceBytes.toString("utf8"));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-114.json"), "utf8"));
const sourcePaths = {
  autocadMarker: "parity/autocad/F-114.scr", autocadRunner: "tools/autocad/run-f114.mjs", f104Runner: "tools/autocad/run-f104.mjs", f104Matrix: "tools/autocad/f104-vector-output.ps1",
  autocadPdfReader: "tools/parity/read-f104-pdf.py", autocadPixelReader: "tools/parity/read-f104-rendered-png.py",
  browserE2e: "e2e/f114-vector-pdf.spec.ts", fixture: "parity/fixtures/f114-document.ts", browserCapture: "tools/parity/capture-f114-browser.mjs",
  browserBuilder: "tools/parity/build-f114-browser-readback.mjs", readbackRunner: "tools/parity/run-f114-readback.mjs", contract: "tools/parity/f114-evidence-contract.mjs",
  mutantBuilder: "tools/parity/f114-pdf-mutants.mjs", pdfReader: "tools/parity/read-f114-pdf.py", pixelReader: "tools/parity/read-f114-rendered-png.py",
  app: "apps/web/src/App.tsx", publish: "packages/cad-core/src/publish.ts", cadPrint: "packages/cad-print/src/index.ts",
  unitTest: "packages/cad-print/test/f114-vector-output.test.ts", mutationTest: "packages/cad-print/test/f114-mutation-proven.test.ts", expected: "parity/expected/F-114.json",
  scope: "parity/F-114-scope.md", packageLock: "package-lock.json", crossChecker: "tools/parity/check-f114-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const autoPdf = autocad.nativePdf; const autoReopenPdf = autocad.reopenPdf;
const browserPdf = browser.independentPdfReadback?.documents?.browser; const readbackPdf = readback.independentPdfReadback?.documents?.independent;
const browserPage1 = browserPdf?.pageDetails?.[0]; const browserPage2 = browserPdf?.pageDetails?.[1];
const readbackPage1 = readbackPdf?.pageDetails?.[0]; const readbackPage2 = readbackPdf?.pageDetails?.[1];
const browserContract = assertF114KuubikPdf(browserPdf, browser.renderedPixels, expected, "F-114 cross browser PDF");
const readbackContract = assertF114KuubikPdf(readbackPdf, readback.renderedPixels, expected, "F-114 cross independent PDF");
const close = (actual, wanted, tolerance = 0.001) => Number.isFinite(actual) && Math.abs(actual - wanted) <= tolerance;
const mixedSizes = (page1, page2) => close(page1?.mediaBox?.[2], 1190.551181) && close(page1?.mediaBox?.[3], 841.889764) && close(page2?.mediaBox?.[2], 595.275591) && close(page2?.mediaBox?.[3], 841.889764);
const requiredText = (page1, page2) => page1?.text?.includes("F-114 A3 LAYOUT") && page1?.text?.includes("KUUBIK F-114 VECTOR PDF") && page2?.text?.includes("F-114 A4 DETAIL") && page2?.text?.includes("KUUBIK F-114 VECTOR PDF");
const vectorOnly = (pdf) => pdf?.pageDetails?.every((page) => page.imageXObjects === 0 && page.plumberImages === 0 && (page.operators?.S ?? 0) >= 1 && (page.operators?.Tj ?? 0) >= 2 && page.extGStates >= 1) === true;
const expectedText = JSON.stringify(expected);
const mutationKeys = ["order", "geometry", "alpha", "raster"];
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true,
  autoCadSourceBound: f104Source.status === "PASS" && autocad.sourceRowId === "F-104" && autocad.sourceArtifactSha256 === sha256(f104SourceBytes) && autocad.sourceObservedAt === f104Source.observedAt,
  autoCadA3VectorReference: autoPdf?.pypdf?.pages === 1 && autoReopenPdf?.pypdf?.pages === 1 && autoPdf?.pypdf?.imageXObjects === 0 && autoReopenPdf?.pypdf?.imageXObjects === 0 && autoPdf?.pdfplumber?.images === 0 && autoReopenPdf?.pdfplumber?.images === 0 && (autoPdf?.pypdf?.operators?.S ?? 0) >= 1 && (autoReopenPdf?.pypdf?.operators?.S ?? 0) >= 1,
  autoCadCatalogDefectRecorded: autoPdf?.pypdf?.strictParsed === false && autoReopenPdf?.pypdf?.strictParsed === false && /Multiple definitions/u.test(autoPdf?.pypdf?.strictError ?? "") && /Multiple definitions/u.test(autoReopenPdf?.pypdf?.strictError ?? ""),
  strictMixedSizeKuubik: browserPdf?.strictParsed === true && readbackPdf?.strictParsed === true && browserPdf?.pages === 2 && readbackPdf?.pages === 2 && mixedSizes(browserPage1, browserPage2) && mixedSizes(readbackPage1, readbackPage2),
  searchableTitles: requiredText(browserPage1, browserPage2) && requiredText(readbackPage1, readbackPage2),
  vectorTransparencyNoImages: browserContract.pass === true && readbackContract.pass === true && vectorOnly(browserPdf) && vectorOnly(readbackPdf) && (browserPage1?.operators?.gs ?? 0) >= 1 && (readbackPage1?.operators?.gs ?? 0) >= 1,
  browserAndProductionBytesAgree: browser.output?.sha256 === readback.outputs?.production?.sha256 && browser.output?.bytes === readback.outputs?.production?.bytes,
  deterministicAndMutationSensitive: browser.matrix?.deterministicReloadSha256 === browser.output?.sha256 && readback.outputs?.deterministic === readback.outputs?.production?.sha256 && mutationKeys.every((key) => /^[a-f0-9]{64}$/u.test(readback.outputs?.mutations?.[key]?.sha256 ?? "") && readback.outputs.mutations[key].sha256 !== readback.outputs?.production?.sha256 && readback.outputs.mutations[key].rejected === true && readback.outputs.mutations[key].reasons?.length > 0) && readback.outputs?.mutations?.raster?.strictParsed === true,
  popplerPageContent: browser.renderedPixels?.images?.page1?.counts?.red > 0 && browser.renderedPixels?.images?.page1?.counts?.blue === 0 && browser.renderedPixels?.images?.page2?.counts?.blue > 0 && browser.renderedPixels?.images?.page2?.counts?.red === 0 && readback.renderedPixels?.images?.page1?.counts?.red > 0 && readback.renderedPixels?.images?.page2?.counts?.blue > 0 && autocad.nativePixels?.counts?.red > 0 && autocad.nativePixels?.counts?.blue > 0,
  browserWorkflowPersistent: browser.matrix?.order?.join("|") === "layout-f114-a3|layout-f114-a4" && browser.matrix?.included?.join("|") === "layout-f114-a3|layout-f114-a4" && browser.matrix?.consoleErrors?.length === 0,
  evidenceMatchesCurrentSources:
    autocad.sourceSha256?.marker === implementationSha256.autocadMarker && autocad.sourceSha256?.runner === implementationSha256.autocadRunner && autocad.sourceSha256?.f104Runner === implementationSha256.f104Runner && autocad.sourceSha256?.f104Matrix === implementationSha256.f104Matrix && autocad.sourceSha256?.pdfReader === implementationSha256.autocadPdfReader && autocad.sourceSha256?.pixelReader === implementationSha256.autocadPixelReader &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.fixture === implementationSha256.fixture && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.contract === implementationSha256.contract && browser.sourceSha256?.mutantBuilder === implementationSha256.mutantBuilder && browser.sourceSha256?.pdfReader === implementationSha256.pdfReader && browser.sourceSha256?.pixelReader === implementationSha256.pixelReader && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.publish === implementationSha256.publish && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.unitTest === implementationSha256.unitTest && browser.sourceSha256?.mutationTest === implementationSha256.mutationTest && browser.sourceSha256?.expected === implementationSha256.expected && browser.sourceSha256?.scope === implementationSha256.scope && browser.sourceSha256?.packageLock === implementationSha256.packageLock && JSON.stringify(browser.expectedContract) === expectedText &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.fixture === implementationSha256.fixture && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.contract === implementationSha256.contract && readback.sourceSha256?.mutantBuilder === implementationSha256.mutantBuilder && readback.sourceSha256?.pdfReader === implementationSha256.pdfReader && readback.sourceSha256?.pixelReader === implementationSha256.pixelReader && readback.sourceSha256?.cadPrint === implementationSha256.cadPrint && readback.sourceSha256?.unitTest === implementationSha256.unitTest && readback.sourceSha256?.mutationTest === implementationSha256.mutationTest && readback.sourceSha256?.expected === implementationSha256.expected && readback.sourceSha256?.scope === implementationSha256.scope && readback.sourceSha256?.packageLock === implementationSha256.packageLock && JSON.stringify(readback.expectedContract) === expectedText && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-114 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-114", source: "Fresh AutoCAD 2024 native A3 vector plot plus exact Chromium/direct mixed A3-A4 PDF bytes and independent pypdf/pdfplumber/Poppler read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])), implementationSha256, checks,
  observedAt: [autocad.observedAt, browser.observedAt, readback.observedAt].filter(Boolean).sort().at(-1), status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-114-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-114 AutoCAD/Chromium/mixed-size vector-PDF cross-evidence PASS.");
