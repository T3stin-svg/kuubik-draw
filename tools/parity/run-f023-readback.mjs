#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, executeExtend, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-023-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-023-kuubik.kdraw");
const readbackPath = resolve(artifactRoot, "F-023-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-core/test/extend.test.ts",
  "packages/cad-core/test/f023-mutation-proven.test.ts",
  "packages/cad-dxf/test/f023-extend-roundtrip.test.ts",
  "tools/parity/run-f023-readback.mjs",
];

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]));
}

function layerName(documentValue, layerId) {
  const layer = documentValue.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`F-023 read-back cannot resolve layer ${layerId}.`);
  return layer.name;
}

function schemaContract(documentValue, entity) {
  const appearance = entity.appearance?.color === undefined && entity.appearance?.lineweightMm === undefined
    ? undefined
    : { color: entity.appearance?.color, lineweightMm: entity.appearance?.lineweightMm };
  const base = compact({ handle: entity.handle, kind: entity.kind, layer: layerName(documentValue, entity.layerId), appearance });
  switch (entity.kind) {
    case "line": return { ...base, start: entity.start, end: entity.end };
    case "polyline": return { ...base, closed: entity.closed, vertices: entity.vertices.map(compact) };
    case "arc": return { ...base, center: entity.center, radius: entity.radius, startAngleRad: entity.startAngleRad, endAngleRad: entity.endAngleRad, counterClockwise: entity.counterClockwise };
    case "ellipse": return { ...base, center: entity.center, majorAxis: entity.majorAxis, ratio: entity.ratio, startParameter: entity.startParameter, endParameter: entity.endParameter };
    case "spline": return { ...base, degree: entity.degree, controlPoints: entity.controlPoints, knots: entity.knots, ...(entity.weights ? { weights: entity.weights } : {}), closed: entity.closed, periodic: entity.periodic };
    default: throw new Error(`F-023 read-back does not support ${entity.kind}.`);
  }
}

