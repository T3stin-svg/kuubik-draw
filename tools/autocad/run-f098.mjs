#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-098.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f098-paper-space.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-098-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temporaryStem = resolve(tmpdir(), `KuubikDraw-F098-${randomUUID()}`);
const ownershipToken = randomUUID();
const temporaryPaths = {
  dwg: `${temporaryStem}.dwg`,
  png: `${temporaryStem}.png`,
  pid: `${temporaryStem}.pid`,
};

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((left, right) => left.processId - right.processId);
}

const preExistingProcesses = acadProcessIdentities();
const preExistingProcessIds = new Set(preExistingProcesses.map(({ processId }) => processId));

function identityMatches(expected, current) {
  return current?.processId === expected?.processId
    && current.executablePath?.toLowerCase() === expected.executablePath?.toLowerCase()
    && current.startTimeUtc === expected.startTimeUtc;
}

function processIdentity(processId) {
  return acadProcessIdentities().find((identity) => identity.processId === processId) ?? null;
}

async function resolveOwnedProcess() {
  try {
    const sidecar = JSON.parse(await readFile(temporaryPaths.pid, "utf8"));
    if (
      sidecar.schemaVersion === 1 && sidecar.owned === true && sidecar.token === ownershipToken &&
      Number.isInteger(sidecar.processId) && sidecar.processId > 0 && !preExistingProcessIds.has(sidecar.processId) &&
      typeof sidecar.executablePath === "string" && sidecar.executablePath.toLowerCase().endsWith("\\acad.exe") &&
      typeof sidecar.startTimeUtc === "string"
    ) return sidecar;
    throw new Error("F-098 PID sidecar did not authenticate an owned AutoCAD process.");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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

async function terminateOwnedProcess(ownership) {
  if (!ownership) return false;
  let current = acadProcessIdentities().find(({ processId }) => processId === ownership.processId);
  if (!current) return true;
  if (!identityMatches(ownership, current)) throw new Error(`F-098 refuses to terminate PID ${ownership.processId}: process identity changed.`);
  try { process.kill(ownership.processId); } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw new Error(`Could not terminate owned AutoCAD process ${ownership.processId}: ${error.message}`);
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    current = acadProcessIdentities().find(({ processId }) => processId === ownership.processId);
    if (!current) return true;
    if (!identityMatches(ownership, current)) throw new Error(`F-098 PID ${ownership.processId} was reused during cleanup.`);
  }
  return false;
}

async function restoredProcessSet() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function removeTemporaryFiles() {
  await Promise.all(Object.values(temporaryPaths).map((path) => rm(path, { force: true })));
}

async function runMatrix() {
  await removeTemporaryFiles();
  let ownership = null;
  let primaryError = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath,
        "-TempDwgPath", temporaryPaths.dwg, "-TempPngPath", temporaryPaths.png,
        "-PidPath", temporaryPaths.pid, "-OwnershipToken", ownershipToken,
      ], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
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
        resolveRun({
          code,
          timedOut,
          output: Buffer.concat(stdout).toString("utf8").trim(),
          errorText: Buffer.concat(stderr).toString("utf8").trim(),
        });
      });
    });
    ownership = await resolveOwnedProcess();
    const automationProcessTerminated = await terminateOwnedProcess(ownership);
    const processSetRestored = await restoredProcessSet();
    if (!ownership || !automationProcessTerminated || !processSetRestored) throw new Error(`F-098 did not restore its owned AutoCAD process: ${JSON.stringify({ processId: ownership?.processId ?? 0, automationProcessTerminated, processSetRestored })}`);
    if (childResult.timedOut) {
      const cleanup = ownership ? "the authenticated owned process was cleaned" : "no unauthenticated native process was terminated";
      throw new Error(`AutoCAD F-098 matrix exceeded the 180 second timeout; ${cleanup}.`);
    }
    if (childResult.code !== 0) throw new Error(`AutoCAD F-098 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    const matrix = JSON.parse(childResult.output.slice(start, end + 1));
    if (matrix.automationProcessId !== ownership.processId || !identityMatches(ownership, matrix.automationProcessIdentity)) throw new Error("AutoCAD sidecar identity and COM read-back disagreed.");
    return { ...matrix, automationProcessTerminated, processSetRestored, preExistingProcessIds: preExistingProcesses.map(({ processId }) => processId) };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (!ownership) {
      try { ownership = await resolveOwnedProcess(); } catch (error) { cleanupErrors.push(error); }
    }
    if (!ownership) {
      try {
        const orphanCandidates = newAutomationSidecars();
        if (orphanCandidates.length === 1) ownership = orphanCandidates[0];
        else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-098 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
      } catch (error) { cleanupErrors.push(error); }
    }
    try { if (ownership && !await terminateOwnedProcess(ownership)) cleanupErrors.push(new Error(`Owned AutoCAD process ${ownership.processId} remained after F-098 cleanup.`)); }
    catch (error) { cleanupErrors.push(error); }
    try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-098 AutoCAD process set was not restored during cleanup.")); }
    catch (error) { cleanupErrors.push(error); }
    try { await removeTemporaryFiles(); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-098 cleanup verification failed.");
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-098" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  !matrix.processSetRestored || matrix.preExistingProcessIds.includes(matrix.automationProcessId) ||
  Object.values(matrix.checks ?? {}).some((value) => value !== true) ||
  matrix.visual?.retained !== false || !/^[a-f0-9]{64}$/.test(matrix.visual?.pngSha256 ?? "") ||
  matrix.dwg?.bytes <= 0 || !/^[a-f0-9]{64}$/.test(matrix.dwg?.sha256 ?? "") || matrix.dwg?.retained !== false ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-098 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-098 AutoCAD live PASS (${result.engineVersion}, positive native paper context, non-retained visible-sheet pixels, DWG reopen).`);
