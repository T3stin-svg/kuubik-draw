#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import { CadSession, createEmptyDocument, executeTrim, resolveCadCommand, serializeKDraw } from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-022-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-022-kuubik.kdraw");
const readbackPath = resolve(artifactRoot, "F-022-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const semanticFields = [
  "handle", "kind", "layer", "appearance.color", "appearance.lineweightMm",
  "line.start/end", "polyline.closed/vertices/bulge/startWidth/endWidth",
  "arc.center/radius/startAngleRad/endAngleRad/counterClockwise",
  "ellipse.center/majorAxis/ratio/startParameter/endParameter",
  "spline.degree/controlPoints/knots/weights/closed/periodic",
];
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-core/test/trim.test.ts",
  "packages/cad-core/test/f022-mutation-proven.test.ts",
  "packages/cad-dxf/test/f022-trim-roundtrip.test.ts",
  "tools/parity/run-f022-readback.mjs",
];

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compact(item)]));
}

function normalizedAppearance(color, lineweightMm) {
  return color === undefined && lineweightMm === undefined ? undefined : compact({ color, lineweightMm });
}

function layerName(documentValue, layerId) {
  const layer = documentValue.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`F-022 semantic read-back cannot resolve layer ${layerId}.`);
  return layer.name;
}

function canonicalSchemaEntity(documentValue, entity) {
  const base = compact({
    handle: entity.handle,
    kind: entity.kind,
    layer: layerName(documentValue, entity.layerId),
    appearance: normalizedAppearance(entity.appearance?.color, entity.appearance?.lineweightMm),
  });
  switch (entity.kind) {
    case "line": return { ...base, start: entity.start, end: entity.end };
    case "polyline": return { ...base, closed: entity.closed, vertices: entity.vertices.map(compact) };
    case "arc": return {
      ...base, center: entity.center, radius: entity.radius,
      startAngleRad: entity.startAngleRad, endAngleRad: entity.endAngleRad,
      counterClockwise: entity.counterClockwise,
    };
    case "ellipse": return {
      ...base, center: entity.center, majorAxis: entity.majorAxis, ratio: entity.ratio,
      startParameter: entity.startParameter, endParameter: entity.endParameter,
    };
    case "spline": return {
      ...base, degree: entity.degree, controlPoints: entity.controlPoints,
      knots: entity.knots, ...(entity.weights ? { weights: entity.weights } : {}),
      closed: entity.closed, periodic: entity.periodic,
    };
    default: throw new Error(`F-022 semantic read-back does not support ${entity.kind}.`);
  }
}

function parseRawEntityMetadata(text) {
  const lines = text.split(/\r?\n/u);
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed raw DXF group at line ${index + 1}.`);
    if (code === 0) {
      if (current) records.push(current);
      current = { type: value.trim(), groups: [] };
    } else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  const result = new Map();
  for (const record of records) {
    const handle = record.groups.find((group) => group.code === 5)?.value;
    if (handle && ["LINE", "LWPOLYLINE", "ARC", "ELLIPSE", "SPLINE"].includes(record.type)) result.set(handle, record);
  }
  return result;
}

function numericGroups(record, code) {
  return record.groups.filter((group) => group.code === code).map((group) => {
    const value = Number(group.value);
    if (!Number.isFinite(value)) throw new Error(`DXF ${record.type} ${code} is non-finite.`);
    return value;
  });
}

function rawSingleton(record, code, fallback) {
  const values = numericGroups(record, code);
  if (!values.length) return fallback;
  if (values.length !== 1) throw new Error(`DXF ${record.type} has ${values.length} values for singleton group ${code}.`);
  return values[0];
}

function rgbHex(value) {
  return `#${Number(value).toString(16).padStart(6, "0")}`;
}

function point2(value) {
  return { x: value.x, y: value.y };
}

