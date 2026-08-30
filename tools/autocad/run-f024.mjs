#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { exactDirectFamilyGeometry } from "./f024-dxf-verifier.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f024-standard-matrix.ps1");
const physicalInputPath = resolve(root, "tools/autocad/f022-shift-click.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f024.mjs");
const runnerTestPath = resolve(root, "tools/autocad/f024-runner.test.mjs");
const verifierPath = resolve(root, "tools/autocad/f024-dxf-verifier.mjs");
const expectedPath = resolve(root, "parity/expected/F-024.json");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-024-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F024-"));
const pidPath = resolve(tempRoot, "F024.pid");
const dxfOutputPath = resolve(tempRoot, "F024-autocad-output.dxf");
const parametricSourcePath = resolve(root, "evidence/artifacts/F-024-browser-parametric-source.dxf");
const parametricWorkingPath = resolve(tempRoot, "F024-browser-parametric-source.dxf");
const parametricOutputPath = resolve(tempRoot, "F024-autocad-parametric-output.dxf");
const ownershipToken = randomUUID();
const expected = JSON.parse(await readFile(expectedPath, "utf8"));

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((first, second) => first - second) : [];
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
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for F-024 AutoCAD termination.`);
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
  const start = output.indexOf("{"); const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(output.slice(start, end + 1)); } catch { return null; }
}

function dxfLayerTypes(bytes) {
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  const result = {};
  for (const entity of parsed?.entities ?? []) {
    const layer = entity.layer ?? "0";
    result[layer] ??= {};
    result[layer][entity.type] = (result[layer][entity.type] ?? 0) + 1;
  }
  return result;
}

function dxfRecordPairs(bytes, type, handle) {
  const lines = bytes.toString("utf8").replace(/\r/gu, "").split("\n");
  for (let index = 0; index + 3 < lines.length; index += 2) {
    if (lines[index]?.trim() !== "0" || lines[index + 1]?.trim() !== type) continue;
    const pairs = [];
    for (let pairIndex = index + 2; pairIndex + 1 < lines.length; pairIndex += 2) {
      const code = Number(lines[pairIndex]?.trim()); const value = lines[pairIndex + 1]?.trim() ?? "";
      if (code === 0) break;
      pairs.push([code, value]);
    }
    if (pairs.some(([code, value]) => code === 5 && value === handle)) return pairs;
  }
  return [];
}

function dxfLayerEntities(bytes, selectedLayers) {
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  return Object.fromEntries(selectedLayers.map((layer) => [layer, (parsed?.entities ?? [])
    .filter((entity) => (entity.layer ?? "0") === layer)
    .map((entity) => {
      const pairs = dxfRecordPairs(bytes, entity.type, entity.handle);
      const groupNumber = (code) => {
        const value = pairs.find(([groupCode]) => groupCode === code)?.[1];
        return value === undefined ? undefined : Number(value);
      };
      return {
      handle: entity.handle,
      type: entity.type,
      layer,
      vertices: entity.vertices?.map(({ x, y, bulge, startWidth, endWidth }) => ({ x, y, bulge: bulge ?? 0, startWidth: startWidth ?? 0, endWidth: endWidth ?? 0 })),
      closed: Boolean(entity.shape),
      center: entity.center === undefined ? undefined : { x: entity.center.x, y: entity.center.y },
      radius: entity.radius,
      startAngle: entity.startAngle,
      endAngle: entity.endAngle,
      majorAxis: entity.majorAxisEndPoint === undefined ? undefined : { x: entity.majorAxisEndPoint.x, y: entity.majorAxisEndPoint.y },
      ratio: entity.axisRatio,
      startTangent: entity.startTangent === undefined ? undefined : { x: entity.startTangent.x, y: entity.startTangent.y },
      endTangent: entity.endTangent === undefined ? undefined : { x: entity.endTangent.x, y: entity.endTangent.y },
      degree: entity.degreeOfSplineCurve,
      fitPoints: entity.fitPoints?.map(({ x, y }) => ({ x, y })),
      controlPoints: entity.controlPoints?.map(({ x, y }) => ({ x, y })),
      knots: entity.knotValues,
      weights: entity.type === "SPLINE" ? pairs.filter(([code]) => code === 41).map(([, value]) => Number(value)) : undefined,
      colorNumber: entity.colorNumber ?? groupNumber(62),
      lineweight: entity.lineweight ?? groupNumber(370),
      };
    })]));
}

function dxfRawLayerRecords(bytes, selectedLayers) {
  const selected = new Set(selectedLayers);
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
    .filter((candidate) => candidate.groups["8"] === layer && ["RAY", "XLINE"].includes(candidate.type))
    .map((candidate) => ({ handle: candidate.groups["5"], type: candidate.type, groups: candidate.groups }))]));
}

function sameLayerTypes(actual, expected) {
  const actualEntries = Object.entries(actual ?? {}).toSorted(([first], [second]) => first.localeCompare(second));
  const expectedEntries = Object.entries(expected ?? {}).toSorted(([first], [second]) => first.localeCompare(second));
  if (actualEntries.length !== expectedEntries.length) return false;
  return actualEntries.every(([type, count], index) => type === expectedEntries[index][0] && count === expectedEntries[index][1]);
}

const near = (actual, expected, tolerance = 1e-6) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const samePoint = (actual, expected) => near(actual?.x, expected[0]) && near(actual?.y, expected[1]);
const sameLine = (entity, first, second) => entity?.type === "LINE" && entity.vertices?.length === 2
  && ((samePoint(entity.vertices[0], first) && samePoint(entity.vertices[1], second))
    || (samePoint(entity.vertices[0], second) && samePoint(entity.vertices[1], first)));
const normalizedAngle = (angle) => ((angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
const sameAngle = (actual, expected) => near(normalizedAngle(actual), normalizedAngle(expected));
const sameList = (actual, expected, tolerance = 1e-6) => Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
  && actual.every((value, index) => Array.isArray(value) ? sameList(value, expected[index], tolerance) : near(value, expected[index], tolerance));
const normalizedWeights = (weights) => Array.isArray(weights) && weights.length > 0 && Math.abs(weights[0]) > 1e-12
  ? weights.map((weight) => weight / weights[0]) : null;
const splinePoint = (spline, fraction) => {
  const { degree, controlPoints, knots, weights } = spline ?? {};
  if (!Number.isInteger(degree) || !Array.isArray(controlPoints) || !Array.isArray(knots) || !Array.isArray(weights)
    || controlPoints.length !== weights.length || knots.length !== controlPoints.length + degree + 1) return null;
  const last = controlPoints.length - 1; const start = knots[degree]; const end = knots[last + 1]; const parameter = start + (end - start) * fraction;
  let span = last;
  if (parameter < end) { span = degree; while (span < last && !(parameter >= knots[span] && parameter < knots[span + 1])) span += 1; }
  const values = Array.from({ length: degree + 1 }, (_, index) => {
    const sourceIndex = span - degree + index; const point = controlPoints[sourceIndex]; const weight = weights[sourceIndex];
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  for (let level = 1; level <= degree; level += 1) for (let index = degree; index >= level; index -= 1) {
    const sourceIndex = span - degree + index; const denominator = knots[sourceIndex + degree - level + 1] - knots[sourceIndex];
    const alpha = denominator === 0 ? 0 : (parameter - knots[sourceIndex]) / denominator; const before = values[index - 1]; const current = values[index];
    values[index] = { x: before.x * (1 - alpha) + current.x * alpha, y: before.y * (1 - alpha) + current.y * alpha, weight: before.weight * (1 - alpha) + current.weight * alpha };
  }
  const result = values[degree]; return result && Math.abs(result.weight) > 1e-12 ? [result.x / result.weight, result.y / result.weight] : null;
};
const splineProbes = (spline) => [0, 0.25, 0.5, 0.75, 1].map((fraction) => splinePoint(spline, fraction));
const sameArc = (entity, center, radius) => entity?.type === "ARC" && samePoint(entity.center, center)
  && near(entity.radius, radius) && sameAngle(entity.startAngle, 3 * Math.PI / 2) && sameAngle(entity.endAngle, 0);

function exactConstructionGeometry(readback) {
  const entities = readback.selectedLayerEntities;
  const raw = readback.selectedRawConstructionRecords;
  const oneLineArc = (layer, lineStart, lineEnd, arcCenter) => entities[layer]?.length === 2
    && entities[layer].some((entity) => sameLine(entity, lineStart, lineEnd))
    && entities[layer].some((entity) => sameArc(entity, arcCenter, 10));
  const twoLineArc = (layer, firstStart, firstEnd, secondStart, secondEnd, arcCenter) => entities[layer]?.length === 3
    && entities[layer].some((entity) => sameLine(entity, firstStart, firstEnd))
    && entities[layer].some((entity) => sameLine(entity, secondStart, secondEnd))
    && entities[layer].some((entity) => sameArc(entity, arcCenter, 10));
  const rawConstruction = (layer, type, base, direction) => raw[layer]?.length === 1
    && raw[layer][0].type === type
    && near(Number(raw[layer][0].groups["10"]), base[0])
    && near(Number(raw[layer][0].groups["20"]), base[1])
    && near(Number(raw[layer][0].groups["11"]), direction[0])
    && near(Number(raw[layer][0].groups["21"]), direction[1])
    && Number(raw[layer][0].groups["62"]) === 1
    && Number(raw[layer][0].groups["370"]) === 50;
  return twoLineArc("F024_PAIR", [0, 0], [90, 0], [100, 10], [100, 100], [90, 10])
    && twoLineArc("F024_NO_TRIM", [0, 200], [100, 200], [100, 200], [100, 300], [90, 210])
    && twoLineArc("F024_RAY_LINE", [0, 4600], [90, 4600], [100, 4610], [100, 4700], [90, 4610])
    && oneLineArc("F024_XLINE_LINE", [100, 4810], [100, 4900], [90, 4810])
    && oneLineArc("F024_RAY_LINE_NO_TRIM", [100, 5000], [100, 5100], [90, 5010])
    && oneLineArc("F024_XLINE_LINE_NO_TRIM", [100, 5200], [100, 5300], [90, 5210])
    && oneLineArc("F024_RAY_XLINE", [0, 5400], [90, 5400], [90, 5410])
    && raw.F024_RAY_LINE?.length === 0
    && rawConstruction("F024_XLINE_LINE", "RAY", [90, 4800], [-1, 0])
    && rawConstruction("F024_RAY_XLINE", "RAY", [100, 5410], [0, 1])
    && rawConstruction("F024_RAY_LINE_NO_TRIM", "RAY", [0, 5000], [1, 0])
    && rawConstruction("F024_XLINE_LINE_NO_TRIM", "XLINE", [0, 5200], [1, 0]);
}

function exactPolylineGeometry(readback, observations) {
  const layers = readback.selectedLayerEntities ?? {};
  const expectedPolylines = {
    F024_MIXED: { closed: false, vertices: [[0, 400], [90, 400], [100, 410], [100, 500]], bulges: [0, Math.tan(Math.PI / 8), 0, 0], widths: [[2, 3.8], [3.8, 3.8], [3.8, 3.8], [3.8, 3.8]] },
    F024_ADJACENT: { closed: true, vertices: [[0, 600], [90, 600], [100, 610], [100, 700], [0, 700]], bulges: [0, Math.tan(Math.PI / 8), 0, 0, 0] },
    F024_ARC_ZERO: { closed: true, vertices: [[0, 800], [150, 800], [150, 950], [0, 950]], bulges: [0, 0, 0, 0] },
    F024_OPEN_CLOSE: { closed: true, vertices: [[0, 1196.492189406418], [0, 1100], [100, 1100], [17.808688094430, 1202.739139881962]], bulges: [0, 0, 0, 0.708958225374] },
    F024_FPA0: { closed: false, vertices: [[0, 1400], [150, 1400], [160, 1410], [160, 1540]], bulges: [0, Math.tan(Math.PI / 8), 0, 0] },
    F024_FPA1: { closed: false, vertices: [[300, 1400], [397.972826303728, 1400], [401.957808971661, 1400.828309145213], [459.171690854788, 1458.04219102834], [460, 1462.02717369627], [460, 1540]], bulges: [0, 0.102829884701, 0.189997598761, 0.1028298847, 0, 0] },
    F024_FPA0_NO_TRIM: { closed: false, vertices: [[600, 1400], [700, 1400], [760, 1460], [760, 1540], [660, 1540]], bulges: [0, Math.tan(Math.PI / 8), 0, 0, 0] },
    F024_POLY_NO_TRIM: { closed: true, vertices: [[300, 600], [400, 600], [400, 700], [300, 700]], bulges: [0, 0, 0, 0] },
  };
  const expectedArcCenters = {
    F024_FPA0_NO_TRIM: [[750, 1530], [750, 1410]],
    F024_POLY_NO_TRIM: [[310, 610], [310, 690], [390, 690], [390, 610]],
  };
  const observedEntities = Object.values(observations ?? {}).flatMap((value) => (Array.isArray(value) ? value : [value])).filter((entity) => entity?.layer);
  return Object.entries(expectedPolylines).every(([layer, expected]) => {
    const entities = layers[layer] ?? []; const polyline = entities.find((entity) => entity.type === "LWPOLYLINE");
    const vertices = polyline?.vertices?.map(({ x, y }) => [x, y]); const bulges = polyline?.vertices?.map(({ bulge }) => bulge ?? 0);
    const widths = polyline?.vertices?.map(({ startWidth, endWidth }) => [startWidth ?? 0, endWidth ?? 0]);
    const wantedWidths = expected.widths ?? expected.vertices.map(() => [0, 0]);
    const arcs = entities.filter((entity) => entity.type === "ARC"); const wantedCenters = expectedArcCenters[layer] ?? [];
    const observed = observedEntities.find((entity) => entity.layer === layer && entity.objectName === "AcDbPolyline");
    return polyline?.layer === layer && polyline.closed === expected.closed && sameList(vertices, expected.vertices)
      && sameList(bulges, expected.bulges) && sameList(widths, wantedWidths)
      && /^[A-F0-9]+$/u.test(polyline.handle ?? "") && observed?.handle === polyline.handle
      && entities.every((entity) => entity.layer === layer && entity.colorNumber === 1 && entity.lineweight === 50 && /^[A-F0-9]+$/u.test(entity.handle ?? ""))
      && arcs.length === wantedCenters.length && wantedCenters.every((center) => arcs.some((arc) => samePoint(arc.center, center) && near(arc.radius, 10)));
  });
}

function exactParametricGeometry(readback, sourceReadback) {
  const entities = readback.selectedLayerEntities?.["0"] ?? [];
  const sourceSpline = sourceReadback?.spline;
  const outputSpline = entities.find((entity) => entity.type === "SPLINE");
  const expectedSourceSpline = { degree: 3, controlPoints: [{ x: 300, y: 200 }, { x: 300, y: 240 }, { x: 360, y: 260 }, { x: 400, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 2, 3, 4] };
  const expectedOutputSpline = { degree: 3, controlPoints: [{ x: 300.695133809593, y: 208.281263088522 }, { x: 306.627520424038, y: 242.283597454257 }, { x: 362.00443483552, y: 262.00443483552 }, { x: 400, y: 300 }], knots: [0.038059957570955, 0.038059957570955, 0.038059957570955, 0.038059957570955, 1, 1, 1, 1], weights: [1.114179872713, 2.076119915142, 3.038059957571, 4] };
  const sameSpline = (actual, expected) => actual?.degree === expected.degree
    && sameList(actual.controlPoints?.map(({ x, y }) => [x, y]), expected.controlPoints.map(({ x, y }) => [x, y]))
    && sameList(actual.knots, expected.knots) && sameList(normalizedWeights(actual.weights), normalizedWeights(expected.weights))
    && sameList(splineProbes(actual), splineProbes(expected));
  return entities.length === 6
    && entities.filter((entity) => entity.type === "LINE").length === 2
    && entities.filter((entity) => entity.type === "ELLIPSE").length === 1
    && entities.filter((entity) => entity.type === "SPLINE").length === 1
    && entities.filter((entity) => entity.type === "ARC").length === 2
    && entities.some((entity) => sameLine(entity, [-200, 0], [-8.557770070555, 0]))
    && entities.some((entity) => sameLine(entity, [100, 200], [290.843943859683, 200]))
    && entities.some((entity) => entity.type === "ARC" && samePoint(entity.center, [-8.557770070476, 10.000000000267]) && near(entity.radius, 10))
    && entities.some((entity) => entity.type === "ARC" && samePoint(entity.center, [290.843943859646, 209.999999999777]) && near(entity.radius, 10))
    && sameSpline(sourceSpline, expectedSourceSpline) && sameSpline(outputSpline, expectedOutputSpline)
    && new Set(sourceSpline?.weights ?? []).size > 1 && new Set(outputSpline?.weights ?? []).size > 1;
}

async function runMatrix() {
  const timeoutMs = 300_000;
  let sidecar = null;
  let primaryError = null;
  try {
    await copyFile(parametricSourcePath, parametricWorkingPath);
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken, "-DxfOutputPath", dxfOutputPath, "-ParametricDxfInputPath", parametricWorkingPath, "-ParametricDxfOutputPath", parametricOutputPath], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = []; const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
        catch { child.kill(); }
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
    if (childResult.timedOut) throw new Error(`AutoCAD F-024 matrix exceeded ${timeoutMs / 1_000} seconds; authenticated PID=${processId || "missing"}; progress=${JSON.stringify(childResult.output || childResult.errorText || "no stage output")}.`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-024 matrix exited ${childResult.code} after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored, checks: matrix?.checks, observations: matrix?.observations })}: ${childResult.errorText || childResult.output}`);
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-024 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    if (!matrix) throw new Error("F-024 PowerShell output did not contain valid JSON.");
    if (matrix.automationProcessId !== processId || !identityMatches(sidecar, { processId: matrix.automationProcessIdentity?.processId, executablePath: sidecar.executablePath, startTimeUtc: sidecar.startTimeUtc })) throw new Error("F-024 PID sidecar and COM process identity disagreed.");
    const dxfBytes = await readFile(dxfOutputPath);
    const parametricSourceDxfBytes = await readFile(parametricSourcePath);
    const parametricDxfBytes = await readFile(parametricOutputPath);
    const parametricSourceEntities = dxfLayerEntities(parametricSourceDxfBytes, ["0"])["0"] ?? [];
    return {
      ...matrix,
      automationProcessTerminated,
      processSetRestored,
      preExistingProcessIds,
      dxfReadback: {
        sha256: sha256(dxfBytes),
        layerTypes: dxfLayerTypes(dxfBytes),
        selectedLayerEntities: dxfLayerEntities(dxfBytes, [
          "F024_MIXED",
          "F024_ADJACENT",
          "F024_ARC_ZERO",
          "F024_OPEN_CLOSE",
          "F024_FPA0",
          "F024_FPA1",
          "F024_FPA0_NO_TRIM",
          "F024_POLY_NO_TRIM",
          "F024_PAIR",
          "F024_NO_TRIM",
          "F024_LINE_CIRCLE",
          "F024_LINE_ARC",
          "F024_LINE_CIRCLE_TRIM",
          "F024_LINE_ELLIPSE",
          "F024_LINE_SPLINE",
          "F024_RAY_LINE",
          "F024_XLINE_LINE",
          "F024_RAY_LINE_NO_TRIM",
          "F024_XLINE_LINE_NO_TRIM",
          "F024_RAY_XLINE",
        ]),
        selectedRawConstructionRecords: dxfRawLayerRecords(dxfBytes, [
          "F024_RAY_LINE",
          "F024_XLINE_LINE",
          "F024_RAY_LINE_NO_TRIM",
          "F024_XLINE_LINE_NO_TRIM",
          "F024_RAY_XLINE",
        ]),
      },
      parametricDxfReadback: {
        sha256: sha256(parametricDxfBytes),
        layerTypes: dxfLayerTypes(parametricDxfBytes),
        selectedLayerEntities: dxfLayerEntities(parametricDxfBytes, ["0"]),
      },
      parametricSourceDxfReadback: {
        sha256: sha256(parametricSourceDxfBytes),
        spline: parametricSourceEntities.find((entity) => entity.type === "SPLINE"),
      },
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      if (!sidecar) sidecar = await ownedSidecar();
      if (!sidecar) {
        const orphanCandidates = newAutomationSidecars();
        if (orphanCandidates.length === 1) sidecar = orphanCandidates[0];
        else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-024 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
      }
      if (sidecar && !await terminate(sidecar)) cleanupErrors.push(new Error(`Owned AutoCAD process ${sidecar.processId} remained after F-024 cleanup.`));
    } catch (error) { cleanupErrors.push(error); }
    try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-024 AutoCAD process set was not restored during cleanup.")); }
    catch (error) { cleanupErrors.push(error); }
    try { await rm(tempRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-024 cleanup verification failed.");
  }
}

