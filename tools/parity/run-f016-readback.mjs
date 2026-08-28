#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, resolveCadCommand } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-016-kuubik.dxf");
const readbackPath = resolve(root, "evidence/artifacts/F-016-independent-readback.json");
const line = (handle, layerId, y) => ({ kind: "line", handle, layerId, start: { x: 0, y }, end: { x: 1000, y } });
const browserLine = { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 180, y: 90 } };
const rectangle = {
  kind: "polyline", handle: "11", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }],
};
const points = (entity) => entity?.vertices?.map(({ x, y }) => ({ x, y })) ?? [];

const document = createEmptyDocument({ documentId: "F-016", now: "2026-08-28T00:00:00.000Z" });
const session = new CadSession(document);
session.commit({
  opId: "F-016-fixture", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10", "11"],
}, [browserLine, rectangle].map((entity) => ({ type: "put", entity })), "2026-08-28T00:00:01.000Z");
const command = resolveCadCommand("M");
if (!command || command.id !== "MOVE") throw new Error("MOVE is missing from the command registry.");
const moved = command.execute(session.document, {
  targetHandles: ["10", "11"], basePoint: { x: 100, y: 200 }, destinationPoint: { x: 600, y: 950 },
});
session.commit({
  opId: "F-016-move", baseRevision: 1, commandId: command.id,
  args: { basePoint: { x: 100, y: 200 }, destinationPoint: { x: 600, y: 950 } },
  targetHandles: moved.movedHandles, resultHandles: moved.movedHandles,
}, moved.changes, "2026-08-28T00:00:02.000Z");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const movedEntities = parsed?.entities.map((entity) => ({ type: entity.type, handle: entity.handle, vertices: points(entity) })) ?? [];
const undo = session.undo("2026-08-28T00:00:03.000Z");
const restored = session.document.entities.map((entity) => ({
  handle: entity.handle,
  kind: entity.kind,
  start: entity.kind === "line" ? entity.start : null,
  end: entity.kind === "line" ? entity.end : null,
  vertices: entity.kind === "polyline" ? entity.vertices : null,
}));

const mixedDocument = createEmptyDocument({ documentId: "F-016-locked" });
mixedDocument.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
mixedDocument.entities.push(line("20", "0", 0), line("21", "locked", 2000));
const mixed = command.execute(mixedDocument, {
  targetHandles: ["20", "21"], basePoint: { x: 0, y: 0 }, destinationPoint: { x: 100, y: 50 },
});
const noOp = command.execute(mixedDocument, {
  targetHandles: ["20", "21"], basePoint: { x: 200, y: 300 }, destinationPoint: { x: 200, y: 300 },
});
const result = {
  schemaVersion: 1,
  rowId: "F-016",
  parser: "dxf-parser@1.1.2",
  units: parsed?.header?.$INSUNITS,
  vector: moved.delta,
  movedEntities,
  emittedHandles: exported.report.emittedHandles,
  afterUndo: restored,
  mixedLocked: mixed,
  zeroDelta: noOp,
  status: "PASS",
};
const expectedMoved = [
  { type: "LINE", handle: "10", vertices: [{ x: 510, y: 760 }, { x: 680, y: 840 }] },
  { type: "LWPOLYLINE", handle: "11", vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
];
if (
  result.units !== 4 || JSON.stringify(result.movedEntities) !== JSON.stringify(expectedMoved) ||
  JSON.stringify(result.emittedHandles) !== JSON.stringify(["10", "11"]) || !undo ||
  JSON.stringify(restored) !== JSON.stringify([
    { handle: "10", kind: "line", start: { x: 10, y: 10 }, end: { x: 180, y: 90 }, vertices: null },
    { handle: "11", kind: "polyline", start: null, end: null, vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]) ||
  mixed.changes.length !== 1 || mixed.movedHandles[0] !== "20" || mixed.rejected[0]?.reason !== "locked-layer" ||
  noOp.changes.length !== 0 || noOp.movedHandles.length !== 0 || noOp.rejected.length !== 0
) throw new Error(`F-016 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.text, "utf8");
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.text).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-016 Kuubik atomic MOVE + production DXF + UNDO/locked/no-op read-back PASS.");
