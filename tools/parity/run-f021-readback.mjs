#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, offsetCadEntity, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-021-kuubik.dxf");
const kdrawPath = resolve(root, "evidence/artifacts/F-021-five-family.kdraw");
const edgeDxfPath = resolve(root, "evidence/artifacts/F-021-edge-polylines.dxf");
const edgeKdrawPath = resolve(root, "evidence/artifacts/F-021-edge-matrix.kdraw");
const concaveKdrawPath = resolve(root, "evidence/artifacts/F-021-concave-refusal.kdraw");
const readbackPath = resolve(root, "evidence/artifacts/F-021-independent-readback.json");
const command = resolveCadCommand("O");
if (!command || command.id !== "OFFSET") throw new Error("OFFSET is missing from the command registry.");

const lineDocument = createEmptyDocument({ documentId: "F-021-line", now: "2026-08-28T00:00:00.000Z" });
lineDocument.entities.push({
  kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", lineweightMm: 0.5 }, extensionData: { rowId: "F-021" },
  start: { x: 0, y: 0 }, end: { x: 1000, y: 0 },
});
const lineSession = new CadSession(lineDocument);
const multiple = command.execute(lineSession.document, {
  targetHandles: ["10"], mode: "distance", distance: 100,
  placementPoints: [{ x: 500, y: 100 }, { x: 500, y: 250 }], multiple: true, eraseSource: false, layerMode: "source",
});
lineSession.commit({
  opId: "F-021-multiple", baseRevision: 0, commandId: "OFFSET",
  args: { mode: "distance", distance: 100, multiple: true, eraseSource: false, layerMode: "source" },
  targetHandles: multiple.sourceHandles, resultHandles: multiple.createdHandles,
}, multiple.changes, "2026-08-28T00:00:01.000Z");
const exported = exportDxf(lineSession.document);
if (exported.report.skipped.length) throw new Error(`F-021 DXF export skipped entities: ${JSON.stringify(exported.report.skipped)}`);
const parsed = new DxfParser().parseSync(exported.text);
const dxfEntities = parsed?.entities.map((entity) => ({
  type: entity.type, handle: entity.handle, layer: entity.layer,
  vertices: entity.vertices?.map(({ x, y }) => ({ x, y })),
})) ?? [];
const lineUndo = lineSession.undo("2026-08-28T00:00:02.000Z");

