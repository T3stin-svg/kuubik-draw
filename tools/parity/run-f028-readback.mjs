#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  CadSession,
  createEmptyDocument,
  deserializeKDraw,
  lengthenEntityLength,
  resolveCadCommand,
  serializeKDraw,
} from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const sourceDxfPath = resolve(artifactRoot, "F-028-source.dxf");
const dxfPath = resolve(artifactRoot, "F-028-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-028-kuubik.kdraw");
const reportPath = resolve(artifactRoot, "F-028-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const exact = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-9) =>
  Number.isFinite(left) &&
  Number.isFinite(right) &&
  Math.abs(left - right) <=
    tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/lengthen.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/src/trim.ts",
  "packages/cad-core/test/lengthen.test.ts",
  "packages/cad-core/test/f028-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f028-lengthen-roundtrip.test.ts",
  "tools/parity/run-f028-readback.mjs",
];
function summary(entity) {
  const base = {
    handle: entity.handle,
    kind: entity.kind,
    layerId: entity.layerId,
    appearance: entity.appearance,
    extensionData: entity.extensionData,
  };
  if (entity.kind === "line")
    return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "arc")
    return {
      ...base,
      center: entity.center,
      radius: entity.radius,
      startAngleRad: entity.startAngleRad,
      endAngleRad: entity.endAngleRad,
      counterClockwise: entity.counterClockwise,
    };
  if (entity.kind === "polyline")
    return { ...base, closed: entity.closed, vertices: entity.vertices };
  if (entity.kind === "ellipse")
    return {
      ...base,
      center: entity.center,
      majorAxis: entity.majorAxis,
      ratio: entity.ratio,
      startParameter: entity.startParameter,
      endParameter: entity.endParameter,
    };
  if (entity.kind === "spline")
    return {
      ...base,
      degree: entity.degree,
      controlPoints: entity.controlPoints,
      knots: entity.knots,
      weights: entity.weights,
      closed: entity.closed,
      periodic: entity.periodic,
    };
  throw new Error(`F-028 summary does not support ${entity.kind}.`);
}
function dxfSummary(entity) {
  const appearance = entity.appearance
    ? {
        color: entity.appearance.color,
        colorMethod: entity.appearance.colorMethod,
        ...(entity.appearance.colorMethod === "aci"
          ? { aciIndex: entity.appearance.aciIndex }
          : {}),
        lineweightMm: entity.appearance.lineweightMm,
      }
    : undefined;
  const value = summary(entity);
  return { ...value, layerId: undefined, extensionData: undefined, appearance };
}
function semanticEqual(left, right) {
  if (typeof left === "number" || typeof right === "number")
    return (
      typeof left === "number" &&
      typeof right === "number" &&
      close(left, right)
    );
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => semanticEqual(value, right[index]))
    );
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left)
      .filter((key) => left[key] !== undefined)
      .sort();
    const rightKeys = Object.keys(right)
      .filter((key) => right[key] !== undefined)
      .sort();
    return (
      exact(leftKeys, rightKeys) &&
      leftKeys.every((key) => semanticEqual(left[key], right[key]))
    );
  }
  return Object.is(left, right);
}
function rawEntityRecords(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code))
      throw new Error(`Malformed F-028 DXF group at line ${index + 1}.`);
    if (code === 0) {
      if (current) records.push(current);
      current = { type: value.trim(), groups: [] };
    } else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(
    records
      .map((record) => [
        record.groups.find(({ code }) => code === 5)?.value,
        record,
      ])
      .filter(([handle]) => handle),
  );
}
const rawValues = (record, code) =>
  record?.groups
    ?.filter((group) => group.code === code)
    .map(({ value }) => value) ?? [];
const pointsMatch = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every(
    (point, index) =>
      close(point.x, expected[index].x) && close(point.y, expected[index].y),
  );
const numbersMatch = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((value, index) => close(value, expected[index]));

const command = resolveCadCommand("LEN");
if (!command || command.id !== "LENGTHEN")
  throw new Error(
    "LEN/LENGTHEN is missing from the production command registry.",
  );
