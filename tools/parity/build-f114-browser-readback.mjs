#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertF114KuubikPdf } from "./f114-evidence-contract.mjs";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [matrixBytes, pdfBytes, screenshotBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-114-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-114-browser-vector.pdf")),
  readFile(resolve(artifactRoot, "F-114-browser-publish.png")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-l", "2", "-r", "144", "-png", resolve(artifactRoot, "F-114-browser-vector.pdf"), resolve(artifactRoot, "F-114-browser-vector")], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const independentPdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f114-pdf.py"), `browser=${resolve(artifactRoot, "F-114-browser-vector.pdf")}`], { windowsHide: true, encoding: "utf8" }));
const renderedPixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f114-rendered-png.py"),
  `page1=${resolve(artifactRoot, "F-114-browser-vector-1.png")}`, `page2=${resolve(artifactRoot, "F-114-browser-vector-2.png")}`,
], { windowsHide: true, encoding: "utf8" }));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-114.json"), "utf8"));
const sourcePaths = {
  e2e: "e2e/f114-vector-pdf.spec.ts", fixture: "parity/fixtures/f114-document.ts", capture: "tools/parity/capture-f114-browser.mjs",
  builder: "tools/parity/build-f114-browser-readback.mjs", contract: "tools/parity/f114-evidence-contract.mjs", pdfReader: "tools/parity/read-f114-pdf.py",
  pixelReader: "tools/parity/read-f114-rendered-png.py", app: "apps/web/src/App.tsx", publish: "packages/cad-core/src/publish.ts",
  cadPrint: "packages/cad-print/src/index.ts", unitTest: "packages/cad-print/test/f114-vector-output.test.ts",
  mutationTest: "packages/cad-print/test/f114-mutation-proven.test.ts", expected: "parity/expected/F-114.json", scope: "parity/F-114-scope.md",
  mutantBuilder: "tools/parity/f114-pdf-mutants.mjs", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const pdf = independentPdfReadback.documents?.browser; const page1 = pdf?.pageDetails?.[0]; const page2 = pdf?.pageDetails?.[1];
const pixels1 = renderedPixels.images?.page1; const pixels2 = renderedPixels.images?.page2;
const semanticContract = assertF114KuubikPdf(pdf, renderedPixels, expected, "F-114 browser PDF");
const close = (actual, expected, tolerance = 0.001) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const pageSize = (page, width, height) => close(page?.mediaBox?.[2], width) && close(page?.mediaBox?.[3], height);
const checks = {
  matrixPassed: matrix.schemaVersion === 1 && matrix.rowId === "F-114" && matrix.status === "PASS" && matrix.viewport?.width === 1920 && matrix.viewport?.height === 1080 && matrix.consoleErrors?.length === 0,
  exactDownload: matrix.output?.sha256 === sha256(pdfBytes) && matrix.deterministicReloadSha256 === sha256(pdfBytes) && matrix.output?.name === "F114 Browser.pdf",
  strictMixedPages: pdf?.strictParsed === true && pdf?.pages === 2 && pageSize(page1, 1190.551181, 841.889764) && pageSize(page2, 595.275591, 841.889764) && page1?.rotation === 0 && page2?.rotation === 0,
  requiredText: page1?.text?.includes("F-114 A3 LAYOUT") && page1?.text?.includes("KUUBIK F-114 VECTOR PDF") && page2?.text?.includes("F-114 A4 DETAIL") && page2?.text?.includes("KUUBIK F-114 VECTOR PDF"),
  vectorTransparencyNoImages: semanticContract.pass === true && [page1, page2].every((page) => page?.imageXObjects === 0 && page?.plumberImages === 0 && (page?.operators?.S ?? 0) >= 1 && (page?.operators?.Tj ?? 0) >= 2 && page?.extGStates >= 1) && (page1?.operators?.gs ?? 0) >= 1,
  pageColours: page1?.strokeColors?.some((value) => value.join("|") === "1|0|0") && page2?.strokeColors?.some((value) => value.join("|") === "0|0|1"),
  popplerComplete: pixels1?.width === 2382 && pixels1?.height === 1684 && pixels1?.counts?.red > 0 && pixels1?.counts?.blue === 0 && pixels1?.counts?.black > 0 && pixels2?.width === 1191 && pixels2?.height === 1684 && pixels2?.counts?.blue > 0 && pixels2?.counts?.red === 0 && pixels2?.counts?.black > 0,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-114 browser read-back mismatch: ${JSON.stringify({ checks, independentPdfReadback, renderedPixels })}`);
const result = {
  schemaVersion: 1, rowId: "F-114", source: "Chromium 1920x1080 exact mixed-size production PDF plus strict pypdf, pdfplumber and Poppler read-back",
  sourceSha256, matrix, output: { bytes: pdfBytes.byteLength, sha256: sha256(pdfBytes) }, screenshot: { bytes: screenshotBytes.byteLength, sha256: sha256(screenshotBytes) },
  expectedContract: expected, semanticContract, independentPdfReadback, renderedPixels, checks, observedAt: matrix.observedAt, status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-114-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-114 Chromium mixed-size vector PDF and independent pypdf/pdfplumber/Poppler read-back PASS.");
