#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, parseScaleFactorInput, parseScaleLengthInput, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";
import {
  f019BasePoint,
  f019ExpectedCommittedEntities,
  f019ExpectedRejected,
  f019ExpectedScaledHandles,
  f019Factor,
  f019NewLength,
  f019ReferenceLength,
  f019ReferencePoints,
  f019StandardDocument,
} from "../../parity/fixtures/f019-standard-fixture.mjs";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-019-kuubik.dxf");
const kdrawPath = resolve(root, "evidence/artifacts/F-019-standard-matrix.kdraw");
const readbackPath = resolve(root, "evidence/artifacts/F-019-independent-readback.json");
const line = (handle, layerId, y) => ({ kind: "line", handle, layerId, start: { x: 0, y }, end: { x: 1000, y } });
const browserLine = { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } };
const rectangle = {
  kind: "polyline", handle: "11", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }],
};
const points = (entity) => entity?.vertices?.map(({ x, y }) => ({ x, y })) ?? [];

const document = createEmptyDocument({ documentId: "F-019", now: "2026-08-28T00:00:00.000Z" });
const session = new CadSession(document);
session.commit({
  opId: "F-019-fixture", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10", "11"],
}, [browserLine, rectangle].map((entity) => ({ type: "put", entity })), "2026-08-28T00:00:01.000Z");
const command = resolveCadCommand("SC");
if (!command || command.id !== "SCALE") throw new Error("SCALE is missing from the command registry.");
const scaled = command.execute(session.document, {
  targetHandles: ["10", "11"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 2 }, copy: false,
});
session.commit({
  opId: "F-019-scale", baseRevision: 1, commandId: command.id,
  args: { basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 2 }, factor: scaled.factor, copy: false },
  targetHandles: scaled.sourceHandles, resultHandles: scaled.scaledHandles,
}, scaled.changes, "2026-08-28T00:00:02.000Z");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const scaledEntities = parsed?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, vertices: points(entity) })) ?? [];
const undo = session.undo("2026-08-28T00:00:03.000Z");
const restored = structuredClone(session.document.entities);

const mixedDocument = createEmptyDocument({ documentId: "F-019-locked" });
mixedDocument.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
mixedDocument.entities.push(line("20", "0", 0), line("21", "locked", 2000), {
  kind: "proxy", handle: "22", layerId: "0", originalType: "CUSTOM", raw: { preserved: true },
});
const mixed = command.execute(mixedDocument, {
  targetHandles: ["20", "21", "22", "missing"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 2 }, copy: false,
});
const noOpSession = new CadSession(structuredClone(mixedDocument));
const noOp = command.execute(noOpSession.document, {
  targetHandles: ["20", "21"], basePoint: { x: 0, y: 0 }, scale: { mode: "reference", referenceLength: 1000, newLength: 1000 }, copy: false,
});
const noOpSource = structuredClone(noOpSession.document.entities);
noOpSession.commit({
  opId: "F-019-factor-one", baseRevision: 0, commandId: "SCALE",
  args: { factor: 1, geometryNoOp: true }, targetHandles: noOp.sourceHandles, resultHandles: [],
}, [{ type: "undo-mark" }], "2026-08-28T00:00:04.000Z");
const noOpCommitted = noOpSession.document;
const noOpUndo = noOpSession.undo("2026-08-28T00:00:05.000Z");
const noOpRestored = noOpSession.document;
const copyAtOne = command.execute(mixedDocument, {
  targetHandles: ["20"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 1 }, copy: true,
});
let pointFactorRejected = false;
try { parseScaleFactorInput("102,200", f019BasePoint); } catch { pointFactorRejected = true; }
const parsedInputs = {
  numericFactor: parseScaleFactorInput("2", f019BasePoint),
  pointFactorRejected,
  numericReference: parseScaleLengthInput("1000", f019BasePoint),
  pointReference: parseScaleLengthInput("1100,200", f019BasePoint),
  twoPointReference: parseScaleLengthInput("100,200; 1100,200", f019BasePoint),
  pointNewLength: parseScaleLengthInput("2100,200", f019BasePoint),
  twoPointNewLength: parseScaleLengthInput("3000,2000; 3000,4000", f019BasePoint),
};

