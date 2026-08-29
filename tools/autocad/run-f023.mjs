#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f023-standard-matrix.ps1");
const shiftHelperPath = resolve(root, "tools/autocad/f022-shift-click.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f023.mjs");
const coreRunnerPath = resolve(root, "tools/autocad/run-f023-core.mjs");
const coreScriptPath = resolve(root, "parity/autocad/F-023-core.scr");
const sourcePath = resolve(root, "evidence/artifacts/F-023-browser-spline-source.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-023-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F023-"));
const pidPath = resolve(tempRoot, "F023.pid");
const splineOutputPath = resolve(tempRoot, "F023-autocad-rational-spline.dxf");
const ownershipToken = randomUUID();

function rawSplineWeights(text) {
  const lines = text.replace(/\r/gu, "").split("\n");
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index].trim();
    const value = lines[index + 1].trim();
    if (code === "0") {
      if (current) records.push(current);
      current = value === "SPLINE" ? { handle: null, weights: [] } : null;
    } else if (current && code === "5") current.handle = value;
    else if (current && code === "41") current.weights.push(Number(value));
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.handle, record.weights]));
}

function splineSemantics(bytes) {
  const text = bytes.toString("utf8");
  const parsed = new DxfParser().parseSync(text);
  const weights = rawSplineWeights(text);
  return (parsed?.entities ?? []).filter((entity) => entity.type === "SPLINE").map((entity) => ({
    handle: entity.handle,
    degree: entity.degreeOfSplineCurve,
    controlPoints: entity.controlPoints?.map(({ x, y }) => [x, y]) ?? [],
    knots: entity.knotValues ?? [],
    weights: weights.get(entity.handle) ?? [],
    rational: entity.rational === true,
  }));
}

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
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for F-023 AutoCAD termination.`);
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
function parseMatrixOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(output.slice(start, end + 1)); } catch { return null; }
}

async function runMatrix() {
  const matrixTimeoutMs = 300_000;
  let sidecar = null;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken, "-SplineFixturePath", sourcePath, "-SplineOutputPath", splineOutputPath], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      let timedOut = false;
      let forceTimeout;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        forceTimeout = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5_000);
      }, matrixTimeoutMs);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout);
        clearTimeout(forceTimeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    sidecar = await ownedSidecar();
    const processId = sidecar?.processId ?? 0;
    const automationProcessTerminated = await terminate(sidecar);
    const processSetRestored = await restoredProcessSet();
    if (childResult.timedOut) throw new Error(`AutoCAD F-023 matrix exceeded the ${matrixTimeoutMs / 1_000} second timeout; authenticated PID=${processId || "missing"}; trace=${childResult.output || childResult.errorText || "none"}.`);
    if (childResult.code !== 0) {
      const diagnostic = parseMatrixOutput(childResult.output);
      throw new Error(`AutoCAD F-023 matrix exited ${childResult.code} after cleanup ${JSON.stringify({
        processId, automationProcessTerminated, processSetRestored,
        options: diagnostic?.options, familyChecks: diagnostic?.familyChecks, propertiesPreserved: diagnostic?.propertiesPreserved,
        failingObservations: diagnostic ? {
          edgeExtend: diagnostic.observations?.edgeExtend,
          erase: diagnostic.observations?.erase,
          eraseExtra: diagnostic.observations?.eraseExtra,
          crossing: diagnostic.observations?.crossing,
          rationalSpline: diagnostic.observations?.rationalSpline,
        } : null,
      })}: ${childResult.errorText || (diagnostic ? "matrix returned FAIL" : childResult.output)}`);
    }
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-023 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    const matrix = parseMatrixOutput(childResult.output);
    if (!matrix) throw new Error("F-023 PowerShell output did not contain valid JSON.");
    if (matrix.automationProcessId !== processId || !identityMatches(sidecar, {
      processId: matrix.automationProcessIdentity?.processId,
      executablePath: sidecar.executablePath,
      startTimeUtc: sidecar.startTimeUtc,
    })) throw new Error("F-023 PID sidecar and COM process identity disagreed.");
    const sourceBytes = await readFile(sourcePath);
    const outputBytes = await readFile(splineOutputPath);
    return {
      ...matrix,
      automationProcessTerminated,
      processSetRestored,
      preExistingProcessIds,
      rationalSplineDxfReadback: {
        sourceSha256: sha256(sourceBytes),
        outputSha256: sha256(outputBytes),
        source: splineSemantics(sourceBytes),
        output: splineSemantics(outputBytes),
      },
    };
  } finally {
    try { if (!sidecar) sidecar = await ownedSidecar(); if (sidecar) await terminate(sidecar); }
    finally { await rm(tempRoot, { recursive: true, force: true }); }
  }
}

const matrix = await runMatrix();
const sourceSpline = matrix.rationalSplineDxfReadback.source[0];
const outputSpline = matrix.rationalSplineDxfReadback.output[0];
const allOptions = (options) => Object.entries(options).every(([name, value]) => name === "project" ? Object.values(value).every(Boolean) : value === true);
const near = (left, right, tolerance = 1e-8) => Math.abs(left - right) <= tolerance;
const nearList = (left, right) => Array.isArray(left) && left.length === right.length && left.every((value, index) => Array.isArray(value) ? nearList(value, right[index]) : near(value, right[index]));
const rationalObservation = matrix.observations?.rationalSpline;
const distanceProbeExpected = [
  [3.5, 1.145570855244561, -0.5316437171331599],
  [4, 1.2641342932078607, -1.1037985601882103],
  [5, 1.4589819430910724, -2.311527085363394],
  [6, 1.6213349275426874, -3.5679976086859684],
  [8, 1.8923225166531834, -6.161516225020227],
  [10, 2.1207132101943484, -8.818930184708481],
];
const distanceProbePassed = Array.isArray(rationalObservation?.boundaryDistanceProbe)
  && rationalObservation.boundaryDistanceProbe.length === distanceProbeExpected.length
  && rationalObservation.boundaryDistanceProbe.every((probe, index) => {
    const expected = distanceProbeExpected[index]; const details = probe.after?.details;
    return expected && near(probe.boundaryX, expected[0]) && near(details?.knots?.at(-1), expected[1])
      && near(details?.controlPoints?.at(-1)?.[0], expected[0]) && near(details?.controlPoints?.at(-1)?.[1], expected[2]);
  });
const shapeProbeExpected = {
  "equal-weights": { controls: [[4, -1], [5, -3], [6, -5.8333333333333375]], knot: 2.0000000000000004, weights: [1, 1, 1, 1, 1, 1, 1] },
  "weight-ramp": { controls: [[4.111739571363378, -1.1117395713633784], [5.086149712222842, -3.184785156254157], [5.999999999999999, -5.681749712721087]], knot: 2.4823194284845047, weights: [1, 2, 3, 4, 4, 4, 4] },
  "changed-curvature": { controls: [[3.619904037091053, 0.6199040370910531], [4.624089089383892, 2.3926511197874634], [6.000000000000001, 5.280575777453684]], knot: 1.6199040370910531, weights: [1, 1, 2, 2, 2, 2, 2] },
};
const shapeProbePassed = Array.isArray(rationalObservation?.shapeProbe)
  && rationalObservation.shapeProbe.length === Object.keys(shapeProbeExpected).length
  && rationalObservation.shapeProbe.every((probe) => {
    const expected = shapeProbeExpected[probe.name]; const details = probe.after?.details;
    return expected && nearList(details?.controlPoints?.slice(-3), expected.controls)
      && near(details?.knots?.at(-1), expected.knot) && nearList(details?.weights, expected.weights);
  });
const startProbePassed = nearList(rationalObservation?.startEndpointProbe?.details?.controlPoints?.slice(0, 3), [
  [-0.2000000000000003, -0.23753137589750417],
  [-0.1458162162570558, -0.1583542505983361],
  [-0.07917712529916805, -0.07917712529916805],
]) && near(rationalObservation?.startEndpointProbe?.details?.knots?.[0], -0.07917712529916805)
  && nearList(rationalObservation?.startEndpointProbe?.details?.weights, [1, 1, 1, 1, 1, 2, 2]);
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-023" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.executableName?.toLowerCase() !== "acad.exe"
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0"
  || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update"
  || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored
  || !allOptions(matrix.options ?? {}) || Object.values(matrix.familyChecks ?? {}).some((value) => value !== true)
  || !matrix.propertiesPreserved || matrix.lockedLayer?.behavior !== "refused" || matrix.hiddenLayer?.behavior !== "refused"
  || matrix.cmdNamesAfter !== "" || !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
  || matrix.rationalSplineDxfReadback.source.length !== 1 || matrix.rationalSplineDxfReadback.output.length !== 1
  || JSON.stringify(sourceSpline?.controlPoints) !== JSON.stringify([[0, 0], [1, 1], [2, 1], [3, 0]])
  || JSON.stringify(sourceSpline?.knots) !== JSON.stringify([0, 0, 0, 0, 1, 1, 1, 1])
  || JSON.stringify(sourceSpline?.weights) !== JSON.stringify([1, 1, 2, 2])
  || !nearList(outputSpline?.controlPoints, [[0, 0], [1, 1], [2, 1], [3, 0], [3.621334927542687, -0.621334927542687], [4.628726947269851, -1.82175549336209], [6, -3.567997608685968]])
  || !nearList(outputSpline?.knots, [0, 0, 0, 0, 1, 1, 1, 1.621334927542687, 1.621334927542687, 1.621334927542687, 1.621334927542687])
  || JSON.stringify(outputSpline?.weights) !== JSON.stringify([1, 1, 2, 2, 2, 2, 2])
  || !distanceProbePassed || !shapeProbePassed || !startProbePassed
) throw new Error(`F-023 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const sourcePaths = ["tools/autocad/f023-standard-matrix.ps1", "tools/autocad/f022-shift-click.ps1", "tools/autocad/run-f023.mjs", "tools/autocad/run-f023-core.mjs", "parity/autocad/F-023-core.scr", "tools/autocad/f023-runner.test.mjs", "tools/autocad/process-ownership.test.mjs"];
const result = {
  ...matrix,
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  shiftHelperSha256: sha256(await readFile(shiftHelperPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  coreRunnerSha256: sha256(await readFile(coreRunnerPath)),
  coreScriptSha256: sha256(await readFile(coreScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-023 AutoCAD desktop live PASS (Standard/Quick/options/families/physical Shift-Trim/rational SPLINE DXF read-back).");
