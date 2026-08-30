#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, deserializeKDraw, executeFillet, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-024-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-024-kuubik.kdraw");
const readbackPath = resolve(artifactRoot, "F-024-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalizedAngle = (value) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/fillet.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-core/test/fillet.test.ts",
  "packages/cad-core/test/f024-mutation-proven.test.ts",
  "packages/cad-dxf/test/f024-fillet-roundtrip.test.ts",
  "tools/parity/run-f024-readback.mjs",
];

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]));
}

function layerName(documentValue, layerId) {
  const layer = documentValue.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`F-024 read-back cannot resolve layer ${layerId}.`);
  return layer.name;
}

function schemaContract(documentValue, entity) {
  const appearance = entity.appearance?.color === undefined && entity.appearance?.lineweightMm === undefined
    ? undefined
    : { color: entity.appearance?.color, lineweightMm: entity.appearance?.lineweightMm };
  const base = compact({ handle: entity.handle, kind: entity.kind, layer: layerName(documentValue, entity.layerId), appearance });
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices.map(compact) };
  if (entity.kind === "arc") return { ...base, center: entity.center, radius: entity.radius, startAngleRad: normalizedAngle(entity.startAngleRad), endAngleRad: normalizedAngle(entity.endAngleRad), counterClockwise: entity.counterClockwise };
  throw new Error(`F-024 read-back does not support ${entity.kind}.`);
}

function independentContract(entity) {
  const base = { handle: entity.handle, kind: ({ LWPOLYLINE: "polyline", ARC: "arc" })[entity.type], layer: entity.layer };
  if (entity.type === "LWPOLYLINE") return {
    ...base,
    closed: Boolean(entity.shape),
    vertices: entity.vertices.map((vertex) => compact({ x: vertex.x, y: vertex.y, bulge: vertex.bulge || undefined, startWidth: vertex.startWidth, endWidth: vertex.endWidth })),
  };
  if (entity.type === "ARC") return { ...base, center: { x: entity.center.x, y: entity.center.y }, radius: entity.radius, startAngleRad: normalizedAngle(entity.startAngle), endAngleRad: normalizedAngle(entity.endAngle), counterClockwise: true };
  throw new Error(`Unsupported independent F-024 type ${entity.type}.`);
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

const command = resolveCadCommand("F");
if (!command || command.id !== "FILLET") throw new Error("F/FILLET is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-024-readback", now: "2026-08-29T17:00:00.000Z" });
document.entities = [
  { kind: "polyline", handle: "10", layerId: "0", appearance: { color: "#ff0000", lineweightMm: 0.5 }, extensionData: { rowId: "F-024" }, closed: false, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }] },
  { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
  { kind: "polyline", handle: "30", layerId: "0", closed: true, vertices: [{ x: 0, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 300 }, { x: 0, y: 300 }] },
  { kind: "polyline", handle: "40", layerId: "0", closed: false, vertices: [{ x: 0, y: 400 }, { x: 100, y: 400, bulge: 0.2 }, { x: 160, y: 460 }, { x: 160, y: 540 }] },
  { kind: "polyline", handle: "50", layerId: "0", closed: false, vertices: [{ x: 300, y: 400 }, { x: 400, y: 400, bulge: Math.tan(Math.PI / 8) }, { x: 450, y: 450 }, { x: 450, y: 550 }, { x: 350, y: 550 }] },
];
const source = structuredClone(document);
const session = new CadSession(document);

const pairResult = executeFillet(session.document, {
  mode: "pairs", radius: 10, trimMode: "trim",
  pairs: [
    { firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 80, y: 0 }, secondHandle: "20", secondPickPoint: { x: 100, y: 20 } },
    { firstHandle: "30", firstSegment: 0, firstPickPoint: { x: 80, y: 200 }, secondHandle: "30", secondSegment: 1, secondPickPoint: { x: 100, y: 220 } },
  ],
});
if (pairResult.rejected.length || pairResult.changes.length !== 3) throw new Error(`F-024 pair matrix rejected output: ${JSON.stringify(pairResult)}`);
session.commit({ opId: "F-024-pairs", baseRevision: 0, commandId: "FILLET", args: { mode: "pairs", radius: 10, trimMode: "trim" }, targetHandles: pairResult.sourceHandles, resultHandles: pairResult.resultHandles }, pairResult.changes, "2026-08-29T17:00:01.000Z");

const currentResult = executeFillet(session.document, { mode: "polyline", radius: 10, trimMode: "trim", filletPolylineArc: 1, polylineHandles: ["40"] });
if (currentResult.rejected.length || currentResult.changes.length !== 1) throw new Error(`F-024 FILLETPOLYARC=1 rejected output: ${JSON.stringify(currentResult)}`);
session.commit({ opId: "F-024-current", baseRevision: 1, commandId: "FILLET", args: { mode: "polyline", radius: 10, filletPolylineArc: 1 }, targetHandles: currentResult.sourceHandles, resultHandles: currentResult.resultHandles }, currentResult.changes, "2026-08-29T17:00:02.000Z");

