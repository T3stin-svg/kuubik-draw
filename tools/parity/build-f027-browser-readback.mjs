#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const close = (left, right, tolerance = 1e-10) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/style.css",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/stretch.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/stretch.test.ts",
  "packages/cad-core/test/f027-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f027-stretch-roundtrip.test.ts",
  "e2e/f027-stretch.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/autocad/f027-runner.test.mjs",
  "tools/parity/capture-f027-browser.mjs",
  "tools/parity/build-f027-browser-readback.mjs",
];

const [matrixBytes, nativeEdgeBytes, lockedBytes, dragBytes, polygonBytes, ellipseBytes, ellipseDxfBytes, ellipseKdrawBytes, dxfBytes, kdrawBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-027-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-027-browser-native-edge-matrix.json")),
  readFile(resolve(artifactRoot, "F-027-browser-locked.json")),
  readFile(resolve(artifactRoot, "F-027-browser-drag.json")),
  readFile(resolve(artifactRoot, "F-027-browser-polygon.json")),
  readFile(resolve(artifactRoot, "F-027-browser-ellipse.json")),
  readFile(resolve(artifactRoot, "F-027-browser-ellipse.dxf")),
  readFile(resolve(artifactRoot, "F-027-browser-ellipse.kdraw")),
  readFile(resolve(artifactRoot, "F-027-browser.dxf")),
  readFile(resolve(artifactRoot, "F-027-browser.kdraw")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const nativeEdge = JSON.parse(nativeEdgeBytes.toString("utf8"));
const locked = JSON.parse(lockedBytes.toString("utf8"));
const drag = JSON.parse(dragBytes.toString("utf8"));
const polygon = JSON.parse(polygonBytes.toString("utf8"));
const ellipse = JSON.parse(ellipseBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const kdraw = await deserializeKDraw(kdrawBytes);
const ellipseDxf = new DxfParser().parseSync(ellipseDxfBytes.toString("utf8"));
const ellipseKdraw = await deserializeKDraw(ellipseKdrawBytes);
const committed = matrix.committed?.entities ?? [];
const dxfLine = byHandle(dxf?.entities, "10");
const dxfCircle = byHandle(dxf?.entities, "20");
const dxfPolyline = byHandle(dxf?.entities, "40");
const committedPolyline = byHandle(committed, "40");
const nativeWrapped = byHandle(nativeEdge.committed?.entities, "E2");
const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-027" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  exactPartialAndWholeGeometry: exact(byHandle(committed, "10")?.start, { x: 0, y: 0 })
    && exact(byHandle(committed, "10")?.end, { x: 1250, y: 50 })
    && exact(byHandle(committed, "20")?.center, { x: 1050, y: 50 })
    && exact(byHandle(committed, "30"), byHandle(matrix.source?.entities, "30"))
    && close(committedPolyline?.vertices?.[0]?.bulge, 0.39968038348871576, 1e-14)
    && close(committedPolyline?.vertices?.[1]?.bulge, -0.3325950526188697, 1e-14)
    && exact(committedPolyline?.vertices?.map(({ x, y, startWidth, endWidth }) => ({ x, y, startWidth, endWidth })), [
      { x: 0, y: 400, startWidth: 2, endWidth: 4 },
      { x: 1250, y: 450, startWidth: 4, endWidth: 6 },
      { x: 2000, y: 400, startWidth: 6, endWidth: 8 },
    ]),
  exactAtomicOperation: matrix.operation?.commandId === "STRETCH"
    && exact(matrix.operation?.targetHandles, ["10", "20", "40"])
    && exact(matrix.operation?.resultHandles, ["10", "20", "40"])
    && exact(matrix.operation?.args?.delta, { x: 250, y: 50 })
    && matrix.operation?.args?.steps?.length === 3,
  atomicUndoExact: exact(matrix.undoRestored?.entities, matrix.source?.entities),
  atomicRedoExact: exact(matrix.redone?.entities, committed),
  capturedKdrawPayloadExact: exact(matrix.restored?.entities, committed),
  downloadedKdrawContainerExact: kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1
    && kdraw.attachments.size === 0 && exact(kdraw.document.entities, committed),
  independentDxfExact: dxfLine?.type === "LINE" && exact(dxfLine.vertices?.map(({ x, y }) => ({ x, y })), [{ x: 0, y: 0 }, { x: 1250, y: 50 }])
    && dxfCircle?.type === "CIRCLE" && exact(dxfCircle.center && { x: dxfCircle.center.x, y: dxfCircle.center.y }, { x: 1050, y: 50 })
    && dxfCircle?.radius === 50 && dxfPolyline?.type === "LWPOLYLINE"
    && close(dxfPolyline?.vertices?.[0]?.bulge, 0.39968038348871576, 1e-14)
    && close(dxfPolyline?.vertices?.[1]?.bulge, -0.3325950526188697, 1e-14)
    && exact(dxfPolyline?.vertices?.map(({ x, y, startWidth, endWidth }) => ({ x, y, startWidth, endWidth })), [
      { x: 0, y: 400, startWidth: 2, endWidth: 4 },
      { x: 1250, y: 450, startWidth: 4, endWidth: 6 },
      { x: 2000, y: 400, startWidth: 6, endWidth: 8 },
    ]),
  nativeEdgeSemantics: nativeEdge.rowId === "F-027" && nativeEdge.status === "PASS" && nativeEdge.consoleErrors?.length === 0
    && exact(byHandle(nativeEdge.committed?.entities, "A1"), byHandle(nativeEdge.source?.entities, "A1"))
    && exact(byHandle(nativeEdge.committed?.entities, "E1"), byHandle(nativeEdge.source?.entities, "E1"))
    && close(nativeWrapped?.center?.x, 1016.321187837475, 1e-10)
    && close(nativeWrapped?.center?.y, 1024.7416264179425, 1e-10)
    && close(nativeWrapped?.majorAxis?.x, -95.68145757452969, 1e-10)
    && close(nativeWrapped?.majorAxis?.y, 29.35210104127352, 1e-10)
    && close(nativeWrapped?.ratio, 0.576564048333548, 1e-12)
    && close(nativeWrapped?.startParameter, 2.341890538582327, 1e-12)
    && close(nativeWrapped?.endParameter, 3.841890538582323, 1e-12)
    && exact(byHandle(nativeEdge.committed?.entities, "E3")?.center, { x: 1525, y: 1005 })
    && exact(byHandle(nativeEdge.committed?.entities, "C1")?.center, { x: 2025, y: 1005 }),
  lockedLayerRefusalExact: locked.rowId === "F-027" && locked.status === "PASS"
    && exact(locked.lockedRestored, locked.source) && exact(locked.lockedOperations, []),
  physicalCanvasCrossingDrag: drag.rowId === "F-027" && drag.status === "PASS" && drag.preview === "2 results / 2 steps"
    && Array.isArray(drag.coordinates) && drag.coordinates.length === 4
    && drag.coordinates.every((value, index) => Math.abs(value - [400, -100, 1100, 100][index]) <= 0.01),
  physicalCanvasCrossingPolygon: polygon.rowId === "F-027" && polygon.status === "PASS" && polygon.preview === "2 results / 2 steps"
    && Array.isArray(polygon.coordinates) && polygon.coordinates.length === 8
    && polygon.coordinates.every((value, index) => Math.abs(value - [400, -100, 1100, -100, 1100, 100, 400, 100][index]) <= 0.01),
  nativeMatchedQuarterEllipseOutput: ellipse.rowId === "F-027" && ellipse.status === "PASS"
    && exact(ellipse.restored?.entities, ellipse.committed?.entities)
    && Math.abs(ellipse.committed?.entities?.[0]?.center?.x - 1009.852004872791) <= 1e-10
    && Math.abs(ellipse.committed?.entities?.[0]?.center?.y - 998.9222357577537) <= 1e-10
    && Math.abs(ellipse.committed?.entities?.[0]?.majorAxis?.x - 115.564843901568) <= 1e-10
    && Math.abs(ellipse.committed?.entities?.[0]?.majorAxis?.y - 2.120881991279924) <= 1e-10
    && Math.abs(ellipse.committed?.entities?.[0]?.ratio - 0.444723039979619) <= 1e-12
    && Math.abs(ellipseDxf?.entities?.[0]?.axisRatio - 0.444723039979619) <= 1e-12
    && exact(ellipseKdraw.document.entities, ellipse.committed?.entities),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-027 browser read-back mismatch: ${JSON.stringify(checks)}`);

const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries([
  ["evidence/artifacts/F-027-browser-matrix.json", matrixBytes],
  ["evidence/artifacts/F-027-browser-native-edge-matrix.json", nativeEdgeBytes],
  ["evidence/artifacts/F-027-browser-locked.json", lockedBytes],
  ["evidence/artifacts/F-027-browser-drag.json", dragBytes],
  ["evidence/artifacts/F-027-browser-polygon.json", polygonBytes],
  ["evidence/artifacts/F-027-browser-ellipse.json", ellipseBytes],
  ["evidence/artifacts/F-027-browser-ellipse.dxf", ellipseDxfBytes],
  ["evidence/artifacts/F-027-browser-ellipse.kdraw", ellipseKdrawBytes],
  ["evidence/artifacts/F-027-browser.dxf", dxfBytes],
  ["evidence/artifacts/F-027-browser.kdraw", kdrawBytes],
].map(([path, bytes]) => [path, { sha256: sha256(bytes), byteLength: bytes.length }]));
const result = { schemaVersion: 1, rowId: "F-027", status: "PASS", observedAt: new Date().toISOString(), checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-027-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-027 Chromium browser evidence PASS (physical crossing window/polygon, crossing union, partial stretch, whole move, locked refusal, atomic Undo/Redo, DXF and KDRAW1 read-back).");
