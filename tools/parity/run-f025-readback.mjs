#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, deserializeKDraw, executeChamfer, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-025-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-025-kuubik.kdraw");
const constructionDxfPath = resolve(artifactRoot, "F-025-kuubik-construction.dxf");
const constructionKdrawPath = resolve(artifactRoot, "F-025-kuubik-construction.kdraw");
const zeroDxfPath = resolve(artifactRoot, "F-025-kuubik-zero.dxf");
const zeroKdrawPath = resolve(artifactRoot, "F-025-kuubik-zero.kdraw");
const oversizedDxfPath = resolve(artifactRoot, "F-025-kuubik-distance-too-large.dxf");
const oversizedKdrawPath = resolve(artifactRoot, "F-025-kuubik-distance-too-large.kdraw");
const readbackPath = resolve(artifactRoot, "F-025-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
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
  "tools/parity/run-f025-readback.mjs",
];

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]));
}

function schemaContract(entity) {
  const base = compact({ handle: entity.handle, kind: entity.kind, appearance: entity.appearance });
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "ray" || entity.kind === "xline") return { ...base, basePoint: entity.basePoint, direction: entity.direction };
  if (entity.kind === "polyline") return { ...base, closed: entity.closed, vertices: entity.vertices.map(compact) };
  throw new Error(`F-025 schema contract does not support ${entity.kind}.`);
}

function independentContract(entity) {
  if (entity.type === "LINE") return { handle: entity.handle, kind: "line", start: { x: entity.vertices[0].x, y: entity.vertices[0].y }, end: { x: entity.vertices[1].x, y: entity.vertices[1].y } };
  if (entity.type === "LWPOLYLINE") return {
    handle: entity.handle,
    kind: "polyline",
    closed: Boolean(entity.shape),
    vertices: entity.vertices.map((vertex) => compact({ x: vertex.x, y: vertex.y, bulge: vertex.bulge || undefined, startWidth: vertex.startWidth, endWidth: vertex.endWidth })),
  };
  throw new Error(`F-025 independent contract does not support ${entity.type}.`);
}

function withoutAppearance(value) {
  if (Array.isArray(value)) return value.map(withoutAppearance);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "appearance").map(([key, item]) => [key, withoutAppearance(item)]));
}

function mismatch(expected, actual, path = "root", tolerance = 1e-9) {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(expected - actual) <= tolerance ? null : `${path}: ${expected} != ${actual}`;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return `${path}: array shape mismatch`;
    for (let index = 0; index < expected.length; index += 1) {
      const item = mismatch(expected[index], actual[index], `${path}[${index}]`, tolerance);
      if (item) return item;
    }
    return null;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedKeys = Object.keys(expected).sort(); const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return `${path}: keys ${JSON.stringify(expectedKeys)} != ${JSON.stringify(actualKeys)}`;
    for (const key of expectedKeys) {
      const item = mismatch(expected[key], actual[key], `${path}.${key}`, tolerance);
      if (item) return item;
    }
    return null;
  }
  return Object.is(expected, actual) ? null : `${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`;
}

function applyChanges(document, changes) {
  const output = structuredClone(document);
  for (const change of changes) {
    if (change.type === "delete") output.entities = output.entities.filter((entity) => entity.handle !== change.handle);
    else {
      const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
      if (index >= 0) output.entities[index] = structuredClone(change.entity);
      else output.entities.push(structuredClone(change.entity));
    }
  }
  return output;
}

function rawDxfRecords(text) {
  const lines = text.replace(/\r/gu, "").split("\n");
  const records = []; let record = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index].trim(); const value = lines[index + 1].trim();
    if (code === "0") {
      if (record) records.push(record);
      record = { type: value, groups: {} };
    } else if (record) {
      const previous = record.groups[code];
      record.groups[code] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
    }
  }
  if (record) records.push(record);
  return records.filter(({ groups }) => typeof groups["5"] === "string");
}

const rawByHandle = (records, handle) => records.find((record) => record.groups["5"] === handle);
const rawPoint = (record, xCode, yCode) => ({ x: Number(record?.groups?.[xCode]), y: Number(record?.groups?.[yCode]) });

const exactVertices = (entity, expected) => entity?.kind === "polyline" && mismatch(entity.vertices, expected) === null;

