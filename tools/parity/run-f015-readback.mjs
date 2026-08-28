#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, resolveCadCommand } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-015-kuubik.dxf");
const readbackPath = resolve(root, "evidence/artifacts/F-015-independent-readback.json");
const document = createEmptyDocument({ documentId: "F-015", now: "2026-08-28T00:00:00.000Z" });
const lines = [
  { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
  { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
];
const session = new CadSession(document);
session.commit({
  opId: "F-015-fixture",
  baseRevision: 0,
  commandId: "LINE",
  args: {},
  targetHandles: [],
  resultHandles: ["10", "11"],
}, lines.map((entity) => ({ type: "put", entity })), "2026-08-28T00:00:01.000Z");
const command = resolveCadCommand("ERASE");
if (!command || command.id !== "ERASE") throw new Error("ERASE is missing from the command registry.");
const erased = command.execute(session.document, { targetHandles: ["10", "11"] });
session.commit({
  opId: "F-015-erase",
  baseRevision: 1,
  commandId: command.id,
  args: { targetHandles: ["10", "11"] },
  targetHandles: erased.erasedHandles,
  resultHandles: [],
}, erased.changes, "2026-08-28T00:00:02.000Z");
if (session.document.entities.length !== 0) throw new Error("F-015 ERASE did not remove both entities.");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const undo = session.undo("2026-08-28T00:00:03.000Z");
const restoredHandles = session.document.entities.map((entity) => entity.handle).sort();
if (!undo || restoredHandles.join(",") !== "10,11") {
  throw new Error("F-015 one-step UNDO did not restore the exact handles.");
}
const lockedDocument = createEmptyDocument({ documentId: "F-015-locked" });
lockedDocument.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
lockedDocument.entities.push({ kind: "line", handle: "20", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const locked = command.execute(lockedDocument, { targetHandles: ["20"] });
const result = {
  schemaVersion: 1,
  rowId: "F-015",
  parser: "dxf-parser@1.1.2",
  units: parsed?.header?.$INSUNITS,
  entityCount: parsed?.entities.length,
  emittedHandles: exported.report.emittedHandles,
  afterErase: 0,
  afterUndoHandles: restoredHandles,
  lockedLayer: locked,
  status: "PASS",
};
if (
  result.units !== 4 || result.entityCount !== 0 || result.emittedHandles.length !== 0 ||
  locked.changes.length !== 0 || locked.rejected[0]?.reason !== "locked-layer"
) {
  throw new Error(`F-015 independent read-back mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.text, "utf8");
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.text).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-015 Kuubik atomic ERASE + empty production DXF + UNDO read-back PASS.");
