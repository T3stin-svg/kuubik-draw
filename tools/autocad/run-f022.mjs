#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f022-standard-matrix.ps1");
const shiftHelperPath = resolve(root, "tools/autocad/f022-shift-click.ps1");
const runnerScriptPath = resolve(root, "tools/autocad/run-f022.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-022-autocad-readback.json");
const splineFixturePath = resolve(root, "evidence/artifacts/F-022-browser-spline-source.dxf");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-022.json"), "utf8"));
const sourcePaths = [
  "tools/autocad/f022-standard-matrix.ps1",
  "tools/autocad/f022-shift-click.ps1",
  "tools/autocad/f022-runner.test.mjs",
  "tools/autocad/run-f022.mjs",
  "tools/autocad/process-ownership.test.mjs",
];
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F022-"));
const pidPath = resolve(tempRoot, "F022.pid");
const splineOutputPath = resolve(tempRoot, "F022-autocad-rational-spline.dxf");
const ownershipToken = randomUUID();

function rawSplineWeights(text) {
  const lines = text.replace(/\r/gu, "").split("\n");
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index].trim(); const value = lines[index + 1].trim();
    if (code === "0") {
      if (current) records.push(current);
      current = value === "SPLINE" ? { handle: null, weights: [] } : null;
      continue;
    }
    if (!current) continue;
    if (code === "5") current.handle = value;
    else if (code === "41") current.weights.push(Number(value));
  }
  if (current) records.push(current);
  return records;
}

function parseSplineDxf(bytes) {
  const text = bytes.toString("utf8");
  const parsed = new DxfParser().parseSync(text);
  const weightsByHandle = new Map(rawSplineWeights(text).map((record) => [record.handle, record.weights]));
  return (parsed?.entities ?? []).filter((entity) => entity.type === "SPLINE").map((entity) => ({
    handle: entity.handle,
    degree: entity.degreeOfSplineCurve,
    knots: entity.knotValues,
    weights: weightsByHandle.get(entity.handle) ?? [],
    controlPoints: entity.controlPoints?.map(({ x, y }) => [x, y]) ?? [],
    rational: entity.rational === true,
  })).sort((left, right) => (left.controlPoints[0]?.[0] ?? 0) - (right.controlPoints[0]?.[0] ?? 0));
}

const splineFixtureBytes = await readFile(splineFixturePath);
const splineFixtureSemantics = parseSplineDxf(splineFixtureBytes);
if (
  splineFixtureSemantics.length !== 1 || splineFixtureSemantics[0].degree !== 3
  || JSON.stringify(splineFixtureSemantics[0].knots) !== JSON.stringify([0, 0, 0, 0, 1, 1, 1, 1])
  || JSON.stringify(splineFixtureSemantics[0].weights) !== JSON.stringify([2, 2, 2, 2])
) throw new Error(`F-022 browser rational SPLINE source fixture mismatch: ${JSON.stringify(splineFixtureSemantics)}`);

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}

