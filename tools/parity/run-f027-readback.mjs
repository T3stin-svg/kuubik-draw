#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, deserializeKDraw, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-027-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-027-kuubik.kdraw");
const readbackPath = resolve(artifactRoot, "F-027-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
};
const exact = (left, right) => JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
const semanticEqual = (left, right) => {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(left), Math.abs(right));
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => semanticEqual(value, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort(); const rightKeys = Object.keys(right).sort();
    return exact(leftKeys, rightKeys) && leftKeys.every((key) => semanticEqual(left[key], right[key]));
  }
  return Object.is(left, right);
};
const sourcePaths = [
  "packages/cad-core/src/stretch.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/stretch.test.ts",
  "packages/cad-core/test/f027-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f027-stretch-roundtrip.test.ts",
  "tools/parity/run-f027-readback.mjs",
];

function schemaSummary(entity) {
  const appearance = entity.appearance ? {
    color: entity.appearance.color,
    colorMethod: entity.appearance.colorMethod,
    ...(entity.appearance.colorMethod === "aci" ? { aciIndex: entity.appearance.aciIndex } : {}),
    linetypeId: entity.appearance.linetypeId,
    lineweightMm: entity.appearance.lineweightMm,
  } : undefined;
  const base = { handle: entity.handle, kind: entity.kind, appearance };
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices };
  if (entity.kind === "circle") return { ...base, center: entity.center, radius: entity.radius };
  if (entity.kind === "arc") return { ...base, center: entity.center, radius: entity.radius, startAngleRad: entity.startAngleRad, endAngleRad: entity.endAngleRad, counterClockwise: entity.counterClockwise };
  if (entity.kind === "ellipse") return { ...base, center: entity.center, majorAxis: entity.majorAxis, ratio: entity.ratio, startParameter: entity.startParameter, endParameter: entity.endParameter };
  if (entity.kind === "spline") return { ...base, degree: entity.degree, controlPoints: entity.controlPoints, knots: entity.knots, weights: entity.weights, closed: entity.closed, periodic: entity.periodic };
  throw new Error(`F-027 schema summary does not support ${entity.kind}.`);
}

function strictEquivalent(expected, actual) {
  return Boolean(actual) && semanticEqual(schemaSummary(expected), schemaSummary(actual));
}

