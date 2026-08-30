#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, deserializeKDraw, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-026-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-026-kuubik.kdraw");
const readbackPath = resolve(artifactRoot, "F-026-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const angleClose = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right))) <= tolerance;
const pointClose = (left, right) => close(left?.x, right?.x) && close(left?.y, right?.y);
const sourcePaths = [
  "packages/cad-core/src/break.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/break.test.ts",
  "packages/cad-core/test/f026-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f026-break-roundtrip.test.ts",
  "tools/parity/run-f026-readback.mjs",
];

function applyChanges(document, changes) {
  const output = structuredClone(document);
  for (const change of changes) {
    if (change.type === "delete") output.entities = output.entities.filter((entity) => entity.handle !== change.handle);
    else {
      const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
      if (index >= 0) output.entities[index] = structuredClone(change.entity);
      else output.entities.push(structuredClone(change.entity));
    }
  }
  return output;
}

function schemaSummary(entity) {
  const base = { handle: entity.handle, kind: entity.kind };
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "arc") return { ...base, center: entity.center, radius: entity.radius, startAngleRad: entity.startAngleRad, endAngleRad: entity.endAngleRad, counterClockwise: entity.counterClockwise };
  if (entity.kind === "ellipse") return { ...base, center: entity.center, majorAxis: entity.majorAxis, ratio: entity.ratio, startParameter: entity.startParameter, endParameter: entity.endParameter };
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices };
  if (entity.kind === "spline") return { ...base, degree: entity.degree, controlPoints: entity.controlPoints, knots: entity.knots, weights: entity.weights, closed: entity.closed, periodic: entity.periodic };
  throw new Error(`F-026 schema summary does not support ${entity.kind}.`);
}

function strictEquivalent(expected, actual) {
  if (!actual || expected.kind !== actual.kind || expected.handle !== actual.handle) return false;
  if (expected.kind === "line") return pointClose(expected.start, actual.start) && pointClose(expected.end, actual.end);
  if (expected.kind === "arc") return pointClose(expected.center, actual.center) && close(expected.radius, actual.radius)
    && angleClose(expected.startAngleRad, actual.startAngleRad) && angleClose(expected.endAngleRad, actual.endAngleRad) && actual.counterClockwise === true;
  if (expected.kind === "ellipse") return pointClose(expected.center, actual.center) && pointClose(expected.majorAxis, actual.majorAxis)
    && close(expected.ratio, actual.ratio) && close(expected.startParameter, actual.startParameter) && close(expected.endParameter, actual.endParameter);
  if (expected.kind === "polyline") return expected.closed === actual.closed && JSON.stringify(expected.vertices) === JSON.stringify(actual.vertices);
  if (expected.kind === "spline") return expected.degree === actual.degree && expected.closed === actual.closed && expected.periodic === actual.periodic
    && JSON.stringify(expected.controlPoints) === JSON.stringify(actual.controlPoints)
    && JSON.stringify(expected.knots) === JSON.stringify(actual.knots)
    && JSON.stringify(expected.weights) === JSON.stringify(actual.weights);
  return false;
}

