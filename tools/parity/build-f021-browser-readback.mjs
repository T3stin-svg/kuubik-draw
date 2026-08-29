#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dxfBytes = await readFile(resolve(artifactRoot, "F-021-browser-distance-multiple.dxf"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const distance = JSON.parse(await readFile(resolve(artifactRoot, "F-021-browser-distance-multiple.json"), "utf8"));
const families = JSON.parse(await readFile(resolve(artifactRoot, "F-021-browser-five-family-matrix.json"), "utf8"));
const edgeMatrix = JSON.parse(await readFile(resolve(artifactRoot, "F-021-browser-edge-matrix.json"), "utf8"));
const entities = dxf?.entities.map((entity) => ({
  type: entity.type, handle: entity.handle, layer: entity.layer,
  vertices: entity.vertices?.map(({ x, y }) => ({ x, y })) ?? [],
})) ?? [];
const result = {
  schemaVersion: 1, rowId: "F-021", source: "Chromium downloads and IndexedDB captured by e2e/f021-offset.spec.ts",
  observedAt: new Date().toISOString(), dxf: { sha256: sha256(dxfBytes), units: dxf?.header?.$INSUNITS, entities }, distance, families, edgeMatrix, status: "PASS",
};
if (
  result.dxf.units !== 4 || JSON.stringify(entities) !== JSON.stringify([
    { type: "LINE", handle: "10", layer: "F021_SOURCE", vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
    { type: "LINE", handle: "11", layer: "F021_SOURCE", vertices: [{ x: 0, y: 100 }, { x: 1000, y: 100 }] },
    { type: "LINE", handle: "12", layer: "F021_SOURCE", vertices: [{ x: 0, y: 200 }, { x: 1000, y: 200 }] },
  ]) || distance.rowId !== "F-021" || distance.status !== "PASS" || distance.operation?.commandId !== "OFFSET" ||
  JSON.stringify(distance.operation?.resultHandles) !== JSON.stringify(["11", "12"]) || distance.restored?.revision !== 2 || distance.restored?.entities?.length !== 1 ||
  families.rowId !== "F-021" || families.status !== "PASS" || families.operation?.commandId !== "OFFSET" ||
  JSON.stringify(families.created?.map(({ kind }) => kind)) !== JSON.stringify(["line", "polyline", "circle", "arc", "spline"]) || families.restored?.length !== 7 ||
  edgeMatrix.rowId !== "F-021" || edgeMatrix.status !== "PASS" || edgeMatrix.observations?.closed?.closed !== true ||
  edgeMatrix.observations?.bulged?.vertices?.[0]?.bulge !== 1 || edgeMatrix.observations?.concave?.rejected?.[0]?.reason !== "self-intersection" ||
  JSON.stringify(edgeMatrix.observations?.ellipseInwardSplit?.created?.map(({ kind, closed }) => ({ kind, closed }))) !== JSON.stringify([{ kind: "spline", closed: false }, { kind: "spline", closed: false }])
) throw new Error(`F-021 browser capture mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-021-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-021 Chromium DXF, five-family and closed/bulged/collapse edge matrices read back PASS.");
