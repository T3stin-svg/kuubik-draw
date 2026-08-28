#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadCommandInputError, CadSession, createEmptyDocument, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";
import {
  f020AxisEnd,
  f020AxisStart,
  f020ExpectedCreatedHandles,
  f020ExpectedPreservedEntities,
  f020ExpectedRejected,
  f020ExpectedReplacedEntities,
  f020ExpectedSourceHandles,
  f020StandardDocument,
} from "../../parity/fixtures/f020-standard-fixture.mjs";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-020-kuubik.dxf");
const kdrawPath = resolve(root, "evidence/artifacts/F-020-standard-matrix.kdraw");
const readbackPath = resolve(root, "evidence/artifacts/F-020-independent-readback.json");
const command = resolveCadCommand("MI");
if (!command || command.id !== "MIRROR") throw new Error("MIRROR is missing from the command registry.");

const lineDocument = createEmptyDocument({ documentId: "F-020-line", now: "2026-08-28T00:00:00.000Z" });
lineDocument.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } });
const lineSession = new CadSession(lineDocument);
const lineMirror = command.execute(lineSession.document, {
  targetHandles: ["10"], axisStart: { x: 100, y: -100 }, axisEnd: { x: 100, y: 100 }, eraseSource: false,
});
lineSession.commit({
  opId: "F-020-line-mirror", baseRevision: 0, commandId: "MIRROR",
  args: { axisStart: { x: 100, y: -100 }, axisEnd: { x: 100, y: 100 }, eraseSource: false, mirrtext: 0 },
  targetHandles: lineMirror.sourceHandles, resultHandles: lineMirror.mirroredHandles,
}, lineMirror.changes, "2026-08-28T00:00:01.000Z");
const exported = exportDxf(lineSession.document);
if (exported.report.skipped.length) throw new Error(`F-020 DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const dxfEntities = parsed?.entities.map((entity) => ({
  type: entity.type,
  handle: entity.handle,
  vertices: entity.vertices?.map(({ x, y }) => ({ x, y })),
})) ?? [];
const lineUndo = lineSession.undo("2026-08-28T00:00:02.000Z");

const matrixSession = new CadSession(structuredClone(f020StandardDocument));
const preserved = command.execute(matrixSession.document, {
  targetHandles: f020StandardDocument.entities.map((entity) => entity.handle),
  axisStart: f020AxisStart,
  axisEnd: f020AxisEnd,
  eraseSource: false,
});
matrixSession.commit({
  opId: "F-020-standard-preserve", baseRevision: 0, commandId: "MIRROR",
  args: { axisStart: f020AxisStart, axisEnd: f020AxisEnd, eraseSource: false, mirrtext: 0 },
  targetHandles: preserved.sourceHandles, resultHandles: preserved.mirroredHandles,
}, preserved.changes, "2026-08-28T00:00:03.000Z");
const preservedDocument = matrixSession.document;
const kdrawBytes = await serializeKDraw(preservedDocument, [], "2026-08-28T00:00:03.000Z");
const kdrawText = new TextDecoder().decode(kdrawBytes);
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-020 .kdraw magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentEntry = envelope.manifest?.entries?.find((entry) => entry.path === "document.json");
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const documentSha256 = createHash("sha256").update(documentBytes).digest("hex");
const independentDocument = JSON.parse(documentBytes.toString("utf8"));
const matrixUndo = matrixSession.undo("2026-08-28T00:00:04.000Z");
const matrixRestored = matrixSession.document;

const replaceSession = new CadSession(structuredClone(f020StandardDocument));
const replaced = command.execute(replaceSession.document, {
  targetHandles: f020StandardDocument.entities.map((entity) => entity.handle),
  axisStart: f020AxisStart,
  axisEnd: f020AxisEnd,
  eraseSource: true,
});
replaceSession.commit({
  opId: "F-020-standard-replace", baseRevision: 0, commandId: "MIRROR",
  args: { axisStart: f020AxisStart, axisEnd: f020AxisEnd, eraseSource: true, mirrtext: 0 },
  targetHandles: replaced.sourceHandles, resultHandles: replaced.mirroredHandles,
}, replaced.changes, "2026-08-28T00:00:05.000Z");
const replacedDocument = replaceSession.document;
const replaceUndo = replaceSession.undo("2026-08-28T00:00:06.000Z");

let coincidentRejected = false;
try {
  command.execute(f020StandardDocument, {
    targetHandles: ["10"], axisStart: { x: 5, y: 5 }, axisEnd: { x: 5, y: 5 }, eraseSource: false,
  });
} catch (error) {
  coincidentRejected = error instanceof CadCommandInputError;
}

const result = {
  schemaVersion: 1,
  rowId: "F-020",
  parser: "dxf-parser@1.1.2 + independent KDRAW1 envelope parser",
  observedAt: new Date().toISOString(),
  units: parsed?.header?.$INSUNITS,
  line: {
    command: lineMirror,
    dxfEntities,
    undoChangeTypes: lineUndo?.changes.map((change) => change.type),
    restoredEntities: lineSession.document.entities,
  },
  preserveSources: {
    sourceHandles: preserved.sourceHandles,
    mirroredHandles: preserved.mirroredHandles,
    createdHandles: preserved.createdHandles,
    rejected: preserved.rejected,
    entities: preservedDocument.entities,
    kdraw: {
      format: envelope.format,
      containerVersion: envelope.manifest?.containerVersion,
      byteLength: documentBytes.byteLength,
      sha256: documentSha256,
      manifestByteLength: documentEntry?.byteLength,
      manifestSha256: documentEntry?.sha256,
      independentDocument,
    },
    undoRevision: matrixRestored.revision,
    restoredEntities: matrixRestored.entities,
  },
  eraseSources: {
    sourceHandles: replaced.sourceHandles,
    mirroredHandles: replaced.mirroredHandles,
    createdHandles: replaced.createdHandles,
    rejected: replaced.rejected,
    entities: replacedDocument.entities,
    undoRevision: replaceSession.document.revision,
    restoredEntities: replaceSession.document.entities,
  },
  coincidentRejected,
  status: "PASS",
};

const expectedDxf = [
  { type: "LINE", handle: "10", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
  { type: "LINE", handle: "11", vertices: [{ x: 190, y: 10 }, { x: 20, y: 90 }] },
];
if (
  result.units !== 4 || JSON.stringify(dxfEntities) !== JSON.stringify(expectedDxf) ||
  JSON.stringify(lineMirror.sourceHandles) !== JSON.stringify(["10"]) ||
  JSON.stringify(lineMirror.createdHandles) !== JSON.stringify(["11"]) || !lineUndo ||
  JSON.stringify(lineSession.document.entities) !== JSON.stringify(lineDocument.entities) ||
  JSON.stringify(preserved.sourceHandles) !== JSON.stringify(f020ExpectedSourceHandles) ||
  JSON.stringify(preserved.mirroredHandles) !== JSON.stringify(f020ExpectedCreatedHandles) ||
  JSON.stringify(preserved.createdHandles) !== JSON.stringify(f020ExpectedCreatedHandles) ||
  JSON.stringify(preserved.rejected) !== JSON.stringify(f020ExpectedRejected) ||
  JSON.stringify(preservedDocument.entities) !== JSON.stringify(f020ExpectedPreservedEntities) ||
  envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1 ||
  documentEntry?.byteLength !== documentBytes.byteLength || documentEntry?.sha256 !== documentSha256 ||
  JSON.stringify(independentDocument.entities) !== JSON.stringify(f020ExpectedPreservedEntities) ||
  !matrixUndo || JSON.stringify(matrixRestored.entities) !== JSON.stringify(f020StandardDocument.entities) ||
  JSON.stringify(replaced.sourceHandles) !== JSON.stringify(f020ExpectedSourceHandles) ||
  JSON.stringify(replaced.mirroredHandles) !== JSON.stringify(f020ExpectedSourceHandles) ||
  replaced.createdHandles.length !== 0 || JSON.stringify(replaced.rejected) !== JSON.stringify(f020ExpectedRejected) ||
  JSON.stringify(replacedDocument.entities) !== JSON.stringify(f020ExpectedReplacedEntities) ||
  !replaceUndo || JSON.stringify(replaceSession.document.entities) !== JSON.stringify(f020StandardDocument.entities) ||
  !coincidentRejected
) throw new Error(`F-020 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.text, "utf8");
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.text).digest("hex"),
  kdrawSha256: createHash("sha256").update(kdrawBytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-020 MIRROR default-No/erase-Yes + 12-family properties + DXF/KDRAW1 + atomic UNDO read-back PASS.");
