#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-10) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/style.css",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/match-properties.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/match-properties.test.ts",
  "packages/cad-core/test/f030-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f030-match-properties-roundtrip.test.ts",
  "e2e/f030-match-properties.spec.ts",
  "tools/parity/run-f030-readback.mjs",
  "tools/parity/capture-f030-browser.mjs",
  "tools/parity/build-f030-browser-readback.mjs",
];

const artifactNames = ["F-030-browser-matrix.json", "F-030-browser-physical.json", "F-030-browser-viewport.json", "F-030-browser.dxf", "F-030-browser.kdraw"];
const artifactBytes = Object.fromEntries(await Promise.all(artifactNames.map(async (name) => [name, await readFile(resolve(artifactRoot, name))])));
const matrix = JSON.parse(artifactBytes["F-030-browser-matrix.json"].toString("utf8"));
const physical = JSON.parse(artifactBytes["F-030-browser-physical.json"].toString("utf8"));
const viewport = JSON.parse(artifactBytes["F-030-browser-viewport.json"].toString("utf8"));
const dxfText = artifactBytes["F-030-browser.dxf"].toString("latin1");
const dxf = new DxfParser().parseSync(dxfText);
const kdraw = await deserializeKDraw(artifactBytes["F-030-browser.kdraw"]);
const sourceEntity = byHandle(matrix.source?.entities, "10");
const targetLine = byHandle(matrix.committed?.entities, "20");
const targetCircle = byHandle(matrix.committed?.entities, "30");
const dxfLine = byHandle(dxf?.entities, "20");
const dxfCircle = byHandle(dxf?.entities, "30");
const expectedAppearance = sourceEntity?.appearance;
const expectedViewport = { ...viewport.source.targetViewport, viewHeight: 1600, locked: true, on: false, shadePlot: "wireframe", snapEnabled: true, gridEnabled: true, ucsIconVisible: false, ucsIconAtOrigin: false };
const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-030" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  exactBasicPropertiesAndGeometry: targetLine?.layerId === "0" && targetCircle?.layerId === "0"
    && exact(targetLine?.appearance, expectedAppearance) && exact(targetCircle?.appearance, expectedAppearance)
    && exact({ start: targetLine?.start, end: targetLine?.end }, { start: { x: 0, y: 200 }, end: { x: 1000, y: 200 } })
    && exact({ center: targetCircle?.center, radius: targetCircle?.radius }, { center: { x: 500, y: 500 }, radius: 100 }),
  exactAtomicOperation: matrix.operation?.commandId === "MATCHPROP" && exact(matrix.operation?.targetHandles, ["20", "30"])
    && exact(matrix.operation?.resultHandles, ["20", "30"]) && exact(matrix.operation?.args?.targetHandles, ["10", "20", "30"])
    && matrix.operation?.args?.settings?.layer === false,
  persistentSettingsApplied: matrix.committed.entities.filter(({ handle }) => ["20", "30"].includes(handle)).every(({ layerId }) => layerId === "0"),
  atomicUndoExact: exact(matrix.undoRestored?.entities, matrix.source?.entities),
  atomicRedoExact: exact(matrix.redone?.entities, matrix.committed?.entities),
  physicalCanvasSourceAndTargets: physical.status === "PASS" && physical.sourceHandle === "10"
    && physical.preview === "MATCHPROP eelvaade: 2 tulemust · 0 muutmata" && physical.selectionSummary === "3 objekti · 2 valitud · 0",
  viewportSpecialExact: viewport.status === "PASS" && viewport.consoleErrors?.length === 0 && exact(viewport.committed, expectedViewport)
    && exact(viewport.undoRestored, viewport.source.targetViewport) && exact(viewport.redone, expectedViewport)
    && viewport.operation?.commandId === "MATCHPROP" && viewport.operation?.args?.kind === "viewport",
  downloadedKdrawContainerExact: kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1
    && kdraw.attachments.size === 0 && exact(kdraw.document.entities, matrix.committed?.entities),
  independentDxfExact: dxfLine?.layer === "0" && dxfCircle?.layer === "0" && dxfLine?.lineType === "HIDDEN" && dxfCircle?.lineType === "HIDDEN"
    && close(dxfLine?.lineTypeScale, 2.5) && close(dxfCircle?.lineTypeScale, 2.5) && dxfLine?.lineweight === 50 && dxfCircle?.lineweight === 50
    && /\r?\n 39\r?\n-3\.25\r?\n/u.test(dxfText) && dxfLine?.vertices?.length === 2 && close(dxfLine.vertices[0].x, 0) && close(dxfLine.vertices[1].x, 1000)
    && close(dxfCircle?.center?.x, 500) && close(dxfCircle?.center?.y, 500) && close(dxfCircle?.radius, 100),
};
if (Object.values(checks).some((pass) => pass !== true)) throw new Error(`F-030 browser read-back mismatch: ${JSON.stringify(checks)}`);
const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries(artifactNames.map((name) => {
  const bytes = artifactBytes[name];
  return [`evidence/artifacts/${name}`, { sha256: sha256(bytes), byteLength: bytes.length }];
}));
const report = { schemaVersion: 1, rowId: "F-030", status: "PASS", observedAt: new Date().toISOString(), checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-030-browser-readback.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-030 Chromium browser evidence PASS (persistent settings, physical selection, basic + viewport properties, atomic Undo/Redo, DXF and KDRAW1 read-back). ");