function rawRecords(text) {
  const lines = text.split(/\r?\n/u); const records = []; let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim()); const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed DXF group at line ${index + 1}.`);
    if (code === 0) { if (current) records.push(current); current = { type: value.trim(), groups: [] }; }
    else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.groups.find((group) => group.code === 5)?.value, record]).filter(([handle]) => handle));
}

function rawNumbers(record, code) {
  return record.groups.filter((group) => group.code === code).map((group) => Number(group.value));
}

function point(value) { return { x: value.x, y: value.y }; }

function independentContract(entity, rawRecord) {
  const base = { handle: entity.handle, kind: ({ LINE: "line", LWPOLYLINE: "polyline", ARC: "arc", ELLIPSE: "ellipse", SPLINE: "spline" })[entity.type], layer: entity.layer };
  switch (entity.type) {
    case "LINE": return { ...base, start: point(entity.vertices[0]), end: point(entity.vertices[1]) };
    case "LWPOLYLINE": return { ...base, closed: Boolean(entity.shape), vertices: entity.vertices.map((vertex) => compact({ x: vertex.x, y: vertex.y, bulge: vertex.bulge || undefined, startWidth: vertex.startWidth, endWidth: vertex.endWidth })) };
    case "ARC": return { ...base, center: point(entity.center), radius: entity.radius, startAngleRad: entity.startAngle, endAngleRad: entity.endAngle, counterClockwise: true };
    case "ELLIPSE": return { ...base, center: point(entity.center), majorAxis: point(entity.majorAxisEndPoint), ratio: entity.axisRatio, startParameter: entity.startAngle, endParameter: entity.endAngle };
    case "SPLINE": {
      if (!rawRecord || rawRecord.type !== "SPLINE") throw new Error(`Missing raw SPLINE record ${entity.handle}.`);
      const flags = rawNumbers(rawRecord, 70)[0] ?? 0;
      return { ...base, degree: entity.degreeOfSplineCurve, controlPoints: entity.controlPoints.map(point), knots: entity.knotValues, weights: rawNumbers(rawRecord, 41), closed: (flags & 1) !== 0, periodic: (flags & 2) !== 0 };
    }
    default: throw new Error(`Unsupported independent F-023 type ${entity.type}.`);
  }
}

function withoutAppearance(value) {
  if (Array.isArray(value)) return value.map(withoutAppearance);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "appearance").map(([key, item]) => [key, withoutAppearance(item)]));
}

function mismatch(expected, actual, path = "root", tolerance = 1e-8) {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(expected - actual) <= tolerance ? null : `${path}: ${expected} != ${actual}`;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return `${path}: array shape mismatch`;
    for (let index = 0; index < expected.length; index += 1) { const item = mismatch(expected[index], actual[index], `${path}[${index}]`, tolerance); if (item) return item; }
    return null;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedKeys = Object.keys(expected).sort(); const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return `${path}: keys ${JSON.stringify(expectedKeys)} != ${JSON.stringify(actualKeys)}`;
    for (const key of expectedKeys) { const item = mismatch(expected[key], actual[key], `${path}.${key}`, tolerance); if (item) return item; }
    return null;
  }
  return Object.is(expected, actual) ? null : `${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`;
}

const command = resolveCadCommand("EX");
if (!command || command.id !== "EXTEND") throw new Error("EX/EXTEND is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-023-readback", now: "2026-08-29T12:30:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", lineweightMm: 0.5 }, extensionData: { rowId: "F-023" }, start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
  { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 0, y: 200, startWidth: 2, endWidth: 4 }, { x: 40, y: 200, startWidth: 3, endWidth: 5 }, { x: 80, y: 200 }] },
  { kind: "arc", handle: "12", layerId: "0", center: { x: 0, y: 500 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true },
  { kind: "ellipse", handle: "13", layerId: "0", center: { x: 0, y: 800 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 },
  { kind: "spline", handle: "14", layerId: "0", degree: 3, controlPoints: [{ x: 0, y: 1100 }, { x: 1, y: 1101 }, { x: 2, y: 1101 }, { x: 3, y: 1100 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 2, 2], closed: false, periodic: false },
  { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: -20 }, end: { x: 100, y: 20 } },
  { kind: "line", handle: "21", layerId: "0", start: { x: 100, y: 180 }, end: { x: 100, y: 220 } },
  { kind: "line", handle: "22", layerId: "0", start: { x: -100, y: 480 }, end: { x: -100, y: 520 } },
  { kind: "line", handle: "23", layerId: "0", start: { x: -100, y: 780 }, end: { x: -100, y: 820 } },
  { kind: "line", handle: "24", layerId: "0", start: { x: 6, y: 1090 }, end: { x: 6, y: 1110 } },
];
const source = structuredClone(document);
const result = executeExtend(document, {
  mode: "standard", boundaryEdgeHandles: ["20", "21", "22", "23", "24"],
  targets: [
    { handle: "10", pickPoint: { x: 80, y: 0 } },
    { handle: "11", pickPoint: { x: 80, y: 200 } },
    { handle: "12", pickPoint: { x: 0, y: 600 } },
    { handle: "13", pickPoint: { x: 0, y: 850 } },
    { handle: "14", pickPoint: { x: 3, y: 1100 } },
  ], edgeMode: "no-extend", projectMode: "none",
});
if (result.rejected.length || result.changes.length !== 5) throw new Error(`F-023 command matrix rejected output: ${JSON.stringify(result)}`);
const session = new CadSession(document);
session.commit({ opId: "F-023-readback", baseRevision: 0, commandId: "EXTEND", args: { mode: "standard" }, targetHandles: result.targetHandles, resultHandles: result.resultHandles }, result.changes, "2026-08-29T12:30:01.000Z");
const committed = structuredClone(session.document);
const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-023 DXF skipped outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-023-strict", now: "2026-08-29T12:30:02.000Z" });
if (strict.report.skipped.length) throw new Error(`F-023 strict import skipped outputs: ${JSON.stringify(strict.report.skipped)}`);
const independent = new DxfParser().parseSync(exported.text);
const records = rawRecords(exported.text);
const kdrawBytes = await serializeKDraw(committed, [], "2026-08-29T12:30:03.000Z");
const envelope = JSON.parse(new TextDecoder().decode(kdrawBytes).slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files["document.json"], "base64");
const kdrawDocument = JSON.parse(documentBytes.toString("utf8"));
const expectedSemantics = result.resultHandles.map((handle) => schemaContract(committed, committed.entities.find((entity) => entity.handle === handle)));
const strictSemantics = result.resultHandles.map((handle) => schemaContract(strict.document, strict.document.entities.find((entity) => entity.handle === handle)));
const independentSemantics = result.resultHandles.map((handle) => {
  const entity = independent?.entities.find((item) => item.handle === handle);
  if (!entity) throw new Error(`Independent parser did not return F-023 handle ${handle}.`);
  return independentContract(entity, records.get(handle));
});
const strictMismatch = mismatch(expectedSemantics, strictSemantics);
const independentMismatch = mismatch(withoutAppearance(expectedSemantics), independentSemantics);
const undo = session.undo("2026-08-29T12:30:04.000Z");
const undoState = structuredClone(session.document);
const redo = session.redo("2026-08-29T12:30:05.000Z");
const report = {
  schemaVersion: 1, rowId: "F-023",
  source: "production EXTEND registry -> immutable atomic commit -> production DXF/KDRAW1 -> strict importer + dxf-parser + raw group reader -> atomic Undo/Redo",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  command: result,
  output: { expectedSemantics, strictSemantics, independentSemantics, strictMismatch, independentMismatch },
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: sha256(documentBytes), exactDocument: JSON.stringify(kdrawDocument.entities) === JSON.stringify(committed.entities) },
  undo: { present: Boolean(undo), revision: undoState.revision, restored: JSON.stringify(undoState.entities) === JSON.stringify(source.entities) },
  redo: { present: Boolean(redo), revision: session.document.revision, restored: JSON.stringify(session.document.entities) === JSON.stringify(committed.entities) },
  status: "PASS",
};
if (strictMismatch || independentMismatch || !report.kdraw.exactDocument || !report.undo.present || !report.undo.restored || !report.redo.present || !report.redo.restored) throw new Error(`F-023 independent read-back mismatch: ${JSON.stringify(report)}`);
await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-023 production EXTEND LINE/POLYLINE/ARC/ELLIPSE/rational-SPLINE DXF/KDRAW1 and atomic Undo/Redo read-back PASS.");
