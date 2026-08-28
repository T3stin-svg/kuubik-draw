#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CadSession, createEmptyDocument, createPaperLayout, serializeKDraw, setPaperLayoutPageSetup } from "../../packages/cad-core/dist/index.js";
import { exportLayoutSvg, exportLayoutVectorPdf } from "../../packages/cad-print/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const operation = (baseRevision) => ({ opId: `PAGESETUP-${baseRevision}`, baseRevision, commandId: "PAGESETUP", args: {}, targetHandles: [], resultHandles: [] });
const browserEvidenceBytes = await readFile(resolve(artifactRoot, "F-103-browser-readback.json"));

const document = createEmptyDocument({ documentId: "F-103", now: "2026-08-28T00:00:00.000Z" });
document.layers[0].appearance = { color: "#ff0000", colorMethod: "aci", lineweightMm: 0.7 };
document.entities = [
  { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 30 }, end: { x: 190, y: 30 } },
  { kind: "line", handle: "11", layerId: "0", start: { x: 20, y: 45 }, end: { x: 190, y: 45 }, appearance: { color: "#00ff00", colorMethod: "aci", lineweightMm: 0.35 } },
  { kind: "line", handle: "13", layerId: "0", start: { x: 20, y: 60 }, end: { x: 190, y: 60 }, appearance: { color: "#0a64dc", colorMethod: "trueColor", lineweightMm: 0 } },
  {
    kind: "hatch", handle: "12", layerId: "0", pattern: "SOLID", associative: false, appearance: { transparency: 40 },
    loops: [{ isHole: false, vertices: [{ x: 50, y: 70 }, { x: 150, y: 70 }, { x: 150, y: 130 }, { x: 50, y: 130 }] }],
  },
];
const paper = createPaperLayout(document, {
  name: "F103 PLOT STYLE",
  paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  pageSetup: {
    mediaName: "ISO_A4", orientation: "landscape", plotArea: { kind: "layout" },
    plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
    displayPlotStyles: true,
  },
  viewports: [{
    id: "viewport-f103", center: { x: 148.5, y: 105 }, width: 257, height: 150,
    viewCenter: { x: 105, y: 80 }, viewHeight: 150, twistAngleRad: 0, locked: true,
  }],
});
const session = new CadSession({ ...document, layouts: paper.layouts });
const baseSetup = session.document.layouts[1].pageSetup;

function apply(profile, plotLineweights, plotTransparency, revision, time) {
  const result = setPaperLayoutPageSetup(session.document, paper.layoutId, { ...baseSetup, plotStyle: { profile, plotLineweights, plotTransparency } });
  session.commit(operation(revision), result.changes, time);
  return session.document.layouts[1];
}

