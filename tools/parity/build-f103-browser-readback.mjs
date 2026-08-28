#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const pixelReader = resolve(root, "tools/parity/read-f103-rendered-png.py");
const pdfReader = resolve(root, "tools/parity/read-f103-pdf.py");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const names = ["color-no-lineweights", "grayscale", "color-alpha", "monochrome"];
const [matrixBytes, kdrawBytes, ...outputBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-103-browser-plot-style.json")),
  readFile(resolve(artifactRoot, "F-103-browser-plot-style.kdraw")),
  ...names.flatMap((name) => [
    readFile(resolve(artifactRoot, `F-103-browser-${name}.svg`)),
    readFile(resolve(artifactRoot, `F-103-browser-${name}.pdf`)),
  ]),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const outputs = Object.fromEntries(names.map((name, index) => [name, {
  svgBytes: outputBytes[index * 2], pdfBytes: outputBytes[index * 2 + 1],
}]));

if (!kdrawBytes.toString("utf8").startsWith("KDRAW1\n")) throw new Error("F-103 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(kdrawBytes.toString("utf8").slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const layout = document.layouts?.find((candidate) => candidate.name === "F103 PLOT STYLE");

function svgSummary(bytes) {
  const text = bytes.toString("utf8");
  const entities = [...text.matchAll(/data-handle="([^"]+)"[^>]*data-source-color="([^"]+)"[^>]*data-plot-color="([^"]+)"(?:[^>]*data-lineweight-mm="([^"]+)")?[^>]*data-opacity="([^"]+)"/gu)]
    .map((match) => ({ handle: match[1], sourceColor: match[2], plotColor: match[3], lineweightMm: match[4] ? Number(match[4]) : null, opacity: Number(match[5]) }));
  return {
    bytes: bytes.byteLength, sha256: sha256(bytes),
    profile: text.match(/data-plot-profile="([^"]+)"/u)?.[1] ?? null,
    lineweights: text.match(/data-plot-lineweights="([^"]+)"/u)?.[1] ?? null,
    transparency: text.match(/data-plot-transparency="([^"]+)"/u)?.[1] ?? null,
    entities, solidFill: /fill-rule="evenodd"/u.test(text), physicalA4Landscape: /width="297mm" height="210mm"/u.test(text),
  };
}

function pdfSummary(bytes) {
  const text = bytes.toString("latin1");
  const xref = text.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
  return {
    bytes: bytes.byteLength, sha256: sha256(bytes), version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length, eof: /%%EOF\s*$/u.test(text),
    xrefOffsetsValid: xref ? xref[2].trim().split("\n").slice(1).every((line, index) => text.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false,
    red: text.includes("1 0 0 RG 1 0 0 rg"), green: text.includes("0 1 0 RG 0 1 0 rg"), black: text.includes("0 0 0 RG 0 0 0 rg"),
    trueColorBlue: text.includes("0.039216 0.392157 0.862745 RG"),
    grayRed: text.includes("0.298039 0.298039 0.298039 RG"), grayGreen: text.includes("0.584314 0.584314 0.584314 RG"),
    fullLineweight: text.includes("0.7 w"), hairline: text.includes(" 0 w "), alpha60: text.includes("/GS60 gs") && text.includes("/CA 0.6 /ca 0.6"), solidFill: text.includes("f*"),
  };
}

const summaries = Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, { svg: svgSummary(value.svgBytes), pdf: pdfSummary(value.pdfBytes) }]));
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
for (const [name, value] of Object.entries(outputs)) {
  const pdfPath = resolve(artifactRoot, `F-103-browser-${name}.pdf`);
  const outputName = name === "monochrome" ? "monochrome-output" : name;
  const prefix = resolve(artifactRoot, `F-103-browser-${outputName}`);
  execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", pdfPath, prefix], { windowsHide: true, stdio: "pipe" });
  value.renderedPath = `${prefix}.png`;
}
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const renderedPixels = JSON.parse(execFileSync(python, [pixelReader, ...Object.entries(outputs).map(([name, value]) => `${name}=${value.renderedPath}`)], { windowsHide: true, encoding: "utf8" }));
const independentPdfReadback = JSON.parse(execFileSync(python, [pdfReader, ...names.map((name) => `${name}=${resolve(artifactRoot, `F-103-browser-${name}.pdf`)}`)], { windowsHide: true, encoding: "utf8" }));

