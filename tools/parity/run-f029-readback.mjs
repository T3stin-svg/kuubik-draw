#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, deserializeKDraw, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-029-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-029-kuubik.kdraw");
const reportPath = resolve(artifactRoot, "F-029-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-10) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/document.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/align.test.ts",
  "packages/cad-core/test/f029-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f029-align-roundtrip.test.ts",
  "tools/parity/run-f029-readback.mjs",
];

function summary(entity) {
  const base = { handle: entity.handle, kind: entity.kind, layerId: entity.layerId, appearance: entity.appearance, extensionData: entity.extensionData };
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "circle") return { ...base, center: entity.center, radius: entity.radius };
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices };
  if (entity.kind === "spline") return { ...base, degree: entity.degree, controlPoints: entity.controlPoints, knots: entity.knots, weights: entity.weights, closed: entity.closed, periodic: entity.periodic };
  if (entity.kind === "text") return { ...base, position: entity.position, height: entity.height, rotationRad: entity.rotationRad, text: entity.text, styleId: entity.styleId };
  throw new Error(`F-029 summary does not support ${entity.kind}.`);
}

function dxfSummary(entity) {
  const appearance = entity.appearance ? {
    color: entity.appearance.color,
    colorMethod: entity.appearance.colorMethod,
    ...(entity.appearance.colorMethod === "aci" ? { aciIndex: entity.appearance.aciIndex } : {}),
    lineweightMm: entity.appearance.lineweightMm,
  } : undefined;
  const base = { handle: entity.handle, kind: entity.kind, appearance };
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "circle") return { ...base, center: entity.center, radius: entity.radius };
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices };
  if (entity.kind === "spline") return { ...base, degree: entity.degree, controlPoints: entity.controlPoints, knots: entity.knots, weights: entity.weights, closed: entity.closed, periodic: entity.periodic };
  if (entity.kind === "text") return { ...base, position: entity.position, height: entity.height, rotationRad: entity.rotationRad, text: entity.text };
  throw new Error(`F-029 DXF summary does not support ${entity.kind}.`);
}

