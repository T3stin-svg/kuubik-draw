#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { planAuthenticatedCleanup, processIdentitySetsEqual } from "./process-ownership.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f029-standard-matrix.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f029.mjs");
const processOwnershipPath = resolve(root, "tools/autocad/process-ownership.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-029-autocad-readback.json");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F029-"));
const pidPath = resolve(tempRoot, "F029.pid");
const dxfOutputPath = resolve(tempRoot, "F029-autocad.dxf");
const ownershipToken = randomUUID();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const pointMatches = (actual, expected) => close(actual?.x, expected?.[0]) && close(actual?.y, expected?.[1]);
const pointsMatch = (actual, expected) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
  && actual.every((point, index) => pointMatches(point, expected[index]));
const numbersMatch = (actual, expected) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
  && actual.every((value, index) => close(value, expected[index]));
function normalizeWeights(values) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(values[0]) || Math.abs(values[0]) <= 1e-12) return null;
  return values.map((value) => value / values[0]);
}
function rawEntityRecords(text) {
  const lines = text.replace(/\r/gu, "").split("\n"); const records = []; let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim()); const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed F-029 AutoCAD DXF group at line ${index + 1}.`);
    if (code === 0) { if (current) records.push(current); current = { type: value.trim(), groups: [] }; }
    else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.groups.find(({ code }) => code === 5)?.value, record]).filter(([handle]) => handle));
}
const rawValues = (record, code) => record?.groups?.filter((group) => group.code === code).map(({ value }) => value) ?? [];

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((a, b) => a.processId - b.processId);
}
function processIdentity(processId) {
  const script = `$process=Get-Process -Id ${processId} -ErrorAction SilentlyContinue; if($process){[ordered]@{processId=[int]$process.Id;executablePath=[IO.Path]::GetFullPath([string]$process.Path);startTimeUtc=$process.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress};exit 0`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : null;
}
const preExistingProcesses = acadProcessIdentities();
const preExistingProcessIds = new Set(preExistingProcesses.map(({ processId }) => processId));
function newAutomationProcesses() {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !preExistingProcessIds.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId))).filter(Boolean);
}
async function ownedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(pidPath, "utf8"));
    if (sidecar.token !== ownershipToken || sidecar.owned !== true || !Number.isInteger(sidecar.processId) || sidecar.processId <= 0
      || preExistingProcessIds.has(sidecar.processId) || sidecar.executableName?.toLowerCase() !== "acad.exe"
      || typeof sidecar.executablePath !== "string" || !sidecar.executablePath.toLowerCase().endsWith("\\acad.exe")
      || typeof sidecar.startTimeUtc !== "string" || !/^[a-f0-9]{64}$/u.test(sidecar.executableSha256 ?? "")
      || !/^[a-f0-9]{64}$/u.test(sidecar.startTimeSha256 ?? "")) return null;
    return sidecar;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function identityMatches(expected, current) {
  return current?.processId === expected.processId && current.executablePath?.toLowerCase() === expected.executablePath.toLowerCase()
    && current.startTimeUtc === expected.startTimeUtc;
}
async function terminate(sidecar) {
  if (!sidecar) return false;
  let current = processIdentity(sidecar.processId); if (!current) return true;
  if (!identityMatches(sidecar, current)) throw new Error(`Refusing to terminate PID ${sidecar.processId}: identity changed.`);
  try { process.kill(sidecar.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100)); current = processIdentity(sidecar.processId);
    if (!current) return true;
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused during F-029 cleanup.`);
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
function dxfSummary(bytes) {
  const text = bytes.toString("utf8"); const parsed = new DxfParser().parseSync(text); const rawByHandle = rawEntityRecords(text);
  return {
    entityCount: parsed?.entities?.length ?? 0,
    entities: (parsed?.entities ?? []).map((entity) => ({
      handle: entity.handle, layer: entity.layer, type: entity.type, colorIndex: entity.colorIndex,
      lineweight: entity.lineweight, lineType: entity.lineType ?? "ByLayer",
      vertices: entity.vertices?.map(({ x, y, bulge, startWidth, endWidth }) => ({ x, y, bulge: bulge ?? 0, startWidth: startWidth ?? 0, endWidth: endWidth ?? 0 })),
      closed: entity.type === "LWPOLYLINE" ? entity.shape === true : undefined,
      center: entity.center ? { x: entity.center.x, y: entity.center.y } : undefined,
      radius: entity.radius,
      controlPoints: entity.controlPoints?.map(({ x, y }) => ({ x, y })),
      knots: entity.knotValues?.map(Number),
      weights: normalizeWeights(rawValues(rawByHandle.get(entity.handle), 41).map(Number)),
      degree: entity.degreeOfSplineCurve,
      splineFlags: Number(rawValues(rawByHandle.get(entity.handle), 70)[0]) || 0,
      textPoint: entity.startPoint ? { x: entity.startPoint.x, y: entity.startPoint.y } : undefined,
      textHeight: entity.textHeight,
      rotation: entity.rotation,
      text: entity.text,
    })),
  };
}
function dxfEntityMatchesNative(dxf, native) {
  const type = { AcDbLine: "LINE", AcDbCircle: "CIRCLE", AcDbPolyline: "LWPOLYLINE", AcDbSpline: "SPLINE", AcDbText: "TEXT" }[native?.objectName];
  if (!dxf || !native || dxf.type !== type || dxf.handle !== native.handle || dxf.layer !== native.layer
    || dxf.colorIndex !== native.color || dxf.lineweight !== native.lineweight
    || String(dxf.lineType).toLowerCase() !== String(native.linetype).toLowerCase()) return false;
  const details = native.details ?? {};
  if (type === "LINE") return dxf.vertices?.length === 2 && pointMatches(dxf.vertices[0], details.start) && pointMatches(dxf.vertices[1], details.end);
  if (type === "CIRCLE") return pointMatches(dxf.center, details.center) && close(dxf.radius, details.radius);
  if (type === "LWPOLYLINE") return dxf.closed === details.closed && dxf.vertices?.length === details.vertices?.length && dxf.vertices.every((vertex, index) => pointMatches(vertex, details.vertices[index])
    && close(vertex.bulge, details.bulges[index]) && close(vertex.startWidth, details.widths[index][0]) && close(vertex.endWidth, details.widths[index][1]));
  if (type === "SPLINE") return dxf.degree === details.degree && pointsMatch(dxf.controlPoints, details.controlPoints)
    && numbersMatch(dxf.knots, details.knots) && numbersMatch(dxf.weights, details.weights)
    && Boolean(dxf.splineFlags & 1) === details.closed && Boolean(dxf.splineFlags & 2) === details.periodic
    && Boolean(dxf.splineFlags & 4) === details.rational && details.controlPointCount === dxf.controlPoints?.length
    && details.fitPointCount === 0;
  if (type === "TEXT") return pointMatches(dxf.textPoint, details.position) && close(dxf.textHeight, details.height)
    && close((dxf.rotation ?? 0) * Math.PI / 180, details.rotation) && dxf.text === details.text;
  return false;
}
function dxfMatchesAllNativeStates(summary, matrix) {
  const states = matrix?.finalStates ?? [];
  if (states.length !== 11 || summary.entityCount !== 11 || summary.entities.length !== 11) return false;
  const byHandle = new Map(summary.entities.map((entity) => [entity.handle, entity]));
  return byHandle.size === 11 && states.every((state) => dxfEntityMatchesNative(byHandle.get(state.handle), state));
}

