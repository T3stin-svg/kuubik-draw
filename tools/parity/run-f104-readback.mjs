#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportLayoutSvg, exportLayoutVectorPdf, readPdfSummary } from "../../packages/cad-print/dist/index.js";
import { createF104Document, F104_LAYOUT_ID } from "../../parity/fixtures/f104-document.ts";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserEvidenceBytes = await readFile(resolve(artifactRoot, "F-104-browser-readback.json"));
const browserEvidence = JSON.parse(browserEvidenceBytes.toString("utf8"));
const document = createF104Document("F-104");
const firstSvg = exportLayoutSvg(document, F104_LAYOUT_ID); const firstPdf = exportLayoutVectorPdf(document, F104_LAYOUT_ID);
const secondSvg = exportLayoutSvg(structuredClone(document), F104_LAYOUT_ID); const secondPdf = exportLayoutVectorPdf(structuredClone(document), F104_LAYOUT_ID);
const scaleMutation = structuredClone(document); scaleMutation.layouts[1].viewports[0].viewHeight = 24700;
const clipMutation = structuredClone(document); clipMutation.layouts[1].viewports[1].clipBoundary[2].x = 370;
const scaleSvg = exportLayoutSvg(scaleMutation, F104_LAYOUT_ID); const scalePdf = exportLayoutVectorPdf(scaleMutation, F104_LAYOUT_ID);
const clipSvg = exportLayoutSvg(clipMutation, F104_LAYOUT_ID); const clipPdf = exportLayoutVectorPdf(clipMutation, F104_LAYOUT_ID);
const kdraw = await serializeKDraw(document, [], "2026-08-28T00:00:00.000Z");
const svgPath = resolve(artifactRoot, "F-104-independent-layout.svg"); const pdfPath = resolve(artifactRoot, "F-104-independent-layout.pdf");
const kdrawPath = resolve(artifactRoot, "F-104-independent-layout.kdraw"); const renderedPath = resolve(artifactRoot, "F-104-independent-layout-rendered.png");
const svgRenderedPath = resolve(artifactRoot, "F-104-independent-layout-svg-rendered.png");
await Promise.all([writeFile(svgPath, firstSvg.text, "utf8"), writeFile(pdfPath, firstPdf.bytes), writeFile(kdrawPath, kdraw)]);
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", pdfPath, renderedPath.slice(0, -4)], { windowsHide: true, stdio: "pipe" });
execFileSync(process.execPath, [resolve(root, "tools/parity/render-f104-svg.mjs"), svgPath, svgRenderedPath], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const independentPdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-pdf.py"), `independent=${pdfPath}`], { windowsHide: true, encoding: "utf8" }));
const renderedPixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-rendered-png.py"), `independentPdf=${renderedPath}`, `independentSvg=${svgRenderedPath}`], { windowsHide: true, encoding: "utf8" }));
const kdrawText = Buffer.from(kdraw).toString("utf8");
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-104 independent KDRAW1 magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length)); const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json"); const decoded = JSON.parse(documentBytes.toString("utf8"));
const sourcePaths = {
  runner: "tools/parity/run-f104-readback.mjs", fixture: "parity/fixtures/f104-document.ts", browserEvidence: "evidence/artifacts/F-104-browser-readback.json",
  cadCore: "packages/cad-core/src/index.ts", cadPrint: "packages/cad-print/src/index.ts", svgRenderer: "tools/parity/render-f104-svg.mjs", pdfReader: "tools/parity/read-f104-pdf.py", pixelReader: "tools/parity/read-f104-rendered-png.py",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const svgText = firstSvg.text; const pdfText = new TextDecoder("latin1").decode(firstPdf.bytes); const pdfSummary = readPdfSummary(firstPdf.bytes);
const result = {
  schemaVersion: 1, rowId: "F-104", source: "Production cad-print deterministic SVG/PDF, KDRAW1 round-trip, mutation sensitivity, pypdf/pdfplumber and Poppler rendered pixels",
  sourceSha256, outputs: {
    svg: { bytes: Buffer.byteLength(svgText), sha256: sha256(svgText), skippedHandles: firstSvg.skippedHandles, viewportIds: [...svgText.matchAll(/data-viewport-id="([^"]+)"/gu)].map((match) => match[1]), rectClips: (svgText.match(/<clipPath[^>]*><rect/gu) ?? []).length, polygonClips: (svgText.match(/<clipPath[^>]*><polygon/gu) ?? []).length },
    pdf: { bytes: firstPdf.bytes.byteLength, sha256: sha256(firstPdf.bytes), skippedHandles: firstPdf.skippedHandles, summary: pdfSummary, images: (pdfText.match(/\/Subtype \/Image\b/gu) ?? []).length },
    deterministic: { svg: sha256(secondSvg.text), pdf: sha256(secondPdf.bytes) },
    mutations: { scale: { svg: sha256(scaleSvg.text), pdf: sha256(scalePdf.bytes) }, clip: { svg: sha256(clipSvg.text), pdf: sha256(clipPdf.bytes) } },
  },
  independentPdfReadback, renderedPixels,
  kdraw: { bytes: kdraw.byteLength, sha256: sha256(kdraw), documentSha256: sha256(documentBytes), entry, revision: decoded.revision, layout: decoded.layouts[1] },
  browserEvidenceSha256: sha256(browserEvidenceBytes), status: "PASS",
};
const independentPdf = independentPdfReadback.documents?.independent; const pdfPixels = renderedPixels.images?.independentPdf; const svgPixels = renderedPixels.images?.independentSvg;
if (
  browserEvidence.status !== "PASS" || browserEvidence.rowId !== "F-104" || firstSvg.skippedHandles.length !== 0 || firstPdf.skippedHandles.length !== 0 ||
  result.outputs.svg.viewportIds.join("|") !== "viewport-f104-50|viewport-f104-100" || result.outputs.svg.rectClips !== 2 || result.outputs.svg.polygonClips !== 1 ||
  result.outputs.deterministic.svg !== result.outputs.svg.sha256 || result.outputs.deterministic.pdf !== result.outputs.pdf.sha256 ||
  result.outputs.mutations.scale.svg === result.outputs.svg.sha256 || result.outputs.mutations.scale.pdf === result.outputs.pdf.sha256 || result.outputs.mutations.clip.svg === result.outputs.svg.sha256 || result.outputs.mutations.clip.pdf === result.outputs.pdf.sha256 ||
  pdfSummary.version !== "1.4" || pdfSummary.pages !== 1 || !pdfSummary.hasXref || !pdfSummary.xrefOffsetsValid || result.outputs.pdf.images !== 0 ||
  independentPdf?.pypdf?.strictParsed !== true || independentPdf?.pypdf?.pages !== 1 || independentPdf?.pypdf?.imageXObjects !== 0 || independentPdf?.pdfplumber?.images !== 0 || independentPdf?.pypdf?.operators?.W !== 3 || independentPdf?.pypdf?.operators?.cm !== 3 ||
  pdfPixels?.counts?.leftRed <= 0 || pdfPixels?.counts?.rightBlue <= 0 || pdfPixels?.counts?.redAlphaOnWhite <= 0 || pdfPixels?.counts?.black <= 0 ||
  svgPixels?.counts?.leftRed <= 0 || svgPixels?.counts?.rightBlue <= 0 || svgPixels?.counts?.redAlphaOnWhite <= 0 || svgPixels?.counts?.black <= 0 ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) || decoded.revision !== 0 || decoded.layouts?.[1]?.viewports?.length !== 2
) throw new Error(`F-104 independent read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-104-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-104 production SVG/PDF deterministic, mutation, KDRAW1, pypdf/pdfplumber and Poppler read-back PASS.");