const matrixSession = new CadSession(structuredClone(f019StandardDocument));
const matrixScale = command.execute(matrixSession.document, {
  targetHandles: f019StandardDocument.entities.map((entity) => entity.handle),
  basePoint: f019BasePoint,
  scale: { mode: "reference", referenceLength: f019ReferenceLength, newLength: f019NewLength },
  copy: false,
});
matrixSession.commit({
  opId: "F-019-standard-matrix",
  baseRevision: 0,
  commandId: command.id,
  args: {
    basePoint: f019BasePoint,
    referencePoints: f019ReferencePoints,
    scale: { mode: "reference", referenceLength: f019ReferenceLength, newLength: f019NewLength },
    factor: matrixScale.factor,
    copy: false,
  },
  targetHandles: matrixScale.sourceHandles,
  resultHandles: matrixScale.scaledHandles,
}, matrixScale.changes, "2026-08-28T00:00:02.000Z");
const matrixCommitted = structuredClone(matrixSession.document);
const kdrawBytes = await serializeKDraw(matrixCommitted, [], "2026-08-28T00:00:02.000Z");
const kdrawText = new TextDecoder().decode(kdrawBytes);
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-019 .kdraw magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentEntry = envelope.manifest?.entries?.find((entry) => entry.path === "document.json");
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const documentSha256 = createHash("sha256").update(documentBytes).digest("hex");
const independentDocument = JSON.parse(documentBytes.toString("utf8"));
const matrixUndo = matrixSession.undo("2026-08-28T00:00:03.000Z");
const matrixRestored = structuredClone(matrixSession.document);

