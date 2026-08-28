#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-100.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f100-viewport-view.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-100-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temporaryStem = resolve(tmpdir(), `KuubikDraw-F100-${randomUUID()}`);
const ownershipToken = randomUUID();
const temporaryPaths = { dwg: `${temporaryStem}.dwg`, bak: `${temporaryStem}.bak`, pid: `${temporaryStem}.pid` };

async function resolveOwnedProcessId() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (sidecar.schemaVersion === 1 && sidecar.owned === true && sidecar.token === ownershipToken && Number.isInteger(sidecar.processId) && sidecar.processId > 0) return sidecar.processId;
    throw new Error("F-100 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function terminateOwnedProcess(processId) {
  if (processId <= 0) return false;
  try { process.kill(processId); } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw new Error(`Could not terminate owned AutoCAD process ${processId}: ${error.message}`);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try { process.kill(processId, 0); } catch { return true; }
  }
  return false;
}

async function removeTemporaryFiles() {
  await Promise.all(Object.values(temporaryPaths).map((path) => rm(path, { force: true })));
}

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], {
    windowsHide: true,
    encoding: "utf8",
  }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0) : [];
}

async function waitForNoResidualAcadProcesses() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (acadProcessIds().length === 0) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function runMatrix() {
  await removeTemporaryFiles();
  let ownedProcessId = 0;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg, "-PidPath", temporaryPaths.pid, "-OwnershipToken", ownershipToken,
      ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = []; const stderr = []; let timedOut = false; let forceTimeout;
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      const timeout = setTimeout(() => {
        timedOut = true; child.kill();
        forceTimeout = setTimeout(() => {
          try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
        }, 5_000);
      }, 180_000);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout); clearTimeout(forceTimeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    ownedProcessId = await resolveOwnedProcessId();
    const automationProcessTerminated = await terminateOwnedProcess(ownedProcessId);
    if (ownedProcessId > 0 && !automationProcessTerminated) throw new Error(`Owned AutoCAD process ${ownedProcessId} remained after F-100.`);
    const noResidualAcadProcesses = await waitForNoResidualAcadProcesses();
    if (!noResidualAcadProcesses) throw new Error(`An AutoCAD process remained after the authenticated F-100 process ${ownedProcessId} terminated.`);
    if (childResult.timedOut) throw new Error(`AutoCAD F-100 matrix exceeded the 180 second timeout; ${ownedProcessId > 0 ? "the authenticated owned process was cleaned" : "no unauthenticated native process was terminated"}.`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-100 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownedProcessId) throw new Error("AutoCAD PID sidecar and COM read-back disagreed.");
    return { ...matrix, automationProcessTerminated, noResidualAcadProcesses };
  } finally {
    try {
      if (ownedProcessId <= 0) ownedProcessId = await resolveOwnedProcessId();
      if (ownedProcessId > 0) await terminateOwnedProcess(ownedProcessId);
    } finally { await removeTemporaryFiles(); }
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-100" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  !matrix.noResidualAcadProcesses ||
  Object.values(matrix.checks ?? {}).some((value) => value !== true) ||
  !Number.isInteger(matrix.oneToTwentyStandardScaleEnum) || matrix.preset?.standardScale !== matrix.oneToTwentyStandardScaleEnum || Math.abs(matrix.preset?.scaleDenominator - 20) > 1e-9 ||
  !matrix.nativeTransform?.authority?.startsWith("AutoCAD Utility.TranslateCoordinates") ||
  Math.abs(matrix.nativeTransform?.normalizedBefore?.x + 0.28) > 1e-8 || Math.abs(matrix.nativeTransform?.normalizedBefore?.y - 0.15) > 1e-8 ||
  Math.abs(matrix.nativeTransform?.normalizedAfter?.x + 0.28) > 1e-8 || Math.abs(matrix.nativeTransform?.normalizedAfter?.y - 0.15) > 1e-8 ||
  Math.abs(matrix.nativeTransform?.axisDevice?.screenSlope + Math.tan(Math.PI / 6)) > 1e-8 ||
  matrix.customPanned?.standardScale !== 1 || Math.abs(matrix.customPanned?.customScale - 0.055) > 1e-9 ||
  Math.abs(matrix.customPanned?.target?.x - matrix.nativeTransform?.pan?.expectedTarget?.x) > 1e-8 ||
  Math.abs(matrix.customPanned?.target?.y - matrix.nativeTransform?.pan?.expectedTarget?.y) > 1e-8 ||
  matrix.dwg?.bytes <= 0 || !/^[a-f0-9]{64}$/.test(matrix.dwg?.sha256 ?? "") || matrix.dwg?.retained !== false ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-100 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = { ...matrix, scriptSha256: sha256(await readFile(scriptPath)), matrixScriptSha256: sha256(await readFile(matrixScriptPath)), observedAt: new Date().toISOString() };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-100 AutoCAD live PASS (${result.engineVersion}, native DisplayDCS cursor zoom/pan/twist, DWG reopen).`);