function rawEntityRecords(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const records = []; let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim()); const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed F-029 DXF group at line ${index + 1}.`);
    if (code === 0) { if (current) records.push(current); current = { type: value.trim(), groups: [] }; }
    else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.groups.find(({ code }) => code === 5)?.value, record]).filter(([handle]) => handle));
}

const rawValues = (record, code) => record?.groups?.filter((group) => group.code === code).map(({ value }) => value) ?? [];
const pointsMatch = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && actual.every((point, index) => close(point.x, expected[index].x) && close(point.y, expected[index].y));
const numbersMatch = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && actual.every((value, index) => close(value, expected[index]));

function semanticEqual(left, right) {
  if (typeof left === "number" || typeof right === "number") return typeof left === "number" && typeof right === "number" && close(left, right);
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => semanticEqual(value, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return exact(leftKeys, rightKeys) && leftKeys.every((key) => semanticEqual(left[key], right[key]));
  }
  return Object.is(left, right);
}

const command = resolveCadCommand("AL");
if (!command || command.id !== "ALIGN") throw new Error("AL/ALIGN is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-029-readback", now: "2026-08-30T16:00:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.35 }, extensionData: { rowId: "F-029" } },
  { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 100 }, radius: 25 },
  { kind: "polyline", handle: "30", layerId: "0", closed: true, vertices: [{ x: 0, y: 200, startWidth: 2, endWidth: 4 }, { x: 100, y: 200, bulge: 0.5, startWidth: 4, endWidth: 6 }], appearance: { color: "#00ff00", colorMethod: "trueColor" } },
  { kind: "spline", handle: "40", layerId: "0", degree: 3, controlPoints: [{ x: 0, y: 300 }, { x: 40, y: 380 }, { x: 80, y: 380 }, { x: 120, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false },
  { kind: "text", handle: "50", layerId: "0", position: { x: 0, y: 450 }, height: 10, rotationRad: 0, text: "ALIGN" },
];
const source = structuredClone(document);
const pointPairs = [
  { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 100, y: 200 } },
  { sourcePoint: { x: 100, y: 0 }, destinationPoint: { x: 100, y: 400 } },
];
const result = command.execute(document, { targetHandles: document.entities.map(({ handle }) => handle), pointPairs, scaleToFit: true });
if (result.rejected.length || result.changes.length !== 5 || !close(result.angleRad, Math.PI / 2) || !close(result.scaleFactor, 2)) {
  throw new Error(`F-029 production ALIGN setup failed: ${JSON.stringify(result)}`);
}
const expected = [
  { ...source.entities[0], start: { x: 100, y: 200 }, end: { x: 100, y: 400 } },
  { ...source.entities[1], center: { x: -100, y: 200 }, radius: 50 },
  { ...source.entities[2], vertices: [{ x: -300, y: 200, startWidth: 4, endWidth: 8 }, { x: -300, y: 400, bulge: 0.5, startWidth: 8, endWidth: 12 }] },
  { ...source.entities[3], controlPoints: [{ x: -500, y: 200 }, { x: -660, y: 280 }, { x: -660, y: 360 }, { x: -500, y: 440 }] },
  { ...source.entities[4], position: { x: -800, y: 200 }, height: 20, rotationRad: Math.PI / 2 },
];
const session = new CadSession(document);
session.commit({
  opId: "F-029-align",
  baseRevision: 0,
  commandId: "ALIGN",
  args: { targetHandles: result.sourceHandles, pointPairs, pointPairCount: result.pointPairCount, scaleToFit: result.scaleToFit, angleRad: result.angleRad, scaleFactor: result.scaleFactor },
  targetHandles: result.sourceHandles,
  resultHandles: result.resultHandles,
}, result.changes, "2026-08-30T16:00:01.000Z");
const committed = structuredClone(session.document);
if (!semanticEqual(committed.entities.map(summary), expected.map(summary))) throw new Error(`F-029 committed geometry mismatch: ${JSON.stringify(committed.entities)}`);

const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-029 DXF skipped output: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-029-strict", now: "2026-08-30T16:00:02.000Z" });
if (strict.report.skipped.length || strict.report.warnings.length || strict.document.entities.length !== expected.length) throw new Error(`F-029 strict DXF read-back failed: ${JSON.stringify(strict.report)}`);
const strictChecks = expected.map((entity) => {
  const actual = strict.document.entities.find(({ handle }) => handle === entity.handle);
  const actualLayer = actual ? strict.document.layers.find(({ id }) => id === actual.layerId)?.name : null;
  const expectedStyle = entity.kind === "text"
    ? (committed.textStyles.find(({ id }) => id === entity.styleId)?.name ?? "Standard")
    : null;
  const actualStyle = actual?.kind === "text"
    ? strict.document.textStyles.find(({ id }) => id === actual.styleId)?.name
    : null;
  return {
    handle: entity.handle,
    expectedLayer: "0",
    actualLayer,
    expectedStyle,
    actualStyle,
    expected: dxfSummary(entity),
    actual: actual ? dxfSummary(actual) : null,
    pass: actualLayer === "0" && expectedStyle === actualStyle && Boolean(actual) && semanticEqual(dxfSummary(entity), dxfSummary(actual)),
  };
});
if (strictChecks.some(({ pass }) => !pass)) throw new Error(`F-029 strict semantic mismatch: ${JSON.stringify(strictChecks)}`);
const independent = new DxfParser().parseSync(exported.text);
const independentTypes = independent?.entities?.map((entity) => `${entity.handle}:${entity.type}`) ?? [];
if (!exact(independentTypes, ["10:LINE", "20:CIRCLE", "30:LWPOLYLINE", "40:SPLINE", "50:TEXT"])) throw new Error(`F-029 independent DXF entity matrix mismatch: ${JSON.stringify(independentTypes)}`);
const independentByHandle = Object.fromEntries(independent.entities.map((entity) => [entity.handle, entity]));
const rawByHandle = rawEntityRecords(exported.text);
const independentChecks = {
  layers: independent.entities.every(({ layer }) => layer === "0"),
  line: pointsMatch(independentByHandle["10"]?.vertices, [{ x: 100, y: 200 }, { x: 100, y: 400 }])
    && independentByHandle["10"]?.colorIndex === 1 && independentByHandle["10"]?.lineweight === 35,
  circle: close(independentByHandle["20"]?.center?.x, -100) && close(independentByHandle["20"]?.center?.y, 200)
    && close(independentByHandle["20"]?.radius, 50),
  polyline: independentByHandle["30"]?.shape === true
    && pointsMatch(independentByHandle["30"]?.vertices, [{ x: -300, y: 200 }, { x: -300, y: 400 }])
    && close(independentByHandle["30"]?.vertices?.[0]?.startWidth, 4)
    && close(independentByHandle["30"]?.vertices?.[0]?.endWidth, 8)
    && close(independentByHandle["30"]?.vertices?.[1]?.startWidth, 8)
    && close(independentByHandle["30"]?.vertices?.[1]?.endWidth, 12)
    && close(independentByHandle["30"]?.vertices?.[1]?.bulge, 0.5)
    && independentByHandle["30"]?.color === 0x00ff00,
  spline: independentByHandle["40"]?.degreeOfSplineCurve === 3
    && pointsMatch(independentByHandle["40"]?.controlPoints, expected[3].controlPoints)
    && numbersMatch(independentByHandle["40"]?.knotValues, expected[3].knots)
    && numbersMatch(rawValues(rawByHandle.get("40"), 41).map(Number), expected[3].weights)
    && ((Number(rawValues(rawByHandle.get("40"), 70)[0]) || 0) & 3) === 0,
  text: close(independentByHandle["50"]?.startPoint?.x, -800)
    && close(independentByHandle["50"]?.startPoint?.y, 200)
    && close(independentByHandle["50"]?.textHeight, 20)
    && close(independentByHandle["50"]?.rotation, 90)
    && independentByHandle["50"]?.text === "ALIGN"
    && rawValues(rawByHandle.get("50"), 7)[0]?.toUpperCase() === "STANDARD",
};
if (Object.values(independentChecks).some((pass) => !pass)) throw new Error(`F-029 independent DXF semantic mismatch: ${JSON.stringify(independentChecks)}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-30T16:00:03.000Z");
const restored = await deserializeKDraw(kdrawBytes);
const documentEntry = restored.manifest.entries.find(({ path }) => path === restored.manifest.documentPath);
if (!documentEntry || restored.attachments.size || !exact(restored.document, committed)) throw new Error("F-029 KDRAW1 read-back mismatch.");
const undo = session.undo("2026-08-30T16:00:04.000Z");
if (!undo || !exact(session.document.entities, source.entities)) throw new Error("F-029 atomic Undo did not restore source entities.");
const redo = session.redo("2026-08-30T16:00:05.000Z");
if (!redo || !semanticEqual(session.document.entities.map(summary), expected.map(summary))) throw new Error("F-029 atomic Redo did not restore committed entities.");