const familyDocument = createEmptyDocument({ documentId: "F-021-five-family", now: "2026-08-28T00:00:00.000Z" });
const sources = [
  { entity: { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }, side: { x: 500, y: 100 } },
  { entity: { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 2000, y: 0 }, { x: 2100, y: 0 }, { x: 2100, y: 100 }] }, side: { x: 2050, y: 50 } },
  { entity: { kind: "circle", handle: "12", layerId: "0", center: { x: 4000, y: 0 }, radius: 100 }, side: { x: 4200, y: 0 } },
  { entity: { kind: "arc", handle: "13", layerId: "0", center: { x: 6000, y: 0 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true }, side: { x: 6141.421356, y: 141.421356 } },
  { entity: { kind: "ellipse", handle: "14", layerId: "0", appearance: { color: "#00ff00", lineweightMm: 0.5 }, center: { x: 8000, y: 0 }, majorAxis: { x: 200, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 }, side: { x: 8250, y: 0 } },
];
familyDocument.entities.push(...sources.map(({ entity }) => entity));
const outputs = sources.map(({ entity, side }, index) => {
  const output = offsetCadEntity(entity, "distance", 20, side);
  if (!output.entity || output.signedDistance === null) throw new Error(`F-021 ${entity.kind} failed: ${output.reason}`);
  return { ...output.entity, handle: (0x20 + index).toString(16).toUpperCase() };
});
familyDocument.entities.push(...outputs);
familyDocument.revision = 1;
familyDocument.metadata.updatedAt = "2026-08-28T00:00:03.000Z";
const kdrawBytes = await serializeKDraw(familyDocument, [], "2026-08-28T00:00:03.000Z");
const kdrawText = new TextDecoder().decode(kdrawBytes);
if (!kdrawText.startsWith("KDRAW1\n")) throw new Error("F-021 .kdraw magic mismatch.");
const envelope = JSON.parse(kdrawText.slice("KDRAW1\n".length));
const documentEntry = envelope.manifest?.entries?.find((entry) => entry.path === "document.json");
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const documentSha256 = createHash("sha256").update(documentBytes).digest("hex");
const independentDocument = JSON.parse(documentBytes.toString("utf8"));

const through = command.execute(lineDocument, {
  targetHandles: ["10"], mode: "through", placementPoints: [{ x: 1500, y: 375 }],
  multiple: false, eraseSource: true, layerMode: "source",
});

const closedEdge = offsetCadEntity({
  kind: "polyline", handle: "30", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }],
}, "distance", 20, { x: 100, y: 100 });
const bulgedEdge = offsetCadEntity({
  kind: "polyline", handle: "31", layerId: "0", closed: false,
  vertices: [{ x: -100, y: 0, bulge: 1 }, { x: 100, y: 0 }],
}, "distance", 20, { x: 0, y: -150 });
const concaveEdge = offsetCadEntity({
  kind: "polyline", handle: "32", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }],
}, "distance", 60, { x: 10, y: 10 });
const ellipseCollapse = offsetCadEntity({
  kind: "ellipse", handle: "33", layerId: "0", center: { x: 8000, y: 1000 }, majorAxis: { x: 200, y: 0 }, ratio: 0.5,
  startParameter: 0, endParameter: Math.PI * 2,
}, "distance", 60, { x: 8000, y: 1000 });
const collapseBounds = (ellipseCollapse.entities ?? []).map((entity) => {
  if (entity.kind !== "spline") throw new Error("F-021 inward ELLIPSE did not produce SPLINE output.");
  return {
    min: { x: Math.min(...entity.controlPoints.map((point) => point.x)), y: Math.min(...entity.controlPoints.map((point) => point.y)) },
    max: { x: Math.max(...entity.controlPoints.map((point) => point.x)), y: Math.max(...entity.controlPoints.map((point) => point.y)) },
  };
});

if (!closedEdge.entity || !bulgedEdge.entity || !ellipseCollapse.entities) throw new Error("F-021 edge outputs are incomplete.");
const edgeDocument = createEmptyDocument({ documentId: "F-021-edge-matrix", now: "2026-08-28T00:00:00.000Z" });
edgeDocument.entities.push(
  { ...closedEdge.entity, handle: "40" },
  { ...bulgedEdge.entity, handle: "41" },
  ...ellipseCollapse.entities.map((entity, index) => ({ ...entity, handle: (0x42 + index).toString(16).toUpperCase() })),
);
edgeDocument.revision = 1;
edgeDocument.metadata.updatedAt = "2026-08-28T00:00:04.000Z";
const edgeKdrawBytes = await serializeKDraw(edgeDocument, [], "2026-08-28T00:00:04.000Z");
const edgeEnvelope = JSON.parse(new TextDecoder().decode(edgeKdrawBytes).slice("KDRAW1\n".length));
const edgeDocumentBytes = Buffer.from(edgeEnvelope.files?.["document.json"] ?? "", "base64");
const independentEdgeDocument = JSON.parse(edgeDocumentBytes.toString("utf8"));