const command = resolveCadCommand("BREAKATPOINT");
if (!command || command.id !== "BREAK") throw new Error("BR/BREAK/BREAKATPOINT is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-026-readback", now: "2026-08-30T06:40:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 }, extensionData: { rowId: "F-026" }, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { kind: "circle", handle: "20", layerId: "0", center: { x: 200, y: 0 }, radius: 50 },
  { kind: "ellipse", handle: "30", layerId: "0", center: { x: 350, y: 0 }, majorAxis: { x: 50, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
  { kind: "polyline", handle: "40", layerId: "0", closed: false, vertices: [{ x: 0, y: 100, startWidth: 2, endWidth: 4 }, { x: 100, y: 100, startWidth: 4, endWidth: 6 }, { x: 200, y: 100 }] },
  { kind: "spline", handle: "50", layerId: "0", degree: 3, controlPoints: [{ x: 0, y: 300 }, { x: 100 / 3, y: 300 }, { x: 200 / 3, y: 300 }, { x: 100, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false },
];
const source = structuredClone(document);
const targets = [
  { handle: "10", firstPoint: { x: 50, y: 20 }, mode: "at-point" },
  { handle: "20", firstPoint: { x: 250, y: 0 }, secondPoint: { x: 200, y: 50 }, mode: "two-point" },
  { handle: "30", firstPoint: { x: 400, y: 0 }, secondPoint: { x: 350, y: 25 }, mode: "two-point" },
  { handle: "40", firstPoint: { x: 25, y: 100 }, secondPoint: { x: 175, y: 100 }, mode: "two-point" },
  { handle: "50", firstPoint: { x: 25, y: 300 }, secondPoint: { x: 75, y: 300 }, mode: "two-point" },
];
const result = command.execute(document, { targets });
if (result.rejected.length || result.steps.length !== 5 || result.changes.length !== 8) throw new Error(`F-026 production BREAK setup failed: ${JSON.stringify(result)}`);
const session = new CadSession(document);
session.commit({ opId: "F-026-break", baseRevision: 0, commandId: "BREAK", args: { targets, steps: result.steps, multiple: result.multiple }, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes, "2026-08-30T06:40:01.000Z");
const committed = structuredClone(session.document);
const independentlyApplied = applyChanges(source, result.changes);
if (JSON.stringify(committed.entities) !== JSON.stringify(independentlyApplied.entities)) throw new Error("F-026 session commit differs from independently applied changes.");

const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-026 DXF skipped outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-026-strict", now: "2026-08-30T06:40:02.000Z" });
if (strict.report.skipped.length || strict.report.warnings.length) throw new Error(`F-026 strict import warnings: ${JSON.stringify(strict.report)}`);
const strictChecks = committed.entities.map((entity) => {
  const actual = strict.document.entities.find((candidate) => candidate.handle === entity.handle);
  return { handle: entity.handle, expected: schemaSummary(entity), actual: actual ? schemaSummary(actual) : null, pass: strictEquivalent(entity, actual) };
});
if (strictChecks.some(({ pass }) => !pass)) throw new Error(`F-026 strict semantic mismatch: ${JSON.stringify(strictChecks)}`);

const independent = new DxfParser().parseSync(exported.text);
if (!independent) throw new Error("Independent F-026 DXF parser returned no document.");
const independentTypes = independent.entities.map((entity) => `${entity.handle}:${entity.type}`);
const expectedTypes = ["10:LINE", "20:ARC", "30:ELLIPSE", "40:LWPOLYLINE", "50:SPLINE", "51:LINE", "52:LWPOLYLINE", "53:SPLINE"];
if (JSON.stringify(independentTypes) !== JSON.stringify(expectedTypes)) throw new Error(`F-026 independent entity matrix mismatch: ${JSON.stringify(independentTypes)}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-30T06:40:03.000Z");
const restored = await deserializeKDraw(kdrawBytes);
const documentEntry = restored.manifest.entries.find(({ path }) => path === restored.manifest.documentPath);
if (!documentEntry || restored.attachments.size !== 0 || JSON.stringify(restored.document) !== JSON.stringify(committed)) throw new Error("F-026 KDRAW1 read-back mismatch.");

const undo = session.undo("2026-08-30T06:40:04.000Z");
if (!undo || JSON.stringify(session.document.entities) !== JSON.stringify(source.entities)) throw new Error("F-026 atomic Undo did not restore the exact source entities.");
const redo = session.redo("2026-08-30T06:40:05.000Z");
if (!redo || JSON.stringify(session.document.entities) !== JSON.stringify(committed.entities)) throw new Error("F-026 atomic Redo did not restore the exact committed entities.");

const closedAtPoint = command.execute(source, { targets: [{ handle: "20", firstPoint: { x: 250, y: 0 }, mode: "at-point" }] });
if (closedAtPoint.changes.length || closedAtPoint.rejected[0]?.reason !== "closed-at-point") throw new Error(`F-026 closed at-point refusal mismatch: ${JSON.stringify(closedAtPoint)}`);

const report = {
  schemaVersion: 1,
  rowId: "F-026",
  source: "production BREAKATPOINT alias -> BREAK registry -> immutable atomic commit -> production DXF/KDRAW1 -> strict importer + dxf-parser -> Undo/Redo",
  observedAt: new Date().toISOString(),
  status: "PASS",
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  command: { targets, result },
  sourceDocument: source,
  output: { schema: committed.entities.map(schemaSummary), strictChecks, independentTypes },
  closedAtPoint,
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: documentEntry.sha256, manifestEntryCount: restored.manifest.entries.length, attachmentCount: restored.attachments.size },
  undoRedo: { undo: Boolean(undo), redo: Boolean(redo), exactSourceRestored: true, exactCommittedRestored: true },
};
await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-026 production BREAK/BREAKATPOINT DXF/KDRAW1 independent read-back with atomic Undo/Redo PASS.");