const command = resolveCadCommand("S");
if (!command || command.id !== "STRETCH") throw new Error("S/STRETCH is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-027-readback", now: "2026-08-30T09:40:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 }, extensionData: { rowId: "F-027" } },
  { kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 0, y: 100, bulge: 0.5, startWidth: 2, endWidth: 4 }, { x: 100, y: 100, bulge: -0.25, startWidth: 4, endWidth: 6 }, { x: 200, y: 100, startWidth: 6, endWidth: 8 }], appearance: { color: "#00ff00", colorMethod: "trueColor", lineweightMm: 0.35 } },
  { kind: "circle", handle: "30", layerId: "0", center: { x: 80, y: 50 }, radius: 5 },
  { kind: "spline", handle: "40", layerId: "0", degree: 2, controlPoints: [{ x: 0, y: 300 }, { x: 100, y: 300 }, { x: 200, y: 300 }], knots: [0, 0, 0, 1, 1, 1], weights: [2, 3, 2], closed: false, periodic: false },
  { kind: "arc", handle: "50", layerId: "0", center: { x: 300, y: 500 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
  { kind: "ellipse", handle: "60", layerId: "0", center: { x: 600, y: 500 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI },
  { kind: "ellipse", handle: "61", layerId: "0", center: { x: 1000, y: 500 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 },
];
const source = structuredClone(document);
const regions = [
  { kind: "crossing-window", points: [{ x: 40, y: -20 }, { x: 110, y: 120 }] },
  { kind: "crossing-polygon", points: [{ x: 90, y: 290 }, { x: 110, y: 290 }, { x: 110, y: 310 }, { x: 90, y: 310 }] },
  { kind: "crossing-window", points: [{ x: 390, y: 490 }, { x: 410, y: 510 }] },
  { kind: "crossing-window", points: [{ x: 690, y: 490 }, { x: 710, y: 510 }] },
  { kind: "crossing-window", points: [{ x: 1090, y: 490 }, { x: 1110, y: 510 }] },
];
const basePoint = { x: 0, y: 0 };
const destinationPoint = { x: 25, y: 5 };
const result = command.execute(document, { regions, individualHandles: [], basePoint, destinationPoint });
if (result.rejected.length || result.steps.length !== 7 || result.changes.length !== 7) throw new Error(`F-027 production STRETCH setup failed: ${JSON.stringify(result)}`);
if (!exact(result.stretchedHandles, ["10", "20", "40", "50", "60", "61"]) || !exact(result.movedHandles, ["30"])) throw new Error(`F-027 move/stretch classification mismatch: ${JSON.stringify(result)}`);

const session = new CadSession(document);
session.commit({
  opId: "F-027-stretch",
  baseRevision: 0,
  commandId: "STRETCH",
  args: { regions, basePoint, destinationPoint, delta: result.delta, steps: result.steps },
  targetHandles: result.sourceHandles,
  resultHandles: result.resultHandles,
}, result.changes, "2026-08-30T09:40:01.000Z");
const committed = structuredClone(session.document);

const expected = [
  { ...source.entities[0], end: { x: 125, y: 5 } },
  { ...source.entities[1], vertices: [source.entities[1].vertices[0], { ...source.entities[1].vertices[1], x: 125, y: 105 }, source.entities[1].vertices[2]] },
  { ...source.entities[2], center: { x: 105, y: 55 } },
  { ...source.entities[3], controlPoints: [source.entities[3].controlPoints[0], { x: 125, y: 305 }, source.entities[3].controlPoints[2]] },
  { ...source.entities[4], center: { x: 312.79576031510857, y: 489.1907858201166 }, radius: 113.31249999999996, startAngleRad: 0.13997535741029188, endAngleRad: 3.0460544268329395 },
  { ...source.entities[5], center: { x: 612.5, y: 502.5 }, majorAxis: { x: -112.5, y: -2.5 }, ratio: 0.44433474570293785, startParameter: Math.PI, endParameter: Math.PI * 2 },
  { ...source.entities[6], center: { x: 1009.85200487279, y: 498.92223575775455 }, majorAxis: { x: 115.56484390156925, y: 2.1208819912797856 }, ratio: 0.4447230399796058, startParameter: 0.07719012025199123, endParameter: 1.647986447046888 },
];
if (!exact(committed.entities, expected)) throw new Error(`F-027 committed geometry mismatch: ${JSON.stringify(committed.entities)}`);

const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-027 DXF skipped outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-027-strict", now: "2026-08-30T09:40:02.000Z" });
if (strict.report.skipped.length || strict.report.warnings.length) throw new Error(`F-027 strict import warnings: ${JSON.stringify(strict.report)}`);
const strictChecks = committed.entities.map((entity) => {
  const actual = strict.document.entities.find((candidate) => candidate.handle === entity.handle);
  const actualLayer = actual ? strict.document.layers.find((layer) => layer.id === actual.layerId)?.name : null;
  return { handle: entity.handle, expectedLayer: "0", actualLayer, expected: schemaSummary(entity), actual: actual ? schemaSummary(actual) : null, pass: actualLayer === "0" && strictEquivalent(entity, actual) };
});
if (strictChecks.some(({ pass }) => !pass)) throw new Error(`F-027 strict semantic mismatch: ${JSON.stringify(strictChecks)}`);

const independent = new DxfParser().parseSync(exported.text);
if (!independent) throw new Error("Independent F-027 DXF parser returned no document.");
const independentTypes = independent.entities.map((entity) => `${entity.handle}:${entity.type}`);
if (!exact(independentTypes, ["10:LINE", "20:LWPOLYLINE", "30:CIRCLE", "40:SPLINE", "50:ARC", "60:ELLIPSE", "61:ELLIPSE"])) throw new Error(`F-027 independent entity matrix mismatch: ${JSON.stringify(independentTypes)}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-30T09:40:03.000Z");
const restored = await deserializeKDraw(kdrawBytes);
const documentEntry = restored.manifest.entries.find(({ path }) => path === restored.manifest.documentPath);
if (!documentEntry || restored.attachments.size !== 0 || !exact(restored.document, committed)) throw new Error("F-027 KDRAW1 read-back mismatch.");

const undo = session.undo("2026-08-30T09:40:04.000Z");
if (!undo || !exact(session.document.entities, source.entities)) throw new Error("F-027 atomic Undo did not restore the exact source entities.");
const redo = session.redo("2026-08-30T09:40:05.000Z");
if (!redo || !exact(session.document.entities, committed.entities)) throw new Error("F-027 atomic Redo did not restore the exact committed entities.");

const zeroDelta = command.execute(source, { regions, individualHandles: [], basePoint, destinationPoint: basePoint });
if (zeroDelta.changes.length !== 0 || zeroDelta.rejected.length !== 7 || zeroDelta.rejected.some(({ reason }) => reason !== "no-op")) {
  throw new Error(`F-027 zero-displacement refusal mismatch: ${JSON.stringify(zeroDelta)}`);
}

const report = {
  schemaVersion: 1,
  rowId: "F-027",
  source: "production S/STRETCH registry -> crossing-window/polygon union -> immutable atomic commit -> production DXF/KDRAW1 -> strict importer + dxf-parser -> Undo/Redo",
  observedAt: new Date().toISOString(),
  status: "PASS",
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  command: { regions, basePoint, destinationPoint, result },
  sourceDocument: source,
  output: { schema: committed.entities.map(schemaSummary), strictChecks, independentTypes },
  zeroDelta,
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: documentEntry.sha256, manifestEntryCount: restored.manifest.entries.length, attachmentCount: restored.attachments.size },
  undoRedo: { undo: Boolean(undo), redo: Boolean(redo), exactSourceRestored: true, exactCommittedRestored: true },
};
await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-027 production STRETCH DXF/KDRAW1 independent read-back with atomic Undo/Redo PASS.");
