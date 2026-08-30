#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const markerPath = resolve(root, "parity/autocad/F-104.scr"); const matrixScriptPath = resolve(root, "tools/autocad/f104-vector-output.ps1");
const runnerScriptPath = resolve(root, "tools/autocad/run-f104.mjs"); const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-104-autocad-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex"); const temporaryStem = resolve(tmpdir(), `KuubikDraw-F104-${randomUUID()}`); const ownershipToken = randomUUID();
const temporaryPaths = { dwg: `${temporaryStem}.dwg`, bak: `${temporaryStem}.bak`, pdf: `${temporaryStem}.pdf`, reopenPdf: `${temporaryStem}.reopen.pdf`, pid: `${temporaryStem}.pid` };
const nativePngPath = resolve(artifactRoot, "F-104-autocad-layout.png"); const reopenPngPath = resolve(artifactRoot, "F-104-autocad-layout-reopen.png");
const preExistingProcessIds = acadProcessIds();

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}

function processIdentity(processId) {
  const script = `$process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue; if ($process) { [ordered]@{ processId = [int]$process.Id; executablePath = [IO.Path]::GetFullPath([string]$process.Path); startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }; exit 0`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : null;
}

function identityMatches(sidecar, current) {
  return current?.processId === sidecar.processId
    && current.executablePath?.toLowerCase() === sidecar.executablePath.toLowerCase()
    && current.startTimeUtc === sidecar.startTimeUtc;
}

function newAutomationSidecars() {
  const existing = new Set(preExistingProcessIds);
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !existing.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}

