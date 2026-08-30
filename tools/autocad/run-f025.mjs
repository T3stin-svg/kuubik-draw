#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { planAuthenticatedCleanup, processIdentitySetsEqual } from "./process-ownership.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f025-standard-matrix.ps1");
const escapeHelperPath = resolve(root, "tools/autocad/f022-shift-click.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f025.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-025-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F025-"));
const pidPath = resolve(tempRoot, "F025.pid");
const dxfOutputPath = resolve(tempRoot, "F025-autocad.dxf");
const ownershipToken = randomUUID();

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((first, second) => first.processId - second.processId);
}

function newAutomationProcesses() {
  const existing = preExistingProcessIds;
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !existing.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}

const preExistingProcesses = acadProcessIdentities();
const preExistingProcessIds = new Set(preExistingProcesses.map(({ processId }) => processId));
async function ownedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(pidPath, "utf8"));
    if (
      sidecar.token !== ownershipToken || sidecar.owned !== true || !Number.isInteger(sidecar.processId) || sidecar.processId <= 0
      || typeof sidecar.executablePath !== "string" || !sidecar.executablePath.toLowerCase().endsWith("\\acad.exe")
      || typeof sidecar.startTimeUtc !== "string" || preExistingProcessIds.has(sidecar.processId)
      || sidecar.executableName?.toLowerCase() !== "acad.exe"
      || typeof sidecar.fileVersion !== "string" || typeof sidecar.productVersion !== "string"
      || !/^[a-f0-9]{64}$/u.test(sidecar.executableSha256 ?? "") || !/^[a-f0-9]{64}$/u.test(sidecar.startTimeSha256 ?? "")
    ) return null;
    return sidecar;
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

