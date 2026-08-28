#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportModelSvg, exportModelVectorPdf, readPdfSummary } from "../../packages/cad-print/src/index.ts";
import { createF106Document } from "../../parity/fixtures/f106-document.ts";

const root = process.cwd(); const artifacts = resolve(root, "evidence/artifacts");
await mkdir(artifacts, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserBytes = await readFile(resolve(artifacts, "F-106-browser-readback.json")); const browser = JSON.parse(browserBytes.toString("utf8"));
const base = createF106Document("local");
const extents = exportModelVectorPdf(base); const svg = exportModelSvg(base);
const extentsRepeated = exportModelVectorPdf(structuredClone(base));
const windowDocument = structuredClone(base);
windowDocument.layouts[0].pageSetup = {
  ...structuredClone(windowDocument.layouts[0].pageSetup), mediaName: "ISO_A3", orientation: "landscape",
  plotArea: { kind: "window", window: { x: -100, y: 200, width: 8000, height: 5000 } }, plotScale: { mode: "fit" },
  centerPlot: false, plotOriginMm: { x: 4, y: 6 },
};
const windowOutput = exportModelVectorPdf(windowDocument);
const displayDocument = structuredClone(base);
displayDocument.layouts[0].pageSetup = {
  ...structuredClone(displayDocument.layouts[0].pageSetup), mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "display" },
  plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 100 }, centerPlot: true, plotOriginMm: { x: 4, y: 6 },
};
const displayWindow = browser.matrix?.displayWindow;
if (!displayWindow) throw new Error("F-106 browser Display window is missing.");
const display = exportModelVectorPdf(displayDocument, { displayWindow });
const scaleMutation = structuredClone(base); scaleMutation.layouts[0].pageSetup.plotScale = { mode: "custom", paperUnits: 1, drawingUnits: 25 };
const geometryMutation = structuredClone(base); geometryMutation.entities[0].end.x += 500;
const mutations = { scale: exportModelVectorPdf(scaleMutation), geometry: exportModelVectorPdf(geometryMutation) };
const outputPaths = Object.fromEntries(["extents", "window", "display"].map((name) => [name, resolve(artifacts, `F-106-independent-${name}.pdf`)]));
await Promise.all([
  writeFile(outputPaths.extents, extents.bytes), writeFile(outputPaths.window, windowOutput.bytes), writeFile(outputPaths.display, display.bytes),
  writeFile(resolve(artifacts, "F-106-independent-extents.svg"), svg.text, "utf8"),
]);
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
for (const name of ["extents", "window", "display"]) execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", outputPaths[name], resolve(artifacts, `F-106-independent-${name}`)], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const pdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-pdf.py"), ...["extents", "window", "display"].map((name) => `${name}=${outputPaths[name]}`)], { windowsHide: true, encoding: "utf8" }));
const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-rendered-png.py"), ...["extents", "window", "display"].map((name) => `${name}=${resolve(artifacts, `F-106-independent-${name}.png`)}`)], { windowsHide: true, encoding: "utf8" }));
const sourcePaths = {
  runner: "tools/parity/run-f106-readback.mjs", fixture: "parity/fixtures/f106-document.ts", browserEvidence: "evidence/artifacts/F-106-browser-readback.json",
  layouts: "packages/cad-core/src/layouts.ts", cadPrint: "packages/cad-print/src/index.ts", pdfReader: "tools/parity/read-f106-pdf.py", pixelReader: "tools/parity/read-f106-rendered-png.py",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const outputs = {
  extents: { bytes: extents.bytes.byteLength, sha256: sha256(extents.bytes), summary: readPdfSummary(extents.bytes), placement: extents.placement },
  svg: { bytes: Buffer.byteLength(svg.text), sha256: sha256(svg.text), placement: svg.placement },
  window: { bytes: windowOutput.bytes.byteLength, sha256: sha256(windowOutput.bytes), summary: readPdfSummary(windowOutput.bytes), placement: windowOutput.placement },
  display: { bytes: display.bytes.byteLength, sha256: sha256(display.bytes), summary: readPdfSummary(display.bytes), placement: display.placement },
  deterministic: sha256(extentsRepeated.bytes), mutations: { scale: sha256(mutations.scale.bytes), geometry: sha256(mutations.geometry.bytes) },
};
const docs = pdfReadback.documents; const images = pixels.images;
const checks = {
  browserPassed: browser.status === "PASS" && browser.rowId === "F-106",
  exactProductionBytes: outputs.extents.sha256 === browser.outputs?.extents?.sha256 && outputs.svg.sha256 === browser.outputs?.svg?.sha256 && outputs.window.sha256 === browser.outputs?.window?.sha256 && outputs.display.sha256 === browser.outputs?.display?.sha256,
  deterministic: outputs.deterministic === outputs.extents.sha256,
  mutationsObserved: outputs.mutations.scale !== outputs.extents.sha256 && outputs.mutations.geometry !== outputs.extents.sha256,
  noSkipped: [extents, svg, windowOutput, display].every((output) => output.skippedHandles.length === 0),
  independentReaders: [docs.extents, docs.window, docs.display].every((document) => document?.strictParsed === true && document.pages === 1 && document.imageXObjects === 0 && document.plumberImages === 0 && document.placement),
  popplerPainted: [images.extents, images.window, images.display].every((image) => image?.counts?.black > 0 && image?.counts?.nonWhite > 0),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-106 independent read-back mismatch: ${JSON.stringify({ checks, outputs, pdfReadback, pixels })}`);
const result = {
  schemaVersion: 1, rowId: "F-106", source: "Production Model SVG/PDF deterministic generation, mutation sensitivity, pypdf/pdfplumber and Poppler read-back",
  sourceSha256, outputs, independentPdfReadback: pdfReadback, renderedPixels: pixels, browserEvidenceSha256: sha256(browserBytes), checks, status: "PASS",
};
await writeFile(resolve(artifacts, "F-106-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-106 production Model SVG/PDF exact browser bytes, mutation and independent read-back PASS.");
