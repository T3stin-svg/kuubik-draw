#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [matrixBytes, svgBytes, pdfBytes, kdrawBytes, displaySvgBytes, displayPdfBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-102-browser-page-setup.json")),
  readFile(resolve(artifactRoot, "F-102-browser-page-setup.svg")),
  readFile(resolve(artifactRoot, "F-102-browser-page-setup.pdf")),
  readFile(resolve(artifactRoot, "F-102-browser-page-setup.kdraw")),
  readFile(resolve(artifactRoot, "F-102-browser-display.svg")),
  readFile(resolve(artifactRoot, "F-102-browser-display.pdf")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const svg = svgBytes.toString("utf8"); const pdf = pdfBytes.toString("latin1"); const kdraw = kdrawBytes.toString("utf8");
const displaySvg = displaySvgBytes.toString("utf8"); const displayPdf = displayPdfBytes.toString("latin1");
if (!kdraw.startsWith("KDRAW1\n")) throw new Error("F-102 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(kdraw.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8")); const layout = document.layouts?.find((candidate) => candidate.name === "F102 PAGE SETUP");
function pdfSummary(text) {
  const media = text.match(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/u);
  const xref = text.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
  const outerTransform = text.match(/\nq ([-+0-9.]+) 0 0 ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) cm/u);
  const paperLine = [...text.matchAll(/([-+0-9.]+) ([-+0-9.]+) m ([-+0-9.]+) ([-+0-9.]+) l S/gu)]
    .toSorted((a, b) => Math.abs(Number(b[4]) - Number(b[2])) - Math.abs(Number(a[4]) - Number(a[2])))[0] ?? null;
  return {
    version: text.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
    mediaBoxPt: media ? { width: Number(media[1]), height: Number(media[2]) } : null,
    pages: (text.match(/\/Type \/Page\b/gu) ?? []).length,
    strokeCommands: (text.match(/\bS\b/gu) ?? []).length,
    xrefOffsetsValid: xref ? xref[2].trim().split("\n").slice(1).every((line, index) => text.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false,
    paperLineDeltaMm: outerTransform && paperLine ? {
      x: Math.abs((Number(paperLine[3]) - Number(paperLine[1])) * Number(outerTransform[1])) * 25.4 / 72,
      y: Math.abs((Number(paperLine[4]) - Number(paperLine[2])) * Number(outerTransform[2])) * 25.4 / 72,
    } : null,
  };
}
function svgPaperLineSummary(text) {
  const transform = text.match(/<g transform="translate\([^)]*\) scale\(([-+0-9.]+) ([-+0-9.]+)\) translate\([^)]*\)">/u);
  const line = text.match(/<line data-handle="20"[^>]*x1="([-+0-9.]+)" y1="([-+0-9.]+)" x2="([-+0-9.]+)" y2="([-+0-9.]+)"\/>/u);
  return transform && line ? {
    x: Math.abs((Number(line[3]) - Number(line[1])) * Number(transform[1])),
    y: Math.abs((Number(line[4]) - Number(line[2])) * Number(transform[2])),
  } : null;
}
const windowPdfSummary = pdfSummary(pdf); const displayPdfSummary = pdfSummary(displayPdf);
const displaySvgLineDeltaMm = svgPaperLineSummary(displaySvg);
const result = {
  schemaVersion: 1, rowId: "F-102",
  source: "Chromium 1920x1080 live PAGESETUP/undo/redo/reload plus independent SVG, PDF and KDRAW1 parsers",
  sourceSha256: {
    e2e: sha256(await readFile(resolve(root, "e2e/f102-page-setup.spec.ts"))),
    capture: sha256(await readFile(resolve(root, "tools/parity/capture-f102-browser.mjs"))),
    builder: sha256(await readFile(resolve(root, "tools/parity/build-f102-browser-readback.mjs"))),
    app: sha256(await readFile(resolve(root, "apps/web/src/App.tsx"))),
    style: sha256(await readFile(resolve(root, "apps/web/src/style.css"))),
    cadCore: sha256(await readFile(resolve(root, "packages/cad-core/src/layouts.ts"))),
    cadPrint: sha256(await readFile(resolve(root, "packages/cad-print/src/index.ts"))),
    packageLock: sha256(await readFile(resolve(root, "package-lock.json"))),
  },
  matrix,
  outputs: {
    svg: { bytes: svgBytes.byteLength, sha256: sha256(svgBytes), physicalA4: /width="210mm" height="297mm"/u.test(svg), source: svg.match(/data-source="([^"]+)"/u)?.[1], destination: svg.match(/data-destination="([^"]+)"/u)?.[1] },
    pdf: { bytes: pdfBytes.byteLength, sha256: sha256(pdfBytes), summary: windowPdfSummary },
    displaySvg: { bytes: displaySvgBytes.byteLength, sha256: sha256(displaySvgBytes), source: displaySvg.match(/data-source="([^"]+)"/u)?.[1], destination: displaySvg.match(/data-destination="([^"]+)"/u)?.[1], paperLineDeltaMm: displaySvgLineDeltaMm },
    displayPdf: { bytes: displayPdfBytes.byteLength, sha256: sha256(displayPdfBytes), summary: displayPdfSummary },
    kdraw: { bytes: kdrawBytes.byteLength, sha256: sha256(kdrawBytes), documentSha256: sha256(documentBytes), documentRevision: document.revision, pageSetup: layout?.pageSetup, paper: layout?.paper, viewport: layout?.viewports?.[0] },
  },
  status: "PASS",
};
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-102" || matrix.status !== "PASS" ||
  matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.initial?.center !== "210,148.5" || matrix.initial?.width !== 390 || matrix.initial?.height !== 267 ||
  matrix.configured?.center !== "210,148.5" || matrix.configured?.width !== 390 || matrix.configured?.height !== 267 ||
  matrix.window?.paper?.widthMm !== 210 || matrix.window?.paper?.heightMm !== 297 ||
  JSON.stringify(matrix.window?.source) !== JSON.stringify({ x: 10, y: 20, width: 180, height: 250 }) ||
  JSON.stringify(matrix.window?.destination) !== JSON.stringify({ x: 10, y: 10, width: 90, height: 125 }) ||
  JSON.stringify(matrix.outsideWindow) !== JSON.stringify({ kind: "window", window: { x: -25, y: -40, width: 300, height: 400 } }) ||
  matrix.display?.plotArea !== "display" || Object.values(matrix.display?.source ?? {}).some((value) => !Number.isFinite(value)) || matrix.display?.source?.width <= 210 || matrix.display?.source?.height <= 297 ||
  JSON.stringify(matrix.display?.source) !== JSON.stringify(matrix.display?.visibleSource) ||
  matrix.display?.svg?.sha256 !== sha256(displaySvgBytes) || matrix.display?.pdf?.sha256 !== sha256(displayPdfBytes) ||
  matrix.svg?.sha256 !== sha256(svgBytes) || matrix.pdf?.sha256 !== sha256(pdfBytes) || matrix.kdraw?.sha256 !== sha256(kdrawBytes) ||
  matrix.operations?.map((operation) => operation.commandId).join("|") !== "PAGESETUP|UNDO|PAGESETUP|PAGESETUP|PAGESETUP|PAGESETUP|PAGESETUP" ||
  matrix.documentRevision !== 7 || matrix.restored?.pageSetup?.plotArea?.kind !== "layout" || matrix.restored?.paper?.widthMm !== 420 ||
  !result.outputs.svg.physicalA4 || result.outputs.svg.source !== "10,20,180,250" || result.outputs.svg.destination !== "10,10,90,125" ||
  windowPdfSummary.version !== "1.4" || windowPdfSummary.pages !== 1 || windowPdfSummary.strokeCommands !== 2 || !windowPdfSummary.xrefOffsetsValid ||
  Math.abs(windowPdfSummary.mediaBoxPt?.width - 595.275591) > 1e-6 || Math.abs(windowPdfSummary.mediaBoxPt?.height - 841.889764) > 1e-6 ||
  Math.abs(windowPdfSummary.paperLineDeltaMm?.x - 90) > 0.001 || Math.abs(windowPdfSummary.paperLineDeltaMm?.y - 125) > 0.001 ||
  result.outputs.displaySvg.source !== Object.values(matrix.display.source).join(",") || result.outputs.displaySvg.destination === undefined ||
  !Number.isFinite(displaySvgLineDeltaMm?.x) || !Number.isFinite(displaySvgLineDeltaMm?.y) ||
  displayPdfSummary.version !== "1.4" || displayPdfSummary.pages !== 1 || displayPdfSummary.strokeCommands !== 2 || !displayPdfSummary.xrefOffsetsValid ||
  !Number.isFinite(displayPdfSummary.paperLineDeltaMm?.x) || !Number.isFinite(displayPdfSummary.paperLineDeltaMm?.y) ||
  Math.abs(displaySvgLineDeltaMm.x - displayPdfSummary.paperLineDeltaMm.x) > 0.001 || Math.abs(displaySvgLineDeltaMm.y - displayPdfSummary.paperLineDeltaMm.y) > 0.001 ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  document.revision !== 1 || layout?.paper?.widthMm !== 210 || layout?.paper?.heightMm !== 297 ||
  layout?.pageSetup?.plotArea?.kind !== "window" || layout?.pageSetup?.plotScale?.drawingUnits !== 2 || layout?.viewports?.[0]?.width !== 390
) throw new Error(`F-102 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-102-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-102 Chromium Page Setup and independent SVG/PDF/KDRAW1 read-back PASS.");