const edgeDxfDocument = createEmptyDocument({ documentId: "F-021-edge-dxf", now: "2026-08-28T00:00:00.000Z" });
edgeDxfDocument.entities.push({ ...closedEdge.entity, handle: "40" }, { ...bulgedEdge.entity, handle: "41" });
const edgeDxfExport = exportDxf(edgeDxfDocument);
if (edgeDxfExport.report.skipped.length) throw new Error(`F-021 edge DXF skipped entities: ${JSON.stringify(edgeDxfExport.report.skipped)}`);
const parsedEdgeDxf = new DxfParser().parseSync(edgeDxfExport.text);
const edgeDxfEntities = parsedEdgeDxf?.entities.map((entity) => ({
  type: entity.type,
  handle: entity.handle,
  layer: entity.layer,
  shape: entity.shape,
  vertices: entity.vertices?.map(({ x, y, bulge }) => ({ x, y, ...(bulge === undefined ? {} : { bulge }) })),
})) ?? [];

const concaveDocument = createEmptyDocument({ documentId: "F-021-concave-refusal", now: "2026-08-28T00:00:00.000Z" });
concaveDocument.entities.push({
  kind: "polyline", handle: "32", layerId: "0", closed: true,
  vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }],
});
const concaveCommandResult = command.execute(concaveDocument, {
  targetHandles: ["32"], mode: "distance", distance: 60, placementPoints: [{ x: 10, y: 10 }],
  multiple: false, eraseSource: false, layerMode: "source",
});
if (concaveCommandResult.changes.length !== 0) throw new Error("F-021 concave refusal unexpectedly mutated the document.");
const concaveKdrawBytes = await serializeKDraw(concaveDocument, [], "2026-08-28T00:00:05.000Z");
const concaveEnvelope = JSON.parse(new TextDecoder().decode(concaveKdrawBytes).slice("KDRAW1\n".length));
const independentConcaveDocument = JSON.parse(Buffer.from(concaveEnvelope.files?.["document.json"] ?? "", "base64").toString("utf8"));

const result = {
  schemaVersion: 1,
  rowId: "F-021",
  parser: "dxf-parser@1.1.2 + independent KDRAW1 envelope parser",
  observedAt: new Date().toISOString(),
  units: parsed?.header?.$INSUNITS,
  multiple: { command: multiple, dxfEntities, undoChangeTypes: lineUndo?.changes.map((change) => change.type), restoredEntities: lineSession.document.entities },
  throughErase: through,
  familyOutputs: outputs,
  edgeMatrix: {
    closed: closedEdge, bulged: bulgedEdge, concave: concaveEdge, ellipseInwardSplit: ellipseCollapse, collapseBounds,
    dxf: { units: parsedEdgeDxf?.header?.$INSUNITS, entities: edgeDxfEntities },
    kdraw: { independentDocument: independentEdgeDocument },
    concavePersistence: { command: concaveCommandResult, independentDocument: independentConcaveDocument },
  },
  kdraw: {
    format: envelope.format, containerVersion: envelope.manifest?.containerVersion,
    byteLength: documentBytes.byteLength, sha256: documentSha256,
    manifestByteLength: documentEntry?.byteLength, manifestSha256: documentEntry?.sha256,
    independentDocument,
  },
  status: "PASS",
};

