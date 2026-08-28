#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

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
const result = {
  schemaVersion: 1,
  rowId: "F-016",
  source: "Chromium downloads captured by e2e/f016-move.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  moved: await read("F-016-browser-moved.dxf"),
  restored: await read("F-016-browser-restored.dxf"),
  mixedLocked: await read("F-016-browser-locked.dxf"),
  status: "PASS",
};
if (
  result.moved.units !== 4 || JSON.stringify(result.moved.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 510, y: 760 }, { x: 680, y: 840 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 500, y: 1750 }, { x: 1500, y: 1750 }, { x: 1500, y: 2250 }, { x: 500, y: 2250 }] },
  ]) ||
  result.restored.units !== 4 || JSON.stringify(result.restored.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]) ||
  result.mixedLocked.units !== 4 || JSON.stringify(result.mixedLocked.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 110, y: 60 }, { x: 280, y: 140 }] },
    { type: "LINE", handle: "12", layer: "layer-1", vertices: [{ x: 10, y: 20 }, { x: 180, y: 90 }] },
  ])
) throw new Error(`F-016 browser capture mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-016-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-016 Chromium moved/restored/mixed-locked downloads captured and read back PASS.");