const document = createEmptyDocument({
  documentId: "F-028-readback",
  now: "2026-08-30T17:00:00.000Z",
});
document.entities = [
  {
    kind: "line",
    handle: "10",
    layerId: "0",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    appearance: {
      color: "#ff0000",
      colorMethod: "aci",
      aciIndex: 1,
      lineweightMm: 0.35,
    },
    extensionData: { rowId: "F-028" },
  },
  {
    kind: "arc",
    handle: "20",
    layerId: "0",
    center: { x: 0, y: 300 },
    radius: 100,
    startAngleRad: 0,
    endAngleRad: Math.PI / 2,
    counterClockwise: true,
  },
  {
    kind: "polyline",
    handle: "30",
    layerId: "0",
    closed: false,
    vertices: [
      { x: 0, y: 500, startWidth: 2, endWidth: 4 },
      { x: 100, y: 500, bulge: 0.5, startWidth: 4, endWidth: 6 },
      { x: 200, y: 500, startWidth: 6, endWidth: 8 },
    ],
    appearance: { color: "#00ff00", colorMethod: "trueColor" },
  },
  {
    kind: "ellipse",
    handle: "40",
    layerId: "0",
    center: { x: 400, y: 300 },
    majorAxis: { x: 100, y: 0 },
    ratio: 0.5,
    startParameter: 0,
    endParameter: Math.PI / 2,
  },
  {
    kind: "spline",
    handle: "50",
    layerId: "0",
    degree: 3,
    controlPoints: [
      { x: 400, y: 500 },
      { x: 440, y: 580 },
      { x: 480, y: 580 },
      { x: 520, y: 500 },
    ],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    weights: [1, 0.8, 1.2, 1],
    closed: false,
    periodic: false,
  },
];
const source = structuredClone(document);
const beforeLengths = Object.fromEntries(
  source.entities.map((entity) => [
    entity.handle,
    lengthenEntityLength(entity),
  ]),
);
const sourceExport = exportDxf(source);
if (sourceExport.report.skipped.length)
  throw new Error(
    `F-028 source DXF skipped output: ${JSON.stringify(sourceExport.report.skipped)}`,
  );
const targets = [
  { handle: "10", pickPoint: { x: 100, y: 0 } },
  { handle: "20", pickPoint: { x: 0, y: 400 } },
  { handle: "30", pickPoint: { x: 200, y: 500 } },
  { handle: "40", pickPoint: { x: 400, y: 350 } },
  { handle: "50", pickPoint: { x: 520, y: 500 } },
];
const result = command.execute(document, {
  mode: "delta",
  value: 25,
  measurement: "length",
  targets: targets.slice(0, 3),
});
if (
  result.rejected.length ||
  result.changes.length !== 3 ||
  result.steps.length !== 3
)
  throw new Error(
    `F-028 production Delta setup failed: ${JSON.stringify(result)}`,
  );
const expected = [
  { ...source.entities[0], end: { x: 125, y: 0 } },
  { ...source.entities[1], endAngleRad: 1.820796326795 },
  {
    ...source.entities[2],
    vertices: [
      { x: 0, y: 500, startWidth: 2, endWidth: 4 },
      { x: 100, y: 500, bulge: 0.632042563776, startWidth: 4, endWidth: 6.431362086458 },
      { x: 210.656237536719, y: 522.431129840324, startWidth: 6, endWidth: 8 },
    ],
  },
  { ...source.entities[3], endParameter: 2 },
  source.entities[4],
];
const session = new CadSession(document);
session.commit(
  {
    opId: "F-028-delta",
    baseRevision: 0,
    commandId: "LENGTHEN",
    args: {
      mode: "delta",
      measurement: "length",
      value: 25,
      multiple: true,
      targets: targets.slice(0, 3),
    },
    targetHandles: result.sourceHandles,
    resultHandles: result.resultHandles,
  },
  result.changes,
  "2026-08-30T17:00:01.000Z",
);
const ellipseDynamic = command.execute(session.document, {
  mode: "dynamic",
  value: 0,
  measurement: "length",
  targets: [
    {
      ...targets[3],
      dynamicPoint: { x: 400 + 100 * Math.cos(2), y: 300 + 50 * Math.sin(2) },
    },
  ],
});
if (
  ellipseDynamic.rejected.length ||
  ellipseDynamic.changes.length !== 1 ||
  ellipseDynamic.steps.length !== 1
)
  throw new Error(
    `F-028 production ELLIPSE Dynamic setup failed: ${JSON.stringify(ellipseDynamic)}`,
  );