function outputSnapshot() {
  const svg = exportLayoutSvg(session.document, paper.layoutId);
  const pdf = exportLayoutVectorPdf(session.document, paper.layoutId);
  const svgText = svg.text;
  const pdfText = new TextDecoder("latin1").decode(pdf.bytes);
  const xref = pdfText.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
  return {
    svg, pdf, summary: {
      profile: svgText.match(/data-plot-profile="([^"]+)"/u)?.[1] ?? null,
      lineweights: svgText.match(/data-plot-lineweights="([^"]+)"/u)?.[1] ?? null,
      transparency: svgText.match(/data-plot-transparency="([^"]+)"/u)?.[1] ?? null,
      svgBytes: Buffer.byteLength(svgText), svgSha256: sha256(svgText), pdfBytes: pdf.bytes.byteLength, pdfSha256: sha256(pdf.bytes),
      svgRed: svgText.includes('data-plot-color="#ff0000"'), svgGreen: svgText.includes('data-plot-color="#00ff00"'),
      svgBlack: svgText.includes('data-plot-color="#000000"'), svgGrayRed: svgText.includes('data-plot-color="#4c4c4c"'), svgGrayGreen: svgText.includes('data-plot-color="#959595"'),
      svgTrueColorBlue: svgText.includes('data-plot-color="#0a64dc"'),
      svgFullLineweight: svgText.includes('data-lineweight-mm="0.7"'), svgHairline: svgText.includes('data-lineweight-mm="0"'), svgAlpha60: svgText.includes('data-opacity="0.6"'),
      pdfVersion: pdfText.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null, pdfPages: (pdfText.match(/\/Type \/Page\b/gu) ?? []).length,
      pdfEof: /%%EOF\s*$/u.test(pdfText), xrefOffsetsValid: xref ? xref[2].trim().split("\n").slice(1).every((line, index) => pdfText.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false,
      pdfRed: pdfText.includes("1 0 0 RG 1 0 0 rg"), pdfGreen: pdfText.includes("0 1 0 RG 0 1 0 rg"), pdfBlack: pdfText.includes("0 0 0 RG 0 0 0 rg"),
      pdfGrayRed: pdfText.includes("0.298039 0.298039 0.298039 RG"), pdfGrayGreen: pdfText.includes("0.584314 0.584314 0.584314 RG"),
      pdfTrueColorBlue: pdfText.includes("0.039216 0.392157 0.862745 RG"),
      pdfFullLineweight: pdfText.includes("0.7 w"), pdfHairline: pdfText.includes(" 0 w "), pdfAlpha60: pdfText.includes("/GS60 gs") && pdfText.includes("/CA 0.6 /ca 0.6"), pdfSolidFill: pdfText.includes("f*"),
    },
  };
}

const colorNoLineweightLayout = apply("color", false, false, 0, "2026-08-28T00:00:01.000Z");
const colorNoLineweight = outputSnapshot();
const grayscaleLayout = apply("grayscale", true, true, 1, "2026-08-28T00:00:02.000Z");
const grayscale = outputSnapshot();
const colorAlphaLayout = apply("color", true, true, 2, "2026-08-28T00:00:03.000Z");
const colorAlpha = outputSnapshot();
const undoOperation = session.undo("2026-08-28T00:00:04.000Z");
const afterUndo = structuredClone(session.document.layouts[1]);
const redoOperation = session.redo("2026-08-28T00:00:05.000Z");
const afterRedo = structuredClone(session.document.layouts[1]);
const monochromeLayout = apply("monochrome", true, true, 5, "2026-08-28T00:00:06.000Z");
const monochrome = outputSnapshot();

const kdraw = await serializeKDraw(session.document, [], "2026-08-28T00:00:06.000Z");
const kdrawText = Buffer.from(kdraw).toString("utf8");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files["document.json"], "base64");
const entry = envelope.manifest.entries.find((candidate) => candidate.path === "document.json");
const decoded = JSON.parse(documentBytes.toString("utf8"));