const translation = command.execute(source, { targetHandles: ["10"], pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 50, y: 25 } }], scaleToFit: true });
const noOp = command.execute(source, { targetHandles: ["10"], pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 0, y: 0 } }], scaleToFit: false });
if (!exact(translation.changes[0]?.entity?.start, { x: 50, y: 25 }) || translation.scaleToFit || noOp.changes.length || !exact(noOp.noChangeHandles, ["10"])) throw new Error("F-029 one-pair/no-op contract mismatch.");

const report = {
  schemaVersion: 1,
  rowId: "F-029",
  status: "PASS",
  observedAt: new Date().toISOString(),
  source: "production AL/ALIGN registry -> two point pairs + explicit Scale Yes -> atomic commit -> production DXF/KDRAW1 -> strict importer + dxf-parser -> Undo/Redo",
  checks: { registry: true, onePairTranslation: true, twoPairRotationScale: true, exactFiveFamilyGeometry: true, propertiesAndHandles: true, strictDxf: true, independentDxf: true, kdrawChecksum: true, atomicUndoRedo: true, noOp: true },
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  command: { pointPairs, result },
  sourceDocument: source,
  committedDocument: committed,
  expected: expected.map(summary),
  strictChecks,
  independentTypes,
  independentChecks,
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: documentEntry.sha256 },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-029 production ALIGN DXF/KDRAW1 independent read-back with atomic Undo/Redo PASS.");