const sourcePaths = {
  e2e: "e2e/f103-plot-style.spec.ts", capture: "tools/parity/capture-f103-browser.mjs", builder: "tools/parity/build-f103-browser-readback.mjs",
  pixelReader: "tools/parity/read-f103-rendered-png.py", pdfReader: "tools/parity/read-f103-pdf.py", app: "apps/web/src/App.tsx", style: "apps/web/src/style.css",
  cadCoreLayouts: "packages/cad-core/src/layouts.ts", cadCorePlotStyle: "packages/cad-core/src/plot-style.ts",
  cadRenderer: "packages/cad-renderer/src/renderer.ts", cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const result = {
  schemaVersion: 1, rowId: "F-103",
  source: "Chromium 1920x1080 live plot-style/undo/redo/reload plus independent SVG, PDF, rendered-pixel and KDRAW1 readers",
  sourceSha256, matrix, summaries, renderedPixels, independentPdfReadback,
  kdraw: { bytes: kdrawBytes.byteLength, sha256: sha256(kdrawBytes), documentSha256: sha256(documentBytes), revision: document.revision, plotStyle: layout?.pageSetup?.plotStyle, displayPlotStyles: layout?.pageSetup?.displayPlotStyles },
  status: "PASS",
};
const color = summaries["color-no-lineweights"]; const gray = summaries.grayscale; const alpha = summaries["color-alpha"]; const mono = summaries.monochrome;
const pixels = renderedPixels.images;
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-103" || matrix.status !== "PASS" || matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.previewState?.initialDisplayPlotStyles !== false || matrix.previewState?.afterFirstApply !== true || matrix.previewState?.finalDisplayPlotStyles !== true ||
  matrix.pixels?.initial?.counts?.redAlpha153 <= 1_000 || matrix.pixels?.initial?.counts?.trueColorBlueRange <= 0 ||
  matrix.documentRevision !== 6 || matrix.operations?.map((operation) => operation.commandId).join("|") !== "PAGESETUP|PAGESETUP|PAGESETUP|UNDO|PAGESETUP|PAGESETUP" ||
  color.svg.profile !== "color" || color.svg.lineweights !== "false" || color.svg.transparency !== "false" || !color.svg.physicalA4Landscape || !color.svg.solidFill ||
  !color.svg.entities.some((entity) => entity.handle === "10" && entity.plotColor === "#ff0000" && entity.lineweightMm === 0 && entity.opacity === 1) ||
  !color.pdf.red || !color.pdf.green || !color.pdf.trueColorBlue || !color.pdf.hairline || color.pdf.alpha60 || !color.pdf.solidFill ||
  gray.svg.profile !== "grayscale" || !gray.svg.entities.some((entity) => entity.handle === "10" && entity.plotColor === "#4c4c4c") || !gray.svg.entities.some((entity) => entity.handle === "11" && entity.plotColor === "#959595") || !gray.svg.entities.some((entity) => entity.handle === "13" && entity.plotColor === "#0a64dc" && entity.lineweightMm === 0) ||
  !gray.pdf.grayRed || !gray.pdf.grayGreen || !gray.pdf.trueColorBlue || !gray.pdf.fullLineweight || !gray.pdf.hairline || !gray.pdf.alpha60 ||
  alpha.svg.profile !== "color" || alpha.svg.lineweights !== "true" || alpha.svg.transparency !== "true" || !alpha.svg.entities.some((entity) => entity.handle === "12" && entity.opacity === 0.6) ||
  !alpha.pdf.red || !alpha.pdf.green || !alpha.pdf.trueColorBlue || !alpha.pdf.fullLineweight || !alpha.pdf.hairline || !alpha.pdf.alpha60 || !alpha.pdf.solidFill ||
  mono.svg.profile !== "monochrome" || mono.svg.entities.filter((entity) => entity.handle !== "13").some((entity) => entity.plotColor !== "#000000") || !mono.svg.entities.some((entity) => entity.handle === "13" && entity.plotColor === "#0a64dc" && entity.lineweightMm === 0) || !mono.pdf.black || !mono.pdf.trueColorBlue || mono.pdf.red || mono.pdf.green || !mono.pdf.hairline || !mono.pdf.alpha60 ||
  Object.values(summaries).some(({ pdf }) => pdf.version !== "1.4" || pdf.pages !== 1 || !pdf.eof || !pdf.xrefOffsetsValid) ||
  !/^\d+\./u.test(independentPdfReadback.readers?.pypdf ?? "") || !/^\d+\./u.test(independentPdfReadback.readers?.pdfplumber ?? "") ||
  Object.values(independentPdfReadback.documents ?? {}).some((pdf) => pdf.pypdf?.pages !== 1 || pdf.pdfplumber?.pages !== 1 || pdf.pypdf?.operators?.w < 2 || pdf.pypdf?.operators?.RG < 2) ||
  pixels["color-no-lineweights"]?.counts?.red <= 0 || pixels["color-no-lineweights"]?.counts?.green <= 0 || pixels["color-no-lineweights"]?.counts?.trueColorBlueRange <= 0 ||
  pixels.grayscale?.counts?.grayscaleRed <= 0 || pixels.grayscale?.counts?.grayscaleGreen <= 0 || pixels.grayscale?.counts?.trueColorBlueRange <= 0 ||
  pixels["color-alpha"]?.counts?.transparentRedOnWhiteRange <= 0 || pixels.monochrome?.counts?.transparentBlackOnWhiteRange <= 0 ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) || document.revision !== 6 ||
  JSON.stringify(layout?.pageSetup?.plotStyle) !== JSON.stringify({ profile: "monochrome", plotLineweights: true, plotTransparency: true }) || layout?.pageSetup?.displayPlotStyles !== true ||
  matrix.outputs?.["F-103-browser-plot-style.kdraw"]?.sha256 !== sha256(kdrawBytes)
) throw new Error(`F-103 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-103-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-103 Chromium plot profiles and independent SVG/PDF/rendered-pixel/KDRAW1 read-back PASS.");
