#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, resolveCadCommand } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-003-kuubik.dxf");
const readbackPath = resolve(root, "evidence/artifacts/F-003-independent-readback.json");
const document = createEmptyDocument({ documentId: "F-003", now: "2026-08-28T00:00:00.000Z" });
const command = resolveCadCommand("RECTANG");
if (!command) throw new Error("RECTANGLE is missing from the command registry.");
const args = { handle: "10", layerId: "0", firstCorner: { x: 125.25, y: -200.5 }, otherCorner: { x: 600.75, y: 900.125 } };
const session = new CadSession(document);
session.commit({
  opId: "F-003-fixture",
  baseRevision: 0,
  commandId: command.id,
  args,
  targetHandles: [],
  resultHandles: [args.handle],
}, command.execute(args), "2026-08-28T00:00:01.000Z");
const exported = exportDxf(session.document);
if (exported.report.skipped.length) throw new Error(`DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const rectangle = parsed?.entities[0];
const vertices = rectangle?.vertices?.map(({ x, y }) => [x, y]) ?? [];
const result = {
  schemaVersion: 1,
  rowId: "F-003",
  parser: "dxf-parser@1.1.2",
  units: parsed?.header?.$INSUNITS,
  entityCount: parsed?.entities.length,
  entityType: rectangle?.type,
  closed: rectangle?.shape === true,
  vertices,
  emittedHandles: exported.report.emittedHandles,
  status: "PASS",
};
if (
  result.units !== 4 || result.entityCount !== 1 || result.entityType !== "LWPOLYLINE" || !result.closed ||
  JSON.stringify(vertices) !== JSON.stringify([[125.25, -200.5], [600.75, -200.5], [600.75, 900.125], [125.25, 900.125]])
) {
  throw new Error(`F-003 independent read-back mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.bytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-003 Kuubik production DXF + independent read-back PASS.");
