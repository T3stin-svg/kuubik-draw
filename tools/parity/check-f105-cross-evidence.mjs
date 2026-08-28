#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-105-autocad-readback.json", browser: "evidence/artifacts/F-105-browser-readback.json",
  readback: "evidence/artifacts/F-105-independent-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8")); const browser = JSON.parse(artifactBytes.browser.toString("utf8")); const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const sourcePaths = {
  autocadMarker: "parity/autocad/F-105.scr", autocadMatrix: "tools/autocad/f105-batch-publish.ps1", autocadRunner: "tools/autocad/run-f105.mjs",
  browserE2e: "e2e/f105-batch-publish.spec.ts", fixture: "parity/fixtures/f105-document.ts", browserCapture: "tools/parity/capture-f105-browser.mjs",
  browserBuilder: "tools/parity/build-f105-browser-readback.mjs", readbackRunner: "tools/parity/run-f105-readback.mjs",
  pdfReader: "tools/parity/read-f105-pdf.py", pixelReader: "tools/parity/read-f105-rendered-png.py", app: "apps/web/src/App.tsx",
  style: "apps/web/src/style.css", publish: "packages/cad-core/src/publish.ts", transaction: "packages/cad-core/src/transaction.ts",
  cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json", scope: "parity/F-105-scope.md", crossChecker: "tools/parity/check-f105-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const autoDocs = autocad.independentPdfReadback?.documents; const browserDocs = browser.independentPdfReadback?.documents; const readbackDocs = readback.independentPdfReadback?.documents;
const a4 = (page) => Math.abs(page?.mediaBox?.[2] - 595.275591) < 0.5 && Math.abs(page?.mediaBox?.[3] - 841.889764) < 0.5;
const title = (page, value) => page?.text?.includes(value) === true;
const vectorOnly = (document) => document?.pageDetails?.every((page) => page.imageXObjects === 0 && page.plumberImages === 0) === true;
const rectClose = (left, right, tolerance = 2e-4) => left && right && ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) <= tolerance);
const browserDisplayPlacement = browserDocs?.display?.pageDetails?.[0]?.layoutPlacement;
const readbackDisplayPlacement = readbackDocs?.display?.pageDetails?.[0]?.layoutPlacement;
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS",
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  sameOrderedContract: autocad.requestedOrder?.join("|") === "F-105 SHEET 20 PLAN|F-105 SHEET 10 SECTION" && browser.matrix?.order?.join("|") === "layout-f105-plan|layout-f105-section" && readback.plan?.multi?.layoutIds?.join("|") === "layout-f105-plan|layout-f105-section",
  autoCadBatchAndExclusion: autocad.batchOutputs?.length === 2 && autocad.excludedOutputs?.length === 1 && autocad.observedGenerationOrder?.join("|") === autocad.requestedOrder?.join("|") && title(autoDocs?.batch1?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && title(autoDocs?.batch2?.pageDetails?.[0], "F-105 SHEET 10 SECTION") && title(autoDocs?.excluded1?.pageDetails?.[0], "F-105 SHEET 20 PLAN"),
  kuubikMultiPageOrder: browserDocs?.multi?.pages === 2 && readbackDocs?.multi?.pages === 2 && title(browserDocs?.multi?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && title(browserDocs?.multi?.pageDetails?.[1], "F-105 SHEET 10 SECTION") && title(readbackDocs?.multi?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && title(readbackDocs?.multi?.pageDetails?.[1], "F-105 SHEET 10 SECTION"),
  kuubikExclusionAndSeparate: browserDocs?.excluded?.pages === 1 && browserDocs?.plan?.pages === 1 && browserDocs?.section?.pages === 1 && readbackDocs?.excluded?.pages === 1 && readbackDocs?.plan?.pages === 1 && readbackDocs?.section?.pages === 1 && title(browserDocs?.excluded?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && !title(browserDocs?.excluded?.pageDetails?.[0], "SECTION"),
  inactiveDisplaySourceReadBack: browser.displayMatrix?.sourceLayoutId === "layout-f105-section" && browser.displayMatrix?.activeLayoutAtPublish === "layout-f105-plan" && rectClose(browser.displayMatrix?.expectedWindow, browser.displayMatrix?.storedWindow, 1e-9) && rectClose(browserDisplayPlacement?.source, browser.displayMatrix?.expectedWindow) && rectClose(readbackDisplayPlacement?.source, browser.displayMatrix?.expectedWindow) && rectClose(browserDisplayPlacement?.destination, readbackDisplayPlacement?.destination),
  allPhysicalA4Vector: [...Object.values(autoDocs ?? {}), ...Object.values(browserDocs ?? {}), ...Object.values(readbackDocs ?? {})].every((document) => document.pageDetails.every((page) => a4(page)) && vectorOnly(document)),
  browserAndProductionBytesAgree: browser.outputs?.multi?.sha256 === readback.outputs?.multi?.sha256 && browser.outputs?.excluded?.sha256 === readback.outputs?.excluded?.sha256 && browser.outputs?.plan?.sha256 === readback.outputs?.separate?.[0]?.sha256 && browser.outputs?.section?.sha256 === readback.outputs?.separate?.[1]?.sha256 && browser.outputs?.display?.sha256 === readback.outputs?.display?.sha256,
  deterministicAndMutationSensitive: readback.outputs?.deterministic === readback.outputs?.multi?.sha256 && readback.outputs?.mutations?.order !== readback.outputs?.multi?.sha256 && readback.outputs?.mutations?.content !== readback.outputs?.multi?.sha256,
  renderedPageOrder: browser.renderedPixels?.images?.multi1?.counts?.red > 0 && browser.renderedPixels?.images?.multi1?.counts?.blue === 0 && browser.renderedPixels?.images?.multi2?.counts?.blue > 0 && browser.renderedPixels?.images?.multi2?.counts?.red === 0 && readback.renderedPixels?.images?.multi1?.counts?.red > 0 && readback.renderedPixels?.images?.multi2?.counts?.blue > 0 && autocad.renderedPixels?.images?.batch1?.counts?.red > 0 && autocad.renderedPixels?.images?.batch2?.counts?.blue > 0,
  atomicPersistentBrowserSettings: browser.matrix?.output === "separate" && browser.matrix?.baseFileName === "F105 Browser" && browser.matrix?.included?.length === 2 && browser.matrix?.consoleErrors?.length === 0,
  nativeDwgReopenStable: autocad.dwg?.bytes > 0 && autocad.beforeSave?.length === 2 && autocad.afterReopen?.length === 2 && autocad.afterReopen?.[0]?.name === autocad.beforeSave?.[0]?.name && autocad.afterReopen?.[1]?.name === autocad.beforeSave?.[1]?.name,
  evidenceMatchesCurrentSources:
    autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner && autocad.pdfReaderSha256 === implementationSha256.pdfReader && autocad.pixelReaderSha256 === implementationSha256.pixelReader &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.fixture === implementationSha256.fixture && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.pdfReader === implementationSha256.pdfReader && browser.sourceSha256?.pixelReader === implementationSha256.pixelReader && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.publish === implementationSha256.publish && browser.sourceSha256?.transaction === implementationSha256.transaction && browser.sourceSha256?.cadPrint === implementationSha256.cadPrint && browser.sourceSha256?.packageLock === implementationSha256.packageLock &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.fixture === implementationSha256.fixture && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.publish === implementationSha256.publish && readback.sourceSha256?.transaction === implementationSha256.transaction && readback.sourceSha256?.cadPrint === implementationSha256.cadPrint && readback.sourceSha256?.pdfReader === implementationSha256.pdfReader && readback.sourceSha256?.pixelReader === implementationSha256.pixelReader && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-105 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1, rowId: "F-105", source: "AutoCAD native ordered batch/exclusion, Chromium persisted publish set and production multi/separate PDFs with independent PDF/Poppler read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])), implementationSha256, checks, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-105-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-105 AutoCAD/Chromium/batch-publish cross-evidence PASS.");
