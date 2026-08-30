#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import DxfParser from "dxf-parser";
import { deserializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const listClose = (left, right, tolerance = 1e-9) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
  && left.every((value, index) => Array.isArray(value)
    ? listClose(value, right[index], tolerance)
    : close(value, right[index], tolerance));
const sourcePaths = [
  "apps/web/src/App.tsx",
  "apps/web/src/workflows/modify-command.ts",
  "apps/web/src/workflows/modify-command.test.ts",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/container.ts",
  "packages/cad-core/src/fillet.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/f024-mutation-proven.test.ts",
  "packages/cad-core/test/fillet.test.ts",
  "packages/cad-renderer/src/bounds.ts",
  "packages/cad-renderer/src/renderer.ts",
  "packages/cad-renderer/src/selection.ts",
  "packages/cad-renderer/test/renderer.test.ts",
  "packages/cad-renderer/test/selection.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f024-fillet-roundtrip.test.ts",
  "packages/cad-print/src/index.ts",
  "packages/cad-print/test/vector-output.test.ts",
  "package-lock.json",
  "e2e/f024-fillet.spec.ts",
  "tools/parity/capture-f024-browser.mjs",
  "tools/parity/build-f024-browser-readback.mjs",
];

const [matrixBytes, familiesBytes, parametricBytes, constructionBytes, dxfBytes, kdrawBytes, parametricSourceDxfBytes, parametricDxfBytes, parametricKdrawBytes, constructionSourceDxfBytes, constructionDxfBytes, constructionKdrawBytes] = await Promise.all([
  readFile(resolve(artifactRoot, "F-024-browser-matrix.json")),
  readFile(resolve(artifactRoot, "F-024-browser-families.json")),
  readFile(resolve(artifactRoot, "F-024-browser-parametric.json")),
  readFile(resolve(artifactRoot, "F-024-browser-construction.json")),
  readFile(resolve(artifactRoot, "F-024-browser.dxf")),
  readFile(resolve(artifactRoot, "F-024-browser.kdraw")),
  readFile(resolve(artifactRoot, "F-024-browser-parametric-source.dxf")),
  readFile(resolve(artifactRoot, "F-024-browser-parametric.dxf")),
  readFile(resolve(artifactRoot, "F-024-browser-parametric.kdraw")),
  readFile(resolve(artifactRoot, "F-024-browser-construction-source.dxf")),
  readFile(resolve(artifactRoot, "F-024-browser-construction.dxf")),
  readFile(resolve(artifactRoot, "F-024-browser-construction.kdraw")),
]);
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const families = JSON.parse(familiesBytes.toString("utf8"));
const parametric = JSON.parse(parametricBytes.toString("utf8"));
const construction = JSON.parse(constructionBytes.toString("utf8"));
const dxf = new DxfParser().parseSync(dxfBytes.toString("utf8"));
const parametricSourceDxf = new DxfParser().parseSync(parametricSourceDxfBytes.toString("utf8"));
const parametricSourceDxfText = parametricSourceDxfBytes.toString("utf8");
const parametricDxfText = parametricDxfBytes.toString("utf8");
const parametricDxf = new DxfParser().parseSync(parametricDxfText);
const constructionSourceDxfText = constructionSourceDxfBytes.toString("utf8");
const constructionDxfText = constructionDxfBytes.toString("utf8");
const constructionDxf = new DxfParser().parseSync(constructionDxfText);
const [kdrawContainer, parametricKdrawContainer, constructionKdrawContainer] = await Promise.all([
  deserializeKDraw(kdrawBytes),
  deserializeKDraw(parametricKdrawBytes),
  deserializeKDraw(constructionKdrawBytes),
]);
const kdrawDocument = kdrawContainer.document;
const parametricKdrawDocument = parametricKdrawContainer.document;
const constructionKdrawDocument = constructionKdrawContainer.document;
const exactContainer = (container) => container.manifest.documentPath === "document.json"
  && container.manifest.entries.length === 1 && container.manifest.entries[0]?.path === "document.json"
  && /^[a-f0-9]{64}$/u.test(container.manifest.entries[0]?.sha256 ?? "") && container.attachments.size === 0;
const dxfByHandle = Object.fromEntries((dxf?.entities ?? []).map((entity) => [entity.handle, entity]));
const joined = matrix.joined?.entities?.find((entity) => entity.handle === "10");
const legacySource = matrix.committed?.entities?.find((entity) => entity.handle === "50");
const browserArcs = matrix.committed?.entities?.filter((entity) => entity.kind === "arc") ?? [];
const dxfJoined = dxfByHandle["10"];
const dxfLegacy = dxfByHandle["50"];
const dxfArcs = [dxfByHandle["51"], dxfByHandle["52"]];
const expectedJoinedVertices = [[0, 0], [90, 0], [100, 10], [100, 100]];
const expectedJoinedWidths = [[2, 3.8], [3.8, 3.8], [3.8, 3.8], [3.8, 3.8]];
const expectedJoinedBulges = [0, Math.tan(Math.PI / 8), 0, 0];
const entityVertices = (entity) => entity?.vertices?.map(({ x, y }) => [x, y]);
const entityWidths = (entity) => entity?.vertices?.map((vertex) => [vertex.startWidth ?? 0, vertex.endWidth ?? 0]);
const entityBulges = (entity) => entity?.vertices?.map((vertex) => vertex.bulge ?? 0);
const normalizeWeights = (weights) => {
  if (!Array.isArray(weights) || weights.length === 0 || !Number.isFinite(weights[0]) || Math.abs(weights[0]) <= 1e-12) return null;
  return weights.map((weight) => weight / weights[0]);
};
const splinePoint = (spline, fraction) => {
  const degree = spline?.degree ?? spline?.degreeOfSplineCurve;
  const controlPoints = spline?.controlPoints;
  const knots = spline?.knots ?? spline?.knotValues;
  const weights = spline?.weights;
  if (!Number.isInteger(degree) || !Array.isArray(controlPoints) || !Array.isArray(knots) || !Array.isArray(weights)
    || controlPoints.length !== weights.length || knots.length !== controlPoints.length + degree + 1) return null;
  const last = controlPoints.length - 1;
  const start = knots[degree]; const end = knots[last + 1];
  const parameter = start + (end - start) * fraction;
  let span = last;
  if (parameter < end) {
    span = degree;
    while (span < last && !(parameter >= knots[span] && parameter < knots[span + 1])) span += 1;
  }
  const values = Array.from({ length: degree + 1 }, (_, index) => {
    const sourceIndex = span - degree + index;
    const point = controlPoints[sourceIndex]; const weight = weights[sourceIndex];
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const sourceIndex = span - degree + index;
      const denominator = knots[sourceIndex + degree - level + 1] - knots[sourceIndex];
      const alpha = denominator === 0 ? 0 : (parameter - knots[sourceIndex]) / denominator;
      const before = values[index - 1]; const current = values[index];
      values[index] = {
        x: before.x * (1 - alpha) + current.x * alpha,
        y: before.y * (1 - alpha) + current.y * alpha,
        weight: before.weight * (1 - alpha) + current.weight * alpha,
      };
    }
  }
  const result = values[degree];
  return result && Math.abs(result.weight) > 1e-12 ? [result.x / result.weight, result.y / result.weight] : null;
};
const splineProbes = (spline) => [0, 0.25, 0.5, 0.75, 1].map((fraction) => splinePoint(spline, fraction));
const parametricSourceSpline = parametric.source?.entities?.find((entity) => entity.handle === "40");
const parametricSpline = parametric.committed?.entities?.find((entity) => entity.handle === "40");
const parametricSourceDxfByHandle = Object.fromEntries((parametricSourceDxf?.entities ?? []).map((entity) => [entity.handle, entity]));
const parametricDxfByHandle = Object.fromEntries((parametricDxf?.entities ?? []).map((entity) => [entity.handle, entity]));
const dxfRecordPairs = (text, type, handle) => {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index + 3 < lines.length; index += 2) {
    if (lines[index]?.trim() !== "0" || lines[index + 1]?.trim() !== type) continue;
    const pairs = [];
    for (let pairIndex = index + 2; pairIndex + 1 < lines.length; pairIndex += 2) {
      const code = Number(lines[pairIndex]?.trim());
      const value = lines[pairIndex + 1]?.trim();
      if (code === 0) break;
      pairs.push([code, value]);
    }
    if (pairs.some(([code, value]) => code === 5 && value === handle)) return pairs;
  }
  return [];
};
const parametricSplinePairs = dxfRecordPairs(parametricDxfText, "SPLINE", "40");
const parametricSourceSplinePairs = dxfRecordPairs(parametricSourceDxfText, "SPLINE", "40");
const parametricSourceDxfSpline = {
  ...parametricSourceDxfByHandle["40"],
  weights: parametricSourceSplinePairs.filter(([code]) => code === 41).map(([, value]) => Number(value)),
};
const parametricOutputDxfSpline = {
  ...parametricDxfByHandle["40"],
  weights: parametricSplinePairs.filter(([code]) => code === 41).map(([, value]) => Number(value)),
};
const dxfAppearance = (text, type, handle) => {
  const pairs = dxfRecordPairs(text, type, handle);
  const first = (code) => pairs.find(([pairCode]) => pairCode === code)?.[1];
  return {
    aci: first(62) === undefined ? null : Number(first(62)),
    lineweight: first(370) === undefined ? null : Number(first(370)),
  };
};
const dxfNumber = (text, type, handle, code) => {
  const value = dxfRecordPairs(text, type, handle).find(([pairCode]) => pairCode === code)?.[1];
  return value === undefined ? null : Number(value);
};
const exactConstructionRecord = (text, type, handle, expected) => {
  const pairs = dxfRecordPairs(text, type, handle);
  return pairs.length > 0 && Object.entries(expected).every(([code, value]) => close(dxfNumber(text, type, handle, Number(code)), value));
};
const fullAciRedAppearance = { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 };
const colorOnlyAciRedAppearance = { color: "#ff0000", colorMethod: "aci", aciIndex: 1 };

