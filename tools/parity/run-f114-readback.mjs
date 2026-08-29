#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exportLayoutsVectorPdf, readPdfSummary } from "../../packages/cad-print/src/index.ts";
import { createF114Document, F114_LAYOUT_IDS } from "../../parity/fixtures/f114-document.ts";
import { assertF114KuubikPdf, evaluateF114KuubikPdf } from "./f114-evidence-contract.mjs";
import { injectReferencedImageXObject } from "./f114-pdf-mutants.mjs";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserBytes = await readFile(resolve(artifactRoot, "F-114-browser-readback.json"));
const browser = JSON.parse(browserBytes.toString("utf8"));
const document = createF114Document("local");
const output = exportLayoutsVectorPdf(document, F114_LAYOUT_IDS);
const repeated = exportLayoutsVectorPdf(structuredClone(document), F114_LAYOUT_IDS);
const reversed = exportLayoutsVectorPdf(document, [...F114_LAYOUT_IDS].reverse());
const geometry = structuredClone(document); const line = geometry.entities.find((entity) => entity.handle === "10");
if (!line || line.kind !== "line") throw new Error("F-114 geometry mutation fixture is missing.");
line.end.x += 500;
const geometryMutation = exportLayoutsVectorPdf(geometry, F114_LAYOUT_IDS);
const alpha = structuredClone(document); const alphaLine = alpha.entities.find((entity) => entity.handle === "10");
if (!alphaLine || alphaLine.kind !== "line") throw new Error("F-114 alpha mutation fixture is missing.");
alphaLine.appearance = { ...alphaLine.appearance, transparency: 75 };
const alphaMutation = exportLayoutsVectorPdf(alpha, F114_LAYOUT_IDS);
const rasterMutation = { bytes: injectReferencedImageXObject(output.bytes) };
const outputPath = resolve(artifactRoot, "F-114-independent-vector.pdf");
await writeFile(outputPath, output.bytes);

