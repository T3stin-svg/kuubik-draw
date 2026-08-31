#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-10) => Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const pointListMatches = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
  && actual.every((point, index) => close(point.x, expected[index].x) && close(point.y, expected[index].y));
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/style.css",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/test/align.test.ts",
  "packages/cad-core/test/f029-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f029-align-roundtrip.test.ts",
  "e2e/f029-align.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/parity/run-f029-readback.mjs",
  "tools/parity/capture-f029-browser.mjs",
  "tools/parity/build-f029-browser-readback.mjs",
];

const [matrixBytes, dxfBytes, kdrawBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-029-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-029-browser.dxf")),
  readFile(resolve(artifactRoot, "F-029-browser.kdraw")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const kdraw = await deserializeKDraw(kdrawBytes);
const committed = matrix.committed?.entities ?? [];
const source = matrix.source?.entities ?? [];
const line = byHandle(committed, "10");
const polyline = byHandle(committed, "20");
const locked = byHandle(committed, "30");
const dxfLine = byHandle(dxf?.entities, "10");
const dxfPolyline = byHandle(dxf?.entities, "20");
const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-029" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  exactCommittedGeometry: exact(line?.start, { x: 100, y: 200 }) && exact(line?.end, { x: 100, y: 400 })
    && exact(line?.appearance, { color: "#ff0000", lineweightMm: 0.35 })
    && exact(line?.extensionData, { rowId: "F-029" })
    && exact(polyline?.vertices, [
      { x: -300, y: 200, startWidth: 4, endWidth: 8 },
      { x: -300, y: 400, startWidth: 8, endWidth: 12 },
    ])
    && exact(locked, byHandle(source, "30")),
  exactAtomicOperation: matrix.operation?.commandId === "ALIGN"
    && exact(matrix.operation?.targetHandles, ["10", "20"])
    && exact(matrix.operation?.resultHandles, ["10", "20"])
    && exact(matrix.operation?.args?.targetHandles, ["10", "20", "30"])
    && matrix.operation?.args?.pointPairCount === 2
    && matrix.operation?.args?.scaleToFit === true
    && close(matrix.operation?.args?.angleRad, Math.PI / 2)
    && close(matrix.operation?.args?.scaleFactor, 2),
  atomicUndoExact: exact(matrix.undoRestored?.entities, source),
  atomicRedoExact: exact(matrix.redone?.entities, committed),
  downloadedKdrawContainerExact: kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1
    && kdraw.attachments.size === 0 && exact(kdraw.document.entities, committed),
  independentDxfExact: exact(dxf?.entities?.map((entity) => `${entity.handle}:${entity.type}`), ["10:LINE", "20:LWPOLYLINE", "30:LINE"])
    && pointListMatches(dxfLine?.vertices, [{ x: 100, y: 200 }, { x: 100, y: 400 }])
    && dxfLine?.lineweight === 35
    && pointListMatches(dxfPolyline?.vertices, [{ x: -300, y: 200 }, { x: -300, y: 400 }])
    && close(dxfPolyline?.vertices?.[0]?.startWidth, 4)
    && close(dxfPolyline?.vertices?.[0]?.endWidth, 8)
    && close(dxfPolyline?.vertices?.[1]?.startWidth, 8)
    && close(dxfPolyline?.vertices?.[1]?.endWidth, 12),
};
if (Object.values(checks).some((pass) => pass !== true)) throw new Error(`F-029 browser read-back mismatch: ${JSON.stringify(checks)}`);

const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries([
  ["evidence/artifacts/F-029-browser-matrix.json", matrixBytes],
  ["evidence/artifacts/F-029-browser.dxf", dxfBytes],
  ["evidence/artifacts/F-029-browser.kdraw", kdrawBytes],
].map(([path, bytes]) => [path, { sha256: sha256(bytes), byteLength: bytes.length }]));
const report = { schemaVersion: 1, rowId: "F-029", status: "PASS", observedAt: new Date().toISOString(), checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-029-browser-readback.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-029 Chromium browser evidence PASS (physical two-pair ALIGN, Scale Yes, locked refusal, atomic Undo/Redo, DXF and KDRAW1 read-back). ");