const checks = {
  browserWorkflowPassedWithoutErrors: matrix.rowId === "F-024" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  lineCircleAndLineArcFamilies: families.rowId === "F-024" && families.status === "PASS" && families.consoleErrors?.length === 0
    && JSON.stringify(families.committed?.entities?.slice(0, 4)) === JSON.stringify(families.source?.entities)
    && JSON.stringify(families.committed?.entities?.slice(4).map((entity) => [entity.kind, entity.handle, entity.layerId, entity.radius]))
      === JSON.stringify([["arc", "41", "c", 10], ["arc", "42", "a", 10]])
    && JSON.stringify(families.committed?.entities?.find((entity) => entity.handle === "41")?.appearance) === JSON.stringify({ lineweightMm: 0.5 })
    && JSON.stringify(families.committed?.entities?.find((entity) => entity.handle === "42")?.appearance) === JSON.stringify(fullAciRedAppearance)
    && JSON.stringify(families.operation?.targetHandles) === JSON.stringify(["10", "20", "30", "40"])
    && JSON.stringify(families.operation?.resultHandles) === JSON.stringify(["41", "42"]),
  ellipseAndRationalSplineTrim: parametric.rowId === "F-024" && parametric.status === "PASS" && parametric.consoleErrors?.length === 0
    && close(parametric.committed?.entities?.find((entity) => entity.handle === "10")?.end?.x, -8.55777007055, 1e-5)
    && JSON.stringify(parametric.committed?.entities?.find((entity) => entity.handle === "20")) === JSON.stringify(parametric.source?.entities?.find((entity) => entity.handle === "20"))
    && parametric.committed?.entities?.find((entity) => entity.handle === "30")?.end?.x < 300
    && JSON.stringify(parametric.committed?.entities?.find((entity) => entity.handle === "40")?.controlPoints?.[0]) !== JSON.stringify(parametric.source?.entities?.find((entity) => entity.handle === "40")?.controlPoints?.[0])
    && Array.isArray(parametricSpline?.weights) && parametricSpline.weights.length === parametricSpline.controlPoints?.length
    && new Set(parametricSourceSpline?.weights ?? []).size > 1 && new Set(parametricSpline.weights).size > 1
    && listClose(normalizeWeights(parametricSourceSpline?.weights), [1, 2, 3, 4], 1e-12)
    && listClose(normalizeWeights(parametricSpline.weights), normalizeWeights([1.114179872713, 2.076119915142, 3.038059957571, 4]), 1e-12)
    && close(parametric.committed?.entities?.find((entity) => entity.handle === "41")?.center?.x, -8.55777007055, 1e-5)
    && close(parametric.committed?.entities?.find((entity) => entity.handle === "41")?.center?.y, 10, 1e-7)
    && ["41", "42"].every((handle) => close(parametric.committed?.entities?.find((entity) => entity.handle === handle)?.radius, 10))
    && ["10", "20", "30", "40"].every((handle) => JSON.stringify(parametric.source?.entities?.find((entity) => entity.handle === handle)?.appearance) === JSON.stringify(fullAciRedAppearance))
    && ["10", "20", "30", "40"].every((handle) => JSON.stringify(parametric.committed?.entities?.find((entity) => entity.handle === handle)?.appearance) === JSON.stringify(fullAciRedAppearance))
    && ["41", "42"].every((handle) => JSON.stringify(parametric.committed?.entities?.find((entity) => entity.handle === handle)?.appearance) === JSON.stringify(colorOnlyAciRedAppearance))
    && JSON.stringify(parametric.operation?.targetHandles) === JSON.stringify(["10", "20", "30", "40"])
    && JSON.stringify(parametric.operation?.resultHandles) === JSON.stringify(["10", "20", "41", "30", "40", "42"]),
  constructionLineBrowserWorkflow: construction.rowId === "F-024" && construction.status === "PASS" && construction.consoleErrors?.length === 0
    && JSON.stringify(construction.operations?.map((operation) => [operation.targetHandles, operation.resultHandles, operation.args?.trimMode])) === JSON.stringify([
      [["10", "11", "20", "21", "50", "51"], ["10", "11", "52", "20", "21", "53", "50", "51", "54"], "trim"],
      [["30", "31", "40", "41"], ["55", "56"], "no-trim"],
    ])
    && construction.committed?.entities?.find((entity) => entity.handle === "10")?.kind === "line"
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "10")?.appearance) === JSON.stringify(fullAciRedAppearance)
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "10")?.start) === JSON.stringify({ x: 0, y: 4600 })
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "10")?.end) === JSON.stringify({ x: 90, y: 4600 })
    && construction.committed?.entities?.find((entity) => entity.handle === "20")?.kind === "ray"
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "20")?.appearance) === JSON.stringify(fullAciRedAppearance)
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "20")?.basePoint) === JSON.stringify({ x: 90, y: 4800 })
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "20")?.direction) === JSON.stringify({ x: -1, y: 0 })
    && construction.committed?.entities?.find((entity) => entity.handle === "51")?.kind === "ray"
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "51")?.appearance) === JSON.stringify(fullAciRedAppearance)
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "51")?.basePoint) === JSON.stringify({ x: 100, y: 5410 })
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "51")?.direction) === JSON.stringify({ x: 0, y: 1 })
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "30")) === JSON.stringify(construction.source?.entities?.find((entity) => entity.handle === "30"))
    && JSON.stringify(construction.committed?.entities?.find((entity) => entity.handle === "40")) === JSON.stringify(construction.source?.entities?.find((entity) => entity.handle === "40"))
    && JSON.stringify(["52", "53", "54", "55", "56"].map((handle) => {
      const entity = construction.committed?.entities?.find((candidate) => candidate.handle === handle);
      return [entity?.kind, entity?.center?.x, entity?.center?.y, entity?.radius, entity?.appearance];
    })) === JSON.stringify([
      ["arc", 90, 4610, 10, colorOnlyAciRedAppearance],
      ["arc", 90, 4810, 10, colorOnlyAciRedAppearance],
      ["arc", 90, 5410, 10, colorOnlyAciRedAppearance],
      ["arc", 90, 5010, 10, colorOnlyAciRedAppearance],
      ["arc", 90, 5210, 10, colorOnlyAciRedAppearance],
    ]),
  mixedTrimJoinedIntoStablePolyline: matrix.source?.entities?.some((entity) => entity.handle === "20")
    && !matrix.joined?.entities?.some((entity) => entity.handle === "20")
    && joined?.kind === "polyline" && joined?.handle === "10"
    && listClose(entityVertices(joined), expectedJoinedVertices)
    && listClose(entityWidths(joined), expectedJoinedWidths)
    && listClose(entityBulges(joined), expectedJoinedBulges),
  noTrimLegacySourcePreserved: JSON.stringify(legacySource) === JSON.stringify(matrix.source?.entities?.find((entity) => entity.handle === "50"))
    && browserArcs.length === 2 && browserArcs.every((entity) => close(entity.radius, 10)),
  exactAtomicOperations: JSON.stringify(matrix.operations?.map((operation) => ({
    commandId: operation.commandId,
    targetHandles: operation.targetHandles,
    resultHandles: operation.resultHandles,
    mode: operation.args?.mode,
    trimMode: operation.args?.trimMode,
    filletPolylineArc: operation.args?.filletPolylineArc,
  }))) === JSON.stringify([
    { commandId: "FILLET", targetHandles: ["10", "20"], resultHandles: ["10"], mode: "pairs", trimMode: "trim" },
    { commandId: "FILLET", targetHandles: ["50"], resultHandles: ["51", "52"], mode: "polyline", trimMode: "no-trim", filletPolylineArc: 0 },
  ]),
  twoStepUndoRedoExact: JSON.stringify(matrix.undoRestored?.entities) === JSON.stringify(matrix.source?.entities)
    && JSON.stringify(matrix.redone?.entities) === JSON.stringify(matrix.committed?.entities),
  productionDxfExact: JSON.stringify((dxf?.entities ?? []).map((entity) => [entity.handle, entity.type]))
      === JSON.stringify([["10", "LWPOLYLINE"], ["50", "LWPOLYLINE"], ["51", "ARC"], ["52", "ARC"]])
    && listClose(entityVertices(dxfJoined), expectedJoinedVertices)
    && listClose(entityWidths(dxfJoined), expectedJoinedWidths)
    && listClose(entityBulges(dxfJoined), expectedJoinedBulges)
    && listClose(entityVertices(dxfLegacy), entityVertices(legacySource))
    && dxfArcs.every((entity) => entity?.type === "ARC" && close(entity.radius, 10)),
  productionKdrawExact: kdrawBytes.subarray(0, 7).toString("utf8") === "KDRAW1\n"
    && exactContainer(kdrawContainer)
    && JSON.stringify(kdrawDocument.entities) === JSON.stringify(matrix.committed?.entities),
  parametricProductionDxfExact: JSON.stringify((parametricDxf?.entities ?? []).map((entity) => [entity.handle, entity.type]))
      === JSON.stringify([["10", "LINE"], ["20", "ELLIPSE"], ["30", "LINE"], ["40", "SPLINE"], ["41", "ARC"], ["42", "ARC"]])
    && close(parametricDxfByHandle["10"]?.vertices?.[1]?.x, -8.55777007055, 1e-5)
    && close(parametricDxfByHandle["20"]?.center?.x, 100)
    && close(parametricDxfByHandle["20"]?.majorAxisEndPoint?.x, 100)
    && close(parametricDxfByHandle["20"]?.axisRatio, 0.5)
    && close(parametricDxfByHandle["30"]?.vertices?.[1]?.x, 290.843943859683, 1e-9)
    && parametricDxfByHandle["40"]?.degreeOfSplineCurve === 3
    && listClose(parametricDxfByHandle["40"]?.knotValues, parametricSpline?.knots, 1e-12)
    && listClose(parametricDxfByHandle["40"]?.controlPoints?.map(({ x, y }) => [x, y]), parametricSpline?.controlPoints?.map(({ x, y }) => [x, y]), 1e-12)
    && listClose(normalizeWeights(parametricOutputDxfSpline.weights), normalizeWeights(parametricSpline?.weights), 1e-12)
    && listClose(splineProbes(parametricOutputDxfSpline), splineProbes(parametricSpline), 1e-9)
    && ["41", "42"].every((handle) => parametricDxfByHandle[handle]?.type === "ARC" && close(parametricDxfByHandle[handle]?.radius, 10))
    && [["LINE", "10"], ["ELLIPSE", "20"], ["LINE", "30"], ["SPLINE", "40"]].every(([type, handle]) => JSON.stringify(dxfAppearance(parametricDxfText, type, handle)) === JSON.stringify({ aci: 1, lineweight: 50 }))
    && [["ARC", "41"], ["ARC", "42"]].every(([type, handle]) => JSON.stringify(dxfAppearance(parametricDxfText, type, handle)) === JSON.stringify({ aci: 1, lineweight: null })),
  parametricProductionDxfSourceExact: JSON.stringify((parametricSourceDxf?.entities ?? []).map((entity) => [entity.handle, entity.type]))
      === JSON.stringify([["10", "LINE"], ["20", "ELLIPSE"], ["30", "LINE"], ["40", "SPLINE"]])
    && listClose(normalizeWeights(parametricSourceDxfSpline.weights), normalizeWeights(parametricSourceSpline?.weights), 1e-12)
    && listClose(splineProbes(parametricSourceDxfSpline), splineProbes(parametricSourceSpline), 1e-9)
    && [["LINE", "10"], ["ELLIPSE", "20"], ["LINE", "30"], ["SPLINE", "40"]].every(([type, handle]) => JSON.stringify(dxfAppearance(parametricSourceDxfText, type, handle)) === JSON.stringify({ aci: 1, lineweight: 50 })),
  parametricProductionKdrawExact: parametricKdrawBytes.subarray(0, 7).toString("utf8") === "KDRAW1\n"
    && exactContainer(parametricKdrawContainer)
    && JSON.stringify(parametricKdrawDocument.entities) === JSON.stringify(parametric.committed?.entities),
  constructionProductionDxfSourceExact: [
    ["RAY", "10", { 10: 0, 20: 4600, 11: 4, 21: 0 }],
    ["XLINE", "20", { 10: 0, 20: 4800, 11: 4, 21: 0 }],
    ["RAY", "30", { 10: 0, 20: 5000, 11: 4, 21: 0 }],
    ["XLINE", "40", { 10: 0, 20: 5200, 11: 4, 21: 0 }],
    ["RAY", "50", { 10: 0, 20: 5400, 11: 4, 21: 0 }],
    ["XLINE", "51", { 10: 100, 20: 5400, 11: 0, 21: 3 }],
  ].every(([type, handle, expected]) => exactConstructionRecord(constructionSourceDxfText, type, handle, expected)
    && JSON.stringify(dxfAppearance(constructionSourceDxfText, type, handle)) === JSON.stringify({ aci: 1, lineweight: 50 })),
  constructionProductionDxfExact: JSON.stringify((constructionDxf?.entities ?? []).map((entity) => [entity.handle, entity.type])) === JSON.stringify([
    ["10", "LINE"], ["11", "LINE"], ["21", "LINE"], ["31", "LINE"], ["41", "LINE"], ["50", "LINE"],
    ["52", "ARC"], ["53", "ARC"], ["54", "ARC"], ["55", "ARC"], ["56", "ARC"],
  ])
    && exactConstructionRecord(constructionDxfText, "RAY", "30", { 10: 0, 20: 5000, 11: 4, 21: 0 })
    && exactConstructionRecord(constructionDxfText, "XLINE", "40", { 10: 0, 20: 5200, 11: 4, 21: 0 })
    && exactConstructionRecord(constructionDxfText, "RAY", "20", { 10: 90, 20: 4800, 11: -1, 21: 0 })
    && exactConstructionRecord(constructionDxfText, "RAY", "51", { 10: 100, 20: 5410, 11: 0, 21: 1 })
    && ["10", "50"].every((handle) => dxfRecordPairs(constructionDxfText, "RAY", handle).length === 0)
    && ["20", "51"].every((handle) => dxfRecordPairs(constructionDxfText, "XLINE", handle).length === 0)
    && close(dxfNumber(constructionDxfText, "LINE", "10", 11), 90)
    && close(dxfNumber(constructionDxfText, "LINE", "21", 20), 4810)
    && close(dxfNumber(constructionDxfText, "LINE", "50", 11), 90)
    && ["52", "53", "54", "55", "56"].every((handle) => JSON.stringify(dxfAppearance(constructionDxfText, "ARC", handle)) === JSON.stringify({ aci: 1, lineweight: null })),
  constructionProductionKdrawExact: constructionKdrawBytes.subarray(0, 7).toString("utf8") === "KDRAW1\n"
    && exactContainer(constructionKdrawContainer)
    && JSON.stringify(constructionKdrawDocument.entities) === JSON.stringify(construction.committed?.entities),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-024 browser read-back mismatch: ${JSON.stringify(checks)}`);

const result = {
  schemaVersion: 1,
  rowId: "F-024",
  source: "Chromium 1920x1080 visible FILLET controls, IndexedDB, production DXF/KDRAW1 downloads and two-step Undo/Redo",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  matrix,
  families,
  parametric,
  construction,
  downloads: {
    dxf: { sha256: sha256(dxfBytes), byteLength: dxfBytes.byteLength, handlesAndTypes: (dxf?.entities ?? []).map((entity) => [entity.handle, entity.type]) },
    kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: kdrawContainer.manifest.entries.find(({ path }) => path === "document.json")?.sha256, productionDeserializer: true },
    parametricDxf: { sha256: sha256(parametricDxfBytes), byteLength: parametricDxfBytes.byteLength, handlesAndTypes: (parametricDxf?.entities ?? []).map((entity) => [entity.handle, entity.type]) },
    parametricSourceDxf: { sha256: sha256(parametricSourceDxfBytes), byteLength: parametricSourceDxfBytes.byteLength, handlesAndTypes: (parametricSourceDxf?.entities ?? []).map((entity) => [entity.handle, entity.type]) },
    parametricKdraw: { sha256: sha256(parametricKdrawBytes), byteLength: parametricKdrawBytes.byteLength, documentSha256: parametricKdrawContainer.manifest.entries.find(({ path }) => path === "document.json")?.sha256, productionDeserializer: true },
    constructionDxf: { sha256: sha256(constructionDxfBytes), byteLength: constructionDxfBytes.byteLength, handlesAndTypes: (constructionDxf?.entities ?? []).map((entity) => [entity.handle, entity.type]) },
    constructionSourceDxf: { sha256: sha256(constructionSourceDxfBytes), byteLength: constructionSourceDxfBytes.byteLength },
    constructionKdraw: { sha256: sha256(constructionKdrawBytes), byteLength: constructionKdrawBytes.byteLength, documentSha256: constructionKdrawContainer.manifest.entries.find(({ path }) => path === "document.json")?.sha256, productionDeserializer: true },
  },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifactRoot, "F-024-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-024 Chromium polyline join/FILLETPOLYARC No Trim/DXF/KDRAW1/Undo/Redo read-back PASS.");
