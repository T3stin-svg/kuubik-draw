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
const close = (left, right, tolerance = 1e-3) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/break.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/break.test.ts",
  "packages/cad-core/test/f026-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f026-break-roundtrip.test.ts",
  "e2e/f026-break.spec.ts",
  "tools/parity/capture-f026-browser.mjs",
  "tools/parity/build-f026-browser-readback.mjs",
];

const [matrixBytes, canvasBytes, atPointBytes, dxfBytes, kdrawBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-026-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-026-browser-canvas.json")),
  readFile(resolve(artifactRoot, "F-026-browser-at-point.json")),
  readFile(resolve(artifactRoot, "F-026-browser.dxf")),
  readFile(resolve(artifactRoot, "F-026-browser.kdraw")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const canvas = JSON.parse(canvasBytes.toString("utf8"));
const atPoint = JSON.parse(atPointBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const kdraw = await deserializeKDraw(kdrawBytes);
const committed = matrix.committed?.entities ?? [];
const canvasFirst = byHandle(canvas.committed?.entities, "10");
const canvasSecond = byHandle(canvas.committed?.entities, "11");
const checks = {
  browserWorkflowsPassedWithoutErrors: matrix.rowId === "F-026" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0
    && canvas.rowId === "F-026" && canvas.status === "PASS" && atPoint.rowId === "F-026" && atPoint.status === "PASS",
  mixedBreakGeometryExact: committed.length === 3
    && byHandle(committed, "10")?.kind === "line" && exact(byHandle(committed, "10")?.end, { x: 500, y: 0 })
    && byHandle(committed, "21")?.kind === "line" && exact(byHandle(committed, "21")?.start, { x: 500, y: 0 })
    && byHandle(committed, "20")?.kind === "arc" && close(byHandle(committed, "20")?.startAngleRad, Math.PI / 2, 1e-9)
    && close(byHandle(committed, "20")?.endAngleRad, Math.PI * 2, 1e-9),
  exactAtomicOperation: matrix.operation?.commandId === "BREAK" && matrix.operation?.args?.multiple === true
    && exact(matrix.operation?.targetHandles, ["10", "20"]) && exact(matrix.operation?.resultHandles, ["10", "21", "20"])
    && exact(matrix.operation?.args?.targets?.map(({ handle, mode }) => ({ handle, mode })), [
      { handle: "10", mode: "at-point" }, { handle: "20", mode: "two-point" },
    ]),
  atomicUndoExact: exact(matrix.undoRestored?.entities, matrix.source?.entities),
  atomicRedoExact: exact(matrix.redone?.entities, committed),
  capturedKdrawPayloadExact: exact(matrix.restored?.entities, committed),
  downloadedKdrawContainerExact: kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1
    && kdraw.attachments.size === 0 && exact(kdraw.document.entities, committed),
  physicalCanvasProjectionExact: canvasFirst?.kind === "line" && canvasSecond?.kind === "line"
    && close(canvasFirst?.end?.x, 250) && close(canvasFirst?.end?.y, 1000)
    && close(canvasSecond?.start?.x, 750) && close(canvasSecond?.start?.y, 1000)
    && canvas.operation?.commandId === "BREAK" && exact(canvas.operation?.targetHandles, ["10"])
    && exact(canvas.operation?.resultHandles, ["10", "11"]),
  atPointAndLockedRefusalExact: byHandle(atPoint.opened?.entities, "10")?.kind === "arc"
    && byHandle(atPoint.opened?.entities, "21")?.kind === "arc"
    && exact(atPoint.lockedRestored, atPoint.source) && exact(atPoint.lockedOperations, [])
    && byHandle(atPoint.capabilityCommitted?.entities, "30")?.kind === "ellipse"
    && close(byHandle(atPoint.capabilityCommitted?.entities, "30")?.startParameter, 0, 1e-9)
    && close(byHandle(atPoint.capabilityCommitted?.entities, "30")?.endParameter, Math.PI / 2, 1e-9)
    && byHandle(atPoint.capabilityCommitted?.entities, "41")?.kind === "ellipse"
    && close(byHandle(atPoint.capabilityCommitted?.entities, "41")?.startParameter, Math.PI / 2, 1e-9)
    && close(byHandle(atPoint.capabilityCommitted?.entities, "41")?.endParameter, Math.PI, 1e-9)
    && exact(byHandle(atPoint.capabilityCommitted?.entities, "40"), byHandle(atPoint.capabilitySource?.entities, "40"))
    && exact(atPoint.capabilityOperation?.targetHandles, ["30"])
    && exact(atPoint.capabilityOperation?.resultHandles, ["30", "41"]),
  independentDxfExact: exact(dxf?.entities?.map((entity) => [entity.handle, entity.type]), [["10", "LINE"], ["20", "ARC"], ["21", "LINE"]]),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-026 browser read-back mismatch: ${JSON.stringify(checks)}`);

const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries([
  ["evidence/artifacts/F-026-browser-matrix.json", matrixBytes],
  ["evidence/artifacts/F-026-browser-canvas.json", canvasBytes],
  ["evidence/artifacts/F-026-browser-at-point.json", atPointBytes],
  ["evidence/artifacts/F-026-browser.dxf", dxfBytes],
  ["evidence/artifacts/F-026-browser.kdraw", kdrawBytes],
].map(([path, bytes]) => [path, { sha256: sha256(bytes), byteLength: bytes.length }]));
const result = { schemaVersion: 1, rowId: "F-026", status: "PASS", checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-026-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-026 Chromium browser evidence PASS (two-point/at-point, free projected second click, locked refusal, atomic Undo/Redo, DXF and KDRAW1 read-back).");
