#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const markerPath = resolve(root, "parity/autocad/F-106.scr"); const matrixPath = resolve(root, "tools/autocad/f106-model-print.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f106.mjs"); const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-106-autocad-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex"); const ownershipToken = randomUUID();
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F106-"));
const paths = { dwg: resolve(tempRoot, "F106.dwg"), pid: resolve(tempRoot, "F106.pid"), output: resolve(tempRoot, "pdf") };
const preExistingProcessIds = acadProcessIds();

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}
async function ownedPid() {
  try { const sidecar = JSON.parse(await readFile(paths.pid, "utf8")); return sidecar.token === ownershipToken && sidecar.owned === true ? sidecar.processId : 0; }
  catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
}
async function terminate(processId) {
  if (!(processId > 0)) return false;
  try { process.kill(processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 80; attempt += 1) { await new Promise((done) => setTimeout(done, 100)); try { process.kill(processId, 0); } catch { return true; } }
  return false;
}
async function restoredProcessSet() {
  const expected = preExistingProcessIds.join("|");
  for (let attempt = 0; attempt < 80; attempt += 1) { if (acadProcessIds().join("|") === expected) return true; await new Promise((done) => setTimeout(done, 100)); }
  return false;
}
const close = (actual, expected, tolerance) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const sameRect = (left, right, tolerance = 0.01) => left === null || right === null
  ? left === right
  : ["x", "y", "width", "height"].every((key) => close(left?.[key], right?.[key], tolerance));
const sameStoredOrigin = (left, right) => left?.centerPlot === true && right?.centerPlot === true ||
  close(left?.plotOriginMm?.x, right?.plotOriginMm?.x, 0.01) && close(left?.plotOriginMm?.y, right?.plotOriginMm?.y, 0.01);
const sameModelPageSetup = (left, right) =>
  left?.name === right?.name && left?.configName === right?.configName && left?.configName === "DWG To PDF.pc3" &&
  left?.canonicalMediaName === right?.canonicalMediaName && Boolean(left?.canonicalMediaName) &&
  left?.plotType === right?.plotType && left?.useStandardScale === right?.useStandardScale && left?.standardScale === right?.standardScale &&
  close(left?.customScale?.paperUnits, right?.customScale?.paperUnits, 1e-6) && close(left?.customScale?.drawingUnits, right?.customScale?.drawingUnits, 1e-6) &&
  close(left?.customScale?.denominator, right?.customScale?.denominator, 1e-6) && left?.centerPlot === right?.centerPlot && sameStoredOrigin(left, right) &&
  close(left?.paper?.widthMm, right?.paper?.widthMm, 0.01) && close(left?.paper?.heightMm, right?.paper?.heightMm, 0.01) &&
  close(left?.paper?.rawWidthMm, right?.paper?.rawWidthMm, 0.01) && close(left?.paper?.rawHeightMm, right?.paper?.rawHeightMm, 0.01) &&
  left?.paper?.rotation === right?.paper?.rotation && sameRect(left?.window, right?.window) && left?.tileMode === right?.tileMode;

let processId = 0;
try {
  const child = await new Promise((resolveRun, reject) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath,
      "-TempDwgPath", paths.dwg, "-OutputDirectory", paths.output, "-PidPath", paths.pid, "-OwnershipToken", ownershipToken,
    ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = []; let timedOut = false; let force;
    const timeout = setTimeout(() => { timedOut = true; running.kill(); force = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5000); }, 240_000);
    running.stdout.on("data", (chunk) => { stdout.push(chunk); if (process.env.DEBUG_F106 === "1") process.stdout.write(chunk); });
    running.stderr.on("data", (chunk) => { stderr.push(chunk); if (process.env.DEBUG_F106 === "1") process.stderr.write(chunk); });
    running.on("error", reject);
    running.on("close", (code) => { clearTimeout(timeout); clearTimeout(force); resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
  processId = await ownedPid();
  if (child.timedOut) throw new Error(`AutoCAD F-106 matrix timed out; authenticated PID=${processId || "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-106 matrix exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{"); const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-106 PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  if (matrix.automationProcessId !== processId) throw new Error("F-106 PID sidecar and COM read-back disagreed.");
  const pdfPaths = Object.fromEntries(Object.entries(matrix.outputs).map(([name, output]) => [name, resolve(output.fullName)]));
  const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
  const pdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-pdf.py"), ...Object.entries(pdfPaths).map(([name, path]) => `${name}=${path}`)], { windowsHide: true, encoding: "utf8" }));
  const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
  const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
  await mkdir(artifactRoot, { recursive: true });
  const pixelArgs = [];
  for (const [name, path] of Object.entries(pdfPaths)) {
    const pdfBytes = await readFile(path); await writeFile(resolve(artifactRoot, `F-106-autocad-${name}.pdf`), pdfBytes);
    const prefix = resolve(artifactRoot, `F-106-autocad-${name}`); execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", path, prefix], { windowsHide: true, stdio: "pipe" });
    pixelArgs.push(`${name}=${prefix}.png`);
  }
  const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f106-rendered-png.py"), ...pixelArgs], { windowsHide: true, encoding: "utf8" }));
  const automationProcessTerminated = await terminate(processId); const processSetRestored = await restoredProcessSet();
  const docs = pdfReadback.documents; const image = pixels.images;
  const media = (document, width, height) => {
    const rotated = Math.abs(document?.rotation ?? 0) % 180 === 90;
    const actualWidth = document?.mediaBox?.[rotated ? 3 : 2]; const actualHeight = document?.mediaBox?.[rotated ? 2 : 3];
    return close(actualWidth, width, 0.75) && close(actualHeight, height, 0.75);
  };
  const displaySource = matrix.display?.modelView?.window;
  const displayScale = 0.01;
  const displayDestination = {
    x: (210 - displaySource.width * displayScale) / 2,
    y: (297 - displaySource.height * displayScale) / 2,
  };
  const visibleDisplayLine = {
    startX: Math.max(1000, displaySource.x),
    endX: Math.min(5000, displaySource.x + displaySource.width),
    y: 2000,
  };
  const expectedDisplayLine = {
    startX: displayDestination.x + (visibleDisplayLine.startX - displaySource.x) * displayScale,
    endX: displayDestination.x + (visibleDisplayLine.endX - displaySource.x) * displayScale,
    y: displayDestination.y + (visibleDisplayLine.y - displaySource.y) * displayScale,
  };
  if (
    matrix.status !== "PASS" || !matrix.engineVersion?.startsWith("24.3") || !matrix.automationProcessOwned || !automationProcessTerminated || !processSetRestored ||
    Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.backgroundPlot !== 0 || matrix.reopenDeviceRefreshed !== true || !sameModelPageSetup(matrix.display, matrix.afterReopen) || matrix.dwg?.bytes <= 0 ||
    !media(docs.extents, 595.275591, 841.889764) || !media(docs.window, 1190.551181, 841.889764) || !media(docs.display, 595.275591, 841.889764) ||
    [docs.extents, docs.window, docs.display].some((document) => document.pages !== 1 || document.imageXObjects !== 0 || document.plumberImages !== 0 || document.operators?.W < 1 || document.operators?.cm < 1) ||
    !close(docs.extents?.primaryLineMm?.lengthMm, 80, 0.2) || !close(docs.extents?.primaryLineMm?.startMm?.x, 65, 1) || !close(docs.extents?.primaryLineMm?.endMm?.x, 145, 1) ||
    !close(docs.extents?.primaryLineMm?.midpointMm?.x, 105, 0.5) || !close(docs.extents?.primaryCurveBoundsMm?.width, 40, 0.2) || !close(docs.extents?.primaryCurveBoundsMm?.height, 40, 0.2) ||
    !close(docs.window?.primaryLineMm?.lengthMm, 200, 0.2) || !close(docs.window?.primaryLineMm?.startMm?.x, 69, 3) || !close(docs.window?.primaryLineMm?.endMm?.x, 269, 3) || !close(docs.window?.primaryLineMm?.startMm?.y, 106, 8) ||
    !close(docs.display?.primaryLineMm?.lengthMm, expectedDisplayLine.endX - expectedDisplayLine.startX, 0.2) ||
    !close(docs.display?.primaryLineMm?.startMm?.x, expectedDisplayLine.startX, 0.3) || !close(docs.display?.primaryLineMm?.endMm?.x, expectedDisplayLine.endX, 0.3) || !close(docs.display?.primaryLineMm?.startMm?.y, expectedDisplayLine.y, 0.3) ||
    [image.extents, image.window, image.display].some((entry) => entry?.counts?.black <= 0 || entry?.counts?.nonWhite <= 0)
  ) throw new Error(`F-106 AutoCAD result mismatch: ${JSON.stringify({ matrix, pdfReadback, pixels, automationProcessTerminated, processSetRestored })}`);
  const result = {
    ...matrix, automationProcessTerminated, processSetRestored, preExistingProcessIds, independentPdfReadback: pdfReadback, renderedPixels: pixels,
    scriptSha256: sha256(await readFile(markerPath)), matrixScriptSha256: sha256(await readFile(matrixPath)), runnerScriptSha256: sha256(await readFile(runnerPath)),
    pdfReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f106-pdf.py"))), pixelReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f106-rendered-png.py"))), observedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`F-106 AutoCAD live PASS (${result.engineVersion}, Model Extents/Window/Display native PDFs/DWG, pypdf/pdfplumber/Poppler).`);
} finally {
  try { if (!(processId > 0)) processId = await ownedPid(); if (processId > 0) await terminate(processId); }
  finally { await rm(tempRoot, { recursive: true, force: true }); }
}