const result = {
  schemaVersion: 1, rowId: "F-103",
  source: "Independent production cad-core PAGESETUP transactions, cad-print SVG/PDF operators and KDRAW1 parser",
  sourceSha256: {
    runner: sha256(await readFile(resolve(root, "tools/parity/run-f103-readback.mjs"))),
    browserEvidence: sha256(browserEvidenceBytes),
    plotStyle: sha256(await readFile(resolve(root, "packages/cad-core/src/plot-style.ts"))),
    layouts: sha256(await readFile(resolve(root, "packages/cad-core/src/layouts.ts"))),
    cadPrint: sha256(await readFile(resolve(root, "packages/cad-print/src/index.ts"))),
  },
  outputs: {
    colorNoLineweight: colorNoLineweight.summary, grayscale: grayscale.summary,
    colorAlpha: colorAlpha.summary, monochrome: monochrome.summary,
  },
  layouts: { colorNoLineweight: colorNoLineweightLayout, grayscale: grayscaleLayout, colorAlpha: colorAlphaLayout, monochrome: monochromeLayout },
  atomic: { undoCommandId: undoOperation?.operation.commandId, redoCommandId: redoOperation?.operation.commandId, afterUndo, afterRedo },
  kdraw: { bytes: kdraw.byteLength, sha256: sha256(kdraw), documentSha256: sha256(documentBytes), revision: decoded.revision, plotStyle: decoded.layouts[1].pageSetup.plotStyle, displayPlotStyles: decoded.layouts[1].pageSetup.displayPlotStyles },
  status: "PASS",
};
const color = result.outputs.colorNoLineweight; const gray = result.outputs.grayscale; const alpha = result.outputs.colorAlpha; const mono = result.outputs.monochrome;
if (
  session.document.revision !== 6 || color.profile !== "color" || color.lineweights !== "false" || color.transparency !== "false" ||
  !color.svgRed || !color.svgGreen || !color.svgTrueColorBlue || !color.svgHairline || color.svgAlpha60 || !color.pdfRed || !color.pdfGreen || !color.pdfTrueColorBlue || !color.pdfHairline || color.pdfAlpha60 ||
  gray.profile !== "grayscale" || !gray.svgGrayRed || !gray.svgGrayGreen || !gray.svgTrueColorBlue || !gray.svgFullLineweight || !gray.svgHairline || !gray.svgAlpha60 || !gray.pdfGrayRed || !gray.pdfGrayGreen || !gray.pdfTrueColorBlue || !gray.pdfHairline || !gray.pdfAlpha60 ||
  alpha.profile !== "color" || !alpha.svgRed || !alpha.svgGreen || !alpha.svgTrueColorBlue || !alpha.svgFullLineweight || !alpha.svgHairline || !alpha.svgAlpha60 || !alpha.pdfRed || !alpha.pdfGreen || !alpha.pdfTrueColorBlue || !alpha.pdfFullLineweight || !alpha.pdfHairline || !alpha.pdfAlpha60 || !alpha.pdfSolidFill ||
  mono.profile !== "monochrome" || !mono.svgBlack || !mono.svgTrueColorBlue || mono.svgRed || mono.svgGreen || !mono.svgHairline || !mono.pdfBlack || !mono.pdfTrueColorBlue || mono.pdfRed || mono.pdfGreen || !mono.pdfHairline || !mono.pdfAlpha60 ||
  Object.values(result.outputs).some((output) => output.pdfVersion !== "1.4" || output.pdfPages !== 1 || !output.pdfEof || !output.xrefOffsetsValid) ||
  undoOperation?.operation.commandId !== "UNDO" || afterUndo.pageSetup.plotStyle.profile !== "grayscale" || redoOperation?.operation.commandId !== "PAGESETUP" || afterRedo.pageSetup.plotStyle.profile !== "color" ||
  !kdrawText.startsWith("KDRAW1\n") || !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) || decoded.revision !== 6 ||
  JSON.stringify(decoded.layouts[1].pageSetup.plotStyle) !== JSON.stringify({ profile: "monochrome", plotLineweights: true, plotTransparency: true }) || decoded.layouts[1].pageSetup.displayPlotStyles !== true ||
  decoded.entities.find((entity) => entity.handle === "13")?.appearance?.colorMethod !== "trueColor" || decoded.entities.find((entity) => entity.handle === "13")?.appearance?.lineweightMm !== 0
) throw new Error(`F-103 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(artifactRoot, { recursive: true });
await Promise.all([
  writeFile(resolve(artifactRoot, "F-103-readback-color-alpha.svg"), colorAlpha.svg.text, "utf8"),
  writeFile(resolve(artifactRoot, "F-103-readback-color-alpha.pdf"), colorAlpha.pdf.bytes),
  writeFile(resolve(artifactRoot, "F-103-readback-plot-style.kdraw"), kdraw),
  writeFile(resolve(artifactRoot, "F-103-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
]);
console.log("F-103 atomic plot styles and independent SVG/PDF/KDRAW1 read-back PASS.");
