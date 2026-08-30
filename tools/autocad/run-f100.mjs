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

async function resolveOwnedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (
      sidecar.schemaVersion === 1 && sidecar.owned === true && sidecar.token === ownershipToken &&
      Number.isInteger(sidecar.processId) && sidecar.processId > 0 && !preExistingProcessIds.has(sidecar.processId) &&
      typeof sidecar.executablePath === "string" && sidecar.executablePath.toLowerCase().endsWith("\\acad.exe") &&
      typeof sidecar.startTimeUtc === "string"
    ) return sidecar;
    throw new Error("F-100 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !preExistingProcessIds.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}

async function terminateOwnedProcess(sidecar) {
  if (!sidecar) return false;
  let current = processIdentity(sidecar.processId);
  if (!current) return true;
  if (!identityMatches(sidecar, current)) throw new Error(`F-100 refuses to terminate PID ${sidecar.processId}: process identity changed.`);
  try { process.kill(sidecar.processId); } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw new Error(`Could not terminate owned AutoCAD process ${sidecar.processId}: ${error.message}`);
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    current = processIdentity(sidecar.processId);
    if (!current) return true;
    if (!identityMatches(sidecar, current)) throw new Error(`F-100 PID ${sidecar.processId} was reused during cleanup.`);
  }
  return false;
}

async function removeTemporaryFiles() {
  await Promise.all(Object.values(temporaryPaths).map((path) => rm(path, { force: true })));
}

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((left, right) => left.processId - right.processId);
}

const preExistingProcesses = acadProcessIdentities();
const preExistingProcessIds = new Set(preExistingProcesses.map(({ processId }) => processId));

async function waitForRestoredProcessSet() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function runMatrix() {
  await removeTemporaryFiles();
  let ownedIdentity = null;
  let primaryError = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg, "-PidPath", temporaryPaths.pid, "-OwnershipToken", ownershipToken,
      ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = []; const stderr = []; let timedOut = false;
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
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
    const automationProcessTerminated = await terminateOwnedProcess(ownedIdentity);
    if (!ownedIdentity || !automationProcessTerminated) throw new Error(`Owned AutoCAD process ${ownedProcessId || "missing"} remained after F-100.`);
    const processSetRestored = await waitForRestoredProcessSet();
    if (!processSetRestored) throw new Error(`The original AutoCAD process set was not restored after authenticated F-100 process ${ownedProcessId} terminated.`);
    if (childResult.timedOut) throw new Error(`AutoCAD F-100 matrix exceeded the 180 second timeout; ${ownedProcessId > 0 ? "the authenticated owned process was cleaned" : "no unauthenticated native process was terminated"}.`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-100 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownedProcessId || !identityMatches(ownedIdentity, matrix.automationProcessIdentity)) throw new Error("AutoCAD sidecar identity and COM read-back disagreed.");
    return { ...matrix, automationProcessTerminated, processSetRestored, preExistingProcessIds: preExistingProcesses.map(({ processId }) => processId) };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (!ownedIdentity) {
      try { ownedIdentity = await resolveOwnedSidecar(); } catch (error) { cleanupErrors.push(error); }
    }
    if (!ownedIdentity) {
      try {
        const orphanCandidates = newAutomationSidecars();
        if (orphanCandidates.length === 1) ownedIdentity = orphanCandidates[0];
        else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-100 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
      } catch (error) { cleanupErrors.push(error); }
    }
    try { if (ownedIdentity && !await terminateOwnedProcess(ownedIdentity)) cleanupErrors.push(new Error(`Owned AutoCAD process ${ownedIdentity.processId} remained after F-100 cleanup.`)); }
    catch (error) { cleanupErrors.push(error); }
    try { if (!await waitForRestoredProcessSet()) cleanupErrors.push(new Error("F-100 AutoCAD process set was not restored during cleanup.")); }
    catch (error) { cleanupErrors.push(error); }
    try { await removeTemporaryFiles(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-100 cleanup verification failed.");
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-100" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  matrix.automationProcessId !== matrix.automationProcessIdentity?.processId ||
  !matrix.processSetRestored || matrix.preExistingProcessIds.includes(matrix.automationProcessId) ||
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
