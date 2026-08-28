#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, parseReferenceAngleInput, parseRotationAngleInput, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";
import {
  f018BasePoint,
  f018ExpectedCommittedEntities,
  f018ExpectedRejected,
  f018ExpectedRotatedHandles,
  f018NewAngleDeg,
  f018ReferenceAngleDeg,
  f018ReferencePoints,
  f018StandardDocument,
} from "../../parity/fixtures/f018-standard-fixture.mjs";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-018-kuubik.dxf");
const kdrawPath = resolve(root, "evidence/artifacts/F-018-standard-matrix.kdraw");
const readbackPath = resolve(root, "evidence/artifacts/F-018-independent-readback.json");
const line = (handle, layerId, y) => ({ kind: "line", handle, layerId, start: { x: 0, y }, end: { x: 1000, y } });
const browserLine = { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } };
const rectangle = {
  kind: "polyline", handle: "11", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }],
};
const points = (entity) => entity?.vertices?.map(({ x, y }) => ({ x, y })) ?? [];

const document = createEmptyDocument({ documentId: "F-018", now: "2026-08-28T00:00:00.000Z" });
const session = new CadSession(document);
session.commit({
  opId: "F-018-fixture", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10", "11"],
}, [browserLine, rectangle].map((entity) => ({ type: "put", entity })), "2026-08-28T00:00:01.000Z");
const command = resolveCadCommand("RO");
if (!command || command.id !== "ROTATE") throw new Error("ROTATE is missing from the command registry.");
const rotated = command.execute(session.document, {
  targetHandles: ["10", "11"], basePoint: { x: 0, y: 0 }, angle: { mode: "relative", angleDeg: 90 },
});
session.commit({
  opId: "F-018-rotate", baseRevision: 1, commandId: command.id,
  args: { basePoint: { x: 0, y: 0 }, angle: { mode: "relative", angleDeg: 90 }, deltaAngleDeg: rotated.deltaAngleDeg },
  targetHandles: rotated.rotatedHandles, resultHandles: rotated.rotatedHandles,
}, rotated.changes, "2026-08-28T00:00:02.000Z");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const rotatedEntities = parsed?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, vertices: points(entity) })) ?? [];
const undo = session.undo("2026-08-28T00:00:03.000Z");
const restored = structuredClone(session.document.entities);

const mixedDocument = createEmptyDocument({ documentId: "F-018-locked" });
mixedDocument.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
mixedDocument.entities.push(line("20", "0", 0), line("21", "locked", 2000), {
  kind: "proxy", handle: "22", layerId: "0", originalType: "CUSTOM", raw: { preserved: true },
});
const mixed = command.execute(mixedDocument, {
  targetHandles: ["20", "21", "22", "missing"], basePoint: { x: 0, y: 0 }, angle: { mode: "relative", angleDeg: 90 },
});
const noOp = command.execute(mixedDocument, {
  targetHandles: ["20", "21"], basePoint: { x: 0, y: 0 }, angle: { mode: "reference", referenceAngleDeg: 45, newAngleDeg: 45 },
});
const parsedInputs = {
  standardNumeric: parseRotationAngleInput("90", { x: 0, y: 0 }),
  standardPoint: parseRotationAngleInput("0,-1000", { x: 0, y: 0 }),
  numericReference: parseReferenceAngleInput("45", f018BasePoint),
  pointReference: parseReferenceAngleInput("1100,1200", f018BasePoint),
  twoPointReference: parseReferenceAngleInput("100,200; 1100,1200", f018BasePoint),
  pointTarget: parseRotationAngleInput("100,1200", f018BasePoint),
};