const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
execFileSync(pdftoppm, ["-f", "1", "-l", "2", "-r", "144", "-png", outputPath, resolve(artifactRoot, "F-114-independent-vector")], { windowsHide: true, stdio: "pipe" });
const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
const mutationDirectory = await mkdtemp(join(tmpdir(), "kuubik-f114-mutations-"));
let independentPdfReadback;
try {
  const mutationBytes = { order: reversed.bytes, geometry: geometryMutation.bytes, alpha: alphaMutation.bytes, raster: rasterMutation.bytes };
  const mutationArguments = [];
  for (const [key, bytes] of Object.entries(mutationBytes)) {
    const path = join(mutationDirectory, `F-114-${key}-mutant.pdf`);
    await writeFile(path, bytes);
    mutationArguments.push(`${key}=${path}`);
  }
  independentPdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f114-pdf.py"), `independent=${outputPath}`, ...mutationArguments], { windowsHide: true, encoding: "utf8" }));
} finally {
  await rm(mutationDirectory, { recursive: true, force: true });
}
const renderedPixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f114-rendered-png.py"),
  `page1=${resolve(artifactRoot, "F-114-independent-vector-1.png")}`, `page2=${resolve(artifactRoot, "F-114-independent-vector-2.png")}`,
], { windowsHide: true, encoding: "utf8" }));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-114.json"), "utf8"));
const sourcePaths = {
  runner: "tools/parity/run-f114-readback.mjs", fixture: "parity/fixtures/f114-document.ts", browserEvidence: "evidence/artifacts/F-114-browser-readback.json",
  contract: "tools/parity/f114-evidence-contract.mjs", mutantBuilder: "tools/parity/f114-pdf-mutants.mjs", pdfReader: "tools/parity/read-f114-pdf.py",
  pixelReader: "tools/parity/read-f114-rendered-png.py", cadPrint: "packages/cad-print/src/index.ts",
  unitTest: "packages/cad-print/test/f114-vector-output.test.ts", mutationTest: "packages/cad-print/test/f114-mutation-proven.test.ts",
  expected: "parity/expected/F-114.json", scope: "parity/F-114-scope.md", packageLock: "package-lock.json",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const pdf = independentPdfReadback.documents?.independent; const page1 = pdf?.pageDetails?.[0]; const page2 = pdf?.pageDetails?.[1];
const pixels1 = renderedPixels.images?.page1; const pixels2 = renderedPixels.images?.page2;
const semanticContract = assertF114KuubikPdf(pdf, renderedPixels, expected, "F-114 independent PDF");
const mutationRejects = Object.fromEntries(["order", "geometry", "alpha", "raster"].map((key) => {
  const evaluation = evaluateF114KuubikPdf(independentPdfReadback.documents?.[key], null, expected);
  return [key, { sha256: independentPdfReadback.documents?.[key]?.sha256, strictParsed: independentPdfReadback.documents?.[key]?.strictParsed, rejected: !evaluation.pass, reasons: evaluation.reasons }];
}));
const close = (actual, expected, tolerance = 0.001) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const checks = {
  browserPassed: browser.status === "PASS",
  exactBrowserBytes: browser.output?.sha256 === sha256(output.bytes) && browser.output?.bytes === output.bytes.byteLength,
  deterministic: sha256(repeated.bytes) === sha256(output.bytes),
  mutationSensitive: Object.values(mutationRejects).every((mutation) => mutation.rejected === true && /^[a-f0-9]{64}$/u.test(mutation.sha256) && mutation.sha256 !== sha256(output.bytes)) && mutationRejects.raster?.strictParsed === true && mutationRejects.raster?.reasons?.includes("page-1-raster"),
  noSkippedHandles: output.skippedHandles.length === 0 && output.pages.every((page) => page.skippedHandles.length === 0),
  mixedPagePlan: output.pages.map((page) => page.layoutId).join("|") === F114_LAYOUT_IDS.join("|") && output.pages[0]?.placement.paper.widthMm === 420 && output.pages[1]?.placement.paper.widthMm === 210,
  strictVectorPdf: semanticContract.pass === true && pdf?.strictParsed === true && pdf?.pages === 2 && pdf?.pageDetails?.every((page) => page.imageXObjects === 0 && page.plumberImages === 0 && (page.operators?.S ?? 0) >= 1 && (page.operators?.Tj ?? 0) >= 2 && page.extGStates >= 1),
  physicalSizes: close(page1?.mediaBox?.[2], 1190.551181) && close(page1?.mediaBox?.[3], 841.889764) && close(page2?.mediaBox?.[2], 595.275591) && close(page2?.mediaBox?.[3], 841.889764),
  requiredText: page1?.text?.includes("F-114 A3 LAYOUT") && page1?.text?.includes("KUUBIK F-114 VECTOR PDF") && page2?.text?.includes("F-114 A4 DETAIL") && page2?.text?.includes("KUUBIK F-114 VECTOR PDF"),
  renderedPages: pixels1?.counts?.red > 0 && pixels1?.counts?.blue === 0 && pixels1?.counts?.black > 0 && pixels2?.counts?.blue > 0 && pixels2?.counts?.red === 0 && pixels2?.counts?.black > 0,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-114 independent read-back mismatch: ${JSON.stringify({ checks, output, independentPdfReadback, renderedPixels })}`);
const result = {
  schemaVersion: 1, rowId: "F-114", source: "Production cad-print mixed-size export repeated independently, mutation-proven and reopened with pypdf/pdfplumber/Poppler",
  sourceSha256, outputs: {
    production: { bytes: output.bytes.byteLength, sha256: sha256(output.bytes), summary: readPdfSummary(output.bytes), pages: output.pages },
    deterministic: sha256(repeated.bytes), mutations: mutationRejects,
  }, expectedContract: expected, semanticContract, independentPdfReadback, renderedPixels, checks, observedAt: new Date().toISOString(), status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-114-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-114 production mixed-size vector PDF, mutation and independent read-back PASS.");
