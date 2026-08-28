#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const names = ["matrix", "screenshot", "extents", "svg", "window", "display"];
const paths = {
  matrix: "F-106-browser-matrix.json", screenshot: "F-106-browser-model-controls.png", extents: "F-106-browser-extents.pdf",
  svg: "F-106-browser-extents.svg", window: "F-106-browser-window.pdf", display: "F-106-browser-display.pdf",
};
const bytes = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(resolve(artifacts, paths[name]))])));
const matrix = JSON.parse(bytes.matrix.toString("utf8")); const svg = bytes.svg.toString("utf8");
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
for (const name of ["extents", "window", "display"]) {
  execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", resolve(artifacts, paths[name]), resolve(artifacts, `F-106-browser-${name}`)], { windowsHide: true, stdio: "pipe" });
}
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const pdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-pdf.py"),
  ...["extents", "window", "display"].map((name) => `${name}=${resolve(artifacts, paths[name])}`),
], { windowsHide: true, encoding: "utf8" }));
const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-rendered-png.py"),
  ...["extents", "window", "display"].map((name) => `${name}=${resolve(artifacts, `F-106-browser-${name}.png`)}`),
], { windowsHide: true, encoding: "utf8" }));
const sourcePaths = {
  e2e: "e2e/f106-model-print.spec.ts", fixture: "parity/fixtures/f106-document.ts", capture: "tools/parity/capture-f106-browser.mjs",
  builder: "tools/parity/build-f106-browser-readback.mjs", pdfReader: "tools/parity/read-f106-pdf.py", pixelReader: "tools/parity/read-f106-rendered-png.py",
  app: "apps/web/src/App.tsx", style: "apps/web/src/style.css", layouts: "packages/cad-core/src/layouts.ts",
  cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const docs = pdfReadback.documents; const image = pixels.images;
const close = (left, right, tolerance) => Math.abs(left - right) <= tolerance;
const rectClose = (left, right, tolerance) => left && right && ["x", "y", "width", "height"].every((key) => close(left[key], right[key], tolerance));
const media = (document, width, height) => document?.mediaBox?.length === 4 && close(document.mediaBox[2], width, 0.001) && close(document.mediaBox[3], height, 0.001);
const vector = (document) => document?.strictParsed === true && document.pages === 1 && document.imageXObjects === 0 && document.plumberImages === 0 && document.operators?.W === 1 && document.operators?.cm === 1;
const checks = {
  matrixPassed: matrix.schemaVersion === 1 && matrix.rowId === "F-106" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0 && matrix.storedRevision === 4,
  hashesMatchDownloads: matrix.outputs?.extents?.sha256 === sha256(bytes.extents) && matrix.outputs?.svg?.sha256 === sha256(bytes.svg) && matrix.outputs?.window?.sha256 === sha256(bytes.window) && matrix.outputs?.display?.sha256 === sha256(bytes.display),
  svgPhysicalVector: svg.includes('width="210mm" height="297mm"') && svg.includes('data-model-space-plot="true"') && svg.includes('data-plot-area="extents"') && svg.includes("F-106 MODEL 1:50") && !svg.includes("<image"),
  physicalMedia: media(docs.extents, 595.275591, 841.889764) && media(docs.window, 1190.551181, 841.889764) && media(docs.display, 595.275591, 841.889764),
  allVector: [docs.extents, docs.window, docs.display].every(vector),
  extentsPlacement: rectClose(docs.extents?.placement?.source, { x: 1000, y: 2000, width: 4000, height: 11250 }, 0.2) && rectClose(docs.extents?.placement?.destination, { x: 65, y: 36, width: 80, height: 225 }, 0.001) && close(docs.extents?.placement?.scaleFactor, 0.02, 0.000001),
  windowPlacement: rectClose(docs.window?.placement?.source, { x: -100, y: 200, width: 8000, height: 5000 }, 0.2) && rectClose(docs.window?.placement?.destination, { x: 14, y: 16, width: 400, height: 250 }, 0.001) && close(docs.window?.placement?.scaleFactor, 0.05, 0.000001),
  displayPlacement: rectClose(docs.display?.placement?.source, matrix.displayWindow, 0.2) && rectClose(docs.display?.placement?.source, matrix.outputs?.display?.placement?.source, 0.2) && close(docs.display?.placement?.scaleFactor, 0.01, 0.000001),
  popplerPainted: [image.extents, image.window, image.display].every((entry) => entry?.width > 1100 && entry?.height > 1600 && entry?.counts?.black > 0 && entry?.counts?.nonWhite > 0),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-106 browser read-back mismatch: ${JSON.stringify({ checks, pdfReadback, pixels })}`);
const result = {
  schemaVersion: 1, rowId: "F-106", source: "Chromium 1920x1080 persisted Model page setup plus pypdf/pdfplumber and Poppler read-back",
  sourceSha256, matrix, outputs: Object.fromEntries(["extents", "svg", "window", "display"].map((name) => [name, { bytes: bytes[name].byteLength, sha256: sha256(bytes[name]) }])),
  screenshot: { bytes: bytes.screenshot.byteLength, sha256: sha256(bytes.screenshot) }, independentPdfReadback: pdfReadback, renderedPixels: pixels, checks, status: "PASS",
};
await writeFile(resolve(artifacts, "F-106-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-106 Chromium Extents/Window/Display Model plot and independent PDF/Poppler read-back PASS.");