const legacyNoTrimResult = executeFillet(session.document, { mode: "polyline", radius: 10, trimMode: "no-trim", filletPolylineArc: 0, polylineHandles: ["50"] });
if (legacyNoTrimResult.rejected.length || legacyNoTrimResult.changes.length !== 2) throw new Error(`F-024 FILLETPOLYARC=0 No Trim rejected output: ${JSON.stringify(legacyNoTrimResult)}`);
session.commit({ opId: "F-024-legacy-no-trim", baseRevision: 2, commandId: "FILLET", args: { mode: "polyline", radius: 10, trimMode: "no-trim", filletPolylineArc: 0 }, targetHandles: legacyNoTrimResult.sourceHandles, resultHandles: legacyNoTrimResult.resultHandles }, legacyNoTrimResult.changes, "2026-08-29T17:00:03.000Z");

const committed = structuredClone(session.document);
const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-024 DXF skipped outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-024-strict", now: "2026-08-29T17:00:04.000Z" });
if (strict.report.skipped.length) throw new Error(`F-024 strict import skipped outputs: ${JSON.stringify(strict.report.skipped)}`);
const independent = new DxfParser().parseSync(exported.text);
const kdrawBytes = await serializeKDraw(committed, [], "2026-08-29T17:00:05.000Z");
const restoredContainer = await deserializeKDraw(kdrawBytes);
const documentEntry = restoredContainer.manifest.entries.find(({ path }) => path === restoredContainer.manifest.documentPath);
if (!documentEntry || restoredContainer.attachments.size !== 0) throw new Error("F-024 KDraw production deserializer returned an invalid manifest or attachments.");
const kdrawDocument = restoredContainer.document;
const expectedSemantics = committed.entities.map((entity) => schemaContract(committed, entity));
const strictSemantics = committed.entities.map((entity) => {
  const found = strict.document.entities.find((candidate) => candidate.handle === entity.handle);
  if (!found) throw new Error(`Strict F-024 importer missed ${entity.handle}.`);
  return schemaContract(strict.document, found);
});
const independentSemantics = committed.entities.map((entity) => {
  const found = independent?.entities.find((candidate) => candidate.handle === entity.handle);
  if (!found) throw new Error(`Independent F-024 parser missed ${entity.handle}.`);
  return independentContract(found);
});
const strictMismatch = mismatch(expectedSemantics, strictSemantics);
const independentMismatch = mismatch(withoutAppearance(expectedSemantics), independentSemantics);

const undoStates = [];
for (let index = 0; index < 3; index += 1) { const operation = session.undo(`2026-08-29T17:01:0${index}.000Z`); undoStates.push({ present: Boolean(operation), revision: session.document.revision }); }
const fullyRestored = JSON.stringify(session.document.entities) === JSON.stringify(source.entities);
const redoStates = [];
for (let index = 0; index < 3; index += 1) { const operation = session.redo(`2026-08-29T17:02:0${index}.000Z`); redoStates.push({ present: Boolean(operation), revision: session.document.revision }); }
const fullyRedone = JSON.stringify(session.document.entities) === JSON.stringify(committed.entities);

const report = {
  schemaVersion: 1,
  rowId: "F-024",
  source: "production FILLET registry -> immutable atomic commits -> production DXF/KDRAW1 -> strict importer + dxf-parser -> three-step Undo/Redo",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  commands: { pairs: pairResult, filletPolyArc1: currentResult, filletPolyArc0NoTrim: legacyNoTrimResult },
  output: { expectedSemantics, strictSemantics, independentSemantics, strictMismatch, independentMismatch },
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: {
    sha256: sha256(kdrawBytes),
    byteLength: kdrawBytes.byteLength,
    documentSha256: documentEntry.sha256,
    productionDeserializer: true,
    manifestEntryCount: restoredContainer.manifest.entries.length,
    attachmentCount: restoredContainer.attachments.size,
    exactDocument: JSON.stringify(kdrawDocument.entities) === JSON.stringify(committed.entities),
  },
  undo: { states: undoStates, fullyRestored },
  redo: { states: redoStates, fullyRedone },
  status: "PASS",
};
if (strictMismatch || independentMismatch || !report.kdraw.exactDocument || !undoStates.every(({ present }) => present) || !fullyRestored || !redoStates.every(({ present }) => present) || !fullyRedone) throw new Error(`F-024 independent read-back mismatch: ${JSON.stringify(report)}`);
await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-024 production FILLET polyline join/FILLETPOLYARC DXF/KDRAW1 and atomic Undo/Redo read-back PASS.");
