#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildLayoutPublishPlan } from "../../packages/cad-core/src/index.ts";
import { exportLayoutsVectorPdf, readPdfSummary } from "../../packages/cad-print/src/index.ts";
import { createF105Document, F105_LAYOUT_IDS } from "../../parity/fixtures/f105-document.ts";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserBytes = await readFile(resolve(artifactRoot, "F-105-browser-readback.json"));
const browser = JSON.parse(browserBytes.toString("utf8"));
const document = createF105Document("local");
const orderedSheets = [
  { layoutId: F105_LAYOUT_IDS[1], included: true },
  { layoutId: F105_LAYOUT_IDS[0], included: true },
];
const multiSettings = { schemaVersion: 1, sheets: orderedSheets, output: "multi-page", baseFileName: "F105 Browser" };
const excludedSettings = { ...multiSettings, sheets: [{ ...orderedSheets[0] }, { ...orderedSheets[1], included: false }] };
const multiPlan = buildLayoutPublishPlan(document, multiSettings); const excludedPlan = buildLayoutPublishPlan(document, excludedSettings);
const multi = exportLayoutsVectorPdf(document, multiPlan.layoutIds); const excluded = exportLayoutsVectorPdf(document, excludedPlan.layoutIds);
const plan = exportLayoutsVectorPdf(document, [F105_LAYOUT_IDS[1]]); const section = exportLayoutsVectorPdf(document, [F105_LAYOUT_IDS[0]]);
const repeated = exportLayoutsVectorPdf(structuredClone(document), multiPlan.layoutIds);
const orderMutation = exportLayoutsVectorPdf(document, [...multiPlan.layoutIds].reverse());
const contentMutationDocument = structuredClone(document); contentMutationDocument.entities[1].end.x += 500;
const contentMutation = exportLayoutsVectorPdf(contentMutationDocument, multiPlan.layoutIds);
const displayWindow = browser.displayMatrix?.expectedWindow;
const displayDocument = structuredClone(document);
const displayLayout = displayDocument.layouts.find((layout) => layout.id === F105_LAYOUT_IDS[0]);
if (!displayLayout?.pageSetup || !displayWindow) throw new Error("F-105 Display layout source is missing");
displayLayout.pageSetup.plotArea = { kind: "display" };
const displaySettings = { schemaVersion: 1, sheets: [
  { layoutId: F105_LAYOUT_IDS[0], included: true, displayWindow }, { layoutId: F105_LAYOUT_IDS[1], included: false },
], output: "multi-page", baseFileName: "F105 Display" };
const displayPlan = buildLayoutPublishPlan(displayDocument, displaySettings);
const display = exportLayoutsVectorPdf(displayDocument, displayPlan.layoutIds, { [F105_LAYOUT_IDS[0]]: { displayWindow } });
const paths = Object.fromEntries(["multi", "excluded", "plan", "section", "display"].map((name) => [name, resolve(artifactRoot, `F-105-independent-${name}.pdf`)]));
await Promise.all([
  writeFile(paths.multi, multi.bytes), writeFile(paths.excluded, excluded.bytes), writeFile(paths.plan, plan.bytes), writeFile(paths.section, section.bytes), writeFile(paths.display, display.bytes),
]);
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-l", "2", "-r", "144", "-png", paths.multi, resolve(artifactRoot, "F-105-independent-multi")], { windowsHide: true, stdio: "pipe" });
execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", paths.excluded, resolve(artifactRoot, "F-105-independent-excluded")], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const pdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-pdf.py"),
  `multi=${paths.multi}`, `excluded=${paths.excluded}`, `plan=${paths.plan}`, `section=${paths.section}`, `display=${paths.display}`,
], { windowsHide: true, encoding: "utf8" }));
const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-rendered-png.py"),
  `multi1=${resolve(artifactRoot, "F-105-independent-multi-1.png")}`, `multi2=${resolve(artifactRoot, "F-105-independent-multi-2.png")}`,
  `excluded=${resolve(artifactRoot, "F-105-independent-excluded.png")}`,
], { windowsHide: true, encoding: "utf8" }));
const sourcePaths = {
  runner: "tools/parity/run-f105-readback.mjs", fixture: "parity/fixtures/f105-document.ts", browserEvidence: "evidence/artifacts/F-105-browser-readback.json",
  publish: "packages/cad-core/src/publish.ts", transaction: "packages/cad-core/src/transaction.ts", cadPrint: "packages/cad-print/src/index.ts",
  pdfReader: "tools/parity/read-f105-pdf.py", pixelReader: "tools/parity/read-f105-rendered-png.py",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const result = {
  schemaVersion: 1, rowId: "F-105", source: "Production ordered batch PDF generation, mutation sensitivity, pypdf/pdfplumber and Poppler read-back",
  sourceSha256, plan: { multi: multiPlan, excluded: excludedPlan, display: displayPlan },
  outputs: {
    multi: { bytes: multi.bytes.byteLength, sha256: sha256(multi.bytes), summary: readPdfSummary(multi.bytes), pages: multi.pages },
    excluded: { bytes: excluded.bytes.byteLength, sha256: sha256(excluded.bytes), summary: readPdfSummary(excluded.bytes), pages: excluded.pages },
    separate: [
      { fileName: multiPlan.separateFiles[0].fileName, bytes: plan.bytes.byteLength, sha256: sha256(plan.bytes) },
      { fileName: multiPlan.separateFiles[1].fileName, bytes: section.bytes.byteLength, sha256: sha256(section.bytes) },
    ],
    display: { bytes: display.bytes.byteLength, sha256: sha256(display.bytes), pages: display.pages },
    deterministic: sha256(repeated.bytes), mutations: { order: sha256(orderMutation.bytes), content: sha256(contentMutation.bytes) },
  },
  independentPdfReadback: pdfReadback, renderedPixels: pixels, browserEvidenceSha256: sha256(browserBytes), status: "PASS",
};
const doc = pdfReadback.documents; const image = pixels.images; const title = (page, value) => page?.text?.includes(value) === true;
const rectClose = (left, right, tolerance = 2e-4) => left && right && ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) <= tolerance);
const displayPlacement = doc.display?.pageDetails?.[0]?.layoutPlacement;
if (
  browser.status !== "PASS" || multiPlan.layoutIds.join("|") !== "layout-f105-plan|layout-f105-section" || excludedPlan.layoutIds.join("|") !== "layout-f105-plan" ||
  multi.skippedHandles.length !== 0 || excluded.skippedHandles.length !== 0 || plan.skippedHandles.length !== 0 || section.skippedHandles.length !== 0 ||
  result.outputs.multi.summary.pages !== 2 || result.outputs.excluded.summary.pages !== 1 || result.outputs.deterministic !== result.outputs.multi.sha256 ||
  result.outputs.mutations.order === result.outputs.multi.sha256 || result.outputs.mutations.content === result.outputs.multi.sha256 ||
  result.outputs.multi.sha256 !== browser.outputs?.multi?.sha256 || result.outputs.excluded.sha256 !== browser.outputs?.excluded?.sha256 || result.outputs.separate[0].sha256 !== browser.outputs?.plan?.sha256 || result.outputs.separate[1].sha256 !== browser.outputs?.section?.sha256 ||
  result.outputs.display.sha256 !== browser.outputs?.display?.sha256 || displayPlan.layoutIds.join("|") !== "layout-f105-section" || !rectClose(displayPlacement?.source, displayWindow) || !rectClose(displayPlacement?.source, browser.displayMatrix?.storedWindow) || !rectClose(displayPlacement?.destination, browser.displayMatrix?.output?.placement?.destination) ||
  doc.multi?.strictParsed !== true || doc.multi?.pages !== 2 || !title(doc.multi?.pageDetails?.[0], "F-105 SHEET 20 PLAN") || !title(doc.multi?.pageDetails?.[1], "F-105 SHEET 10 SECTION") ||
  doc.excluded?.pages !== 1 || !title(doc.excluded?.pageDetails?.[0], "F-105 SHEET 20 PLAN") || doc.plan?.pages !== 1 || doc.section?.pages !== 1 || doc.display?.pages !== 1 || !title(doc.display?.pageDetails?.[0], "F-105 SHEET 10 SECTION") ||
  image.multi1?.counts?.red <= 0 || image.multi1?.counts?.blue !== 0 || image.multi2?.counts?.blue <= 0 || image.multi2?.counts?.red !== 0 || image.excluded?.counts?.red <= 0 || image.excluded?.counts?.blue !== 0
) throw new Error(`F-105 independent read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-105-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-105 production ordered/excluded/separate PDF, mutation and independent read-back PASS.");