const matrixSession = new CadSession(structuredClone(f018StandardDocument));
const matrixRotate = command.execute(matrixSession.document, {
  targetHandles: f018StandardDocument.entities.map((entity) => entity.handle),
  basePoint: f018BasePoint,
  angle: { mode: "reference", referenceAngleDeg: f018ReferenceAngleDeg, newAngleDeg: f018NewAngleDeg },
});
matrixSession.commit({
  opId: "F-018-standard-matrix",
  baseRevision: 0,
  commandId: command.id,
  args: {
    basePoint: f018BasePoint,
    referencePoints: f018ReferencePoints,
    angle: { mode: "reference", referenceAngleDeg: f018ReferenceAngleDeg, newAngleDeg: f018NewAngleDeg },
    deltaAngleDeg: matrixRotate.deltaAngleDeg,
  },
  targetHandles: matrixRotate.rotatedHandles,
  resultHandles: matrixRotate.rotatedHandles,
}, matrixRotate.changes, "2026-08-28T00:00:02.000Z");
const matrixCommitted = structuredClone(matrixSession.document);
const kdrawBytes = await serializeKDraw(matrixCommitted, [], "2026-08-28T00:00:02.000Z");
const kdrawText = new TextDecoder().decode(kdrawBytes);
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-018 .kdraw magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentEntry = envelope.manifest?.entries?.find((entry) => entry.path === "document.json");
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const documentSha256 = createHash("sha256").update(documentBytes).digest("hex");
const independentDocument = JSON.parse(documentBytes.toString("utf8"));
const matrixUndo = matrixSession.undo("2026-08-28T00:00:03.000Z");
const matrixRestored = structuredClone(matrixSession.document);

const result = {
  schemaVersion: 1,
  rowId: "F-018",
  parser: "dxf-parser@1.1.2 + independent KDRAW1 envelope parser",
  observedAt: new Date().toISOString(),
  units: parsed?.header?.$INSUNITS,
  deltaAngleDeg: rotated.deltaAngleDeg,
  rotatedEntities,
  emittedHandles: exported.report.emittedHandles,
  afterUndo: restored,
  mixedLocked: mixed,
  equalAngleNoOp: noOp,
  parsedInputs,
  standardMatrix: {
    referenceAngleDeg: f018ReferenceAngleDeg,
    newAngleDeg: f018NewAngleDeg,
    deltaAngleDeg: matrixRotate.deltaAngleDeg,
    rotatedHandles: matrixRotate.rotatedHandles,
    rejected: matrixRotate.rejected,
    committedRevision: matrixCommitted.revision,
    committedEntities: matrixCommitted.entities,
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
  { type: "LINE", handle: "10", vertices: [{ x: -10, y: 10 }, { x: -90, y: 180 }] },
  { type: "LWPOLYLINE", handle: "11", vertices: [{ x: -1000, y: 0 }, { x: -1000, y: 1000 }, { x: -1500, y: 1000 }, { x: -1500, y: 0 }] },
];
if (
  result.units !== 4 || result.deltaAngleDeg !== 90 || JSON.stringify(result.rotatedEntities) !== JSON.stringify(expectedDxf) ||
  JSON.stringify(result.emittedHandles) !== JSON.stringify(["10", "11"]) || !undo ||
  JSON.stringify(restored) !== JSON.stringify([browserLine, rectangle]) ||
  mixed.changes.length !== 1 || mixed.rotatedHandles[0] !== "20" ||
  JSON.stringify(mixed.rejected) !== JSON.stringify([
    { handle: "21", reason: "locked-layer" }, { handle: "22", reason: "unsupported-entity" }, { handle: "missing", reason: "missing" },
  ]) || noOp.changes.length !== 0 || noOp.rotatedHandles.length !== 0 || noOp.rejected.length !== 0 ||
  JSON.stringify(parsedInputs) !== JSON.stringify({ standardNumeric: 90, standardPoint: -90, numericReference: 45, pointReference: 45, twoPointReference: 45, pointTarget: 90 }) ||
  matrixRotate.deltaAngleDeg !== 90 || JSON.stringify(matrixRotate.rotatedHandles) !== JSON.stringify(f018ExpectedRotatedHandles) ||
  JSON.stringify(matrixRotate.rejected) !== JSON.stringify(f018ExpectedRejected) || matrixCommitted.revision !== 1 ||
  JSON.stringify(matrixCommitted.entities) !== JSON.stringify(f018ExpectedCommittedEntities) ||
  envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1 ||
  documentEntry?.byteLength !== documentBytes.byteLength || documentEntry?.sha256 !== documentSha256 ||
  JSON.stringify(independentDocument.entities) !== JSON.stringify(f018ExpectedCommittedEntities) || independentDocument.revision !== 1 ||
  !matrixUndo || matrixRestored.revision !== 2 || JSON.stringify(matrixRestored.entities) !== JSON.stringify(f018StandardDocument.entities)
) throw new Error(`F-018 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.text, "utf8");
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.text).digest("hex"),
  kdrawSha256: createHash("sha256").update(kdrawBytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-018 ROTATE modes + DXF + independent .kdraw 12-family matrix + atomic UNDO read-back PASS.");
