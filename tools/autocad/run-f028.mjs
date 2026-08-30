#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { runOwnedDesktopMatrix, sha256 } from "./owned-desktop-matrix.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f028-standard-matrix.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f028.mjs");
const sharedRunnerPath = resolve(root, "tools/autocad/owned-desktop-matrix.mjs");
const processOwnershipPath = resolve(root, "tools/autocad/process-ownership.mjs");
const sourceDxfPath = resolve(root, "evidence/artifacts/F-028-source.dxf");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-028-autocad-readback.json");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const pointMatches = (actual, expected) => close(actual?.x, expected?.[0]) && close(actual?.y, expected?.[1]);

function dxfSummary(bytes) {
  const text = bytes.toString("utf8");
  const parsed = new DxfParser().parseSync(text);
  const lines = text.replace(/\r/g, "").split("\n");
  const rawRecords = new Map();
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed F-028 AutoCAD DXF group at line ${index + 1}.`);
    if (code === 0) {
      if (current?.handle) rawRecords.set(current.handle, current);
      current = { type: value.trim(), handle: null, groups: [] };
    } else if (current) {
      current.groups.push({ code, value: value.trim() });
      if (code === 5) current.handle = value.trim();
    }
  }
  if (current?.handle) rawRecords.set(current.handle, current);
  const rawValues = (handle, code) => rawRecords.get(handle)?.groups?.filter((group) => group.code === code).map(({ value }) => Number(value)) ?? [];
  return {
    entityCount: parsed?.entities?.length ?? 0,
    entities: (parsed?.entities ?? []).map((entity) => ({
      handle: entity.handle,
      layer: entity.layer,
      type: entity.type,
      colorIndex: entity.colorIndex,
      lineweight: entity.lineweight,
      lineType: entity.lineType ?? "ByLayer",
      closed: entity.type === "LWPOLYLINE" ? entity.shape === true : undefined,
      vertices: entity.vertices?.map(({ x, y, bulge, startWidth, endWidth }) => ({ x, y, bulge: bulge ?? 0, startWidth: startWidth ?? 0, endWidth: endWidth ?? 0 })),
      center: entity.center ? { x: entity.center.x, y: entity.center.y } : undefined,
      radius: entity.radius,
      majorAxisEndPoint: entity.majorAxisEndPoint ? { x: entity.majorAxisEndPoint.x, y: entity.majorAxisEndPoint.y } : undefined,
      axisRatio: entity.axisRatio,
      startAngle: entity.startAngle,
      endAngle: entity.endAngle,
      fitPoints: entity.fitPoints?.map(({ x, y }) => ({ x, y })),
      controlPoints: entity.controlPoints?.map(({ x, y }) => ({ x, y })),
      knots: entity.knotValues,
      weights: rawValues(entity.handle, 41),
      degree: entity.degreeOfSplineCurve,
    })),
  };
}

function dxfEntityMatchesNative(dxf, native) {
  const type = { AcDbLine: "LINE", AcDbArc: "ARC", AcDbPolyline: "LWPOLYLINE", AcDbEllipse: "ELLIPSE", AcDbSpline: "SPLINE" }[native?.objectName];
  const colorIndex = dxf?.colorIndex ?? 256;
  const lineweight = dxf?.lineweight ?? -1;
  if (!dxf || !native || dxf.type !== type || dxf.handle !== native.handle || dxf.layer !== native.layer
    || colorIndex !== native.color || lineweight !== native.lineweight
    || String(dxf.lineType).toLowerCase() !== String(native.linetype).toLowerCase()) return false;
  const details = native.details ?? {};
  if (type === "LINE") return dxf.vertices?.length === 2 && pointMatches(dxf.vertices[0], details.start) && pointMatches(dxf.vertices[1], details.end);
  if (type === "ARC") return pointMatches(dxf.center, details.center) && close(dxf.radius, details.radius)
    && close(dxf.startAngle, details.startAngle) && close(dxf.endAngle, details.endAngle);
  if (type === "LWPOLYLINE") return dxf.closed === details.closed && dxf.vertices?.length === details.vertices?.length
    && dxf.vertices.every((vertex, index) => pointMatches(vertex, details.vertices[index]) && close(vertex.bulge, details.bulges[index])
      && close(vertex.startWidth, details.widths[index][0]) && close(vertex.endWidth, details.widths[index][1]));
  if (type === "ELLIPSE") return pointMatches(dxf.center, details.center) && pointMatches(dxf.majorAxisEndPoint, details.majorAxis)
    && close(dxf.axisRatio, details.ratio) && close(dxf.startAngle, details.startParameter) && close(dxf.endAngle, details.endParameter);
  if (type === "SPLINE") return dxf.degree === details.degree
    && (details.fitPoints?.length ? dxf.fitPoints?.length === details.fitPoints.length && dxf.fitPoints.every((point, index) => pointMatches(point, details.fitPoints[index])) : true)
    && dxf.controlPoints?.length === details.controlPoints?.length && dxf.controlPoints.every((point, index) => pointMatches(point, details.controlPoints[index]))
    && dxf.knots?.length === details.knots?.length && dxf.knots.every((value, index) => close(value, details.knots[index]))
    && dxf.weights?.length === details.weights?.length && dxf.weights.every((value, index) => close(value, details.weights[index]));
  return false;
}

function validateDxf(bytes, matrix) {
  const summary = dxfSummary(bytes);
  const states = matrix?.finalStates ?? [];
  const byHandle = new Map(summary.entities.map((entity) => [entity.handle, entity]));
  return {
    ...summary,
    fullStateMatchesNative: states.length === 14 && summary.entityCount === 14 && byHandle.size === 14
      && states.every((state) => dxfEntityMatchesNative(byHandle.get(state.handle), state)),
  };
}

const matrix = await runOwnedDesktopMatrix({
  rowId: "F-028",
  matrixScriptPath,
  timeoutEnvironmentName: "F028_AUTOCAD_TIMEOUT_MS",
  validateDxf,
  extraArguments: ["-SourceDxfPath", sourceDxfPath],
});
if (matrix.schemaVersion !== 1 || matrix.rowId !== "F-028" || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0" || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update" || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || matrix.status !== "PASS"
  || matrix.sourceDxfSha256 !== sha256(await readFile(sourceDxfPath))
  || Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.cmdNamesAfter !== ""
  || matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256 || matrix.dxfReadback.fullStateMatchesNative !== true) throw new Error(`F-028 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
const report = {
  ...matrix,
  certificationAuthority: true,
  workflow: "owned AutoCAD 2024.1.2 desktop LENGTHEN Delta/Percent/Total/Dynamic/Angle, five-family, command Undo, visibility and atomic Undo/Redo matrix + independently parsed DXF",
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  sharedRunnerSha256: sha256(await readFile(sharedRunnerPath)),
  processOwnershipSha256: sha256(await readFile(processOwnershipPath)),
  sourceDxfArtifact: "evidence/artifacts/F-028-source.dxf",
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`F-028 AutoCAD 2024.1.2 LENGTHEN live matrix PASS; visibility=${matrix.observations.visibility.behavior.map(({ state, behavior }) => `${state}:${behavior}`).join(",")}.`);