session.commit(
  {
    opId: "F-028-ellipse-dynamic",
    baseRevision: 1,
    commandId: "LENGTHEN",
    args: {
      mode: "dynamic",
      multiple: false,
      targets: [
        {
          ...targets[3],
          dynamicPoint: {
            x: 400 + 100 * Math.cos(2),
            y: 300 + 50 * Math.sin(2),
          },
        },
      ],
    },
    targetHandles: ellipseDynamic.sourceHandles,
    resultHandles: ellipseDynamic.resultHandles,
  },
  ellipseDynamic.changes,
  "2026-08-30T17:00:01.500Z",
);
const controlSplineProbe = command.execute(session.document, {
  mode: "dynamic",
  value: 0,
  measurement: "length",
  targets: [{ ...targets[4], dynamicPoint: { x: 550, y: 460 } }],
});
if (
  controlSplineProbe.changes.length ||
  controlSplineProbe.steps.length ||
  JSON.stringify(controlSplineProbe.rejected) !==
    JSON.stringify([
      { handle: "50", targetIndex: 0, reason: "unsupported-target" },
    ])
)
  throw new Error(
    `F-028 control-point SPLINE refusal mismatch: ${JSON.stringify(controlSplineProbe)}`,
  );
const committed = structuredClone(session.document);
if (!semanticEqual(committed.entities.map(summary), expected.map(summary)))
  throw new Error(
    `F-028 committed geometry mismatch: ${JSON.stringify(committed.entities)}`,
  );
for (const entity of committed.entities.filter(({ handle }) =>
  ["10", "20", "30"].includes(handle),
))
  if (
    !close(
      lengthenEntityLength(entity),
      beforeLengths[entity.handle] + 25,
      1e-7,
    )
  )
    throw new Error(`F-028 length delta mismatch on ${entity.handle}.`);
const exported = exportDxf(committed);
if (exported.report.skipped.length)
  throw new Error(
    `F-028 DXF skipped output: ${JSON.stringify(exported.report.skipped)}`,
  );
const strict = importDxf(exported.bytes, {
  documentId: "F-028-strict",
  now: "2026-08-30T17:00:02.000Z",
});
if (
  strict.report.skipped.length ||
  strict.report.warnings.length ||
  strict.document.entities.length !== 5
)
  throw new Error(
    `F-028 strict DXF read-back failed: ${JSON.stringify(strict.report)}`,
  );
const strictChecks = expected.map((entity) => {
  const actual = strict.document.entities.find(
    ({ handle }) => handle === entity.handle,
  );
  const actualLayer = actual
    ? strict.document.layers.find(({ id }) => id === actual.layerId)?.name
    : null;
  return {
    handle: entity.handle,
    expectedLayer: "0",
    actualLayer,
    expected: dxfSummary(entity),
    actual: actual ? dxfSummary(actual) : null,
    pass:
      actualLayer === "0" &&
      Boolean(actual) &&
      semanticEqual(dxfSummary(entity), dxfSummary(actual)),
  };
});
if (strictChecks.some(({ pass }) => !pass))
  throw new Error(
    `F-028 strict semantic mismatch: ${JSON.stringify(strictChecks)}`,
  );
const independent = new DxfParser().parseSync(exported.text);
const independentTypes =
  independent?.entities?.map((entity) => `${entity.handle}:${entity.type}`) ??
  [];
if (
  !exact(independentTypes, [
    "10:LINE",
    "20:ARC",
    "30:LWPOLYLINE",
    "40:ELLIPSE",
    "50:SPLINE",
  ])
)
  throw new Error(
    `F-028 independent type mismatch: ${JSON.stringify(independentTypes)}`,
  );
const byHandle = Object.fromEntries(
  independent.entities.map((entity) => [entity.handle, entity]),
);
const raw = rawEntityRecords(exported.text);
const independentChecks = {
  line:
    pointsMatch(byHandle["10"]?.vertices, [
      expected[0].start,
      expected[0].end,
    ]) &&
    byHandle["10"]?.colorIndex === 1 &&
    byHandle["10"]?.lineweight === 35,
  arc:
    close(byHandle["20"]?.center?.x, 0) &&
    close(byHandle["20"]?.center?.y, 300) &&
    close(byHandle["20"]?.radius, 100) &&
    close(byHandle["20"]?.endAngle, expected[1].endAngleRad),
  polyline:
    pointsMatch(byHandle["30"]?.vertices, expected[2].vertices) &&
    byHandle["30"]?.vertices.every(
      (vertex, index) =>
        close(vertex.bulge ?? 0, expected[2].vertices[index].bulge ?? 0) &&
        close(vertex.startWidth, expected[2].vertices[index].startWidth) &&
        close(vertex.endWidth, expected[2].vertices[index].endWidth),
    ),
  ellipse:
    close(byHandle["40"]?.center?.x, 400) &&
    close(byHandle["40"]?.center?.y, 300) &&
    close(byHandle["40"]?.endAngle, expected[3].endParameter),
  spline:
    byHandle["50"]?.degreeOfSplineCurve === 3 &&
    pointsMatch(byHandle["50"]?.controlPoints, expected[4].controlPoints) &&
    numbersMatch(byHandle["50"]?.knotValues, expected[4].knots) &&
    numbersMatch(rawValues(raw.get("50"), 41).map(Number), expected[4].weights),
};
if (Object.values(independentChecks).some((pass) => !pass))
  throw new Error(
    `F-028 independent DXF semantic mismatch: ${JSON.stringify(independentChecks)}`,
  );
