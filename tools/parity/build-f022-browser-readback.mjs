#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-renderer/src/index.ts",
  "packages/cad-renderer/src/selection.ts",
  "packages/cad-renderer/test/selection.test.ts",
  "e2e/f022-trim.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/parity/capture-f022-browser.mjs",
  "tools/parity/build-f022-browser-readback.mjs",
  "package-lock.json",
];
const json = async (name) => JSON.parse(await readFile(resolve(artifactRoot, name), "utf8"));
const dxf = async (name) => {
  const bytes = await readFile(resolve(artifactRoot, name));
  return { bytes, document: new DxfParser().parseSync(bytes.toString("utf8")) };
};

const [standard, quick, shiftExtend, options, composite, closedCurves, spline, standardDxf, circleDxf, ellipseDxf, splineSourceDxf, splineDxf] = await Promise.all([
  json("F-022-browser-standard.json"),
  json("F-022-browser-quick.json"),
  json("F-022-browser-shift-extend.json"),
  json("F-022-browser-options.json"),
  json("F-022-browser-composite.json"),
  json("F-022-browser-closed-curves.json"),
  json("F-022-browser-spline.json"),
  dxf("F-022-browser-standard.dxf"),
  dxf("F-022-browser-circle.dxf"),
  dxf("F-022-browser-ellipse.dxf"),
  dxf("F-022-browser-spline-source.dxf"),
  dxf("F-022-browser-spline.dxf"),
]);

const result = {
  schemaVersion: 1,
  rowId: "F-022",
  source: "Chromium 1920x1080 visible controls, IndexedDB and downloaded production DXF",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  standard,
  quick,
  shiftExtend,
  options,
  composite,
  closedCurves,
  spline,
  downloads: {
    standard: { sha256: sha256(standardDxf.bytes), types: standardDxf.document?.entities.map((entity) => entity.type), handles: standardDxf.document?.entities.map((entity) => entity.handle) },
    circle: { sha256: sha256(circleDxf.bytes), types: circleDxf.document?.entities.map((entity) => entity.type) },
    ellipse: { sha256: sha256(ellipseDxf.bytes), types: ellipseDxf.document?.entities.map((entity) => entity.type) },
    spline: {
      sourceSha256: sha256(splineSourceDxf.bytes),
      sourceTypes: splineSourceDxf.document?.entities.map((entity) => entity.type),
      sha256: sha256(splineDxf.bytes),
      types: splineDxf.document?.entities.map((entity) => entity.type),
      splines: splineDxf.document?.entities.filter((entity) => entity.type === "SPLINE").map((entity) => ({
        handle: entity.handle,
        degree: entity.degreeOfSplineCurve,
        controlPointCount: entity.controlPoints?.length,
        knotCount: entity.knotValues?.length,
      })),
    },
  },
  status: "PASS",
};