function canonicalIndependentEntity(entity, rawRecord) {
  const base = compact({
    handle: entity.handle,
    kind: ({ LINE: "line", LWPOLYLINE: "polyline", ARC: "arc", ELLIPSE: "ellipse", SPLINE: "spline" })[entity.type],
    layer: entity.layer,
    appearance: normalizedAppearance(entity.color === undefined ? undefined : rgbHex(entity.color), entity.lineweight === undefined ? undefined : entity.lineweight / 100),
  });
  switch (entity.type) {
    case "LINE": return { ...base, start: point2(entity.vertices[0]), end: point2(entity.vertices[1]) };
    case "LWPOLYLINE": return { ...base, closed: Boolean(entity.shape), vertices: entity.vertices.map((vertex) => compact({
      x: vertex.x, y: vertex.y, bulge: vertex.bulge === 0 ? undefined : vertex.bulge,
      startWidth: vertex.startWidth, endWidth: vertex.endWidth,
    })) };
    case "ARC": return {
      ...base, center: point2(entity.center), radius: entity.radius,
      startAngleRad: entity.startAngle, endAngleRad: entity.endAngle, counterClockwise: true,
    };
    case "ELLIPSE": return {
      ...base, center: point2(entity.center), majorAxis: point2(entity.majorAxisEndPoint), ratio: entity.axisRatio,
      startParameter: entity.startAngle, endParameter: entity.endAngle,
    };
    case "SPLINE": {
      if (!rawRecord || rawRecord.type !== "SPLINE") throw new Error(`Missing raw SPLINE metadata for ${entity.handle}.`);
      const flags = rawSingleton(rawRecord, 70, 0);
      const weights = numericGroups(rawRecord, 41);
      return {
        ...base, degree: entity.degreeOfSplineCurve, controlPoints: entity.controlPoints.map(({ x, y }) => ({ x, y })),
        knots: entity.knotValues, ...(weights.length ? { weights } : {}),
        closed: (flags & 1) !== 0, periodic: (flags & 2) !== 0,
      };
    }
    default: throw new Error(`Unsupported independent F-022 type ${entity.type}.`);
  }
}

function semanticMismatch(expected, actual, path = "root", tolerance = 1e-8) {
  if (typeof expected === "number" && typeof actual === "number") return Math.abs(expected - actual) <= tolerance ? null : `${path}: ${expected} != ${actual}`;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return `${path}: array shape mismatch`;
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = semanticMismatch(expected[index], actual[index], `${path}[${index}]`, tolerance);
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return `${path}: keys ${JSON.stringify(expectedKeys)} != ${JSON.stringify(actualKeys)}`;
    for (const key of expectedKeys) {
      const mismatch = semanticMismatch(expected[key], actual[key], `${path}.${key}`, tolerance);
      if (mismatch) return mismatch;
    }
    return null;
  }
  return Object.is(expected, actual) ? null : `${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`;
}

