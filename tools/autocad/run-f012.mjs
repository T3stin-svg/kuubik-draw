#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { runOwnedDesktopMatrix, sha256 } from "./owned-desktop-matrix.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f012-standard-matrix.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f012.mjs");
const sharedRunnerPath = resolve(root, "tools/autocad/owned-desktop-matrix.mjs");
const processOwnershipPath = resolve(root, "tools/autocad/process-ownership.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-012-autocad-readback.json");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const pointMatches = (actual, expected) => close(actual?.x, expected?.[0]) && close(actual?.y, expected?.[1]);

function rawSplineRecords(bytes) {
  const lines = bytes.toString("utf8").replace(/\r/gu, "").split("\n");
  const records = new Map(); let current = null;
  const flush = () => { if (current?.handle) records.set(current.handle, current); };
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10); const value = lines[index + 1].trim();
    if (code === 0) { flush(); current = { type: value, groups: [] }; }
    else if (current) { current.groups.push({ code, value }); if (code === 5) current.handle = value; }
  }
  flush(); return records;
}

function dxfSummary(bytes) {
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  const raw = rawSplineRecords(bytes);
  return {
    entityCount: parsed?.entities?.length ?? 0,
    entities: (parsed?.entities ?? []).map((entity) => ({
      handle: entity.handle,
      layer: entity.layer,
      type: entity.type,
      colorIndex: entity.colorIndex ?? 256,
      lineweight: entity.lineweight ?? -1,
      lineType: entity.lineType ?? "ByLayer",
      flags: Number(raw.get(entity.handle)?.groups.find(({ code }) => code === 70)?.value),
      degree: entity.degreeOfSplineCurve,
      fitPoints: entity.fitPoints?.map(({ x, y }) => ({ x, y })) ?? [],
      controlPoints: entity.controlPoints?.map(({ x, y }) => ({ x, y })) ?? [],
      knots: entity.knotValues ?? [],
      weights: raw.get(entity.handle)?.groups.filter(({ code }) => code === 41).map(({ value }) => Number(value)) ?? [],
    })),
  };
}

function dxfMatchesNative(dxf, native) {
  const details = native?.details ?? {};
  const fitPoints = Array.isArray(details.fitPoints) ? details.fitPoints : [];
  const controlPoints = Array.isArray(details.controlPoints) ? details.controlPoints : [];
  const knots = Array.isArray(details.knots) ? details.knots : [];
  const weights = Array.isArray(details.weights) ? details.weights : [];
  return dxf?.type === "SPLINE" && dxf.handle === native.handle && dxf.layer === native.layer
    && dxf.colorIndex === native.color && dxf.lineweight === native.lineweight
    && String(dxf.lineType).toLowerCase() === String(native.linetype).toLowerCase()
    && dxf.degree === details.degree
    && dxf.fitPoints.length === fitPoints.length && dxf.fitPoints.every((point, index) => pointMatches(point, fitPoints[index]))
    && dxf.controlPoints.length === controlPoints.length && dxf.controlPoints.every((point, index) => pointMatches(point, controlPoints[index]))
    && dxf.knots.length === knots.length && dxf.knots.every((value, index) => close(value, knots[index]))
    && dxf.weights.length === weights.length && dxf.weights.every((value, index) => close(value, weights[index]));
}

function validateDxf(bytes, matrix) {
  const summary = dxfSummary(bytes); const states = matrix?.finalStates ?? [];
  const byHandle = new Map(summary.entities.map((entity) => [entity.handle, entity]));
  return { ...summary, fullStateMatchesNative: states.length === 2 && summary.entityCount === 2 && byHandle.size === 2 && states.every((state) => dxfMatchesNative(byHandle.get(state.handle), state)) };
}

const matrix = await runOwnedDesktopMatrix({ rowId: "F-012", matrixScriptPath, timeoutEnvironmentName: "F012_AUTOCAD_TIMEOUT_MS", validateDxf });
if (matrix.schemaVersion !== 1 || matrix.rowId !== "F-012" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0" || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update" || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || matrix.status !== "PASS"
  || Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.cmdNamesAfter !== ""
  || matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256 || matrix.dxfReadback.fullStateMatchesNative !== true) {
  throw new Error(`F-012 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
}
const report = {
  ...matrix,
  certificationAuthority: true,
  certificationScope: "Fit creation plus Reverse/Open/Close/command-local and global Undo/Redo; graphical CV Delete for open cubic all-index, rational, repeated-knot, minimum cubic degree reduction, open quadratic all-index and one closed-periodic case; SPLINEDIT Join principal Fit SPLINE + coincident LINE C0 path; not the complete F-012 matrix",
  workflow: "owned AutoCAD 2024.1.2 desktop SPLINE/SPLINEDIT prompt matrix + independently parsed DXF",
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  sharedRunnerSha256: sha256(await readFile(sharedRunnerPath)),
  processOwnershipSha256: sha256(await readFile(processOwnershipPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-012 AutoCAD 2024.1.2 owned desktop SPLINE/SPLINEDIT subset PASS.");
