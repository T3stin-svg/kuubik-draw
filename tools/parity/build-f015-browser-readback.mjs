#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sources = {
  empty: resolve(artifactRoot, "F-015-browser-empty.dxf"),
  restored: resolve(artifactRoot, "F-015-browser-restored.dxf"),
  locked: resolve(artifactRoot, "F-015-browser-locked.dxf"),
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const summarizeEntity = (entity) => ({
  type: entity.type,
  handle: entity.handle,
  layer: entity.layer,
  closed: entity.shape === true,
  vertices: entity.vertices?.map(({ x, y }) => ({ x, y })) ?? [],
});
const read = async (path) => {
  const bytes = await readFile(path);
  const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
  return {
    sha256: sha256(bytes),
    units: parsed?.header?.$INSUNITS,
    entities: parsed?.entities.map(summarizeEntity) ?? [],
  };
};
const result = {
  schemaVersion: 1,
  rowId: "F-015",
  source: "Chromium downloads captured by e2e/f015-erase.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  empty: await read(sources.empty),
  restored: await read(sources.restored),
  locked: await read(sources.locked),
  status: "PASS",
};
const line = result.restored.entities.find((entity) => entity.type === "LINE");
const rectangle = result.restored.entities.find((entity) => entity.type === "LWPOLYLINE");
const locked = result.locked.entities[0];
if (
  result.empty.units !== 4 || result.empty.entities.length !== 0 ||
  result.restored.units !== 4 || result.restored.entities.length !== 2 ||
  line?.handle !== "10" || JSON.stringify(line.vertices) !== JSON.stringify([{ x: 10, y: 10 }, { x: 180, y: 90 }]) ||
  rectangle?.handle !== "11" || rectangle.layer !== "0" || !rectangle.closed ||
  result.locked.units !== 4 || result.locked.entities.length !== 1 ||
  locked?.handle !== "12" || locked.layer !== "layer-1" || !locked.closed ||
  JSON.stringify(locked.vertices) !== JSON.stringify([
    { x: 125.25, y: -200.5 }, { x: 600.75, y: -200.5 },
    { x: 600.75, y: 900.125 }, { x: 125.25, y: 900.125 },
  ])
) {
  throw new Error(`F-015 browser capture mismatch: ${JSON.stringify(result)}`);
}
await writeFile(resolve(artifactRoot, "F-015-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-015 Chromium empty/restored/locked downloads captured and read back PASS.");