const command = resolveCadCommand("TR");
if (!command || command.id !== "TRIM") throw new Error("TR/TRIM is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-022-readback", now: "2026-08-29T00:00:00.000Z" });
document.entities = [
  { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", lineweightMm: 0.5 }, extensionData: { rowId: "F-022" }, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  {
    kind: "polyline", handle: "11", layerId: "0", closed: false,
    vertices: [
      { x: 0, y: 200, startWidth: 2, endWidth: 6 },
      { x: 100, y: 200, bulge: 1, startWidth: 3, endWidth: 5 },
      { x: 200, y: 200 },
    ],
  },
  { kind: "circle", handle: "12", layerId: "0", center: { x: 0, y: 500 }, radius: 10 },
  { kind: "ellipse", handle: "13", layerId: "0", center: { x: 100, y: 500 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
  {
    kind: "spline", handle: "14", layerId: "0", degree: 3,
    controlPoints: [{ x: 0, y: 800 }, { x: 100 / 3, y: 900 }, { x: 200 / 3, y: 700 }, { x: 100, y: 800 }],
    knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
  },
  { kind: "line", handle: "20", layerId: "0", start: { x: 25, y: -50 }, end: { x: 25, y: 250 } },
  { kind: "line", handle: "21", layerId: "0", start: { x: 75, y: -50 }, end: { x: 75, y: 250 } },
  { kind: "line", handle: "22", layerId: "0", start: { x: 5, y: 480 }, end: { x: 5, y: 520 } },
  { kind: "line", handle: "23", layerId: "0", start: { x: 100, y: 480 }, end: { x: 100, y: 520 } },
  { kind: "line", handle: "24", layerId: "0", start: { x: 25, y: 650 }, end: { x: 25, y: 950 } },
  { kind: "line", handle: "25", layerId: "0", start: { x: 75, y: 650 }, end: { x: 75, y: 950 } },
];
const source = structuredClone(document);
const result = executeTrim(document, {
  mode: "standard",
  cuttingEdgeHandles: ["20", "21", "22", "23", "24", "25"],
  targets: [
    { handle: "10", pickPoint: { x: 50, y: 0 } },
    { handle: "11", pickPoint: { x: 50, y: 200 } },
    { handle: "12", pickPoint: { x: 10, y: 500 } },
    { handle: "13", pickPoint: { x: 110, y: 500 } },
    { handle: "14", pickPoint: { x: 50, y: 800 } },
  ],
  edgeMode: "no-extend",
  projectMode: "none",
});
if (result.rejected.length) throw new Error(`F-022 production command rejected targets: ${JSON.stringify(result.rejected)}`);
const session = new CadSession(document);
session.commit({
  opId: "F-022-readback", baseRevision: 0, commandId: "TRIM",
  args: { mode: "standard", edgeMode: "no-extend", projectMode: "none" },
  targetHandles: result.targetHandles, resultHandles: result.resultHandles,
}, result.changes, "2026-08-29T00:00:01.000Z");
const committed = structuredClone(session.document);
const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-022 DXF skipped trimmed outputs: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-022-strict", now: "2026-08-29T00:00:02.000Z" });
if (strict.report.skipped.length) throw new Error(`F-022 strict import skipped outputs: ${JSON.stringify(strict.report.skipped)}`);
const independent = new DxfParser().parseSync(exported.text);
const kdrawBytes = await serializeKDraw(committed, [], "2026-08-29T00:00:03.000Z");
const envelope = JSON.parse(new TextDecoder().decode(kdrawBytes).slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const kdrawDocument = JSON.parse(documentBytes.toString("utf8"));
const undo = session.undo("2026-08-29T00:00:04.000Z");

const resultKinds = result.resultHandles.map((handle) => committed.entities.find((entity) => entity.handle === handle)?.kind ?? null);
const strictKinds = result.resultHandles.map((handle) => strict.document.entities.find((entity) => entity.handle === handle)?.kind ?? null);
const independentTypes = result.resultHandles.map((handle) => independent?.entities.find((entity) => entity.handle === handle)?.type ?? null);
const rawMetadata = parseRawEntityMetadata(exported.text);
const expectedSemantics = result.resultHandles.map((handle) => canonicalSchemaEntity(committed, committed.entities.find((entity) => entity.handle === handle)));
const strictSemantics = result.resultHandles.map((handle) => canonicalSchemaEntity(strict.document, strict.document.entities.find((entity) => entity.handle === handle)));
const independentSemantics = result.resultHandles.map((handle) => {
  const entity = independent?.entities.find((item) => item.handle === handle);
  if (!entity) throw new Error(`Independent DXF parser did not return handle ${handle}.`);
  return canonicalIndependentEntity(entity, rawMetadata.get(handle));
});
const strictSemanticMismatch = semanticMismatch(expectedSemantics, strictSemantics);
const independentSemanticMismatch = semanticMismatch(expectedSemantics, independentSemantics);
const report = {
  schemaVersion: 1,
  rowId: "F-022",
  source: "production command registry -> immutable commit -> production DXF/KDRAW1 -> strict importer + dxf-parser + independent envelope -> atomic undo",
  observedAt: new Date().toISOString(),
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  command: result,
  committed: { revision: committed.revision, handles: committed.entities.map((entity) => entity.handle), kinds: committed.entities.map((entity) => entity.kind) },
  dxf: {
    sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, report: exported.report,
    strictKinds, independentTypes, semanticFields,
    expectedSemantics, strictSemantics, independentSemantics,
    checks: {
      exactStrictSemantics: strictSemanticMismatch === null,
      exactIndependentSemantics: independentSemanticMismatch === null,
    },
    mismatches: compact({ strict: strictSemanticMismatch ?? undefined, independent: independentSemanticMismatch ?? undefined }),
  },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: sha256(documentBytes), handles: kdrawDocument.entities?.map((entity) => entity.handle) },
  undo: { present: Boolean(undo), revision: session.document.revision, restored: session.document.entities },
  status: "PASS",
};

if (
  JSON.stringify(resultKinds) !== JSON.stringify(["line", "line", "polyline", "polyline", "arc", "ellipse", "spline", "spline"])
  || JSON.stringify(strictKinds) !== JSON.stringify(resultKinds)
  || JSON.stringify(independentTypes) !== JSON.stringify(["LINE", "LINE", "LWPOLYLINE", "LWPOLYLINE", "ARC", "ELLIPSE", "SPLINE", "SPLINE"])
  || strictSemanticMismatch !== null
  || independentSemanticMismatch !== null
  || JSON.stringify(kdrawDocument.entities) !== JSON.stringify(committed.entities)
  || !undo || JSON.stringify(session.document.entities) !== JSON.stringify(source.entities)
) throw new Error(`F-022 independent read-back mismatch: ${JSON.stringify(report)}`);

await mkdir(dirname(readbackPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(readbackPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-022 production TRIM line/polyline/circle/ellipse/SPLINE DXF/KDRAW1 and atomic Undo read-back PASS.");
