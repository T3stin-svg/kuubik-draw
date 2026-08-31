#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/chamfer.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/chamfer.test.ts",
  "packages/cad-core/test/f025-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f025-chamfer-roundtrip.test.ts",
  "e2e/f025-chamfer.spec.ts",
  "e2e/helpers/model-space.ts",
  "tools/parity/capture-f025-browser.mjs",
  "tools/parity/build-f025-browser-readback.mjs",
];

const [matrixBytes, modesBytes, shiftNoOpBytes, modeTransitionBytes, edgeCasesBytes, seamForwardBytes, seamReverseBytes, propertiesBytes, propertiesDxfBytes, propertiesKdrawBytes, constructionBytes, constructionDxfBytes, constructionKdrawBytes, zeroBytes, zeroDxfBytes, zeroKdrawBytes, oversizedBytes, oversizedDxfBytes, oversizedKdrawBytes, dxfBytes, kdrawBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-025-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-025-browser-modes.json")),
  readFile(resolve(artifactRoot, "F-025-browser-shift-no-op.json")),
  readFile(resolve(artifactRoot, "F-025-browser-mode-transition.json")),
  readFile(resolve(artifactRoot, "F-025-browser-edge-cases.json")),
  readFile(resolve(artifactRoot, "F-025-browser-seam-forward.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser-seam-reverse.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser-properties.json")),
  readFile(resolve(artifactRoot, "F-025-browser-properties.dxf")),
  readFile(resolve(artifactRoot, "F-025-browser-properties.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser-construction.json")),
  readFile(resolve(artifactRoot, "F-025-browser-construction.dxf")),
  readFile(resolve(artifactRoot, "F-025-browser-construction.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser-zero.json")),
  readFile(resolve(artifactRoot, "F-025-browser-zero.dxf")),
  readFile(resolve(artifactRoot, "F-025-browser-zero.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser-distance-too-large.json")),
  readFile(resolve(artifactRoot, "F-025-browser-distance-too-large.dxf")),
  readFile(resolve(artifactRoot, "F-025-browser-distance-too-large.kdraw")),
  readFile(resolve(artifactRoot, "F-025-browser.dxf")),
  readFile(resolve(artifactRoot, "F-025-browser.kdraw")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const modes = JSON.parse(modesBytes.toString("utf8"));
const shiftNoOp = JSON.parse(shiftNoOpBytes.toString("utf8"));
const modeTransition = JSON.parse(modeTransitionBytes.toString("utf8"));
const edgeCases = JSON.parse(edgeCasesBytes.toString("utf8"));
const properties = JSON.parse(propertiesBytes.toString("utf8"));
const construction = JSON.parse(constructionBytes.toString("utf8"));
const zero = JSON.parse(zeroBytes.toString("utf8"));
const oversized = JSON.parse(oversizedBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const propertiesDxf = new DxfParser().parseSync(propertiesDxfBytes.toString("utf8"));
const zeroDxf = new DxfParser().parseSync(zeroDxfBytes.toString("utf8"));
const oversizedDxf = new DxfParser().parseSync(oversizedDxfBytes.toString("utf8"));
const kdraw = await deserializeKDraw(kdrawBytes);
const seamForwardKdraw = await deserializeKDraw(seamForwardBytes);
const seamReverseKdraw = await deserializeKDraw(seamReverseBytes);
const propertiesKdraw = await deserializeKDraw(propertiesKdrawBytes);
const constructionKdraw = await deserializeKDraw(constructionKdrawBytes);
const zeroKdraw = await deserializeKDraw(zeroKdrawBytes);
const oversizedKdraw = await deserializeKDraw(oversizedKdrawBytes);
const byHandle = (entities, handle) => entities?.find((entity) => entity.handle === handle);
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const point = (value, x, y) => Number.isFinite(value?.x) && Number.isFinite(value?.y)
  && Math.abs(value.x - x) <= 1e-9 && Math.abs(value.y - y) <= 1e-9;
const line = (entity, start, end) => entity?.kind === "line" && point(entity.start, ...start) && point(entity.end, ...end);
const dxfLine = (entity, start, end) => entity?.type === "LINE" && point(entity.vertices?.[0], ...start) && point(entity.vertices?.[1], ...end);
const rawRecord = (bytes, type, handle) => {
  const lines = bytes.toString("utf8").replace(/\r/gu, "").split("\n");
  for (let index = 0; index + 3 < lines.length; index += 2) {
    if (lines[index]?.trim() !== "0" || lines[index + 1]?.trim() !== type) continue;
    const groups = {};
    for (let pairIndex = index + 2; pairIndex + 1 < lines.length; pairIndex += 2) {
      const code = lines[pairIndex]?.trim(); const value = lines[pairIndex + 1]?.trim();
      if (code === "0") break;
      groups[code] = value;
    }
    if (groups["5"] === handle) return groups;
  }
  return null;
};
const rawPoint = (record, xCode, yCode) => [Number(record?.[xCode]), Number(record?.[yCode])];
const expectedPolyline = [
  { x: 100, y: 0 }, { x: 900, y: 0 }, { x: 1000, y: 100 }, { x: 1000, y: 900 },
  { x: 900, y: 1000 }, { x: 100, y: 1000 }, { x: 0, y: 900 }, { x: 0, y: 100 },
];
const committed = matrix.committed?.entities ?? [];
const dxfEntities = dxf?.entities ?? [];
const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-025" && matrix.status === "PASS"
    && modes.rowId === "F-025" && modes.status === "PASS"
    && matrix.consoleErrors?.length === 0 && modes.consoleErrors?.length === 0,
  distanceMultipleExact: committed.length === 6
    && line(byHandle(committed, "10"), [-1000, 0], [-100, 0])
    && line(byHandle(committed, "20"), [0, 200], [0, 1000])
    && line(byHandle(committed, "30"), [1100, 0], [2000, 0])
    && line(byHandle(committed, "40"), [1000, 200], [1000, 1000])
    && line(byHandle(committed, "41"), [-100, 0], [0, 200])
    && line(byHandle(committed, "42"), [1100, 0], [1000, 200]),
  exactAtomicOperation: matrix.operation?.baseRevision === 0 && matrix.operation?.commandId === "CHAMFER"
    && matrix.operation?.args?.mode === "pairs" && matrix.operation?.args?.trimMode === "trim"
    && matrix.operation?.args?.multiple === true
    && exact(matrix.operation?.args?.specification, { method: "distance", firstDistance: 100, secondDistance: 200 })
    && exact(matrix.operation?.args?.pairs, [
      { firstHandle: "10", firstPickPoint: { x: -500, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 500 } },
      { firstHandle: "30", firstPickPoint: { x: 1500, y: 0 }, secondHandle: "40", secondPickPoint: { x: 1000, y: 500 } },
    ])
    && exact(matrix.operation?.args?.steps, [
      { mode: "pair", sourceHandles: ["10", "20"], resultHandles: ["10", "20", "41"], method: "distance", effectiveDistances: [100, 200], chamferPoints: [{ x: -100, y: 0 }, { x: 0, y: 200 }], skippedVertices: [] },
      { mode: "pair", sourceHandles: ["30", "40"], resultHandles: ["30", "40", "42"], method: "distance", effectiveDistances: [100, 200], chamferPoints: [{ x: 1100, y: 0 }, { x: 1000, y: 200 }], skippedVertices: [] },
    ])
    && exact(matrix.operation?.targetHandles, ["10", "20", "30", "40"])
    && exact(matrix.operation?.resultHandles, ["10", "20", "41", "30", "40", "42"]),
  atomicUndoRedoAndKdraw: exact(matrix.undoRestored?.entities, matrix.source?.entities)
    && exact(matrix.redone?.entities, committed)
    && exact(matrix.restored?.entities, committed)
    && kdraw.manifest.documentPath === "document.json" && kdraw.manifest.entries.length === 1
    && kdraw.attachments.size === 0 && exact(kdraw.document.entities, committed),
  angleNoTrimExact: exact(modes.noTrim?.entities?.slice(0, 4), modes.angleSource?.entities)
    && line(modes.noTrim?.entities?.[4], [-100, 0], [0, 100])
    && modes.angleOperation?.commandId === "CHAMFER"
    && exact(modes.angleOperation?.args?.specification, { method: "angle", firstDistance: 100, angleDeg: 45 })
    && modes.angleOperation?.args?.trimMode === "no-trim",
  polylineExact: modes.polyline?.entities?.length === 1
    && modes.polyline?.entities?.[0]?.kind === "polyline"
    && modes.polyline?.entities?.[0]?.handle === "10"
    && exact(modes.polyline.entities[0].vertices, expectedPolyline)
    && modes.polylineOperation?.commandId === "CHAMFER"
    && exact(modes.polylineOperation?.targetHandles, ["10"])
    && exact(modes.polylineOperation?.resultHandles, ["10"]),
  shiftNoOpPreviewEqualsCommit: shiftNoOp.status === "PASS" && shiftNoOp.hiddenSourceCount === 0
    && exact(shiftNoOp.restored, shiftNoOp.source) && exact(shiftNoOp.operations, []),
  canvasPolylineToPairTransitionExact: modeTransition.status === "PASS"
    && exact(modeTransition.committed?.entities?.[0], modeTransition.source?.entities?.[0])
    && modeTransition.operation?.args?.mode === "pairs"
    && modeTransition.operation?.args?.pairs?.[0]?.sharpCorner === true
    && exact(modeTransition.operation?.targetHandles, ["20", "30"]),
  polylineOverlapAndClosedSeamsExact: edgeCases.status === "PASS"
    && exact(edgeCases.overlap?.entities?.[0]?.vertices, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 }])
    && exact(edgeCases.forward?.document?.entities?.[0]?.vertices, [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 10 }])
    && exact(edgeCases.reverse?.document?.entities?.[0]?.vertices, [{ x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 20 }])
    && exact(edgeCases.forward?.operation?.args?.pairs?.map((pair) => [pair.firstSegment, pair.secondSegment]), [[3, 0]])
    && exact(edgeCases.reverse?.operation?.args?.pairs?.map((pair) => [pair.firstSegment, pair.secondSegment]), [[0, 3]])
    && exact(seamForwardKdraw.document.entities, edgeCases.forward?.document?.entities)
    && exact(seamReverseKdraw.document.entities, edgeCases.reverse?.document?.entities),
  currentLayerSecondSelectionPropertiesExact: properties.status === "PASS"
    && properties.committed?.entities?.[2]?.handle === "21" && properties.committed?.entities?.[2]?.layerId === "current"
    && line(properties.committed?.entities?.[2], [-10, 0], [0, 20])
    && exact(properties.committed?.entities?.[2]?.appearance, { lineweightMm: 0.35, transparency: 25 })
    && exact(propertiesKdraw.document.entities, properties.committed?.entities)
    && propertiesDxf?.entities?.some((entity) => entity.handle === "21" && entity.type === "LINE" && entity.layer === "CURRENT" && entity.lineweight === 35),
  constructionBrowserCommitAndKdrawExact: construction.status === "PASS" && construction.consoleErrors?.length === 0
    && construction.committed?.entities?.find(({ handle }) => handle === "10")?.kind === "line"
    && point(construction.committed?.entities?.find(({ handle }) => handle === "10")?.end, -10, 0)
    && construction.committed?.entities?.find(({ handle }) => handle === "20")?.kind === "ray"
    && point(construction.committed?.entities?.find(({ handle }) => handle === "20")?.basePoint, 0, 20)
    && point(construction.committed?.entities?.find(({ handle }) => handle === "20")?.direction, 0, 1)
    && construction.committed?.entities?.find(({ handle }) => handle === "30")?.kind === "ray"
    && point(construction.committed?.entities?.find(({ handle }) => handle === "30")?.basePoint, 310, 200)
    && point(construction.committed?.entities?.find(({ handle }) => handle === "30")?.direction, 1, 0)
    && construction.committed?.entities?.find(({ handle }) => handle === "50")?.kind === "ray"
    && point(construction.committed?.entities?.find(({ handle }) => handle === "50")?.basePoint, 490, 400)
    && point(construction.committed?.entities?.find(({ handle }) => handle === "50")?.direction, -1, 0)
    && exact(construction.committed?.entities?.find(({ handle }) => handle === "70"), construction.source?.entities?.find(({ handle }) => handle === "70"))
    && exact(construction.committed?.entities?.find(({ handle }) => handle === "80"), construction.source?.entities?.find(({ handle }) => handle === "80"))
    && exact(construction.operations?.map(({ targetHandles, resultHandles, args }) => ({ targetHandles, resultHandles, trimMode: args.trimMode })), [
      { targetHandles: ["10", "20", "30", "40", "50", "60"], resultHandles: ["10", "20", "81", "30", "40", "82", "50", "60", "83"], trimMode: "trim" },
      { targetHandles: ["70", "80"], resultHandles: ["84"], trimMode: "no-trim" },
    ])
    && exact(constructionKdraw.document.entities, construction.committed?.entities),
  constructionDxfExact: exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "20"), "10", "20"), [0, 20])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "20"), "11", "21"), [0, 1])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "30"), "10", "20"), [310, 200])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "30"), "11", "21"), [1, 0])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "50"), "10", "20"), [490, 400])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "50"), "11", "21"), [-1, 0])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "70"), "10", "20"), [600, 600])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "RAY", "70"), "11", "21"), [4, 0])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "XLINE", "80"), "10", "20"), [700, 600])
    && exact(rawPoint(rawRecord(constructionDxfBytes, "XLINE", "80"), "11", "21"), [0, 3]),
  zeroPolylineAndPairAreOutputIdentity: zero.status === "PASS" && exact(zero.restored, zero.source) && exact(zero.operations, [])
    && zeroDxf?.entities?.length === 1 && zeroDxf.entities[0]?.type === "LWPOLYLINE" && zeroDxf.entities[0]?.handle === "10"
    && zeroDxf.entities[0]?.vertices?.length === 4 && zeroDxf.entities[0]?.vertices?.every((vertex, index) => point(vertex, zero.source.entities[0].vertices[index].x, zero.source.entities[0].vertices[index].y))
    && exact(zeroKdraw.document, zero.source),
  oversizedSelectedPolylineTrimFailsClosed: oversized.status === "PASS" && oversized.consoleErrors?.length === 0
    && exact(oversized.restored, oversized.source) && exact(oversized.operations, [])
    && exact(oversizedKdraw.document, oversized.source)
    && exact(oversizedDxf?.entities?.map((entity) => [entity.handle, entity.type]), [["10", "LWPOLYLINE"], ["20", "LWPOLYLINE"], ["30", "LINE"], ["40", "LWPOLYLINE"], ["50", "LWPOLYLINE"]])
    && ["10", "20", "40", "50"].every((handle) => {
      const source = byHandle(oversized.source?.entities, handle); const output = byHandle(oversizedDxf?.entities, handle);
      return source?.kind === "polyline" && output?.type === "LWPOLYLINE" && output.shape === true
        && exact(output.vertices?.map(({ x, y }) => ({ x, y })), source.vertices);
    }),
  independentDxfExact: exact(dxfEntities.map((entity) => [entity.handle, entity.type]), [
    ["10", "LINE"], ["20", "LINE"], ["30", "LINE"], ["40", "LINE"], ["41", "LINE"], ["42", "LINE"],
  ])
    && dxfLine(byHandle(dxfEntities, "10"), [-1000, 0], [-100, 0])
    && dxfLine(byHandle(dxfEntities, "20"), [0, 200], [0, 1000])
    && dxfLine(byHandle(dxfEntities, "41"), [-100, 0], [0, 200])
    && dxfLine(byHandle(dxfEntities, "42"), [1100, 0], [1000, 200]),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-025 browser read-back mismatch: ${JSON.stringify(checks)}`);

const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const artifacts = Object.fromEntries([
  ["evidence/artifacts/F-025-browser-matrix.json", matrixBytes],
  ["evidence/artifacts/F-025-browser-modes.json", modesBytes],
  ["evidence/artifacts/F-025-browser-shift-no-op.json", shiftNoOpBytes],
  ["evidence/artifacts/F-025-browser-mode-transition.json", modeTransitionBytes],
  ["evidence/artifacts/F-025-browser-edge-cases.json", edgeCasesBytes],
  ["evidence/artifacts/F-025-browser-seam-forward.kdraw", seamForwardBytes],
  ["evidence/artifacts/F-025-browser-seam-reverse.kdraw", seamReverseBytes],
  ["evidence/artifacts/F-025-browser-properties.json", propertiesBytes],
  ["evidence/artifacts/F-025-browser-properties.dxf", propertiesDxfBytes],
  ["evidence/artifacts/F-025-browser-properties.kdraw", propertiesKdrawBytes],
  ["evidence/artifacts/F-025-browser-construction.json", constructionBytes],
  ["evidence/artifacts/F-025-browser-construction.dxf", constructionDxfBytes],
  ["evidence/artifacts/F-025-browser-construction.kdraw", constructionKdrawBytes],
  ["evidence/artifacts/F-025-browser-zero.json", zeroBytes],
  ["evidence/artifacts/F-025-browser-zero.dxf", zeroDxfBytes],
  ["evidence/artifacts/F-025-browser-zero.kdraw", zeroKdrawBytes],
  ["evidence/artifacts/F-025-browser-distance-too-large.json", oversizedBytes],
  ["evidence/artifacts/F-025-browser-distance-too-large.dxf", oversizedDxfBytes],
  ["evidence/artifacts/F-025-browser-distance-too-large.kdraw", oversizedKdrawBytes],
  ["evidence/artifacts/F-025-browser.dxf", dxfBytes],
  ["evidence/artifacts/F-025-browser.kdraw", kdrawBytes],
].map(([path, bytes]) => [path, { sha256: sha256(bytes), byteLength: bytes.length }]));
const result = { schemaVersion: 1, rowId: "F-025", status: "PASS", checks, artifacts, sourceSha256 };
await writeFile(resolve(artifactRoot, "F-025-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-025 Chromium browser evidence PASS (Distance/Angle, Multiple/Polyline, zero/oversized fail-closed, RAY/XLINE Trim/No Trim, physical Shift, layer refusal, atomic Undo/Redo, DXF and KDRAW1 read-back).");
