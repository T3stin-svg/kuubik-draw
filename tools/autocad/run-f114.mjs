#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
if (!process.argv.includes("--reuse-current-f104")) {
  execFileSync(process.execPath, [resolve(root, "tools/autocad/run-f104.mjs")], { cwd: root, windowsHide: true, stdio: "inherit" });
}
const sourcePath = resolve(artifactRoot, "F-104-autocad-readback.json");
const sourceBytes = await readFile(sourcePath); const source = JSON.parse(sourceBytes.toString("utf8"));
const nativePdf = source.independentPdfReadback?.documents?.native; const reopenPdf = source.independentPdfReadback?.documents?.reopen;
const nativePixels = source.renderedPixels?.images?.native; const reopenPixels = source.renderedPixels?.images?.reopen;
const a3Landscape = (document) => Math.abs(Math.min(document?.pypdf?.mediaBox?.[2], document?.pypdf?.mediaBox?.[3]) - 842) < 0.1 && Math.abs(Math.max(document?.pypdf?.mediaBox?.[2], document?.pypdf?.mediaBox?.[3]) - 1191) < 0.1;
const checks = {
  freshF104LivePass: source.schemaVersion === 1 && source.rowId === "F-104" && source.status === "PASS" && source.engineVersion?.startsWith("24.3"),
  ownedAndRestored: source.automationProcessOwned === true && source.automationProcessTerminated === true && source.processSetRestored === true && source.userDocument?.isolatedOwnedProcess === true && source.userDocument?.blankRestored === true,
  physicalA3Vector: nativePdf?.pypdf?.pages === 1 && reopenPdf?.pypdf?.pages === 1 && a3Landscape(nativePdf) && a3Landscape(reopenPdf) && nativePdf?.pypdf?.imageXObjects === 0 && reopenPdf?.pypdf?.imageXObjects === 0 && nativePdf?.pdfplumber?.images === 0 && reopenPdf?.pdfplumber?.images === 0 && (nativePdf?.pypdf?.operators?.S ?? 0) >= 1 && (reopenPdf?.pypdf?.operators?.S ?? 0) >= 1,
  autoCadCatalogDefectRecorded: nativePdf?.pypdf?.strictParsed === false && reopenPdf?.pypdf?.strictParsed === false && /Multiple definitions/u.test(nativePdf?.pypdf?.strictError ?? "") && /Multiple definitions/u.test(reopenPdf?.pypdf?.strictError ?? ""),
  popplerSharpAndStable: nativePixels?.width === 2382 && nativePixels?.height === 1684 && nativePixels?.counts?.red > 0 && nativePixels?.counts?.blue > 0 && nativePixels?.counts?.black > 0 && nativePixels?.sha256 === reopenPixels?.sha256,
  nativeReopenStable: source.dwg?.bytes > 0 && source.pdf?.bytes > 0 && source.reopenPdf?.bytes > 0 && source.beforeSave?.viewportCount === 2 && source.afterReopen?.viewportCount === 2,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-114 AutoCAD reference mismatch: ${JSON.stringify(checks)}`);
const sourcePaths = {
  marker: "parity/autocad/F-114.scr", runner: "tools/autocad/run-f114.mjs", f104Runner: "tools/autocad/run-f104.mjs",
  f104Matrix: "tools/autocad/f104-vector-output.ps1", pdfReader: "tools/parity/read-f104-pdf.py", pixelReader: "tools/parity/read-f104-rendered-png.py",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const result = {
  schemaVersion: 1, rowId: "F-114", benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  authority: "autocad-2024.1.2-live", sourceRowId: "F-104", sourceArtifactSha256: sha256(sourceBytes), sourceObservedAt: source.observedAt,
  workflow: "Fresh owned AutoCAD 2024 A3 layout plot through DWG To PDF.pc3, native DWG save/reopen and second plot; both PDFs reopened by pypdf/pdfplumber and rendered by Poppler.",
  engineVersion: source.engineVersion, automationProcessOwned: source.automationProcessOwned, automationProcessTerminated: source.automationProcessTerminated,
  processSetRestored: source.processSetRestored, nativePdf, reopenPdf, nativePixels, reopenPixels, sourceSha256, checks, observedAt: new Date().toISOString(), status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-114-autocad-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-114 AutoCAD live vector-PDF reference PASS (${result.engineVersion}, A3, native save/reopen, no image XObjects).`);
