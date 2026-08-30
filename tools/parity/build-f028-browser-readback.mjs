#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd(); const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const pointListMatches = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((point, index) => close(point.x, expected[index].x) && close(point.y, expected[index].y));
const sourcePaths = ["apps/web/src/App.tsx", "apps/web/src/style.css", "apps/web/src/workflows/modify-command.ts", "apps/web/src/workflows/modify-command.test.ts", "packages/cad-core/src/commands.ts", "packages/cad-core/src/index.ts", "packages/cad-core/src/lengthen.ts", "packages/cad-core/src/transaction.ts", "packages/cad-core/src/trim.ts", "packages/cad-core/test/lengthen.test.ts", "packages/cad-core/test/f028-mutation-proven.test.ts", "packages/cad-dxf/src/import.ts", "packages/cad-dxf/src/index.ts", "packages/cad-dxf/test/f028-lengthen-roundtrip.test.ts", "e2e/f028-lengthen.spec.ts", "tools/parity/run-f028-readback.mjs", "tools/parity/capture-f028-browser.mjs", "tools/parity/build-f028-browser-readback.mjs"];
const [matrixBytes, dynamicBytes, dxfBytes, kdrawBytes] = await Promise.all([readFile(resolve(artifactRoot, "F-028-browser-matrix.json")), readFile(resolve(artifactRoot, "F-028-browser-dynamic.json")), readFile(resolve(artifactRoot, "F-028-browser.dxf")), readFile(resolve(artifactRoot, "F-028-browser.kdraw"))]);
const matrix = JSON.parse(matrixBytes.toString("utf8")); const dynamic = JSON.parse(dynamicBytes.toString("utf8")); const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8")); const kdraw = await deserializeKDraw(kdrawBytes);
const committed = matrix.committed?.entities ?? []; const source = matrix.source?.entities ?? []; const line = byHandle(committed, "10"); const polyline = byHandle(committed, "20"); const locked = byHandle(committed, "40"); const dxfLine = byHandle(dxf?.entities, "10"); const dxfPolyline = byHandle(dxf?.entities, "20");
const dynamicEntity = dynamic.committed?.entities?.[0]; const dynamicCoordinates = dynamic.targetInput?.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-028" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  exactCommittedGeometry: exact(line?.end, { x: 125, y: 0 }) && exact(line?.appearance, { color: "#ff0000", lineweightMm: 0.35 }) && exact(line?.extensionData, { rowId: "F-028" })
    && exact(polyline?.vertices, [{ x: 0, y: 400, startWidth: 2, endWidth: 4 }, { x: 100, y: 400, startWidth: 4, endWidth: 6.5 }, { x: 100, y: 525, startWidth: 6, endWidth: 8 }]) && exact(locked, byHandle(source, "40")),
  exactAtomicOperation: matrix.operation?.commandId === "LENGTHEN" && exact(matrix.operation?.targetHandles, ["10", "20"]) && exact(matrix.operation?.resultHandles, ["10", "20"])
    && matrix.operation?.args?.mode === "delta" && matrix.operation?.args?.measurement === "length" && matrix.operation?.args?.value === 25 && matrix.operation?.args?.multiple === true,
  atomicUndoExact: exact(matrix.undoRestored?.entities, source), atomicRedoExact: exact(matrix.redone?.entities, committed),
  physicalDynamicCanvas: dynamic.rowId === "F-028" && dynamic.status === "PASS" && dynamicCoordinates.length === 5 && [10, 1000, 0, 1500, 50].every((value, index) => Math.abs(dynamicCoordinates[index] - value) <= 0.001)
    && dynamicEntity?.kind === "line" && Math.abs(dynamicEntity?.end?.x - 1500) <= 0.001 && Math.abs(dynamicEntity?.end?.y) <= 0.001,
  downloadedKdrawContainerExact: kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1 && kdraw.attachments.size === 0 && exact(kdraw.document.entities, committed),
  independentDxfExact: exact(dxf?.entities?.map((entity) => `${entity.handle}:${entity.type}`), ["10:LINE", "20:LWPOLYLINE", "40:LINE"])
    && pointListMatches(dxfLine?.vertices, [{ x: 0, y: 0 }, { x: 125, y: 0 }]) && dxfLine?.lineweight === 35
    && pointListMatches(dxfPolyline?.vertices, [{ x: 0, y: 400 }, { x: 100, y: 400 }, { x: 100, y: 525 }])
    && close(dxfPolyline?.vertices?.[1]?.startWidth, 4) && close(dxfPolyline?.vertices?.[1]?.endWidth, 6.5),
};
if (Object.values(checks).some((pass) => pass !== true)) throw new Error(`F-028 browser read-back mismatch: ${JSON.stringify(checks)}`);
const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries([["evidence/artifacts/F-028-browser-matrix.json", matrixBytes], ["evidence/artifacts/F-028-browser-dynamic.json", dynamicBytes], ["evidence/artifacts/F-028-browser.dxf", dxfBytes], ["evidence/artifacts/F-028-browser.kdraw", kdrawBytes]].map(([path, bytes]) => [path, { sha256: sha256(bytes), byteLength: bytes.length }]));
const report = { schemaVersion: 1, rowId: "F-028", status: "PASS", observedAt: new Date().toISOString(), checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-028-browser-readback.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-028 Chromium browser evidence PASS (Multiple Delta, physical Dynamic, locked refusal, atomic Undo/Redo, DXF and KDRAW1 read-back). ");
