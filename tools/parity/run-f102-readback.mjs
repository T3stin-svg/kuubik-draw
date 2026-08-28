#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CadSession, createEmptyDocument, createPaperLayout, serializeKDraw, setPaperLayoutPageSetup } from "../../packages/cad-core/dist/index.js";
import { exportLayoutSvg, exportLayoutVectorPdf, resolveLayoutPlotPlacement } from "../../packages/cad-print/dist/index.js";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserEvidenceBytes = await readFile(resolve(artifactRoot, "F-102-browser-readback.json"));
const browserEvidence = JSON.parse(browserEvidenceBytes.toString("utf8"));
const operation = (baseRevision, commandId) => ({ opId: `${commandId}-${baseRevision}`, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] });
const document = createEmptyDocument({ documentId: "F-102", now: "2026-08-28T00:00:00.000Z" });
document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: 100, y: 0 } }];
const paper = createPaperLayout(document, {
  name: "F102 PAGE SETUP",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  viewports: [{
    id: "viewport-f102", center: { x: 210, y: 148.5 }, width: 390, height: 267,
    viewCenter: { x: 0, y: 0 }, viewHeight: 5340, twistAngleRad: 0, locked: true,
  }],
  entities: [{ kind: "line", handle: "20", layerId: "0", start: { x: 10, y: 20 }, end: { x: 190, y: 270 } }],
});
const session = new CadSession({ ...document, layouts: paper.layouts });
const windowSetup = {
  mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "window", window: { x: 10, y: 20, width: 180, height: 250 } },
  plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
};
const configured = setPaperLayoutPageSetup(session.document, paper.layoutId, windowSetup);
session.commit(operation(0, "PAGESETUP"), configured.changes, "2026-08-28T00:00:01.000Z");
const windowDocument = session.document; const windowLayout = windowDocument.layouts[1];
const placement = resolveLayoutPlotPlacement(windowLayout); const svg = exportLayoutSvg(windowDocument, paper.layoutId); const pdf = exportLayoutVectorPdf(windowDocument, paper.layoutId);
const kdraw = await serializeKDraw(windowDocument, new Map(), "2026-08-28T00:00:01.000Z");
const kdrawText = Buffer.from(kdraw).toString("utf8"); const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files["document.json"], "base64"); const entry = envelope.manifest.entries.find((candidate) => candidate.path === "document.json");
const decoded = JSON.parse(documentBytes.toString("utf8"));
const afterUndoOperation = session.undo("2026-08-28T00:00:02.000Z"); const afterUndo = session.document.layouts[1];
const afterRedoOperation = session.redo("2026-08-28T00:00:03.000Z"); const afterRedo = session.document.layouts[1];
const fit = setPaperLayoutPageSetup(session.document, paper.layoutId, {
  mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "extents" }, plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
});
session.commit(operation(3, "PAGESETUP"), fit.changes, "2026-08-28T00:00:04.000Z");
const fitLayout = session.document.layouts[1]; const fitPlacement = resolveLayoutPlotPlacement(fitLayout);
const outside = setPaperLayoutPageSetup(session.document, paper.layoutId, {
  mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "window", window: { x: -25, y: -40, width: 300, height: 400 } },
  plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
});
session.commit(operation(4, "PAGESETUP"), outside.changes, "2026-08-28T00:00:05.000Z");
const outsideLayout = session.document.layouts[1]; const outsidePlacement = resolveLayoutPlotPlacement(outsideLayout);
const display = setPaperLayoutPageSetup(session.document, paper.layoutId, {
  mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "display" }, plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
});
session.commit(operation(5, "PAGESETUP"), display.changes, "2026-08-28T00:00:06.000Z");
const displayLayout = session.document.layouts[1]; const displayWindow = structuredClone(browserEvidence.matrix?.display?.source);
if (!displayWindow || Object.values(displayWindow).some((value) => !Number.isFinite(value)) || displayWindow.width <= 0 || displayWindow.height <= 0) {
  throw new Error("F-102 independent read-back requires the captured Chromium Display window.");
}
const displayPlacement = resolveLayoutPlotPlacement(displayLayout, { displayWindow });
const displaySvg = exportLayoutSvg(session.document, paper.layoutId, { displayWindow });
const displayPdf = exportLayoutVectorPdf(session.document, paper.layoutId, { displayWindow });
if (!(() => { try { resolveLayoutPlotPlacement(displayLayout); return false; } catch (error) { return /current paper-space display window/u.test(String(error)); } })()) {
  throw new Error("F-102 Display plot must reject a missing current paper-space view.");
}
const restored = setPaperLayoutPageSetup(session.document, paper.layoutId, {
  mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" }, plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 5, y: 6 },
});
session.commit(operation(6, "PAGESETUP"), restored.changes, "2026-08-28T00:00:07.000Z");
const final = session.document.layouts[1];
const pdfText = new TextDecoder("latin1").decode(pdf.bytes); const media = pdfText.match(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/u);
const xref = pdfText.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
const pdfReadback = {
  version: pdfText.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
  mediaBoxPt: media ? { width: Number(media[1]), height: Number(media[2]) } : null,
  pages: (pdfText.match(/\/Type \/Page\b/gu) ?? []).length,
  strokeCommands: (pdfText.match(/\bS\b/gu) ?? []).length,
  xrefOffsetsValid: xref ? xref[2].trim().split("\n").slice(1).every((line, index) => pdfText.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false,
};
const displayPdfText = new TextDecoder("latin1").decode(displayPdf.bytes);
const displayOuterTransform = displayPdfText.match(/\nq ([-+0-9.]+) 0 0 ([-+0-9.]+) ([-+0-9.]+) ([-+0-9.]+) cm/u);
const displayPaperLine = [...displayPdfText.matchAll(/([-+0-9.]+) ([-+0-9.]+) m ([-+0-9.]+) ([-+0-9.]+) l S/gu)]
  .toSorted((a, b) => Math.abs(Number(b[4]) - Number(b[2])) - Math.abs(Number(a[4]) - Number(a[2])))[0] ?? null;
const displayPdfReadback = {
  pages: (displayPdfText.match(/\/Type \/Page\b/gu) ?? []).length,
  eof: /%%EOF\s*$/u.test(displayPdfText),
  paperLineDeltaMm: displayOuterTransform && displayPaperLine ? {
    x: Math.abs((Number(displayPaperLine[3]) - Number(displayPaperLine[1])) * Number(displayOuterTransform[1])) * 25.4 / 72,
    y: Math.abs((Number(displayPaperLine[4]) - Number(displayPaperLine[2])) * Number(displayOuterTransform[2])) * 25.4 / 72,
  } : null,
};
const result = {
  schemaVersion: 1, rowId: "F-102",
  source: "production cad-core PAGESETUP transaction with AutoCAD viewport-coordinate persistence, cad-print physical SVG/PDF and independent readers",
  sourceSha256: { runner: sha256(await readFile(resolve(root, "tools/parity/run-f102-readback.mjs"))), browserEvidence: sha256(browserEvidenceBytes) },
  window: { layout: windowLayout, placement },
  outputs: {
    svg: { bytes: Buffer.byteLength(svg.text), sha256: sha256(svg.text), source: svg.text.match(/data-source="([^"]+)"/u)?.[1], destination: svg.text.match(/data-destination="([^"]+)"/u)?.[1] },
    pdf: { bytes: pdf.bytes.byteLength, sha256: sha256(pdf.bytes), summary: pdfReadback },
    kdraw: { bytes: kdraw.byteLength, sha256: sha256(kdraw), documentSha256: sha256(documentBytes), revision: decoded.revision, layout: decoded.layouts[1] },
  },
  atomic: { undoCommandId: afterUndoOperation?.operation.commandId, redoCommandId: afterRedoOperation?.operation.commandId, afterUndo, afterRedo },
  fit: { layout: fitLayout, placement: fitPlacement },
  outsideWindow: { layout: outsideLayout, placement: outsidePlacement },
  display: {
    layout: displayLayout, displayWindow, placement: displayPlacement,
    svg: { bytes: Buffer.byteLength(displaySvg.text), sha256: sha256(displaySvg.text), source: displaySvg.text.match(/data-source="([^"]+)"/u)?.[1], destination: displaySvg.text.match(/data-destination="([^"]+)"/u)?.[1] },
    pdf: { bytes: displayPdf.bytes.byteLength, sha256: sha256(displayPdf.bytes), summary: displayPdfReadback },
  },
  final,
  status: "PASS",
};
if (
  !kdrawText.startsWith("KDRAW1\n") || !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  windowDocument.revision !== 1 || windowLayout.paper.widthMm !== 210 || windowLayout.paper.heightMm !== 297 ||
  windowLayout.viewports[0].center.x !== 210 || windowLayout.viewports[0].width !== 390 || windowLayout.viewports[0].height !== 267 ||
  placement.source.x !== 10 || placement.source.y !== 20 || placement.source.width !== 180 || placement.source.height !== 250 ||
  placement.destination.x !== 10 || placement.destination.y !== 10 || placement.destination.width !== 90 || placement.destination.height !== 125 ||
  svg.skippedHandles.length !== 0 || result.outputs.svg.source !== "10,20,180,250" || result.outputs.svg.destination !== "10,10,90,125" ||
  pdf.skippedHandles.length !== 0 || pdfReadback.version !== "1.4" || pdfReadback.pages !== 1 || pdfReadback.strokeCommands !== 2 || !pdfReadback.xrefOffsetsValid ||
  Math.abs(pdfReadback.mediaBoxPt.width - 595.275591) > 1e-6 || Math.abs(pdfReadback.mediaBoxPt.height - 841.889764) > 1e-6 ||
  decoded.revision !== 1 || decoded.layouts[1].pageSetup.plotArea.kind !== "window" || decoded.layouts[1].viewports[0].width !== 390 ||
  afterUndoOperation?.operation.commandId !== "UNDO" || afterUndo.paper.widthMm !== 420 || afterUndo.viewports[0].width !== 390 ||
  afterRedoOperation?.operation.commandId !== "PAGESETUP" || JSON.stringify(afterRedo) !== JSON.stringify(windowLayout) ||
  fitPlacement.setup.plotScale.mode !== "fit" || !fitPlacement.setup.centerPlot ||
  outsidePlacement.source.x !== -25 || outsidePlacement.source.y !== -40 || outsidePlacement.source.width !== 300 || outsidePlacement.source.height !== 400 ||
  displayPlacement.setup.plotArea.kind !== "display" || JSON.stringify(displayPlacement.source) !== JSON.stringify(displayWindow) ||
  displaySvg.skippedHandles.length !== 0 || result.display.svg.source !== Object.values(displayWindow).join(",") ||
  displayPdf.skippedHandles.length !== 0 || displayPdfReadback.pages !== 1 || !displayPdfReadback.eof ||
  !Number.isFinite(displayPdfReadback.paperLineDeltaMm?.x) || !Number.isFinite(displayPdfReadback.paperLineDeltaMm?.y) ||
  session.document.revision !== 7 || final.paper.widthMm !== 420 || final.paper.heightMm !== 297 || final.pageSetup.plotArea.kind !== "layout" || final.pageSetup.centerPlot || final.pageSetup.plotScale.drawingUnits !== 1
) throw new Error(`F-102 independent read-back mismatch: ${JSON.stringify(result)}`);
await mkdir(artifactRoot, { recursive: true });
await Promise.all([
  writeFile(resolve(artifactRoot, "F-102-page-setup.svg"), svg.text, "utf8"),
  writeFile(resolve(artifactRoot, "F-102-page-setup.pdf"), pdf.bytes),
  writeFile(resolve(artifactRoot, "F-102-page-setup.kdraw"), kdraw),
  writeFile(resolve(artifactRoot, "F-102-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
]);
console.log("F-102 atomic Page Setup, native viewport-coordinate persistence and independent SVG/PDF/KDRAW1 read-back PASS.");