async function terminate(sidecar) {
  if (!sidecar) return false;
  let current = processIdentity(sidecar.processId);
  if (!current) return true;
  if (!identityMatches(sidecar, current)) throw new Error(`Refusing to terminate PID ${sidecar.processId}: process identity changed after authentication.`);
  try { process.kill(sidecar.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    current = processIdentity(sidecar.processId);
    if (!current) return true;
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for F-025 AutoCAD termination.`);
  }
  return false;
}

async function restoredProcessSet() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processIdentitySetsEqual(preExistingProcesses, acadProcessIdentities())) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

function parseMatrixOutput(output) {
  const start = output.indexOf("{"); const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(output.slice(start, end + 1)); } catch { return null; }
}

function dxfLayerTypes(bytes) {
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  const result = {};
  for (const entity of parsed?.entities ?? []) {
    result[entity.layer] ??= {};
    result[entity.layer][entity.type] = (result[entity.layer][entity.type] ?? 0) + 1;
  }
  return result;
}

function dxfLayerEntities(bytes, selectedLayers) {
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  return Object.fromEntries(selectedLayers.map((layer) => [layer, (parsed?.entities ?? [])
    .filter((entity) => (entity.layer ?? "0") === layer)
    .map((entity) => ({
      handle: entity.handle,
      type: entity.type,
      layer,
      vertices: entity.vertices?.map(({ x, y }) => ({ x, y })),
      basePoint: entity.position === undefined ? undefined : { x: entity.position.x, y: entity.position.y },
      direction: entity.direction === undefined ? undefined : { x: entity.direction.x, y: entity.direction.y },
      colorIndex: entity.colorIndex,
      lineType: entity.lineType,
      lineweight: entity.lineweight,
    }))]));
}

function dxfRawLayerRecords(bytes, selectedLayers) {
  const lines = bytes.toString("utf8").replace(/\r/gu, "").split("\n");
  const records = [];
  let record = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index].trim();
    const value = lines[index + 1].trim();
    if (code === "0") {
      if (record) records.push(record);
      record = { type: value, groups: {} };
      continue;
    }
    if (!record) continue;
    const existing = record.groups[code];
    record.groups[code] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  if (record) records.push(record);
  return Object.fromEntries(selectedLayers.map((layer) => [layer, records
    .filter((candidate) => candidate.groups["8"] === layer)
    .map((candidate) => ({ handle: candidate.groups["5"], type: candidate.type, groups: candidate.groups }))]));
}

async function runMatrix() {
  const timeoutMs = Number(process.env.F025_AUTOCAD_TIMEOUT_MS ?? 300_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 300_000) throw new Error("F025_AUTOCAD_TIMEOUT_MS must be between 30000 and 300000.");
  let sidecar = null;
  let primaryError = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken, "-DxfOutputPath", dxfOutputPath, "-EscapeHelperPath", escapeHelperPath], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = []; const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { child.kill(); }
      }, timeoutMs);
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    sidecar = await ownedSidecar();
    const processId = sidecar?.processId ?? 0;
    const automationProcessTerminated = await terminate(sidecar);
    const processSetRestored = await restoredProcessSet();
    const matrix = parseMatrixOutput(childResult.output);
    if (childResult.timedOut) throw new Error(`AutoCAD F-025 matrix exceeded ${timeoutMs / 1_000} seconds; authenticated PID=${processId || "missing"}; trace=${JSON.stringify(childResult.output || childResult.errorText || "none")}.`);
    if (childResult.code !== 0) {
      const polylineCases = Object.fromEntries(["adjacent", "separated", "openClose"].map((key) => {
        const entity = matrix?.observations?.[key]?.entities?.[0];
        return [key, entity ? { objectName: entity.objectName, closed: entity.details?.closed, vertices: entity.details?.vertices, bulges: entity.details?.bulges } : null];
      }));
      throw new Error(`AutoCAD F-025 matrix exited ${childResult.code} after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored, checks: matrix?.checks, polylineCases, trace: childResult.output })}: ${childResult.errorText || childResult.output}`);
    }
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-025 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    if (!matrix) throw new Error("F-025 PowerShell output did not contain valid JSON.");
    if (matrix.automationProcessId !== processId || !identityMatches(sidecar, { processId: matrix.automationProcessIdentity?.processId, executablePath: sidecar.executablePath, startTimeUtc: sidecar.startTimeUtc })) throw new Error("F-025 PID sidecar and COM process identity disagreed.");
    const dxfBytes = await readFile(dxfOutputPath);
    const selectedLayers = [
      "F025_DISTANCE", "F025_ANGLE", "F025_POLY", "F025_POLY_NOTRIM", "F025_POLY_SHORT", "F025_POLY_OVERLAP", "F025_POLY_OVERLAP_NOTRIM", "F025_POLY_SHORT_NOTRIM", "F025_POLY_ZERO", "F025_ZERO", "F025_PARALLEL",
      "F025_RAY", "F025_RAY_FORWARD", "F025_XLINE_LINE", "F025_RAY_NOTRIM", "F025_ADJACENT", "F025_SEPARATED", "F025_OPEN_CLOSE",
      "F025_SEAM_FORWARD", "F025_SEAM_REVERSE", "F025_PAIR_ZERO", "F025_PAIR_ZERO_SEAM", "F025_PAIR_TOO_SHORT", "F025_SHIFT", "F025_MULTIPLE", "F025_COMMAND_UNDO", "F025_GLOBAL_UNDO_REDO", "F025_CURRENT_SRC", "F025_CURRENT_OUT",
      "F025_CROSS_A", "F025_CROSS_B", "F025_CROSS_OUT", "F025_SAME_PROP", "F025_CROSS_REVERSE_A", "F025_CROSS_REVERSE_B", "F025_CROSS_REVERSE_OUT", "F025_LOCKED", "F025_OFF", "F025_FROZEN",
    ];
    const rawLayerRecords = dxfRawLayerRecords(dxfBytes, selectedLayers);
    return {
      ...matrix,
      automationProcessTerminated,
      processSetRestored,
      preExistingProcesses,
      preExistingProcessIds: [...preExistingProcessIds].toSorted((first, second) => first - second),
      dxfReadback: {
        sha256: sha256(dxfBytes),
        layerTypes: dxfLayerTypes(dxfBytes),
        selectedLayerEntities: dxfLayerEntities(dxfBytes, selectedLayers),
        rawLayerRecords,
        rawConstructionRecords: Object.fromEntries(selectedLayers.map((layer) => [layer, rawLayerRecords[layer].filter(({ type }) => ["RAY", "XLINE"].includes(type))])),
      },
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      if (!sidecar) sidecar = await ownedSidecar();
      const cleanupPlan = planAuthenticatedCleanup(sidecar, newAutomationProcesses());
      if (cleanupPlan.refusedProcessIds.length > 0) cleanupErrors.push(new Error(`F-025 refuses to terminate unauthenticated AutoCAD automation processes and left them untouched: ${cleanupPlan.refusedProcessIds.join(", ")}`));
      if (cleanupPlan.terminate && !await terminate(cleanupPlan.terminate)) cleanupErrors.push(new Error(`Owned AutoCAD process ${cleanupPlan.terminate.processId} remained after F-025 cleanup.`));
    } catch (error) { cleanupErrors.push(error); }
    try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-025 AutoCAD process set was not restored during cleanup.")); } catch (error) { cleanupErrors.push(error); }
    try { await rm(tempRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-025 cleanup verification failed.");
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-025" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.executableName?.toLowerCase() !== "acad.exe"
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0" || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update" || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored
  || Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.cmdNamesAfter !== ""
  || !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
  || matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256
) throw new Error(`F-025 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const sourcePaths = ["tools/autocad/f025-standard-matrix.ps1", "tools/autocad/f022-shift-click.ps1", "tools/autocad/f025-runner.test.mjs", "tools/autocad/process-ownership.mjs", "tools/autocad/run-f025.mjs"];
const result = {
  ...matrix,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-025 AutoCAD desktop live exploratory PASS (Distance/Angle, Trim/No Trim, Polyline, zero, parallel and RAY/XLINE with exact DXF read-back).");