async function runMatrix() {
  const timeoutMs = Number(process.env.F029_AUTOCAD_TIMEOUT_MS ?? 300_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 300_000) throw new Error("F029_AUTOCAD_TIMEOUT_MS must be between 30000 and 300000.");
  let sidecar = null; let primaryError = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken, "-DxfOutputPath", dxfOutputPath], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const stdout = []; const stderr = []; let timedOut = false;
      child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
      const timeout = setTimeout(() => { timedOut = true; try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { child.kill(); } }, timeoutMs);
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() }); });
    });
    sidecar = await ownedSidecar(); const processId = sidecar?.processId ?? 0;
    const automationProcessTerminated = await terminate(sidecar); const processSetRestored = await restoredProcessSet(); const matrix = parseMatrixOutput(childResult.output);
    if (childResult.timedOut) throw new Error(`AutoCAD F-029 matrix exceeded ${timeoutMs / 1000}s; PID=${processId || "missing"}; trace=${childResult.output || childResult.errorText}`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-029 matrix exited ${childResult.code} after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored, checks: matrix?.checks })}: ${childResult.errorText || childResult.output}`);
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored || !matrix) throw new Error(`F-029 cleanup/matrix failure: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored, matrix: Boolean(matrix) })}`);
    if (matrix.automationProcessId !== sidecar.processId || matrix.automationProcessIdentity?.processId !== sidecar.processId
      || matrix.automationProcessIdentity?.executableSha256 !== sidecar.executableSha256 || matrix.automationProcessIdentity?.startTimeSha256 !== sidecar.startTimeSha256) throw new Error("F-029 PID sidecar and AutoCAD COM identity disagreed.");
    const dxfBytes = await readFile(dxfOutputPath); const summary = dxfSummary(dxfBytes); summary.fullStateMatchesNative = dxfMatchesAllNativeStates(summary, matrix);
    return { ...matrix, automationProcessTerminated, processSetRestored, preExistingProcesses, dxfReadback: { sha256: sha256(dxfBytes), ...summary } };
  } catch (error) { primaryError = error; throw error; }
  finally {
    const cleanupErrors = [];
    try {
      if (!sidecar) sidecar = await ownedSidecar(); const plan = planAuthenticatedCleanup(sidecar, newAutomationProcesses());
      if (plan.refusedProcessIds.length) cleanupErrors.push(new Error(`F-029 left unauthenticated AutoCAD processes untouched: ${plan.refusedProcessIds.join(", ")}`));
      if (plan.terminate && !await terminate(plan.terminate)) cleanupErrors.push(new Error(`Owned AutoCAD PID ${plan.terminate.processId} remained.`));
    } catch (error) { cleanupErrors.push(error); }
    try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-029 did not restore the exact pre-existing AutoCAD process set.")); } catch (error) { cleanupErrors.push(error); }
    try { await rm(tempRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-029 cleanup verification failed.");
  }
}

const matrix = await runMatrix();
if (matrix.schemaVersion !== 1 || matrix.rowId !== "F-029" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0" || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update" || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || matrix.status !== "PASS"
  || Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.cmdNamesAfter !== ""
  || matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256 || matrix.dxfReadback.fullStateMatchesNative !== true) throw new Error(`F-029 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
const report = {
  ...matrix,
  certificationAuthority: true,
  workflow: "owned AutoCAD 2024.1.2 desktop ALIGN one/two-pair Scale No/Yes, opposite/no-op/locked and atomic Undo/Redo matrix + independently parsed DXF",
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  processOwnershipSha256: sha256(await readFile(processOwnershipPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`F-029 AutoCAD 2024.1.2 ALIGN live matrix PASS; locked behavior=${matrix.observations.locked.behavior}; pre-existing AutoCAD PIDs preserved: ${[...preExistingProcessIds].join(", ") || "none"}.`);