const errors = [standard, quick, shiftExtend, options, composite, closedCurves, spline].flatMap((item) => item.consoleErrors ?? []);
const compositePolyline = composite.polyline?.entities?.find((entity) => entity.handle === "10");
const compositeHatchLines = composite.hatch?.entities?.filter((entity) => entity.kind === "line");
const compositeBlockLine = composite.block?.entities?.find((entity) => entity.handle === "10");
const layeredInheritedLine = composite.layeredBlock?.entities?.find((entity) => entity.handle === "10");
const layeredHiddenLine = composite.layeredBlock?.entities?.find((entity) => entity.handle === "11");
const layeredFrozenLine = composite.layeredBlock?.entities?.find((entity) => entity.handle === "12");
if (
  [standard, quick, shiftExtend, options, composite, closedCurves, spline].some((item) => item.rowId !== "F-022" || item.status !== "PASS")
  || errors.length !== 0
  || standard.committed?.revision !== 1 || standard.operation?.commandId !== "TRIM"
  || JSON.stringify(standard.operation?.resultHandles) !== JSON.stringify(["10", "22"])
  || JSON.stringify(standard.committed?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["10", "20", "21", "22"])
  || standard.restored?.revision !== 2 || JSON.stringify(standard.restored?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["10", "20", "21"])
  || JSON.stringify(quick.trimmed?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["10", "20", "21", "22"])
  || JSON.stringify(quick.trimOperation?.resultHandles) !== JSON.stringify(["10", "22"])
  || quick.trimOperation?.args?.mode !== "quick" || quick.trimOperation?.args?.cuttingEdgeHandles?.length !== 0
  || JSON.stringify(quick.committed?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["20"])
  || JSON.stringify(quick.restored?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["10", "20"])
  || shiftExtend.physicalInput?.modifier !== "Shift" || !Number.isFinite(shiftExtend.physicalInput?.pointer?.x) || !Number.isFinite(shiftExtend.physicalInput?.pointer?.y)
  || shiftExtend.committed?.entities?.[0]?.end?.x !== 100 || shiftExtend.operation?.args?.targets?.[0]?.action !== "extend"
  || options.noExtendRevision !== 0 || !["none", "ucs", "view"].every((mode) => options.projects?.[mode]?.entities?.[0]?.start?.x === 50)
  || JSON.stringify(options.erased?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["20"])
  || options.refused?.revision !== 0 || JSON.stringify(options.rejected) !== JSON.stringify([
    { handle: "10", targetIndex: 0, reason: "locked-layer" },
    { handle: "11", targetIndex: 1, reason: "hidden-layer" },
  ])
  || compositePolyline?.kind !== "polyline" || compositePolyline.closed !== false
  || JSON.stringify(compositePolyline.vertices) !== JSON.stringify([
    { x: 75, y: 0, startWidth: 5, endWidth: 6 },
    { x: 100, y: 0, bulge: 1, startWidth: 3, endWidth: 5 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 0, startWidth: 2, endWidth: 3 },
    { x: 25, y: 0, startWidth: 2, endWidth: 3 },
  ])
  || JSON.stringify(compositeHatchLines?.map((entity) => entity.handle)) !== JSON.stringify(["10"])
  || compositeHatchLines?.[0]?.start?.x !== 0 || compositeHatchLines?.[0]?.end?.x !== 100
  || compositeBlockLine?.start?.x !== 60 || compositeBlockLine?.start?.y !== 0 || compositeBlockLine?.end?.x !== 100
  || composite.cycle?.revision !== 0 || JSON.stringify(composite.cycle?.entities?.map((entity) => entity.handle)) !== JSON.stringify(["10", "21"])
  || composite.cycle?.entities?.[0]?.start?.x !== 0 || composite.cycle?.entities?.[0]?.end?.x !== 100
  || composite.cycle?.entities?.[1]?.kind !== "blockRef" || composite.cycle?.entities?.[1]?.blockId !== "cycle"
  || layeredInheritedLine?.start?.x !== 25 || layeredInheritedLine?.end?.x !== 100
  || layeredHiddenLine?.start?.x !== 0 || layeredHiddenLine?.end?.x !== 100
  || layeredFrozenLine?.start?.x !== 0 || layeredFrozenLine?.end?.x !== 100
  || JSON.stringify(closedCurves.circle?.map((entity) => entity.kind)) !== JSON.stringify(["arc", "line"])
  || JSON.stringify(closedCurves.ellipse?.map((entity) => entity.kind)) !== JSON.stringify(["ellipse", "line"])
  || JSON.stringify(spline.committed?.entities?.filter((entity) => entity.kind === "spline").map((entity) => ({ handle: entity.handle, knots: entity.knots, weights: entity.weights }))) !== JSON.stringify([
    { handle: "10", knots: [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25], weights: [2, 2, 2, 2] },
    { handle: "22", knots: [0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1], weights: [2, 2, 2, 2] },
  ])
  || Math.abs((spline.tangentCommitted?.entities?.find((entity) => entity.kind === "spline")?.controlPoints?.[0]?.x ?? Number.NaN) - 0.37) > 1e-7
  || Math.abs(spline.tangentCommitted?.entities?.find((entity) => entity.kind === "spline")?.controlPoints?.[0]?.y ?? Number.NaN) > 1e-8
  || JSON.stringify(result.downloads.standard.types) !== JSON.stringify(["LINE", "LINE", "LINE", "LINE"])
  || JSON.stringify(result.downloads.standard.handles) !== JSON.stringify(["10", "20", "21", "22"])
  || JSON.stringify(result.downloads.circle.types) !== JSON.stringify(["ARC", "LINE"])
  || JSON.stringify(result.downloads.ellipse.types) !== JSON.stringify(["ELLIPSE", "LINE"])
  || JSON.stringify(result.downloads.spline.sourceTypes) !== JSON.stringify(["SPLINE", "LINE", "LINE"])
  || JSON.stringify(result.downloads.spline.types) !== JSON.stringify(["SPLINE", "LINE", "LINE", "SPLINE"])
  || JSON.stringify(result.downloads.spline.splines) !== JSON.stringify([
    { handle: "10", degree: 3, controlPointCount: 4, knotCount: 8 },
    { handle: "22", degree: 3, controlPointCount: 4, knotCount: 8 },
  ])
) throw new Error(`F-022 browser read-back mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-022-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-022 Chromium Standard/Quick/Fence/Crossing/Shift-Extend/closed-curves/SPLINE production read-back PASS.");