const preExistingProcessIds = acadProcessIds();
async function ownedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(pidPath, "utf8"));
    if (
      sidecar.token !== ownershipToken || sidecar.owned !== true || !Number.isInteger(sidecar.processId) || sidecar.processId <= 0
      || typeof sidecar.executablePath !== "string" || !sidecar.executablePath.toLowerCase().endsWith("\\acad.exe")
      || typeof sidecar.startTimeUtc !== "string" || preExistingProcessIds.includes(sidecar.processId)
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

function parseMatrixOutput(output) {
  const start = output.indexOf("{"); const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(output.slice(start, end + 1)); } catch { return null; }
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
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for owned AutoCAD termination.`);
  }
  return false;
}

async function restoredProcessSet() {
  const expected = preExistingProcessIds.join("|");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (acadProcessIds().join("|") === expected) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function runMatrix() {
  let sidecar = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken, "-SplineFixturePath", splineFixturePath, "-SplineOutputPath", splineOutputPath], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = []; const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      let timedOut = false; let forceTimeout;
      const timeout = setTimeout(() => {
        timedOut = true; child.kill();
        forceTimeout = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5_000);
      }, 120_000);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout); clearTimeout(forceTimeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    sidecar = await ownedSidecar();
    const processId = sidecar?.processId ?? 0;
    const automationProcessTerminated = await terminate(sidecar);
    const processSetRestored = await restoredProcessSet();
    if (childResult.timedOut) throw new Error(`AutoCAD F-022 matrix exceeded the 120 second timeout; authenticated PID=${processId || "missing"}; output=${childResult.output || childResult.errorText || "none"}.`);
    if (childResult.code !== 0) {
      const diagnostic = parseMatrixOutput(childResult.output);
      if (diagnostic) {
        throw new Error(`AutoCAD F-022 matrix returned FAIL after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored, options: diagnostic.options, familyChecks: diagnostic.familyChecks, standardBefore: diagnostic.observations?.standardBefore, standardBeforeReadback: diagnostic.observations?.standardBeforeReadback, standard: diagnostic.observations?.standard, standardReadback: diagnostic.observations?.standardReadback, polyline: diagnostic.observations?.familyAfter?.polyline, hatchTarget: diagnostic.observations?.hatchTarget, nestedBlockChildLayerTargets: diagnostic.observations?.nestedBlockChildLayerTargets, rationalSpline: diagnostic.observations?.rationalSpline })}`);
      }
      throw new Error(`AutoCAD F-022 matrix exited ${childResult.code} after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}: ${[childResult.output, childResult.errorText].filter(Boolean).join("\n")}`);
    }
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-022 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    const matrix = parseMatrixOutput(childResult.output);
    if (!matrix) throw new Error("PowerShell output did not contain valid JSON.");
    if (matrix.automationProcessId !== processId || JSON.stringify(matrix.automationProcessIdentity) !== JSON.stringify({
      processId: sidecar.processId,
      executableName: sidecar.executableName,
      executableSha256: sidecar.executableSha256,
      fileVersion: sidecar.fileVersion,
      productVersion: sidecar.productVersion,
      startTimeSha256: sidecar.startTimeSha256,
    })) throw new Error("F-022 PID sidecar, executable/start-time identity and COM read-back disagreed.");
    const splineOutputBytes = await readFile(splineOutputPath);
    return {
      ...matrix,
      automationProcessTerminated,
      processSetRestored,
      preExistingProcessIds,
      rationalSplineDxfReadback: {
        sourceSha256: sha256(splineFixtureBytes),
        outputSha256: sha256(splineOutputBytes),
        splines: parseSplineDxf(splineOutputBytes),
      },
    };
  } finally {
    try { if (!sidecar) sidecar = await ownedSidecar(); if (sidecar) await terminate(sidecar); }
    finally { await rm(tempRoot, { recursive: true, force: true }); }
  }
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-022" || !matrix.engineVersion?.startsWith("24.3") ||
  matrix.automationProcessIdentity?.executableName?.toLowerCase() !== expected.autoCad.executableName
  || matrix.automationProcessIdentity?.fileVersion !== expected.autoCad.executableFileVersion
  || matrix.automationProcessIdentity?.productVersion !== expected.autoCad.executableProductVersion
  || matrix.installedUpdateIdentity?.displayName !== expected.autoCad.installedUpdateDisplayName
  || matrix.installedUpdateIdentity?.displayVersion !== expected.autoCad.installedUpdateDisplayVersion ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || !Number.isInteger(matrix.automationProcessId) ||
  matrix.status !== "PASS" || Object.entries(matrix.options ?? {}).some(([name, value]) => name === "project" ? Object.values(value).some((item) => item !== true) : value !== true) ||
  Object.values(matrix.familyChecks ?? {}).some((value) => value !== true) || matrix.lockedLayer?.behavior !== "refused" || !matrix.lockedLayer?.passed
  || matrix.hiddenLayer?.behavior !== "refused" || !matrix.hiddenLayer?.passed ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored
) throw new Error(`F-022 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  shiftHelperSha256: sha256(await readFile(shiftHelperPath)),
  runnerScriptSha256: sha256(await readFile(runnerScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-022 AutoCAD live PASS (${result.engineVersion}, Standard/Quick/Fence/Crossing/Edge/Erase/Undo/Project, six geometry families including SPLINE, locked-layer refusal).`);
