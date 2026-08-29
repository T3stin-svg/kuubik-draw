#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  f017ExpectedCommittedEntities,
  f017ExpectedCopiedHandles,
  f017ExpectedRejected,
  f017ExpectedSourceHandles,
  f017StandardDocument,
} from "../../parity/fixtures/f017-standard-fixture.mjs";

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
const standardMatrix = JSON.parse(await readFile(resolve(artifactRoot, "F-017-browser-standard-matrix.json"), "utf8"));
const result = {
  schemaVersion: 1,
  rowId: "F-017",
  source: "Chromium downloads captured by e2e/f017-copy.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  copied: await read("F-017-browser-copied.dxf"),
  restored: await read("F-017-browser-restored.dxf"),
  mixedLocked: await read("F-017-browser-locked.dxf"),
  standardMatrix,
  status: "PASS",
};
if (
  result.copied.units !== 4 || JSON.stringify(result.copied.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
    { type: "LINE", handle: "12", layer: "0", vertices: [{ x: 510, y: 760 }, { x: 680, y: 840 }] },
    { type: "LWPOLYLINE", handle: "13", layer: "0", vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
    { type: "LINE", handle: "14", layer: "0", vertices: [{ x: -290, y: 110 }, { x: -120, y: 190 }] },
    { type: "LWPOLYLINE", handle: "15", layer: "0", vertices: [{ x: -300, y: 1100 }, { x: 700, y: 1100 }, { x: 700, y: 1600 }, { x: -300, y: 1600 }] },
  ]) ||
  result.restored.units !== 4 || JSON.stringify(result.restored.entities.map(({ type, handle, layer, vertices }) => ({ type, handle, layer, vertices }))) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]) ||
  result.mixedLocked.units !== 4 || JSON.stringify(result.mixedLocked.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LINE", handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20 }, { x: 180, y: 90 }] },
    { type: "LINE", handle: "13", layer: "0", vertices: [{ x: 110, y: 60 }, { x: 280, y: 140 }] },
  ]) ||
  standardMatrix.schemaVersion !== 1 || standardMatrix.rowId !== "F-017" || standardMatrix.status !== "PASS" ||
  standardMatrix.copied?.revision !== 1 || JSON.stringify(standardMatrix.copied?.entities) !== JSON.stringify(f017ExpectedCommittedEntities) ||
  JSON.stringify(standardMatrix.copied?.sourceHandles) !== JSON.stringify(f017ExpectedSourceHandles) ||
  JSON.stringify(standardMatrix.copied?.copiedHandles) !== JSON.stringify(f017ExpectedCopiedHandles) ||
  JSON.stringify(standardMatrix.rejected) !== JSON.stringify(f017ExpectedRejected) ||
  standardMatrix.restored?.revision !== 2 || JSON.stringify(standardMatrix.restored?.entities) !== JSON.stringify(f017StandardDocument.entities)
) throw new Error(`F-017 browser capture mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-017-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-017 Chromium DXF and 12-family IndexedDB repeated COPY/UNDO matrix read back PASS.");
