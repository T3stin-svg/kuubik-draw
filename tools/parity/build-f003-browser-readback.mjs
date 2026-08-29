#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sourcePath = process.env.F003_BROWSER_DXF_PATH;
if (!sourcePath) throw new Error("F003_BROWSER_DXF_PATH must point to the captured Chromium DXF.");
const bytes = await readFile(sourcePath);
const parsed = new DxfParser().parseSync(bytes.toString("utf8"));
const rectangle = parsed?.entities?.[0];
const vertices = rectangle?.vertices?.map(({ x, y }) => [x, y]) ?? [];
const result = {
  schemaVersion: 1,
  rowId: "F-003",
  source: "Chromium DXF download captured by e2e/f003-rectangle.spec.ts with PARITY_CAPTURE_DIR",
  observedAt: new Date().toISOString(),
  dxfSha256: createHash("sha256").update(bytes).digest("hex"),
  units: parsed?.header?.$INSUNITS,
  entityCount: parsed?.entities?.length ?? 0,
  entityType: rectangle?.type,
  closed: rectangle?.shape === true,
  vertices,
  status: "PASS",
};
if (
  result.units !== 4 || result.entityCount !== 1 || result.entityType !== "LWPOLYLINE" || !result.closed ||
  JSON.stringify(vertices) !== JSON.stringify([[125.25, -200.5], [600.75, -200.5], [600.75, 900.125], [125.25, 900.125]])
) throw new Error(`F-003 browser capture mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-003-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-003 Chromium DXF capture and read-back PASS.");
