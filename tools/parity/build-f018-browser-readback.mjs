#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  f018ExpectedCommittedEntities,
  f018ExpectedRejected,
  f018ExpectedRotatedHandles,
  f018StandardDocument,
} from "../../parity/fixtures/f018-standard-fixture.mjs";

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
const standardMatrix = JSON.parse(await readFile(resolve(artifactRoot, "F-018-browser-standard-matrix.json"), "utf8"));
const result = {
  schemaVersion: 1,
  rowId: "F-018",
  source: "Chromium downloads captured by e2e/f018-rotate.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  rotated: await read("F-018-browser-rotated.dxf"),
  restored: await read("F-018-browser-restored.dxf"),
  mixedLocked: await read("F-018-browser-locked.dxf"),
  standardMatrix,
  status: "PASS",
};
if (
  result.rotated.units !== 4 || JSON.stringify(result.rotated.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: -10, y: 10 }, { x: -90, y: 180 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: -1000, y: 0 }, { x: -1000, y: 1000 }, { x: -1500, y: 1000 }, { x: -1500, y: 0 }] },
  ]) ||
  result.restored.units !== 4 || JSON.stringify(result.restored.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]) ||
  result.mixedLocked.units !== 4 || JSON.stringify(result.mixedLocked.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: -10, y: 10 }, { x: -90, y: 180 }] },
    { type: "LINE", handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20 }, { x: 180, y: 90 }] },
  ]) ||
  standardMatrix.schemaVersion !== 1 || standardMatrix.rowId !== "F-018" || standardMatrix.status !== "PASS" ||
  standardMatrix.rotated?.revision !== 1 || JSON.stringify(standardMatrix.rotated?.entities) !== JSON.stringify(f018ExpectedCommittedEntities) ||
  JSON.stringify(standardMatrix.rotated?.rotatedHandles) !== JSON.stringify(f018ExpectedRotatedHandles) ||
  JSON.stringify(standardMatrix.rejected) !== JSON.stringify(f018ExpectedRejected) ||
  standardMatrix.restored?.revision !== 2 || JSON.stringify(standardMatrix.restored?.entities) !== JSON.stringify(f018StandardDocument.entities)
) throw new Error(`F-018 browser capture mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-018-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-018 Chromium DXF and 12-family IndexedDB ROTATE/UNDO matrix read back PASS.");