const expectedDxf = [
  { type: "LINE", handle: "10", layer: "0", vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
  { type: "LINE", handle: "11", layer: "0", vertices: [{ x: 0, y: 100 }, { x: 1000, y: 100 }] },
  { type: "LINE", handle: "12", layer: "0", vertices: [{ x: 0, y: 200 }, { x: 1000, y: 200 }] },
];
const expectedFamilies = ["line", "polyline", "circle", "arc", "spline"];
if (
  result.units !== 4 || JSON.stringify(dxfEntities) !== JSON.stringify(expectedDxf) ||
  JSON.stringify(multiple.createdHandles) !== JSON.stringify(["11", "12"]) || multiple.steps.length !== 2 || !lineUndo ||
  JSON.stringify(lineSession.document.entities) !== JSON.stringify(lineDocument.entities) ||
  through.createdHandles[0] !== "11" || through.changes[0]?.type !== "delete" || through.changes[1]?.entity?.start?.y !== 375 ||
  JSON.stringify(outputs.map(({ kind }) => kind)) !== JSON.stringify(expectedFamilies) ||
  outputs[0]?.start?.y !== 20 || outputs[1]?.vertices?.[1]?.x !== 2080 || outputs[2]?.radius !== 120 || outputs[3]?.radius !== 120 ||
  outputs[4]?.kind !== "spline" || outputs[4]?.degree !== 3 || outputs[4]?.controlPoints?.[0]?.x !== 8220 || outputs[4]?.appearance?.lineweightMm !== undefined ||
  JSON.stringify(closedEdge.entity?.kind === "polyline" ? closedEdge.entity.vertices : null) !== JSON.stringify([{ x: 20, y: 20, bulge: 0 }, { x: 180, y: 20, bulge: 0 }, { x: 180, y: 180, bulge: 0 }, { x: 20, y: 180, bulge: 0 }]) ||
  JSON.stringify(bulgedEdge.entity?.kind === "polyline" ? bulgedEdge.entity.vertices : null) !== JSON.stringify([{ x: -120, y: 0, bulge: 1 }, { x: 120, y: 0 }]) ||
  concaveEdge.entity !== null || concaveEdge.reason !== "self-intersection" ||
  ellipseCollapse.entities?.length !== 2 || ellipseCollapse.entities.some((entity) => entity.kind !== "spline" || entity.closed) ||
  Math.abs(collapseBounds[0]?.min.x - 7861.43593539449) > 1e-6 || Math.abs(collapseBounds[0]?.min.y - 960) > 1e-6 ||
  Math.abs(collapseBounds[1]?.max.x - 8138.56406460551) > 1e-6 || Math.abs(collapseBounds[1]?.max.y - 1040) > 1e-6 ||
  parsedEdgeDxf?.header?.$INSUNITS !== 4 || edgeDxfEntities.length !== 2 || edgeDxfEntities[0]?.type !== "LWPOLYLINE" || edgeDxfEntities[0]?.shape !== true ||
  edgeDxfEntities[0]?.vertices?.[0]?.x !== 20 || edgeDxfEntities[1]?.type !== "LWPOLYLINE" || edgeDxfEntities[1]?.vertices?.[0]?.x !== -120 || edgeDxfEntities[1]?.vertices?.[0]?.bulge !== 1 ||
  JSON.stringify(independentEdgeDocument.entities) !== JSON.stringify(edgeDocument.entities) ||
  concaveCommandResult.rejected?.[0]?.reason !== "self-intersection" || independentConcaveDocument.revision !== 0 ||
  JSON.stringify(independentConcaveDocument.entities) !== JSON.stringify(concaveDocument.entities) ||
  envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1 ||
  documentEntry?.byteLength !== documentBytes.byteLength || documentEntry?.sha256 !== documentSha256 ||
  JSON.stringify(independentDocument.entities) !== JSON.stringify(familyDocument.entities)
) throw new Error(`F-021 independent read-back mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(dxfPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(edgeDxfPath, edgeDxfExport.bytes);
await writeFile(edgeKdrawPath, edgeKdrawBytes);
await writeFile(concaveKdrawPath, concaveKdrawBytes);
await writeFile(readbackPath, `${JSON.stringify({
  ...result,
  dxfSha256: createHash("sha256").update(exported.bytes).digest("hex"),
  kdrawSha256: createHash("sha256").update(kdrawBytes).digest("hex"),
  edgeDxfSha256: createHash("sha256").update(edgeDxfExport.bytes).digest("hex"),
  edgeKdrawSha256: createHash("sha256").update(edgeKdrawBytes).digest("hex"),
  concaveKdrawSha256: createHash("sha256").update(concaveKdrawBytes).digest("hex"),
}, null, 2)}\n`, "utf8");
console.log("F-021 OFFSET Distance/Through/Multiple/Erase + five-family and closed/bulged/collapse DXF/KDRAW1 + atomic UNDO read-back PASS.");