const matrix = await runMatrix();
const expectedLayerTypes = {
  F024_PAIR: { LINE: 2, ARC: 1 },
  F024_NO_TRIM: { LINE: 2, ARC: 1 },
  F024_MIXED: { LWPOLYLINE: 1 },
  F024_ADJACENT: { LWPOLYLINE: 1 },
  F024_ARC_ZERO: { LWPOLYLINE: 1 },
  F024_OPEN_CLOSE: { LWPOLYLINE: 1 },
  F024_FPA0: { LWPOLYLINE: 1 },
  F024_FPA1: { LWPOLYLINE: 1 },
  F024_FPA0_NO_TRIM: { LWPOLYLINE: 1, ARC: 2 },
  F024_POLY_NO_TRIM: { LWPOLYLINE: 1, ARC: 4 },
  F024_MULTIPLE: { LINE: 4, ARC: 2 },
  F024_COMMAND_UNDO: { LINE: 4, ARC: 1 },
  F024_GLOBAL_UNDO_REDO: { LINE: 4, ARC: 2 },
  F024_CURRENT_SRC: { LINE: 2, ARC: 1 },
  F024_CROSS_A: { LINE: 1 },
  F024_CROSS_B: { LINE: 1 },
  F024_CROSS_ARC: { ARC: 1 },
  F024_SHIFT: { LINE: 2 },
  F024_LINE_CIRCLE: { LINE: 1, CIRCLE: 1, ARC: 1 },
  F024_LINE_ARC: { LINE: 1, ARC: 2 },
  F024_LINE_CIRCLE_TRIM: { LINE: 1, CIRCLE: 1, ARC: 1 },
  F024_LINE_ELLIPSE: { LINE: 1, ELLIPSE: 1, ARC: 1 },
  F024_LINE_SPLINE: { LINE: 1, SPLINE: 1, ARC: 1 },
  F024_LOCKED: { LINE: 2 },
  F024_OFF: { LINE: 2, ARC: 1 },
  F024_FROZEN: { LINE: 2, ARC: 1 },
  F024_RAY_LINE: { LINE: 2, ARC: 1 },
  F024_XLINE_LINE: { LINE: 1, ARC: 1 },
  F024_RAY_LINE_NO_TRIM: { LINE: 1, ARC: 1 },
  F024_XLINE_LINE_NO_TRIM: { LINE: 1, ARC: 1 },
  F024_RAY_XLINE: { LINE: 1, ARC: 1 },
};
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-024" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.executableName?.toLowerCase() !== "acad.exe"
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0" || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update" || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored
  || Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.cmdNamesAfter !== ""
  || !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
  || matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256
  || matrix.parametricDxfReadback.sha256 !== matrix.parametricDxfOutputSha256
  || Object.entries(expectedLayerTypes).some(([layer, types]) => !sameLayerTypes(matrix.dxfReadback.layerTypes[layer], types))
  || !exactConstructionGeometry(matrix.dxfReadback)
  || !exactDirectFamilyGeometry(matrix.dxfReadback, {
    F024_LINE_CIRCLE: matrix.observations?.lineCircle,
    F024_LINE_ARC: matrix.observations?.lineArc,
    F024_LINE_CIRCLE_TRIM: matrix.observations?.lineCircleTrim,
    F024_LINE_ELLIPSE: matrix.observations?.lineEllipse,
    F024_LINE_SPLINE: matrix.observations?.lineSpline,
  }, expected.autoCad?.directFamilies)
  || !sameLayerTypes(matrix.parametricDxfReadback.layerTypes["0"], { LINE: 2, ELLIPSE: 1, SPLINE: 1, ARC: 2 })
  || !exactPolylineGeometry(matrix.dxfReadback, matrix.observations)
  || !exactParametricGeometry(matrix.parametricDxfReadback, matrix.parametricSourceDxfReadback)
) throw new Error(`F-024 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  implementationSha256: {
    "tools/autocad/f024-standard-matrix.ps1": sha256(await readFile(matrixScriptPath)),
    "tools/autocad/f022-shift-click.ps1": sha256(await readFile(physicalInputPath)),
    "tools/autocad/run-f024.mjs": sha256(await readFile(runnerPath)),
    "tools/autocad/f024-runner.test.mjs": sha256(await readFile(runnerTestPath)),
    "tools/autocad/f024-dxf-verifier.mjs": sha256(await readFile(verifierPath)),
    "parity/expected/F-024.json": sha256(await readFile(expectedPath)),
    "evidence/artifacts/F-024-browser-parametric-source.dxf": sha256(await readFile(parametricSourcePath)),
  },
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-024 AutoCAD desktop live PASS (pair Trim/No Trim, Multiple/Undo/Redo, current-layer output, mixed/same-polyline segments, physical Shift, line/arc/circle/ellipse/spline/RAY/XLINE, FILLETPOLYARC and exact DXF read-back).");
