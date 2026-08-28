#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const markerPath = resolve(root, "parity/autocad/F-107.scr");
const matrixPath = resolve(root, "tools/autocad/f107-page-setups.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f107.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-107-autocad-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ownershipToken = randomUUID();
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F107-"));
const paths = { dwt: resolve(tempRoot, "F107.dwt"), pid: resolve(tempRoot, "F107.pid") };
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
const close = (actual, expected, tolerance = 0.01) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const samePoint = (left, right) => close(left?.x, right?.x) && close(left?.y, right?.y);
const sameMargins = (left, right) => samePoint(left?.lowerLeft, right?.lowerLeft) && samePoint(left?.upperRight, right?.upperRight);
const sameSetup = (left, right, includeName) => (!includeName || left?.name === right?.name) && left?.configName === right?.configName && left?.canonicalMediaName === right?.canonicalMediaName && left?.rotation === right?.rotation && close(left?.paper?.widthMm, right?.paper?.widthMm) && close(left?.paper?.heightMm, right?.paper?.heightMm) && left?.plotType === right?.plotType && left?.paperUnits === right?.paperUnits && left?.useStandardScale === right?.useStandardScale && left?.standardScale === right?.standardScale && close(left?.customScale, right?.customScale, 1e-6) && left?.centerPlot === right?.centerPlot && samePoint(left?.plotOrigin, right?.plotOrigin) && sameMargins(left?.paperMargins, right?.paperMargins) && left?.plotWithLineweights === right?.plotWithLineweights && left?.plotWithPlotStyles === right?.plotWithPlotStyles && left?.styleSheet === right?.styleSheet;

let processId = 0;
try {
  const child = await new Promise((resolveRun, reject) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath, "-TemplatePath", paths.dwt, "-PidPath", paths.pid, "-OwnershipToken", ownershipToken], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = []; let timedOut = false; let force;
    const timeout = setTimeout(() => { timedOut = true; running.kill(); force = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5000); }, 180_000);
    running.stdout.on("data", (chunk) => { stdout.push(chunk); if (process.env.DEBUG_F107 === "1") process.stdout.write(chunk); });
    running.stderr.on("data", (chunk) => { stderr.push(chunk); if (process.env.DEBUG_F107 === "1") process.stderr.write(chunk); });
    running.on("error", reject);
    running.on("close", (code) => { clearTimeout(timeout); clearTimeout(force); resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
  processId = await ownedPid();
  if (child.timedOut) throw new Error(`AutoCAD F-107 matrix timed out; authenticated PID=${processId || "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-107 matrix exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{"); const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-107 PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  if (matrix.automationProcessId !== processId) throw new Error("F-107 PID sidecar and COM read-back disagreed.");
  const automationProcessTerminated = await terminate(processId);
  const processSetRestored = await restoredProcessSet();
  if (
    matrix.status !== "PASS" || !matrix.engineVersion?.startsWith("24.3") || !matrix.automationProcessOwned || !automationProcessTerminated || !processSetRestored ||
    Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.backgroundPlot !== 0 || matrix.dwt?.bytes <= 0 || matrix.dwt?.header !== "AC1032" ||
    matrix.operations?.renameTo !== "F-107 A4 Issue" || matrix.counts?.withDelete !== matrix.counts?.beforeDelete + 1 || matrix.counts?.afterDelete !== matrix.counts?.beforeDelete || matrix.insertionUnits?.saved !== 4 || matrix.insertionUnits?.reopened !== 4 ||
    !sameSetup(matrix.savedSetup, matrix.reopenedSetup, true) || !sameSetup(matrix.savedLayout, matrix.reopenedLayout, false)
  ) throw new Error(`F-107 AutoCAD result mismatch: ${JSON.stringify({ matrix, automationProcessTerminated, processSetRestored })}`);
  const result = {
    ...matrix,
    automationProcessTerminated,
    processSetRestored,
    preExistingProcessIds,
    scriptSha256: sha256(await readFile(markerPath)),
    matrixScriptSha256: sha256(await readFile(matrixPath)),
    runnerScriptSha256: sha256(await readFile(runnerPath)),
    observedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`F-107 AutoCAD live PASS (${result.engineVersion}, named setup CRUD/apply and native DWT reopen).`);
} finally {
  try { if (!(processId > 0)) processId = await ownedPid(); if (processId > 0) await terminate(processId); }
  finally { await rm(tempRoot, { recursive: true, force: true }); }
}
