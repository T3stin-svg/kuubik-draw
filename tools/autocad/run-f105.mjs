#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const markerPath = resolve(root, "parity/autocad/F-105.scr"); const matrixPath = resolve(root, "tools/autocad/f105-batch-publish.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f105.mjs"); const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-105-autocad-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex"); const ownershipToken = randomUUID();
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F105-"));
const paths = { dwg: resolve(tempRoot, "F105.dwg"), pid: resolve(tempRoot, "F105.pid"), output: resolve(tempRoot, "pdf") };
const preExistingProcesses = acadProcessIdentities();
const preExistingProcessIds = new Set(preExistingProcesses.map(({ processId }) => processId));

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((a, b) => a.processId - b.processId);
}
function identityMatches(expected, current) {
  return current?.processId === expected?.processId
    && current.executablePath?.toLowerCase() === expected.executablePath?.toLowerCase()
    && current.startTimeUtc === expected.startTimeUtc;
}
function processIdentity(processId) {
  return acadProcessIdentities().find((identity) => identity.processId === processId) ?? null;
}
async function ownedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(paths.pid, "utf8"));
    if (
      sidecar.token === ownershipToken && sidecar.owned === true && Number.isInteger(sidecar.processId) && sidecar.processId > 0 &&
      !preExistingProcessIds.has(sidecar.processId) && typeof sidecar.executablePath === "string" &&
      sidecar.executablePath.toLowerCase().endsWith("\\acad.exe") && typeof sidecar.startTimeUtc === "string"
    ) return sidecar;
    throw new Error("F-105 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function newAutomationSidecars() {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !preExistingProcessIds.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}
async function terminate(ownership) {
  if (!ownership) return false;
  let current = acadProcessIdentities().find(({ processId }) => processId === ownership.processId);
  if (!current) return true;
  if (!identityMatches(ownership, current)) throw new Error(`F-105 refuses to terminate PID ${ownership.processId}: process identity changed.`);
  try { process.kill(ownership.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    current = acadProcessIdentities().find(({ processId }) => processId === ownership.processId);
    if (!current) return true;
    if (!identityMatches(ownership, current)) throw new Error(`F-105 PID ${ownership.processId} was reused during cleanup.`);
  }
  return false;
}
async function restoredProcessSet() {
  for (let attempt = 0; attempt < 100; attempt += 1) { if (JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)) return true; await new Promise((done) => setTimeout(done, 100)); }
  return false;
}

let ownership = null;
let primaryError = null;
try {
  const child = await new Promise((resolveRun, reject) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath,
      "-TempDwgPath", paths.dwg, "-OutputDirectory", paths.output, "-PidPath", paths.pid, "-OwnershipToken", ownershipToken,
    ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = []; let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { running.kill(); }
    }, 180_000);
    running.stdout.on("data", (chunk) => stdout.push(chunk)); running.stderr.on("data", (chunk) => stderr.push(chunk));
    running.on("error", (error) => { clearTimeout(timeout); reject(error); });
    running.on("close", (code) => { clearTimeout(timeout); resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
  ownership = await ownedSidecar();
  if (child.timedOut) throw new Error(`AutoCAD F-105 matrix timed out; authenticated PID=${ownership?.processId ?? "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-105 matrix exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{"); const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-105 PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  if (!ownership || matrix.automationProcessId !== ownership.processId || !identityMatches(ownership, matrix.automationProcessIdentity)) throw new Error("F-105 PID sidecar and COM read-back disagreed.");
  const batchPaths = matrix.batchOutputs.map((entry) => resolve(entry.fullName));
  const excludedPaths = matrix.excludedOutputs.map((entry) => resolve(entry.fullName));
  const bundledPython = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
  const python = process.env.PYTHON_CMD ?? (existsSync(bundledPython) ? bundledPython : "python");
  const labelled = [...batchPaths.map((path, index) => `batch${index + 1}=${path}`), ...excludedPaths.map((path, index) => `excluded${index + 1}=${path}`)];
  const pdfReadback = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-pdf.py"), ...labelled], { windowsHide: true, encoding: "utf8" }));
  const bundledPdftoppm = "C:\\Users\\Olav\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
  const pdftoppm = process.env.PDFTOPPM_CMD ?? (existsSync(bundledPdftoppm) ? bundledPdftoppm : "pdftoppm");
  await mkdir(artifactRoot, { recursive: true });
  const rendered = [];
  for (const [index, path] of batchPaths.entries()) {
    const prefix = resolve(artifactRoot, `F-105-autocad-batch-${index + 1}`); execFileSync(pdftoppm, ["-f", "1", "-singlefile", "-r", "144", "-png", path, prefix], { windowsHide: true, stdio: "pipe" }); rendered.push(`batch${index + 1}=${prefix}.png`);
  }
  const pixels = JSON.parse(execFileSync(python, [resolve(root, "tools/parity/read-f105-rendered-png.py"), ...rendered], { windowsHide: true, encoding: "utf8" }));
  const automationProcessTerminated = await terminate(ownership); const processSetRestored = await restoredProcessSet();
  const documents = pdfReadback.documents; const documentValues = Object.values(documents); const allPages = documentValues.flatMap((document) => document.pageDetails);
  const batchTitles = [documents.batch1?.pageDetails?.[0]?.text ?? "", documents.batch2?.pageDetails?.[0]?.text ?? ""];
  const observedGenerationOrder = batchTitles.map((text) => text.includes("F-105 SHEET 20 PLAN")
    ? "F-105 SHEET 20 PLAN"
    : text.includes("F-105 SHEET 10 SECTION") ? "F-105 SHEET 10 SECTION" : "UNKNOWN");
  if (
    matrix.status !== "PASS" || !matrix.engineVersion?.startsWith("24.3") || matrix.requestedOrder?.join("|") !== "F-105 SHEET 20 PLAN|F-105 SHEET 10 SECTION" ||
    !automationProcessTerminated || !processSetRestored || matrix.batchOutputs?.length !== 2 || matrix.excludedOutputs?.length !== 1 ||
    documentValues.some((document) => document.pages !== 1) || allPages.some((page) => page.imageXObjects !== 0 || page.plumberImages !== 0) ||
    observedGenerationOrder.join("|") !== matrix.requestedOrder.join("|") ||
    !batchTitles[0]?.includes("F-105 SHEET 20 PLAN") || !batchTitles[1]?.includes("F-105 SHEET 10 SECTION") ||
    !documents.excluded1?.pageDetails?.[0]?.text?.includes("F-105 SHEET 20 PLAN") || matrix.dwg?.bytes <= 0
  ) throw new Error(`F-105 AutoCAD result mismatch: ${JSON.stringify({ matrix, pdfReadback, pixels, automationProcessTerminated, processSetRestored })}`);
  const result = {
    ...matrix, observedGenerationOrder, automationProcessTerminated, processSetRestored, preExistingProcessIds: preExistingProcesses.map(({ processId }) => processId), independentPdfReadback: pdfReadback, renderedPixels: pixels,
    scriptSha256: sha256(await readFile(markerPath)), matrixScriptSha256: sha256(await readFile(matrixPath)), runnerScriptSha256: sha256(await readFile(runnerPath)),
    pdfReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f105-pdf.py"))), pixelReaderSha256: sha256(await readFile(resolve(root, "tools/parity/read-f105-rendered-png.py"))), observedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`F-105 AutoCAD live PASS (${result.engineVersion}, ordered batch + excluded layout, native PDFs/DWG, pypdf/pdfplumber/Poppler).`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  if (!ownership) {
    try { ownership = await ownedSidecar(); } catch (error) { cleanupErrors.push(error); }
  }
  if (!ownership) {
    try {
      const orphanCandidates = newAutomationSidecars();
      if (orphanCandidates.length === 1) ownership = orphanCandidates[0];
      else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-105 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
    } catch (error) { cleanupErrors.push(error); }
  }
  try { if (ownership && !await terminate(ownership)) cleanupErrors.push(new Error(`Owned AutoCAD process ${ownership.processId} remained after F-105 cleanup.`)); }
  catch (error) { cleanupErrors.push(error); }
  try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-105 AutoCAD process set was not restored during cleanup.")); }
  catch (error) { cleanupErrors.push(error); }
  try { await rm(tempRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-105 cleanup verification failed.");
}