const kdrawBytes = await serializeKDraw(
  committed,
  [],
  "2026-08-30T17:00:03.000Z",
);
const restored = await deserializeKDraw(kdrawBytes);
const documentEntry = restored.manifest.entries.find(
  ({ path }) => path === restored.manifest.documentPath,
);
if (
  !documentEntry ||
  restored.attachments.size ||
  !exact(restored.document, committed)
)
  throw new Error("F-028 KDRAW1 read-back mismatch.");
const undoDynamic = session.undo("2026-08-30T17:00:04.000Z");
if (
  !undoDynamic ||
  !semanticEqual(
    session.document.entities.map(summary),
    [...expected.slice(0, 3), source.entities[3], source.entities[4]].map(
      summary,
    ),
  )
)
  throw new Error("F-028 Dynamic Undo mismatch.");
const undoDelta = session.undo("2026-08-30T17:00:04.500Z");
if (!undoDelta || !exact(session.document.entities, source.entities))
  throw new Error("F-028 Delta Undo mismatch.");
const redoDelta = session.redo("2026-08-30T17:00:05.000Z");
if (!redoDelta) throw new Error("F-028 Delta Redo missing.");
const redoDynamic = session.redo("2026-08-30T17:00:05.500Z");
if (
  !redoDynamic ||
  !semanticEqual(session.document.entities.map(summary), expected.map(summary))
)
  throw new Error("F-028 Dynamic Redo mismatch.");
const percent = command.execute(source, {
  mode: "percent",
  value: 150,
  measurement: "length",
  targets: [targets[0]],
});
const total = command.execute(source, {
  mode: "total",
  value: 80,
  measurement: "length",
  targets: [targets[0]],
});
const dynamic = command.execute(source, {
  mode: "dynamic",
  value: 0,
  measurement: "length",
  targets: [{ ...targets[0], dynamicPoint: { x: 150, y: 50 } }],
});
const arcAngle = command.execute(source, {
  mode: "total",
  value: 180,
  measurement: "angle",
  targets: [targets[1]],
});
const modeChecks = {
  percent: close(lengthenEntityLength(percent.changes[0]?.entity), 150),
  total: close(lengthenEntityLength(total.changes[0]?.entity), 80),
  dynamic: exact(dynamic.changes[0]?.entity?.end, { x: 150, y: 0 }),
  arcAngle: close(arcAngle.changes[0]?.entity?.endAngleRad, Math.PI),
};
if (Object.values(modeChecks).some((pass) => !pass))
  throw new Error(`F-028 mode mismatch: ${JSON.stringify(modeChecks)}`);
const report = {
  schemaVersion: 1,
  rowId: "F-028",
  status: "PASS",
  observedAt: new Date().toISOString(),
  source:
    "production LEN/LENGTHEN registry -> Delta over LINE/ARC/open POLYLINE -> ELLIPSE Dynamic -> rational control-point SPLINE refusal -> production DXF/KDRAW1 -> strict importer + dxf-parser -> Undo/Redo",
  checks: {
    registry: true,
    exactAuditedGeometry: true,
    exactLengthDelta: true,
    controlSplineFailsClosed: true,
    propertiesAndHandles: true,
    strictDxf: true,
    independentDxf: true,
    kdrawChecksum: true,
    atomicUndoRedo: true,
    modeMatrix: true,
  },
  implementationSha256: Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        sha256(await readFile(resolve(root, path))),
      ]),
    ),
  ),
  sourceDocument: source,
  committedDocument: committed,
  expected: expected.map(summary),
  strictChecks,
  independentTypes,
  independentChecks,
  modeChecks,
  sourceDxf: {
    sha256: sha256(sourceExport.bytes),
    byteLength: sourceExport.bytes.byteLength,
    emittedHandles: sourceExport.report.emittedHandles,
  },
  dxf: {
    sha256: sha256(exported.bytes),
    byteLength: exported.bytes.byteLength,
    emittedHandles: exported.report.emittedHandles,
  },
  kdraw: {
    sha256: sha256(kdrawBytes),
    byteLength: kdrawBytes.byteLength,
    documentSha256: documentEntry.sha256,
  },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(sourceDxfPath, sourceExport.bytes);
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  "F-028 production LENGTHEN audited Delta/Dynamic/refusal DXF/KDRAW1 read-back PASS.",
);