async function resolveOwnedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (sidecar.schemaVersion !== 1 || sidecar.owned !== true || sidecar.token !== ownershipToken || !Number.isInteger(sidecar.processId) || sidecar.processId <= 0
      || typeof sidecar.executablePath !== "string" || !sidecar.executablePath.toLowerCase().endsWith("\\acad.exe")
      || typeof sidecar.startTimeUtc !== "string" || preExistingProcessIds.includes(sidecar.processId)) return null;
    return sidecar;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function terminateOwnedProcess(sidecar) {
  if (!sidecar) return false;
  let current = processIdentity(sidecar.processId);
  if (!current) return true;
  if (!identityMatches(sidecar, current)) throw new Error(`Refusing to terminate PID ${sidecar.processId}: process identity changed after F-104 authentication.`);
  try { process.kill(sidecar.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    current = processIdentity(sidecar.processId);
    if (!current) return true;
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for F-104 AutoCAD termination.`);
  }
  return false;
}

async function waitForOriginalProcessSet() {
  const expected = preExistingProcessIds.join("|");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (acadProcessIds().join("|") === expected) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function removeTemporaryFiles() { await Promise.all(Object.values(temporaryPaths).map((path) => rm(path, { force: true }))); }

async function runMatrix() {
  await removeTemporaryFiles(); let ownedIdentity = null; let primaryError = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg, "-TempPdfPath", temporaryPaths.pdf, "-TempReopenPdfPath", temporaryPaths.reopenPdf,
        "-PidPath", temporaryPaths.pid, "-OwnershipToken", ownershipToken,
      ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = []; const stderr = []; let timedOut = false;
      child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
      const timeout = setTimeout(() => {
        timedOut = true;
        try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
        catch { child.kill(); }
      }, 180_000);
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    ownedIdentity = await resolveOwnedSidecar();
    const ownedProcessId = ownedIdentity?.processId ?? 0;
    if (childResult.timedOut) throw new Error(`AutoCAD F-104 matrix exceeded 180 seconds; authenticated PID=${ownedProcessId || "missing"}.`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-104 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("F-104 PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownedProcessId) throw new Error("F-104 PID sidecar and COM read-back disagreed.");
    const pdfBytes = await readFile(temporaryPaths.pdf); const reopenPdfBytes = await readFile(temporaryPaths.reopenPdf);
    if (sha256(pdfBytes) !== matrix.pdf?.sha256 || sha256(reopenPdfBytes) !== matrix.reopenPdf?.sha256) throw new Error("F-104 native PDF hash changed before read-back.");
    const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
    const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
    execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", temporaryPaths.pdf, nativePngPath.slice(0, -4)], { windowsHide: true, stdio: "pipe" });
    execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", temporaryPaths.reopenPdf, reopenPngPath.slice(0, -4)], { windowsHide: true, stdio: "pipe" });
    const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
    const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
    const independentPdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-pdf.py"), `native=${temporaryPaths.pdf}`, `reopen=${temporaryPaths.reopenPdf}`], { windowsHide: true, encoding: "utf8" }));
    const renderedPixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f104-rendered-png.py"), `native=${nativePngPath}`, `reopen=${reopenPngPath}`], { windowsHide: true, encoding: "utf8" }));
    const automationProcessTerminated = await terminateOwnedProcess(ownedIdentity);
    if (!automationProcessTerminated) throw new Error(`Owned AutoCAD process ${ownedProcessId} remained after F-104.`);
    const processSetRestored = await waitForOriginalProcessSet();
    return { ...matrix, automationProcessTerminated, processSetRestored, preExistingProcessIds, independentPdfReadback, renderedPixels };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      if (!ownedIdentity) ownedIdentity = await resolveOwnedSidecar();
      if (!ownedIdentity) {
        const orphanCandidates = newAutomationSidecars();
        if (orphanCandidates.length === 1) ownedIdentity = orphanCandidates[0];
        else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-104 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
      }
      if (ownedIdentity && !await terminateOwnedProcess(ownedIdentity)) cleanupErrors.push(new Error(`Owned AutoCAD process ${ownedIdentity.processId} remained after F-104 cleanup.`));
    } catch (error) { cleanupErrors.push(error); }
    try { if (!await waitForOriginalProcessSet()) cleanupErrors.push(new Error("F-104 AutoCAD process set was not restored during cleanup.")); }
    catch (error) { cleanupErrors.push(error); }
    try { await removeTemporaryFiles(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-104 cleanup verification failed.");
  }
}

const result = await runMatrix(); const nativePdf = result.independentPdfReadback?.documents?.native; const reopenPdf = result.independentPdfReadback?.documents?.reopen;
const nativePixels = result.renderedPixels?.images?.native; const reopenPixels = result.renderedPixels?.images?.reopen;
const a3 = (document) => {
  const width = document?.pypdf?.mediaBox?.[2]; const height = document?.pypdf?.mediaBox?.[3];
  return Number.isFinite(width) && Number.isFinite(height) && Math.abs(Math.min(width, height) - 842) < 0.1 && Math.abs(Math.max(width, height) - 1191) < 0.1;
};
if (
  result.schemaVersion !== 1 || result.rowId !== "F-104" || !result.engineVersion?.startsWith("24.3") || !result.automationProcessOwned || !result.automationProcessTerminated || !result.processSetRestored ||
  Object.values(result.checks ?? {}).some((value) => value !== true) || result.beforeSave?.viewportCount !== 2 || result.afterReopen?.viewportCount !== 2 ||
  nativePdf?.pypdf?.strictParsed !== false || reopenPdf?.pypdf?.strictParsed !== false || !/Multiple definitions/u.test(nativePdf?.pypdf?.strictError ?? "") || !/Multiple definitions/u.test(reopenPdf?.pypdf?.strictError ?? "") ||
  nativePdf?.pypdf?.pages !== 1 || reopenPdf?.pypdf?.pages !== 1 || !a3(nativePdf) || !a3(reopenPdf) || nativePdf?.pypdf?.imageXObjects !== 0 || reopenPdf?.pypdf?.imageXObjects !== 0 || nativePdf?.pdfplumber?.images !== 0 || reopenPdf?.pdfplumber?.images !== 0 ||
  (nativePdf?.pypdf?.operators?.S ?? 0) < 3 || (reopenPdf?.pypdf?.operators?.S ?? 0) < 3 ||
  nativePixels?.counts?.leftRed <= 0 || nativePixels?.counts?.rightBlue <= 0 || nativePixels?.counts?.black <= 0 || reopenPixels?.counts?.leftRed <= 0 || reopenPixels?.counts?.rightBlue <= 0 || reopenPixels?.counts?.black <= 0 ||
  nativePixels?.width !== reopenPixels?.width || nativePixels?.height !== reopenPixels?.height || JSON.stringify(nativePixels?.counts) !== JSON.stringify(reopenPixels?.counts) ||
  result.dwg?.bytes <= 0 || result.pdf?.bytes <= 0 || result.reopenPdf?.bytes <= 0 || result.userDocument?.isolatedOwnedProcess !== true || result.userDocument?.blankRestored !== true || result.status !== "PASS"
) throw new Error(`F-104 AutoCAD result mismatch: ${JSON.stringify(result)}`);
const finalResult = {
  ...result, scriptSha256: sha256(await readFile(markerPath)), matrixScriptSha256: sha256(await readFile(matrixScriptPath)), runnerScriptSha256: sha256(await readFile(runnerScriptPath)),
  pdfReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f104-pdf.py"))), pixelReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f104-rendered-png.py"))), observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(finalResult, null, 2)}\n`, "utf8");
console.log(`F-104 AutoCAD live PASS (${finalResult.engineVersion}, native A3 two-viewport vector PDF, VPCLIP, DWG reopen, Poppler/pypdf/pdfplumber).`);
