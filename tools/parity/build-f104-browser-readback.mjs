#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const [matrixBytes, svgBytes, pdfBytes, kdrawBytes, screenshotBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-104-browser-vector-output.json")), readFile(resolve(artifactRoot, "F-104-browser-layout.svg")),
  readFile(resolve(artifactRoot, "F-104-browser-layout.pdf")), readFile(resolve(artifactRoot, "F-104-browser-layout.kdraw")),
  readFile(resolve(artifactRoot, "F-104-browser-layout.png")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8")); const svg = svgBytes.toString("utf8"); const pdf = pdfBytes.toString("latin1");
const kdrawText = kdrawBytes.toString("utf8");
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-104 browser KDRAW1 magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length)); const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json"); const document = JSON.parse(documentBytes.toString("utf8"));
const layout = document.layouts?.find((candidate) => candidate.name === "F104 VECTOR OUTPUT");

const renderedPath = resolve(artifactRoot, "F-104-browser-layout-rendered.png");
const svgRenderedPath = resolve(artifactRoot, "F-104-browser-layout-svg-rendered.png");
const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", resolve(artifactRoot, "F-104-browser-layout.pdf"), renderedPath.slice(0, -4)], { windowsHide: true, stdio: "pipe" });
execFileSync(process.execPath, [resolve(root, "tools/parity/render-f104-svg.mjs"), resolve(artifactRoot, "F-104-browser-layout.svg"), svgRenderedPath], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const independentPdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-pdf.py"), `browser=${resolve(artifactRoot, "F-104-browser-layout.pdf")}`], { windowsHide: true, encoding: "utf8" }));
const renderedPixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-rendered-png.py"), `browserPdf=${renderedPath}`, `browserSvg=${svgRenderedPath}`], { windowsHide: true, encoding: "utf8" }));

const sourcePaths = {
  e2e: "e2e/f104-vector-output.spec.ts", fixture: "parity/fixtures/f104-document.ts", capture: "tools/parity/capture-f104-browser.mjs",
  layoutTools: "e2e/helpers/layout-tools.ts",
  builder: "tools/parity/build-f104-browser-readback.mjs", svgRenderer: "tools/parity/render-f104-svg.mjs", pdfReader: "tools/parity/read-f104-pdf.py", pixelReader: "tools/parity/read-f104-rendered-png.py",
  app: "apps/web/src/App.tsx", style: "apps/web/src/style.css", cadCoreLayouts: "packages/cad-core/src/layouts.ts",
  cadRenderer: "packages/cad-renderer/src/renderer.ts", cadPrint: "packages/cad-print/src/index.ts", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const svgSummary = {
  bytes: svgBytes.byteLength, sha256: sha256(svgBytes), physicalA3: /width="420mm" height="297mm"/u.test(svg),
  viewportIds: [...svg.matchAll(/data-viewport-id="([^"]+)"/gu)].map((match) => match[1]), rectClips: (svg.match(/<clipPath[^>]*><rect/gu) ?? []).length,
  polygonClips: (svg.match(/<clipPath[^>]*><polygon/gu) ?? []).length, scale50: svg.includes("scale(0.02)"), scale100: svg.includes("scale(0.01)"),
  title: svg.includes("KUUBIK F-104 VECTOR LAYOUT"), alpha60: svg.includes('data-opacity="0.6"'), images: (svg.match(/<image\b/gu) ?? []).length,
};
const xref = pdf.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/u);
const pdfSummary = {
  bytes: pdfBytes.byteLength, sha256: sha256(pdfBytes), version: pdf.match(/^%PDF-([0-9.]+)/u)?.[1] ?? null,
  pages: (pdf.match(/\/Type \/Page\b/gu) ?? []).length, a3: pdf.includes("/MediaBox [0 0 1190.551181 841.889764]"),
  rectangularClip: pdf.includes("16.25 25 185 247 re W n"), polygonClip: pdf.includes("218.75 25 m 403.75 25 l 382 272 l 240.5 272 l h W n"),
  scale50: pdf.includes("0.02 0 0 0.02 108.75 148.5 cm"), scale100: pdf.includes("0.01 0 0 0.01 111.25 148.5 cm"),
  title: pdf.includes("(KUUBIK F-104 VECTOR LAYOUT) Tj"), alpha60: pdf.includes("/GS60 gs"), images: (pdf.match(/\/Subtype \/Image\b/gu) ?? []).length,
  xrefOffsetsValid: xref ? xref[2].trim().split("\n").slice(1).every((line, index) => pdf.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`)) : false,
};
const result = {
  schemaVersion: 1, rowId: "F-104", source: "Chromium 1920x1080 persisted two-viewport A3 layout plus independent SVG, pypdf, pdfplumber, Poppler-pixel and KDRAW1 readers",
  sourceSha256, matrix, svg: svgSummary, pdf: pdfSummary, independentPdfReadback, renderedPixels,
  screenshot: { bytes: screenshotBytes.byteLength, sha256: sha256(screenshotBytes) },
  kdraw: { bytes: kdrawBytes.byteLength, sha256: sha256(kdrawBytes), documentSha256: sha256(documentBytes), revision: document.revision, layout }, status: "PASS",
};
const independentPdf = independentPdfReadback.documents?.browser; const pdfPixels = renderedPixels.images?.browserPdf; const svgPixels = renderedPixels.images?.browserSvg;
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-104" || matrix.status !== "PASS" || matrix.viewport?.width !== 1920 || matrix.viewport?.height !== 1080 || matrix.consoleErrors?.length !== 0 ||
  matrix.before?.length !== 2 || matrix.after?.length !== 2 || matrix.before?.[0]?.viewHeight !== 12350 || matrix.before?.[1]?.viewHeight !== 24700 || matrix.before?.[0]?.locked !== "true" || matrix.before?.[1]?.locked !== "true" ||
  matrix.outputs?.svg?.sha256 !== sha256(svgBytes) || matrix.outputs?.pdf?.sha256 !== sha256(pdfBytes) || matrix.outputs?.kdraw?.sha256 !== sha256(kdrawBytes) || matrix.deterministicReload?.svgSha256 !== sha256(svgBytes) || matrix.deterministicReload?.pdfSha256 !== sha256(pdfBytes) ||
  !svgSummary.physicalA3 || svgSummary.viewportIds.join("|") !== "viewport-f104-50|viewport-f104-100" || svgSummary.rectClips !== 2 || svgSummary.polygonClips !== 1 || !svgSummary.scale50 || !svgSummary.scale100 || !svgSummary.title || !svgSummary.alpha60 || svgSummary.images !== 0 ||
  pdfSummary.version !== "1.4" || pdfSummary.pages !== 1 || !pdfSummary.a3 || !pdfSummary.rectangularClip || !pdfSummary.polygonClip || !pdfSummary.scale50 || !pdfSummary.scale100 || !pdfSummary.title || !pdfSummary.alpha60 || pdfSummary.images !== 0 || !pdfSummary.xrefOffsetsValid ||
  !/^\d+\./u.test(independentPdfReadback.readers?.pypdf ?? "") || !/^\d+\./u.test(independentPdfReadback.readers?.pdfplumber ?? "") || independentPdf?.pypdf?.strictParsed !== true || independentPdf?.pypdf?.pages !== 1 || independentPdf?.pypdf?.imageXObjects !== 0 || independentPdf?.pdfplumber?.images !== 0 || independentPdf?.pypdf?.operators?.W !== 3 || independentPdf?.pypdf?.operators?.cm !== 3 ||
  pdfPixels?.width < 2300 || pdfPixels?.height < 1600 || pdfPixels?.counts?.leftRed <= 0 || pdfPixels?.counts?.rightBlue <= 0 || pdfPixels?.counts?.redAlphaOnWhite <= 0 || pdfPixels?.counts?.black <= 0 ||
  svgPixels?.width < 2300 || svgPixels?.height < 1600 || svgPixels?.counts?.leftRed <= 0 || svgPixels?.counts?.rightBlue <= 0 || svgPixels?.counts?.redAlphaOnWhite <= 0 || svgPixels?.counts?.black <= 0 ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) || document.revision !== 0 || layout?.viewports?.length !== 2 || layout?.paper?.widthMm !== 420 || layout?.paper?.heightMm !== 297
) throw new Error(`F-104 browser/read-back mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-104-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-104 Chromium two-viewport SVG/PDF/KDRAW1 and independent Poppler/pypdf/pdfplumber read-back PASS.");