const command = resolveCadCommand("CHA");
if (!command || command.id !== "CHAMFER") throw new Error("CHA/CHAMFER is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-025-readback", now: "2026-08-30T01:30:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 }, extensionData: { rowId: "F-025" }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
  { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
  { kind: "line", handle: "30", layerId: "0", start: { x: 200, y: 0 }, end: { x: 300, y: 0 } },
  { kind: "line", handle: "40", layerId: "0", start: { x: 300, y: 0 }, end: { x: 300, y: 100 } },
  { kind: "polyline", handle: "50", layerId: "0", appearance: { color: "#00ff00", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 }, closed: true, vertices: [{ x: 0, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 300 }, { x: 0, y: 300 }] },
];
const source = structuredClone(document);
const session = new CadSession(document);

const distanceResult = executeChamfer(session.document, {
  mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
  pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
});
if (distanceResult.rejected.length || distanceResult.changes.length !== 3) throw new Error(`F-025 Distance read-back setup failed: ${JSON.stringify(distanceResult)}`);
session.commit({ opId: "F-025-distance", baseRevision: 0, commandId: "CHAMFER", args: { mode: "pairs", specification: distanceResult.specification, trimMode: distanceResult.trimMode, steps: distanceResult.steps }, targetHandles: distanceResult.sourceHandles, resultHandles: distanceResult.resultHandles }, distanceResult.changes, "2026-08-30T01:30:01.000Z");

const angleResult = executeChamfer(session.document, {
  mode: "pairs", specification: { method: "angle", firstDistance: 10, angleDeg: 45 }, trimMode: "no-trim",
  pairs: [{ firstHandle: "30", firstPickPoint: { x: 250, y: 0 }, secondHandle: "40", secondPickPoint: { x: 300, y: 50 } }],
});
if (angleResult.rejected.length || angleResult.changes.length !== 1) throw new Error(`F-025 Angle read-back setup failed: ${JSON.stringify(angleResult)}`);
session.commit({ opId: "F-025-angle", baseRevision: 1, commandId: "CHAMFER", args: { mode: "pairs", specification: angleResult.specification, trimMode: angleResult.trimMode, steps: angleResult.steps }, targetHandles: angleResult.sourceHandles, resultHandles: angleResult.resultHandles }, angleResult.changes, "2026-08-30T01:30:02.000Z");

const polylineResult = executeChamfer(session.document, {
  mode: "polyline", specification: { method: "distance", firstDistance: 10, secondDistance: 10 }, trimMode: "trim", polylineHandles: ["50"],
});
if (polylineResult.rejected.length || polylineResult.changes.length !== 1) throw new Error(`F-025 Polyline read-back setup failed: ${JSON.stringify(polylineResult)}`);
session.commit({ opId: "F-025-polyline", baseRevision: 2, commandId: "CHAMFER", args: { mode: "polyline", specification: polylineResult.specification, trimMode: polylineResult.trimMode, steps: polylineResult.steps }, targetHandles: polylineResult.sourceHandles, resultHandles: polylineResult.resultHandles }, polylineResult.changes, "2026-08-30T01:30:03.000Z");

const committed = structuredClone(session.document);
const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-025 DXF skipped outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-025-strict", now: "2026-08-30T01:30:04.000Z" });
if (strict.report.skipped.length) throw new Error(`F-025 strict import skipped outputs: ${JSON.stringify(strict.report.skipped)}`);
const independent = new DxfParser().parseSync(exported.text);
if (!independent) throw new Error("Independent F-025 DXF parser returned no document.");
const expectedSemantics = committed.entities.map(schemaContract);
const strictSemantics = committed.entities.map((entity) => {
  const found = strict.document.entities.find((candidate) => candidate.handle === entity.handle);
  if (!found) throw new Error(`Strict F-025 importer missed ${entity.handle}.`);
  return schemaContract(found);
});
const independentSemantics = committed.entities.map((entity) => {
  const found = independent.entities.find((candidate) => candidate.handle === entity.handle);
  if (!found) throw new Error(`Independent F-025 parser missed ${entity.handle}.`);
  return independentContract(found);
});
const strictMismatch = mismatch(expectedSemantics, strictSemantics);
const independentMismatch = mismatch(withoutAppearance(expectedSemantics), independentSemantics);
if (strictMismatch || independentMismatch) throw new Error(`F-025 semantic read-back mismatch: ${strictMismatch ?? independentMismatch}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-30T01:30:05.000Z");
const restoredContainer = await deserializeKDraw(kdrawBytes);
const documentEntry = restoredContainer.manifest.entries.find(({ path }) => path === restoredContainer.manifest.documentPath);
if (!documentEntry || restoredContainer.attachments.size !== 0 || mismatch(committed, restoredContainer.document)) throw new Error("F-025 KDRAW1 read-back mismatch.");

const edgeSource = createEmptyDocument({ documentId: "F-025-edge-readback", now: "2026-08-30T01:33:00.000Z" });
edgeSource.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }] }];
const overlapResult = executeChamfer(edgeSource, { mode: "polyline", specification: { method: "distance", firstDistance: 20, secondDistance: 20 }, trimMode: "trim", polylineHandles: ["10"] });
const overlapDocument = applyChanges(edgeSource, overlapResult.changes);
const overlapVertices = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 }];
if (!exactVertices(overlapDocument.entities[0], overlapVertices) || mismatch(overlapResult.steps[0]?.skippedVertices, [0, 2])) throw new Error("F-025 overlap production result mismatch.");
const overlapDxf = exportDxf(overlapDocument);
const overlapStrict = importDxf(overlapDxf.bytes, { documentId: "F-025-overlap-strict", now: "2026-08-30T01:33:01.000Z" });
const overlapIndependent = new DxfParser().parseSync(overlapDxf.text);
if (!exactVertices(overlapStrict.document.entities[0], overlapVertices)
  || mismatch(overlapIndependent?.entities?.[0]?.vertices?.map(({ x, y }) => ({ x, y })), overlapVertices)) throw new Error("F-025 overlap DXF read-back mismatch.");
const overlapKdraw = await serializeKDraw(overlapDocument, [], "2026-08-30T01:33:02.000Z");
if (mismatch((await deserializeKDraw(overlapKdraw)).document.entities, overlapDocument.entities)) throw new Error("F-025 overlap KDRAW1 read-back mismatch.");

async function seamReadback(firstSegment, secondSegment, expectedVertices, suffix) {
  const result = executeChamfer(edgeSource, {
    mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
    pairs: [{ firstHandle: "10", firstSegment, firstPickPoint: firstSegment === 3 ? { x: 0, y: 10 } : { x: 10, y: 0 }, secondHandle: "10", secondSegment, secondPickPoint: secondSegment === 3 ? { x: 0, y: 10 } : { x: 10, y: 0 } }],
  });
  const document = applyChanges(edgeSource, result.changes);
  if (!exactVertices(document.entities[0], expectedVertices)) throw new Error(`F-025 ${suffix} production seam mismatch.`);
  const dxfOutput = exportDxf(document);
  const strictOutput = importDxf(dxfOutput.bytes, { documentId: `F-025-${suffix}-strict`, now: "2026-08-30T01:33:03.000Z" });
  const independentOutput = new DxfParser().parseSync(dxfOutput.text);
  if (!exactVertices(strictOutput.document.entities[0], expectedVertices)
    || mismatch(independentOutput?.entities?.[0]?.vertices?.map(({ x, y }) => ({ x, y })), expectedVertices)) throw new Error(`F-025 ${suffix} DXF read-back mismatch.`);
  const kdrawOutput = await serializeKDraw(document, [], "2026-08-30T01:33:04.000Z");
  if (mismatch((await deserializeKDraw(kdrawOutput)).document.entities, document.entities)) throw new Error(`F-025 ${suffix} KDRAW1 read-back mismatch.`);
  return { result, document, dxfSha256: sha256(dxfOutput.bytes), kdrawSha256: sha256(kdrawOutput) };
}
const seamForward = await seamReadback(3, 0, [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 10 }], "seam-forward");
const seamReverse = await seamReadback(0, 3, [{ x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 20 }], "seam-reverse");

const propertySource = createEmptyDocument({ documentId: "F-025-property-readback", now: "2026-08-30T01:34:00.000Z" });
propertySource.layers.push(
  { id: "first", name: "FIRST", visible: true, frozen: false, locked: false, plottable: true },
  { id: "second", name: "SECOND", visible: true, frozen: false, locked: false, plottable: true },
  { id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true },
);
propertySource.currentLayerId = "current";
propertySource.entities = [
  { kind: "line", handle: "10", layerId: "first", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5, transparency: 50 }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
  { kind: "line", handle: "20", layerId: "second", appearance: { color: "#00ff00", colorMethod: "aci", aciIndex: 3, lineweightMm: 0.35, transparency: 25 }, start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
];
const propertyResult = executeChamfer(propertySource, { mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "no-trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
const propertyDocument = applyChanges(propertySource, propertyResult.changes);
const propertyConnector = propertyDocument.entities.find(({ handle }) => handle === "21");
if (mismatch(propertyConnector, { kind: "line", start: { x: -10, y: 0 }, end: { x: 0, y: 20 }, handle: "21", layerId: "current", appearance: { lineweightMm: 0.35, transparency: 25 } })) throw new Error("F-025 production connector property mismatch.");
const propertyDxf = exportDxf(propertyDocument);
const propertyStrict = importDxf(propertyDxf.bytes, { documentId: "F-025-property-strict", now: "2026-08-30T01:34:01.000Z" });
const strictCurrentLayer = propertyStrict.document.layers.find(({ name }) => name === "CURRENT");
const strictConnector = propertyStrict.document.entities.find(({ handle }) => handle === "21");
const parsedConnector = new DxfParser().parseSync(propertyDxf.text)?.entities?.find(({ handle }) => handle === "21");
if (!strictCurrentLayer || strictConnector?.layerId !== strictCurrentLayer.id || strictConnector?.appearance?.lineweightMm !== 0.35
  || Math.abs((strictConnector?.appearance?.transparency ?? 0) - 25.098039215686) > 1e-9 || strictConnector.appearance?.color !== undefined || strictConnector.appearance?.linetypeId !== undefined
  || parsedConnector?.layer !== "CURRENT" || parsedConnector?.lineweight !== 35) throw new Error("F-025 connector property DXF read-back mismatch.");
const propertyKdraw = await serializeKDraw(propertyDocument, [], "2026-08-30T01:34:02.000Z");
if (mismatch((await deserializeKDraw(propertyKdraw)).document.entities, propertyDocument.entities)) throw new Error("F-025 connector property KDRAW1 read-back mismatch.");

const constructionSource = createEmptyDocument({ documentId: "F-025-construction-readback", now: "2026-08-30T02:00:00.000Z" });
const constructionAppearance = { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 };
constructionSource.entities = [
  { kind: "ray", handle: "10", layerId: "0", appearance: constructionAppearance, basePoint: { x: -100, y: 0 }, direction: { x: 4, y: 0 } },
  { kind: "xline", handle: "20", layerId: "0", appearance: constructionAppearance, basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 3 } },
  { kind: "ray", handle: "30", layerId: "0", appearance: constructionAppearance, basePoint: { x: 200, y: 200 }, direction: { x: 4, y: 0 } },
  { kind: "xline", handle: "40", layerId: "0", appearance: constructionAppearance, basePoint: { x: 300, y: 200 }, direction: { x: 0, y: 3 } },
  { kind: "xline", handle: "50", layerId: "0", appearance: constructionAppearance, basePoint: { x: 400, y: 400 }, direction: { x: 4, y: 0 } },
  { kind: "line", handle: "60", layerId: "0", appearance: constructionAppearance, start: { x: 500, y: 400 }, end: { x: 500, y: 500 } },
  { kind: "ray", handle: "70", layerId: "0", appearance: constructionAppearance, basePoint: { x: 600, y: 600 }, direction: { x: 4, y: 0 } },
  { kind: "xline", handle: "80", layerId: "0", appearance: constructionAppearance, basePoint: { x: 700, y: 600 }, direction: { x: 0, y: 3 } },
];
const constructionTrim = executeChamfer(constructionSource, {
  mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
  pairs: [
    { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
    { firstHandle: "30", firstPickPoint: { x: 350, y: 200 }, secondHandle: "40", secondPickPoint: { x: 300, y: 250 } },
    { firstHandle: "50", firstPickPoint: { x: 450, y: 400 }, secondHandle: "60", secondPickPoint: { x: 500, y: 450 } },
  ],
});
if (constructionTrim.rejected.length || constructionTrim.changes.length !== 9) throw new Error(`F-025 construction Trim setup failed: ${JSON.stringify(constructionTrim)}`);
const constructionTrimmed = applyChanges(constructionSource, constructionTrim.changes);
const constructionNoTrim = executeChamfer(constructionTrimmed, {
  mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "no-trim",
  pairs: [{ firstHandle: "70", firstPickPoint: { x: 650, y: 600 }, secondHandle: "80", secondPickPoint: { x: 700, y: 650 } }],
});
if (constructionNoTrim.rejected.length || constructionNoTrim.changes.length !== 1) throw new Error(`F-025 construction No Trim setup failed: ${JSON.stringify(constructionNoTrim)}`);
const constructionDocument = applyChanges(constructionTrimmed, constructionNoTrim.changes);
const constructionExport = exportDxf(constructionDocument);
if (constructionExport.report.skipped.length) throw new Error(`F-025 construction DXF skipped outputs: ${JSON.stringify(constructionExport.report.skipped)}`);
const constructionStrict = importDxf(constructionExport.bytes, { documentId: "F-025-construction-strict", now: "2026-08-30T02:00:01.000Z" });
const constructionExpected = constructionDocument.entities.map(schemaContract);
const constructionStrictSemantics = constructionDocument.entities.map((entity) => schemaContract(constructionStrict.document.entities.find(({ handle }) => handle === entity.handle)));
const constructionStrictMismatch = mismatch(constructionExpected, constructionStrictSemantics);
if (constructionStrictMismatch) throw new Error(`F-025 construction strict read-back mismatch: ${constructionStrictMismatch}`);
const constructionRaw = rawDxfRecords(constructionExport.text);
const constructionRawChecks = {
  trimmedReverseRay: rawByHandle(constructionRaw, "10")?.type === "LINE" && mismatch(rawPoint(rawByHandle(constructionRaw, "10"), "10", "20"), { x: -100, y: 0 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "10"), "11", "21"), { x: -10, y: 0 }) === null,
  trimmedXlineToRay: rawByHandle(constructionRaw, "20")?.type === "RAY" && mismatch(rawPoint(rawByHandle(constructionRaw, "20"), "10", "20"), { x: 0, y: 20 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "20"), "11", "21"), { x: 0, y: 1 }) === null,
  forwardRay: rawByHandle(constructionRaw, "30")?.type === "RAY" && mismatch(rawPoint(rawByHandle(constructionRaw, "30"), "10", "20"), { x: 310, y: 200 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "30"), "11", "21"), { x: 1, y: 0 }) === null,
  reverseXlineToRay: rawByHandle(constructionRaw, "50")?.type === "RAY" && mismatch(rawPoint(rawByHandle(constructionRaw, "50"), "10", "20"), { x: 490, y: 400 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "50"), "11", "21"), { x: -1, y: 0 }) === null,
  noTrimRay: rawByHandle(constructionRaw, "70")?.type === "RAY" && mismatch(rawPoint(rawByHandle(constructionRaw, "70"), "10", "20"), { x: 600, y: 600 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "70"), "11", "21"), { x: 4, y: 0 }) === null,
  noTrimXline: rawByHandle(constructionRaw, "80")?.type === "XLINE" && mismatch(rawPoint(rawByHandle(constructionRaw, "80"), "10", "20"), { x: 700, y: 600 }) === null && mismatch(rawPoint(rawByHandle(constructionRaw, "80"), "11", "21"), { x: 0, y: 3 }) === null,
};
if (Object.values(constructionRawChecks).some((value) => value !== true)) throw new Error(`F-025 construction independent raw DXF mismatch: ${JSON.stringify(constructionRawChecks)}`);
const constructionKdraw = await serializeKDraw(constructionDocument, [], "2026-08-30T02:00:02.000Z");
if (mismatch((await deserializeKDraw(constructionKdraw)).document.entities, constructionDocument.entities)) throw new Error("F-025 construction KDRAW1 read-back mismatch.");

const zeroSource = createEmptyDocument({ documentId: "F-025-zero-readback", now: "2026-08-30T02:10:00.000Z" });
zeroSource.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
const zeroPolyline = executeChamfer(zeroSource, { mode: "polyline", specification: { method: "distance", firstDistance: 0, secondDistance: 0 }, trimMode: "trim", polylineHandles: ["10"] });
const zeroPair = executeChamfer(zeroSource, { mode: "pairs", specification: { method: "distance", firstDistance: 0, secondDistance: 0 }, trimMode: "trim", pairs: [{ firstHandle: "10", firstSegment: 3, firstPickPoint: { x: 0, y: 10 }, secondHandle: "10", secondSegment: 0, secondPickPoint: { x: 10, y: 0 } }] });
if (zeroPolyline.rejected.length || zeroPair.rejected.length || zeroPolyline.changes.length || zeroPair.changes.length) throw new Error(`F-025 zero identity workflow mutated: ${JSON.stringify({ zeroPolyline, zeroPair })}`);
const zeroExport = exportDxf(zeroSource); const zeroStrict = importDxf(zeroExport.bytes, { documentId: "F-025-zero-strict", now: "2026-08-30T02:10:01.000Z" }); const zeroIndependent = new DxfParser().parseSync(zeroExport.text);
if (mismatch(zeroStrict.document.entities[0]?.vertices, zeroSource.entities[0].vertices)
  || mismatch(zeroIndependent?.entities?.[0]?.vertices?.map(({ x, y }) => ({ x, y })), zeroSource.entities[0].vertices)) throw new Error("F-025 zero identity DXF read-back mismatch.");
const zeroKdraw = await serializeKDraw(zeroSource, [], "2026-08-30T02:10:02.000Z");
if (mismatch((await deserializeKDraw(zeroKdraw)).document, zeroSource)) throw new Error("F-025 zero identity KDRAW1 read-back mismatch.");

const oversizedSource = createEmptyDocument({ documentId: "F-025-distance-too-large-readback", now: "2026-08-30T02:20:00.000Z" });
oversizedSource.entities = [
  { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] },
  { kind: "polyline", handle: "20", layerId: "0", closed: true, vertices: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 5 }, { x: 20, y: 5 }] },
  { kind: "line", handle: "30", layerId: "0", start: { x: 25, y: 0 }, end: { x: 25, y: 100 } },
  { kind: "polyline", handle: "40", layerId: "0", closed: true, vertices: [{ x: 40, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 5 }, { x: 40, y: 5 }] },
  { kind: "polyline", handle: "50", layerId: "0", closed: true, vertices: [{ x: 45, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 5 }, { x: 45, y: 5 }] },
];
const oversizedSession = new CadSession(oversizedSource);
const oversizedResult = executeChamfer(oversizedSession.document, {
  mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 10 }, trimMode: "trim",
  pairs: [
    { firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 2, y: 0 }, secondHandle: "10", secondSegment: 1, secondPickPoint: { x: 5, y: 2 } },
    { firstHandle: "20", firstSegment: 0, firstPickPoint: { x: 22, y: 0 }, secondHandle: "30", secondPickPoint: { x: 25, y: 20 } },
    { firstHandle: "40", firstSegment: 0, firstPickPoint: { x: 42, y: 0 }, secondHandle: "50", secondSegment: 3, secondPickPoint: { x: 45, y: 2 } },
  ],
});
if (oversizedResult.changes.length || oversizedResult.steps.length || oversizedResult.rejected.length !== 3
  || oversizedResult.rejected.some(({ reason }) => reason !== "distance-too-large") || oversizedSession.canUndo
  || mismatch(oversizedSession.document, oversizedSource)) throw new Error(`F-025 oversized selected-polyline Trim did not fail closed: ${JSON.stringify(oversizedResult)}`);
const oversizedExport = exportDxf(oversizedSession.document);
if (oversizedExport.report.skipped.length) throw new Error(`F-025 oversized source DXF skipped outputs: ${JSON.stringify(oversizedExport.report.skipped)}`);
const oversizedStrict = importDxf(oversizedExport.bytes, { documentId: "F-025-distance-too-large-strict", now: "2026-08-30T02:20:01.000Z" });
const oversizedIndependent = new DxfParser().parseSync(oversizedExport.text);
const oversizedExpectedSemantics = oversizedSource.entities.map(schemaContract);
const oversizedStrictSemantics = oversizedSource.entities.map((entity) => schemaContract(oversizedStrict.document.entities.find(({ handle }) => handle === entity.handle)));
const oversizedIndependentSemantics = oversizedSource.entities.map((entity) => independentContract(oversizedIndependent?.entities.find(({ handle }) => handle === entity.handle)));
if (mismatch(oversizedExpectedSemantics, oversizedStrictSemantics)
  || mismatch(withoutAppearance(oversizedExpectedSemantics), oversizedIndependentSemantics)) throw new Error("F-025 oversized selected-polyline DXF read-back mismatch.");
const oversizedKdraw = await serializeKDraw(oversizedSession.document, [], "2026-08-30T02:20:02.000Z");
if (mismatch((await deserializeKDraw(oversizedKdraw)).document, oversizedSource)) throw new Error("F-025 oversized selected-polyline KDRAW1 read-back mismatch.");

const undoStates = [];
for (let index = 0; index < 3; index += 1) {
  const operation = session.undo(`2026-08-30T01:31:0${index}.000Z`);
  undoStates.push({ present: Boolean(operation), revision: session.document.revision });
  if (!operation) throw new Error(`F-025 Undo ${index + 1} failed.`);
}
if (mismatch(source.entities, session.document.entities)) throw new Error("F-025 three-step Undo did not restore the exact source entities.");
const redoStates = [];
for (let index = 0; index < 3; index += 1) {
  const operation = session.redo(`2026-08-30T01:32:0${index}.000Z`);
  redoStates.push({ present: Boolean(operation), revision: session.document.revision });
  if (!operation) throw new Error(`F-025 Redo ${index + 1} failed.`);
}
if (mismatch(committed.entities, session.document.entities)) throw new Error("F-025 three-step Redo did not restore the exact committed entities.");

const report = {
  schemaVersion: 1,
  rowId: "F-025",
  source: "production CHAMFER registry -> immutable atomic commits -> production DXF/KDRAW1 -> strict importer + dxf-parser -> three-step Undo/Redo",
  observedAt: new Date().toISOString(),
  status: "PASS",
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  commands: { distance: distanceResult, angleNoTrim: angleResult, polyline: polylineResult },
  edgeCases: {
    overlap: { result: overlapResult, vertices: overlapVertices, dxfSha256: sha256(overlapDxf.bytes), kdrawSha256: sha256(overlapKdraw) },
    seamForward,
    seamReverse,
    properties: { connector: propertyConnector, strictConnector, dxfSha256: sha256(propertyDxf.bytes), kdrawSha256: sha256(propertyKdraw) },
    construction: { trim: constructionTrim, noTrim: constructionNoTrim, expectedSemantics: constructionExpected, strictSemantics: constructionStrictSemantics, strictMismatch: constructionStrictMismatch, rawChecks: constructionRawChecks, dxfSha256: sha256(constructionExport.bytes), kdrawSha256: sha256(constructionKdraw) },
    zeroIdentity: { polyline: zeroPolyline, pair: zeroPair, source: zeroSource, dxfSha256: sha256(zeroExport.bytes), kdrawSha256: sha256(zeroKdraw) },
    distanceTooLarge: { result: oversizedResult, source: oversizedSource, canUndo: oversizedSession.canUndo, expectedSemantics: oversizedExpectedSemantics, strictSemantics: oversizedStrictSemantics, independentSemantics: oversizedIndependentSemantics, dxfSha256: sha256(oversizedExport.bytes), kdrawSha256: sha256(oversizedKdraw) },
  },
  output: { expectedSemantics, strictSemantics, independentSemantics, strictMismatch, independentMismatch },
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: documentEntry.sha256, manifestEntryCount: restoredContainer.manifest.entries.length, attachmentCount: restoredContainer.attachments.size },
  undoRedo: { undoStates, redoStates, exactSourceRestored: true, exactCommittedRestored: true },
};
await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(constructionDxfPath, constructionExport.bytes);
await writeFile(constructionKdrawPath, constructionKdraw);
await writeFile(zeroDxfPath, zeroExport.bytes);
await writeFile(zeroKdrawPath, zeroKdraw);
await writeFile(oversizedDxfPath, oversizedExport.bytes);
await writeFile(oversizedKdrawPath, oversizedKdraw);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-025 production CHAMFER Distance/Angle/Polyline, zero/oversized fail-closed and RAY/XLINE DXF/KDRAW1 with atomic Undo/Redo read-back PASS.");
