#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  f019ExpectedCommittedEntities,
  f019ExpectedRejected,
  f019ExpectedScaledHandles,
  f019StandardDocument,
} from "../../parity/fixtures/f019-standard-fixture.mjs";

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
const standardMatrix = JSON.parse(await readFile(resolve(artifactRoot, "F-019-browser-standard-matrix.json"), "utf8"));
const factorOneUndo = JSON.parse(await readFile(resolve(artifactRoot, "F-019-browser-factor-one-undo.json"), "utf8"));
const result = {
  schemaVersion: 1,
  rowId: "F-019",
  source: "Chromium downloads captured by e2e/f019-scale.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  scaled: await read("F-019-browser-scaled.dxf"),
  restored: await read("F-019-browser-restored.dxf"),
  mixedLocked: await read("F-019-browser-locked.dxf"),
  copied: await read("F-019-browser-copied.dxf"),
  factorOneUndo,
  standardMatrix,
  status: "PASS",
};
if (
  result.scaled.units !== 4 || JSON.stringify(result.scaled.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 20, y: 20 }, { x: 360, y: 180 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }] },
  ]) ||
  result.restored.units !== 4 || JSON.stringify(result.restored.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LWPOLYLINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] },
  ]) ||
  result.mixedLocked.units !== 4 || JSON.stringify(result.mixedLocked.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 20, y: 20 }, { x: 360, y: 180 }] },
    { type: "LINE", handle: "12", layer: "Layer 1", vertices: [{ x: 10, y: 20 }, { x: 180, y: 90 }] },
  ]) ||
  result.copied.units !== 4 || JSON.stringify(result.copied.entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 10, y: 10 }, { x: 180, y: 90 }] },
    { type: "LINE", handle: "11", layer: "0", vertices: [{ x: 20, y: 20 }, { x: 360, y: 180 }] },
  ]) ||
  factorOneUndo.schemaVersion !== 1 || factorOneUndo.rowId !== "F-019" || factorOneUndo.status !== "PASS" ||
  factorOneUndo.factorOne?.revision !== 2 || factorOneUndo.afterOneUndo?.revision !== 3 ||
  JSON.stringify(factorOneUndo.factorOne?.entities) !== JSON.stringify(factorOneUndo.afterOneUndo?.entities) ||
  JSON.stringify(factorOneUndo.factorOne?.operations?.map(({ commandId }) => commandId)) !== JSON.stringify(["LINE", "SCALE"]) ||
  JSON.stringify(factorOneUndo.afterOneUndo?.operations?.map(({ commandId }) => commandId)) !== JSON.stringify(["LINE", "SCALE", "UNDO"]) ||
  factorOneUndo.factorOne?.operations?.[1]?.args?.factor !== 1 || factorOneUndo.factorOne?.operations?.[1]?.args?.geometryNoOp !== true ||
  JSON.stringify(factorOneUndo.factorOne?.operations?.[1]?.targetHandles) !== JSON.stringify(["10"]) ||
  JSON.stringify(factorOneUndo.factorOne?.operations?.[1]?.resultHandles) !== JSON.stringify([]) ||
  standardMatrix.schemaVersion !== 1 || standardMatrix.rowId !== "F-019" || standardMatrix.status !== "PASS" ||
  standardMatrix.scaled?.revision !== 1 || JSON.stringify(standardMatrix.scaled?.entities) !== JSON.stringify(f019ExpectedCommittedEntities) ||
  JSON.stringify(standardMatrix.scaled?.scaledHandles) !== JSON.stringify(f019ExpectedScaledHandles) ||
  JSON.stringify(standardMatrix.rejected) !== JSON.stringify(f019ExpectedRejected) ||
  standardMatrix.restored?.revision !== 2 || JSON.stringify(standardMatrix.restored?.entities) !== JSON.stringify(f019StandardDocument.entities)
) throw new Error(`F-019 browser capture mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-019-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-019 Chromium DXF and 12-family IndexedDB SCALE/Copy/UNDO matrix read back PASS.");
