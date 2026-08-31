import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportDxf, importDxf } from "../../../packages/cad-dxf/src/index.js";
import { createF110Document } from "../../../packages/cad-dxf/test/f110-fixture.js";

const target = process.argv[2];
if (!target) throw new Error("Usage: vite-node f110-write-audit-fixture.ts <target.dxf>");

const first = exportDxf(createF110Document());
writeFileSync(resolve(target), first.bytes);
const physical = readFileSync(resolve(target));
const imported = importDxf(physical, { documentId: "F-110-audit-readback" });
const second = exportDxf(imported.document);
if (!physical.equals(second.bytes)) throw new Error("F-110 strict import/export read-back is not byte-equal.");

console.log(JSON.stringify({
  path: resolve(target),
  bytes: physical.byteLength,
  sha256: createHash("sha256").update(physical).digest("hex"),
  strictByteEqual: true,
  importedHandles: imported.report.importedHandles,
}));