const matrixCopy = command.execute(structuredClone(f019StandardDocument), {
  targetHandles: f019StandardDocument.entities.map((entity) => entity.handle),
  basePoint: f019BasePoint,
  scale: { mode: "factor", factor: f019Factor },
  copy: true,
});
const expectedCopyHandles = ["1E", "1F", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29"];
const expectedCopies = f019ExpectedCommittedEntities.slice(0, 12).map((entity, index) => ({ ...structuredClone(entity), handle: expectedCopyHandles[index] }));

const result = {
  schemaVersion: 1,
  rowId: "F-019",
  parser: "dxf-parser@1.1.2 + independent KDRAW1 envelope parser",
  observedAt: new Date().toISOString(),
  units: parsed?.header?.$INSUNITS,
  factor: scaled.factor,
  scaledEntities,
  emittedHandles: exported.report.emittedHandles,
  afterUndo: restored,
  mixedLocked: mixed,
  equalReferenceNoOp: {
    commandResult: noOp,
    committedRevision: noOpCommitted.revision,
    committedEntities: noOpCommitted.entities,
    undoRevision: noOpRestored.revision,
    restoredEntities: noOpRestored.entities,
    undoChangeTypes: noOpUndo?.changes.map((change) => change.type),
  },
  copyAtFactorOne: copyAtOne,
  parsedInputs,
  standardMatrix: {
    referenceLength: f019ReferenceLength,
    newLength: f019NewLength,
    factor: matrixScale.factor,
    scaledHandles: matrixScale.scaledHandles,
    rejected: matrixScale.rejected,
    committedRevision: matrixCommitted.revision,
    committedEntities: matrixCommitted.entities,
    copy: {
      sourceHandles: matrixCopy.sourceHandles,
      createdHandles: matrixCopy.createdHandles,
      rejected: matrixCopy.rejected,
      entities: matrixCopy.changes.map((change) => change.entity),
    },
    kdraw: {
      format: envelope.format,
      containerVersion: envelope.manifest?.containerVersion,
      paths: envelope.manifest?.entries?.map((entry) => entry.path),
      byteLength: documentBytes.byteLength,
      sha256: documentSha256,
      manifestByteLength: documentEntry?.byteLength,
      manifestSha256: documentEntry?.sha256,
      independentDocument,
    },
    undoRevision: matrixRestored.revision,
    restoredEntities: matrixRestored.entities,
  },
  status: "PASS",
};
const expectedDxf = [
  { type: "LINE", handle: "10", vertices: [{ x: 20, y: 20 }, { x: 360, y: 180 }] },
  { type: "LWPOLYLINE", handle: "11", vertices: [{ x: 0, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }] },
];
if (
  result.units !== 4 || result.factor !== 2 || JSON.stringify(result.scaledEntities) !== JSON.stringify(expectedDxf) ||
  JSON.stringify(result.emittedHandles) !== JSON.stringify(["10", "11"]) || !undo ||
  JSON.stringify(restored) !== JSON.stringify([browserLine, rectangle]) ||
  mixed.changes.length !== 1 || mixed.scaledHandles[0] !== "20" ||
  JSON.stringify(mixed.rejected) !== JSON.stringify([
    { handle: "21", reason: "locked-layer" }, { handle: "22", reason: "unsupported-entity" }, { handle: "missing", reason: "missing" },
  ]) || noOp.changes.length !== 0 || JSON.stringify(noOp.sourceHandles) !== JSON.stringify(["20"]) ||
  noOp.scaledHandles.length !== 0 || JSON.stringify(noOp.rejected) !== JSON.stringify([{ handle: "21", reason: "locked-layer" }]) ||
  noOpCommitted.revision !== 1 || JSON.stringify(noOpCommitted.entities) !== JSON.stringify(noOpSource) ||
  !noOpUndo || JSON.stringify(noOpUndo.changes.map((change) => change.type)) !== JSON.stringify(["undo-mark"]) ||
  noOpRestored.revision !== 2 || JSON.stringify(noOpRestored.entities) !== JSON.stringify(noOpSource) ||
  copyAtOne.changes.length !== 1 || copyAtOne.createdHandles[0] !== "23" || copyAtOne.factor !== 1 ||
  JSON.stringify(parsedInputs) !== JSON.stringify({ numericFactor: 2, pointFactorRejected: true, numericReference: 1000, pointReference: 1000, twoPointReference: 1000, pointNewLength: 2000, twoPointNewLength: 2000 }) ||
  matrixScale.factor !== f019Factor || JSON.stringify(matrixScale.scaledHandles) !== JSON.stringify(f019ExpectedScaledHandles) ||
  JSON.stringify(matrixScale.rejected) !== JSON.stringify(f019ExpectedRejected) || matrixCommitted.revision !== 1 ||
  JSON.stringify(matrixCommitted.entities) !== JSON.stringify(f019ExpectedCommittedEntities) ||
  JSON.stringify(matrixCopy.sourceHandles) !== JSON.stringify(f019ExpectedScaledHandles) ||
  JSON.stringify(matrixCopy.createdHandles) !== JSON.stringify(expectedCopyHandles) ||
  JSON.stringify(matrixCopy.rejected) !== JSON.stringify(f019ExpectedRejected) ||
  JSON.stringify(matrixCopy.changes.map((change) => change.entity)) !== JSON.stringify(expectedCopies) ||
  envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1 ||
  documentEntry?.byteLength !== documentBytes.byteLength || documentEntry?.sha256 !== documentSha256 ||
  JSON.stringify(independentDocument.entities) !== JSON.stringify(f019ExpectedCommittedEntities) || independentDocument.revision !== 1 ||
  !matrixUndo || matrixRestored.revision !== 2 || JSON.stringify(matrixRestored.entities) !== JSON.stringify(f019StandardDocument.entities)
) throw new Error(`F-019 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.bytes).digest("hex"),
  kdrawSha256: createHash("sha256").update(kdrawBytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-019 SCALE modes + Copy + DXF + independent .kdraw 12-family matrix + atomic UNDO read-back PASS.");
