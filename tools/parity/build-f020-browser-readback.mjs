#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  f020ExpectedCreatedHandles,
  f020ExpectedPreservedEntities,
  f020ExpectedRejected,
  f020ExpectedSourceHandles,
  f020StandardDocument,
} from "../../parity/fixtures/f020-standard-fixture.mjs";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const summarize = (entity) => ({
  type: entity.type,
  handle: entity.handle,
  layer: entity.layer,
  vertices: entity.vertices?.map(({ x, y }) => ({ x, y })) ?? [],
});
const read = async (name) => {
  const bytes = await readFile(resolve(artifactRoot, name));
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  return { sha256: sha256(bytes), units: parsed?.header?.$INSUNITS, entities: parsed?.entities.map(summarize) ?? [] };
};

const standardMatrix = JSON.parse(await readFile(resolve(artifactRoot, "F-020-browser-standard-matrix.json"), "utf8"));
const result = {
  schemaVersion: 1,
  rowId: "F-020",
  source: "Chromium downloads captured by e2e/f020-mirror.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  preserved: await read("F-020-browser-preserved.dxf"),
  erasedLocked: await read("F-020-browser-erased-locked.dxf"),
  standardMatrix,
  status: "PASS",
};

if (
  result.preserved.units !== 4 || JSON.stringify(result.preserved.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LINE", handle: "11", layer: "0", vertices: [{ x: 190, y: 10 }, { x: 20, y: 90 }] },
  ]) ||
  result.erasedLocked.units !== 4 || JSON.stringify(result.erasedLocked.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 190, y: 10 }, { x: 20, y: 90 }] },
    { type: "LINE", handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20 }, { x: 180, y: 90 }] },
  ]) ||
  standardMatrix.schemaVersion !== 1 || standardMatrix.rowId !== "F-020" || standardMatrix.status !== "PASS" ||
  standardMatrix.mirrored?.revision !== 1 ||
  JSON.stringify(standardMatrix.mirrored?.entities) !== JSON.stringify(f020ExpectedPreservedEntities) ||
  JSON.stringify(standardMatrix.mirrored?.operation?.targetHandles) !== JSON.stringify(f020ExpectedSourceHandles) ||
  JSON.stringify(standardMatrix.mirrored?.operation?.resultHandles) !== JSON.stringify(f020ExpectedCreatedHandles) ||
  JSON.stringify(standardMatrix.rejected) !== JSON.stringify(f020ExpectedRejected) ||
  standardMatrix.restored?.revision !== 2 ||
  JSON.stringify(standardMatrix.restored?.entities) !== JSON.stringify(f020StandardDocument.entities)
) throw new Error(`F-020 browser capture mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-020-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-020 Chromium DXF and 12-family IndexedDB MIRROR/UNDO matrix read back PASS.");
