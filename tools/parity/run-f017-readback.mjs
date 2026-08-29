#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";
import {
  f017BasePoint,
  f017DestinationPoints,
  f017Deltas,
  f017ExpectedCommittedEntities,
  f017ExpectedCopiedHandles,
  f017ExpectedRejected,
  f017ExpectedSourceHandles,
  f017StandardDocument,
} from "../../parity/fixtures/f017-standard-fixture.mjs";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-017-kuubik.dxf");
const kdrawPath = resolve(root, "evidence/artifacts/F-017-standard-matrix.kdraw");
const readbackPath = resolve(root, "evidence/artifacts/F-017-independent-readback.json");
const line = (handle, layerId, y) => ({ kind: "line", handle, layerId, start: { x: 0, y }, end: { x: 1000, y } });
const browserLine = { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } };
const rectangle = {
  kind: "polyline", handle: "11", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }],
};
const points = (entity) => entity?.vertices?.map(({ x, y }) => ({ x, y })) ?? [];

const document = createEmptyDocument({ documentId: "F-017", now: "2026-08-28T00:00:00.000Z" });
const session = new CadSession(document);
session.commit({
  opId: "F-017-fixture", baseRevision: 0, commandId: "FIXTURE", args: {}, targetHandles: [], resultHandles: ["10", "11"],
}, [browserLine, rectangle].map((entity) => ({ type: "put", entity })), "2026-08-28T00:00:01.000Z");
const command = resolveCadCommand("CP");
if (!command || command.id !== "COPY") throw new Error("COPY is missing from the command registry.");
const copied = command.execute(session.document, {
  targetHandles: ["10", "11"], basePoint: f017BasePoint, destinationPoints: f017DestinationPoints,
});
session.commit({
  opId: "F-017-copy", baseRevision: 1, commandId: command.id,
  args: { basePoint: f017BasePoint, destinationPoints: f017DestinationPoints },
  targetHandles: copied.sourceHandles, resultHandles: copied.copiedHandles,
}, copied.changes, "2026-08-28T00:00:02.000Z");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const copiedEntities = parsed?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, vertices: points(entity) })) ?? [];
const undo = session.undo("2026-08-28T00:00:03.000Z");
const restored = structuredClone(session.document.entities);

const mixedDocument = createEmptyDocument({ documentId: "F-017-locked" });
mixedDocument.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
mixedDocument.entities.push(line("20", "0", 0), line("21", "locked", 2000));
const mixed = command.execute(mixedDocument, {
  targetHandles: ["20", "21"], basePoint: { x: 0, y: 0 }, destinationPoints: [{ x: 100, y: 50 }],
});
const coincident = command.execute(mixedDocument, {
  targetHandles: ["20"], basePoint: { x: 200, y: 300 }, destinationPoints: [{ x: 200, y: 300 }],
});

// Serialize the complete 12-family COPY result through production .kdraw, then
// parse the envelope and document bytes without using the production reader.
const matrixSession = new CadSession(structuredClone(f017StandardDocument));
const matrixCopy = command.execute(matrixSession.document, {
  targetHandles: f017StandardDocument.entities.map((entity) => entity.handle),
  basePoint: f017BasePoint,
  destinationPoints: f017DestinationPoints,
});
matrixSession.commit({
  opId: "F-017-standard-matrix",
  baseRevision: 0,
  commandId: command.id,
  args: { basePoint: f017BasePoint, destinationPoints: f017DestinationPoints },
  targetHandles: matrixCopy.sourceHandles,
  resultHandles: matrixCopy.copiedHandles,
}, matrixCopy.changes, "2026-08-28T00:00:02.000Z");
const matrixCommitted = structuredClone(matrixSession.document);
const kdrawBytes = await serializeKDraw(matrixCommitted, [], "2026-08-28T00:00:02.000Z");
const kdrawText = new TextDecoder().decode(kdrawBytes);
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-017 .kdraw magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentEntry = envelope.manifest?.entries?.find((entry) => entry.path === "document.json");
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const documentSha256 = createHash("sha256").update(documentBytes).digest("hex");
const independentDocument = JSON.parse(documentBytes.toString("utf8"));
const matrixUndo = matrixSession.undo("2026-08-28T00:00:03.000Z");
const matrixRestored = structuredClone(matrixSession.document);

const result = {
  schemaVersion: 1,
  rowId: "F-017",
  parser: "dxf-parser@1.1.2 + independent KDRAW1 envelope parser",
  observedAt: new Date().toISOString(),
  units: parsed?.header?.$INSUNITS,
  deltas: copied.deltas,
  copiedEntities,
  emittedHandles: exported.report.emittedHandles,
  afterUndo: restored,
  mixedLocked: mixed,
  coincident,
  standardMatrix: {
    deltas: matrixCopy.deltas,
    sourceHandles: matrixCopy.sourceHandles,
    copiedHandles: matrixCopy.copiedHandles,
    rejected: matrixCopy.rejected,
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
  { type: "LINE", handle: "10", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
  { type: "LWPOLYLINE", handle: "11", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  { type: "LINE", handle: "12", vertices: [{ x: 510, y: 760 }, { x: 680, y: 840 }] },
  { type: "LWPOLYLINE", handle: "13", vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
  { type: "LINE", handle: "14", vertices: [{ x: -290, y: 110 }, { x: -120, y: 190 }] },
  { type: "LWPOLYLINE", handle: "15", vertices: [{ x: -300, y: 1100 }, { x: 700, y: 1100 }, { x: 700, y: 1600 }, { x: -300, y: 1600 }] },
];
if (
  result.units !== 4 || JSON.stringify(result.deltas) !== JSON.stringify(f017Deltas) ||
  JSON.stringify(result.copiedEntities) !== JSON.stringify(expectedDxf) ||
  JSON.stringify(result.emittedHandles) !== JSON.stringify(["10", "11", "12", "13", "14", "15"]) || !undo ||
  JSON.stringify(restored) !== JSON.stringify([browserLine, rectangle]) ||
  mixed.changes.length !== 1 || mixed.sourceHandles[0] !== "20" || mixed.copiedHandles[0] !== "22" || mixed.rejected[0]?.reason !== "locked-layer" ||
  coincident.changes.length !== 1 || coincident.deltas[0]?.x !== 0 || coincident.deltas[0]?.y !== 0 ||
  JSON.stringify(matrixCopy.deltas) !== JSON.stringify(f017Deltas) ||
  JSON.stringify(matrixCopy.sourceHandles) !== JSON.stringify(f017ExpectedSourceHandles) ||
  JSON.stringify(matrixCopy.copiedHandles) !== JSON.stringify(f017ExpectedCopiedHandles) ||
  JSON.stringify(matrixCopy.rejected) !== JSON.stringify(f017ExpectedRejected) ||
  matrixCommitted.revision !== 1 || JSON.stringify(matrixCommitted.entities) !== JSON.stringify(f017ExpectedCommittedEntities) ||
  envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1 ||
  documentEntry?.byteLength !== documentBytes.byteLength || documentEntry?.sha256 !== documentSha256 ||
  JSON.stringify(independentDocument.entities) !== JSON.stringify(f017ExpectedCommittedEntities) || independentDocument.revision !== 1 ||
  !matrixUndo || matrixRestored.revision !== 2 || JSON.stringify(matrixRestored.entities) !== JSON.stringify(f017StandardDocument.entities)
) throw new Error(`F-017 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.bytes).digest("hex"),
  kdrawSha256: createHash("sha256").update(kdrawBytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-017 repeated COPY + DXF + independent .kdraw 12-family matrix + atomic UNDO read-back PASS.");
