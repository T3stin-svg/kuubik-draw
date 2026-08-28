#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const names = ["matrix", "displayMatrix", "screenshot", "excluded", "multi", "plan", "section", "display"];
const paths = {
  matrix: "F-105-browser-matrix.json", displayMatrix: "F-105-browser-display.json", screenshot: "F-105-browser-publish.png", excluded: "F-105-browser-excluded.pdf",
  multi: "F-105-browser-multi.pdf", plan: "F-105-browser-plan.pdf", section: "F-105-browser-section.pdf",
  display: "F-105-browser-display.pdf",
};
const bytes = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(resolve(artifactRoot, paths[name]))])));
const matrix = JSON.parse(bytes.matrix.toString("utf8"));
const displayMatrix = JSON.parse(bytes.displayMatrix.toString("utf8"));
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-l", "2", "-r", "144", "-png", resolve(artifactRoot, paths.multi), resolve(artifactRoot, "F-105-browser-multi")], { windowsHide: true, stdio: "pipe" });
execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", resolve(artifactRoot, paths.excluded), resolve(artifactRoot, "F-105-browser-excluded")], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const readback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-pdf.py"),
  `excluded=${resolve(artifactRoot, paths.excluded)}`, `multi=${resolve(artifactRoot, paths.multi)}`,
  `plan=${resolve(artifactRoot, paths.plan)}`, `section=${resolve(artifactRoot, paths.section)}`, `display=${resolve(artifactRoot, paths.display)}`,
], { windowsHide: true, encoding: "utf8" }));
const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-rendered-png.py"),
  `multi1=${resolve(artifactRoot, "F-105-browser-multi-1.png")}`, `multi2=${resolve(artifactRoot, "F-105-browser-multi-2.png")}`,
  `excluded=${resolve(artifactRoot, "F-105-browser-excluded.png")}`,
], { windowsHide: true, encoding: "utf8" }));
const sourcePaths = {
  e2e: "e2e/f105-batch-publish.spec.ts", fixture: "parity/fixtures/f105-document.ts", capture: "tools/parity/capture-f105-browser.mjs",
  builder: "tools/parity/build-f105-browser-readback.mjs", pdfReader: "tools/parity/read-f105-pdf.py", pixelReader: "tools/parity/read-f105-rendered-png.py",
  app: "apps/web/src/App.tsx", style: "apps/web/src/style.css", publish: "packages/cad-core/src/publish.ts",
  transaction: "packages/cad-core/src/transaction.ts", cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const doc = readback.documents; const image = pixels.images;
const title = (page, value) => page?.text?.includes(value) === true;
const a4 = (page) => Math.abs(page?.mediaBox?.[2] - 595.275591) < 0.001 && Math.abs(page?.mediaBox?.[3] - 841.889764) < 0.001;
const rectClose = (left, right, tolerance = 2e-4) => left && right && ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) <= tolerance);
const displayPlacement = doc.display?.pageDetails?.[0]?.layoutPlacement;
const checks = {
  matrixPassed: matrix.status === "PASS" && matrix.rowId === "F-105" && matrix.consoleErrors?.length === 0,
  hashesMatchDownloads: matrix.outputs?.excluded?.sha256 === sha256(bytes.excluded) && matrix.outputs?.multi?.sha256 === sha256(bytes.multi) && matrix.outputs?.separate?.[0]?.sha256 === sha256(bytes.plan) && matrix.outputs?.separate?.[1]?.sha256 === sha256(bytes.section),
  orderedMultiPage: doc.multi?.strictParsed === true && doc.multi?.pages === 2 && title(doc.multi?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && title(doc.multi?.pageDetails?.[1], "F-105 SHEET 10 SECTION") && doc.multi.pageDetails.every(a4),
  exclusionAndSeparate: doc.excluded?.pages === 1 && title(doc.excluded?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && !title(doc.excluded?.pageDetails?.[0], "SECTION") && doc.plan?.pages === 1 && doc.section?.pages === 1 && title(doc.plan?.pageDetails?.[0], "F-105 SHEET 20 PLAN") && title(doc.section?.pageDetails?.[0], "F-105 SHEET 10 SECTION"),
  inactiveDisplayCaptured: displayMatrix.status === "PASS" && displayMatrix.sourceLayoutId === "layout-f105-section" && displayMatrix.activeLayoutAtPublish === "layout-f105-plan" && displayMatrix.output?.sha256 === sha256(bytes.display) && rectClose(displayMatrix.expectedWindow, displayMatrix.storedWindow, 1e-9),
  inactiveDisplayReadBack: doc.display?.pages === 1 && title(doc.display?.pageDetails?.[0], "F-105 SHEET 10 SECTION") && rectClose(displayPlacement?.source, displayMatrix.expectedWindow) && rectClose(displayPlacement?.source, displayMatrix.output?.placement?.source) && rectClose(displayPlacement?.destination, displayMatrix.output?.placement?.destination),
  vectorOnly: [doc.excluded, doc.multi, doc.plan, doc.section, doc.display].every((document) => document.pageDetails.every((page) => page.imageXObjects === 0 && page.plumberImages === 0)),
  renderedOrder: image.multi1?.counts?.red > 0 && image.multi1?.counts?.blue === 0 && image.multi2?.counts?.blue > 0 && image.multi2?.counts?.red === 0 && image.excluded?.counts?.red > 0 && image.excluded?.counts?.blue === 0,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-105 browser read-back mismatch: ${JSON.stringify({ checks, readback, pixels })}`);
const result = {
  schemaVersion: 1, rowId: "F-105", source: "Chromium IndexedDB publish-set workflow plus pypdf/pdfplumber and Poppler page read-back",
  sourceSha256, matrix, displayMatrix, outputs: Object.fromEntries(["excluded", "multi", "plan", "section", "display"].map((name) => [name, { bytes: bytes[name].byteLength, sha256: sha256(bytes[name]) }])),
  screenshot: { bytes: bytes.screenshot.byteLength, sha256: sha256(bytes.screenshot) }, independentPdfReadback: readback, renderedPixels: pixels, checks, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-105-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-105 Chromium ordered/excluded/separate publish and independent PDF/Poppler read-back PASS.");
