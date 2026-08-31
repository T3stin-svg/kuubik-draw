#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  CadSession,
  createEmptyDocument,
  deserializeKDraw,
  resolveCadCommand,
  serializeKDraw,
  splinePointAtParameter,
} from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-012-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-012-kuubik.kdraw");
const reportPath = resolve(artifactRoot, "F-012-independent-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const close = (left, right, tolerance = 1e-8) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const pointClose = (left, right, tolerance) => close(left?.x, right?.x, tolerance) && close(left?.y, right?.y, tolerance);
const sourcePaths = [
  "apps/web/src/App.tsx",
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/spline.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/spline.test.ts",
  "packages/cad-core/test/f012-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f012-spline-fit-roundtrip.test.ts",
  "e2e/f012-spline.spec.ts",
  "tools/parity/run-f012-readback.mjs",
];

function rawEntityRecords(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed F-012 DXF group at line ${index + 1}.`);
    if (code === 0) {
      if (current) records.push(current);
      current = { type: value.trim(), groups: [] };
    } else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.groups.find(({ code }) => code === 5)?.value, record]).filter(([handle]) => handle));
}

const rawValues = (record, code) => record?.groups.filter((group) => group.code === code).map(({ value }) => value) ?? [];
const rawNumber = (record, code) => Number(rawValues(record, code)[0]);
const fitPointsFromRaw = (record) => {
  const x = rawValues(record, 11).map(Number);
  const y = rawValues(record, 21).map(Number);
  return x.map((value, index) => ({ x: value, y: y[index] }));
};
const tangentFromRaw = (record, xCode, yCode) => ({ x: rawNumber(record, xCode), y: rawNumber(record, yCode) });

const splineCommand = resolveCadCommand("SPLINE");
const editCommand = resolveCadCommand("SPLINEDIT");
if (!splineCommand || splineCommand.id !== "SPLINE" || !editCommand || editCommand.id !== "SPLINEDIT") {
  throw new Error("F-012 production SPLINE/SPLINEDIT registry wiring is missing.");
}

const document = createEmptyDocument({ documentId: "F-012-readback", now: "2026-08-31T07:10:00.000Z" });
document.entities = [{
  kind: "polyline", handle: "40", layerId: "0", closed: false,
  appearance: { color: "#00ff00" }, extensionData: { source: "PEDIT-spline-fit" },
  vertices: [{ x: 420, y: 0 }, { x: 450, y: 80 }, { x: 510, y: -20 }, { x: 560, y: 0 }],
}];
const session = new CadSession(document);
const creationFixtures = [
  {
    handle: "10", layerId: "0", method: "fit", points: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 15 }, { x: 140, y: 0 }],
    fitTolerance: 0.125, knotParameterization: "sqrt-chord", startTangent: { x: 180, y: 0 }, endTangent: { x: 100, y: -60 },
  },
  {
    handle: "20", layerId: "0", method: "fit", points: [{ x: 0, y: 200 }, { x: 90, y: 225 }, { x: 70, y: 310 }, { x: -20, y: 280 }],
    fitTolerance: 0, knotParameterization: "chord", closed: true,
  },
  {
    handle: "30", layerId: "0", method: "control-vertices", degree: 3,
    points: [{ x: 220, y: 0 }, { x: 250, y: 80 }, { x: 310, y: -20 }, { x: 360, y: 0 }], weights: [1, 0.7, 1.3, 1],
  },
  {
    handle: "60", layerId: "0", method: "fit",
    points: [{ x: 200, y: -300 }, { x: 240, y: -220 }, { x: 310, y: -330 }, { x: 380, y: -250 }],
    fitTolerance: 0, knotParameterization: "chord",
  },
];
for (const [index, args] of creationFixtures.entries()) {
  session.commit({
    opId: `F-012-create-${index + 1}`,
    baseRevision: session.document.revision,
    commandId: "SPLINE",
    args,
    targetHandles: [],
    resultHandles: [args.handle],
  }, splineCommand.execute(args), `2026-08-31T07:10:0${index + 1}.000Z`);
}
const objectArgs = { handle: "50", method: "object", sourceHandle: "40" };
const objectChanges = splineCommand.execute(objectArgs, session.document);
session.commit({
  opId: "F-012-object",
  baseRevision: session.document.revision,
  commandId: "SPLINE",
  args: objectArgs,
  targetHandles: ["40"],
  resultHandles: ["50"],
}, objectChanges, "2026-08-31T07:10:03.250Z");
const cvEditArgs = {
  targetHandle: "30",
  actions: [
    { type: "cv-move", index: 1, point: { x: 255, y: 95 } },
    { type: "cv-weight", index: 1, weight: 2.5 },
    { type: "close" },
    { type: "open" },
  ],
};
const cvEdit = editCommand.execute(session.document, cvEditArgs);
if (cvEdit.rejected.length || cvEdit.changes.length !== 1 || cvEdit.editedHandles.join() !== "30") throw new Error(`F-012 CV SPLINEDIT setup failed: ${JSON.stringify(cvEdit)}`);
session.commit({
  opId: "F-012-cv-edit",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: cvEditArgs,
  targetHandles: ["30"],
  resultHandles: ["30"],
}, cvEdit.changes, "2026-08-31T07:10:03.500Z");
const polylineArgs = { targetHandle: "60", actions: [{ type: "convert-polyline", precision: 10 }] };
const polylineEdit = editCommand.execute(session.document, polylineArgs);
if (polylineEdit.rejected.length || polylineEdit.changes.length !== 2 || polylineEdit.editedHandles.join() !== "61") throw new Error(`F-012 Convert to Polyline setup failed: ${JSON.stringify(polylineEdit)}`);
session.commit({
  opId: "F-012-convert-polyline",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: polylineArgs,
  targetHandles: ["60"],
  resultHandles: ["61"],
}, polylineEdit.changes, "2026-08-31T07:10:03.750Z");
const kinkCreateArgs = {
  handle: "70", layerId: "0", method: "fit",
  points: [{ x: 0, y: -500 }, { x: 30, y: -430 }, { x: 70, y: -560 }, { x: 110, y: -440 }, { x: 150, y: -500 }],
  fitTolerance: 0, knotParameterization: "chord",
};
session.commit({
  opId: "F-012-kink-create",
  baseRevision: session.document.revision,
  commandId: "SPLINE",
  args: kinkCreateArgs,
  targetHandles: [],
  resultHandles: ["70"],
}, splineCommand.execute(kinkCreateArgs), "2026-08-31T07:10:03.800Z");
const kinkSource = structuredClone(session.document.entities.find(({ handle }) => handle === "70"));
if (kinkSource?.kind !== "spline") throw new Error("F-012 Fit Kink source setup failed.");
const kinkSamples = Array.from({ length: 41 }, (_unused, index) => splinePointAtParameter(kinkSource, index / 40));
const kinkPoint = splinePointAtParameter(kinkSource, 0.45);
if (!kinkPoint) throw new Error("F-012 Fit Kink target evaluation failed.");
const kinkArgs = { targetHandle: "70", actions: [{ type: "fit-kink", point: kinkPoint }] };
const kinkEdit = editCommand.execute(session.document, kinkArgs);
if (kinkEdit.rejected.length || kinkEdit.changes.length !== 1 || kinkEdit.editedHandles.join() !== "70") throw new Error(`F-012 Fit Kink setup failed: ${JSON.stringify(kinkEdit)}`);
session.commit({
  opId: "F-012-fit-kink",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: kinkArgs,
  targetHandles: ["70"],
  resultHandles: ["70"],
}, kinkEdit.changes, "2026-08-31T07:10:03.900Z");
const refineCreateArgs = {
  handle: "80", layerId: "0", method: "control-vertices", degree: 3,
  points: [{ x: 0, y: -700 }, { x: 30, y: -630 }, { x: 80, y: -720 }, { x: 120, y: -700 }],
};
session.commit({
  opId: "F-012-cv-refine-create",
  baseRevision: session.document.revision,
  commandId: "SPLINE",
  args: refineCreateArgs,
  targetHandles: [],
  resultHandles: ["80"],
}, splineCommand.execute(refineCreateArgs), "2026-08-31T07:10:03.925Z");
const refineSource = structuredClone(session.document.entities.find(({ handle }) => handle === "80"));
if (refineSource?.kind !== "spline") throw new Error("F-012 CV Refine source setup failed.");
const refineSamples = Array.from({ length: 81 }, (_unused, index) => splinePointAtParameter(refineSource, index / 80));
const refinePoint = splinePointAtParameter(refineSource, 0.5);
if (!refinePoint) throw new Error("F-012 CV Refine target evaluation failed.");
const refineArgs = { targetHandle: "80", actions: [{ type: "cv-add", point: refinePoint }, { type: "cv-elevate", order: 5 }] };
const refineEdit = editCommand.execute(session.document, refineArgs);
if (refineEdit.rejected.length || refineEdit.changes.length !== 1 || refineEdit.editedHandles.join() !== "80") throw new Error(`F-012 CV Refine setup failed: ${JSON.stringify(refineEdit)}`);
session.commit({
  opId: "F-012-cv-refine",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: refineArgs,
  targetHandles: ["80"],
  resultHandles: ["80"],
}, refineEdit.changes, "2026-08-31T07:10:03.950Z");
const deleteCreateArgs = {
  handle: "90", layerId: "0", method: "control-vertices", degree: 3,
  points: [{ x: 0, y: -900 }, { x: 15, y: -865 }, { x: 55, y: -875 }, { x: 100, y: -910 }, { x: 120, y: -900 }],
};
session.commit({
  opId: "F-012-cv-delete-create",
  baseRevision: session.document.revision,
  commandId: "SPLINE",
  args: deleteCreateArgs,
  targetHandles: [],
  resultHandles: ["90"],
}, splineCommand.execute(deleteCreateArgs), "2026-08-31T07:10:03.960Z");
const deleteArgs = { targetHandle: "90", actions: [{ type: "cv-delete", index: 2 }] };
const deleteEdit = editCommand.execute(session.document, deleteArgs);
if (deleteEdit.rejected.length || deleteEdit.changes.length !== 1 || deleteEdit.editedHandles.join() !== "90") throw new Error(`F-012 CV Delete setup failed: ${JSON.stringify(deleteEdit)}`);
session.commit({
  opId: "F-012-cv-delete",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: deleteArgs,
  targetHandles: ["90"],
  resultHandles: ["90"],
}, deleteEdit.changes, "2026-08-31T07:10:03.975Z");

const variantFixtures = [
  {
    handle: "91", create: { handle: "91", layerId: "0", method: "control-vertices", degree: 3, points: [{ x: 180, y: -900 }, { x: 210, y: -830 }, { x: 260, y: -920 }, { x: 300, y: -900 }], weights: [1, 1.5, 2, 2.5] },
    actionFactory: (source) => {
      const point = splinePointAtParameter(source, 0.5);
      if (!point) throw new Error("F-012 rational repeated-knot point evaluation failed.");
      return [{ type: "cv-add", point }, { type: "cv-add", point }, { type: "cv-delete", index: 2 }];
    },
  },
  {
    handle: "92", create: { handle: "92", layerId: "0", method: "control-vertices", degree: 3, points: [{ x: 360, y: -900 }, { x: 390, y: -830 }, { x: 440, y: -920 }, { x: 480, y: -900 }], weights: [1, 1.25, 0.8, 1] },
    actionFactory: () => [{ type: "cv-delete", index: 2 }],
  },
  {
    handle: "93", create: { handle: "93", layerId: "0", method: "control-vertices", degree: 3, closed: true, points: [{ x: 540, y: -900 }, { x: 570, y: -830 }, { x: 620, y: -860 }, { x: 660, y: -920 }, { x: 610, y: -960 }, { x: 555, y: -945 }] },
    actionFactory: () => [{ type: "cv-delete", index: 2 }],
  },
  {
    handle: "94", create: { handle: "94", layerId: "0", method: "control-vertices", degree: 2, points: [{ x: 720, y: -900 }, { x: 750, y: -830 }, { x: 800, y: -870 }, { x: 845, y: -930 }, { x: 880, y: -900 }] },
    actionFactory: () => [{ type: "cv-delete", index: 2 }],
  },
];
const variantSources = {};
for (const [index, fixture] of variantFixtures.entries()) {
  session.commit({
    opId: `F-012-cv-delete-variant-create-${fixture.handle}`,
    baseRevision: session.document.revision,
    commandId: "SPLINE",
    args: fixture.create,
    targetHandles: [],
    resultHandles: [fixture.handle],
  }, splineCommand.execute(fixture.create), `2026-08-31T07:10:03.98${index}Z`);
  const source = structuredClone(session.document.entities.find(({ handle }) => handle === fixture.handle));
  if (source?.kind !== "spline") throw new Error(`F-012 CV Delete variant ${fixture.handle} source setup failed.`);
  variantSources[fixture.handle] = source;
  const args = { targetHandle: fixture.handle, actions: fixture.actionFactory(source) };
  const editResult = editCommand.execute(session.document, args);
  if (editResult.rejected.length || editResult.changes.length !== 1 || editResult.editedHandles.join() !== fixture.handle) throw new Error(`F-012 CV Delete variant ${fixture.handle} failed: ${JSON.stringify(editResult)}`);
  session.commit({
    opId: `F-012-cv-delete-variant-${fixture.handle}`,
    baseRevision: session.document.revision,
    commandId: "SPLINEDIT",
    args,
    targetHandles: [fixture.handle],
    resultHandles: [fixture.handle],
  }, editResult.changes, `2026-08-31T07:10:03.99${index}Z`);
}
const beforeEdit = structuredClone(session.document.entities.find(({ handle }) => handle === "10"));
const editArgs = {
  targetHandle: "10",
  actions: [
    { type: "fit-add", index: 2, point: { x: 70, y: 55 } },
    { type: "fit-move", index: 1, point: { x: 35, y: 85 } },
    { type: "fit-properties", fitTolerance: 0.25, knotParameterization: "uniform", startTangent: { x: 200, y: 10 }, endTangent: { x: 120, y: -70 } },
    { type: "reverse" },
  ],
};
const edit = editCommand.execute(session.document, editArgs);
if (edit.rejected.length || edit.changes.length !== 1 || edit.editedHandles.join() !== "10") throw new Error(`F-012 SPLINEDIT setup failed: ${JSON.stringify(edit)}`);
session.commit({
  opId: "F-012-edit",
  baseRevision: session.document.revision,
  commandId: "SPLINEDIT",
  args: editArgs,
  targetHandles: ["10"],
  resultHandles: ["10"],
}, edit.changes, "2026-08-31T07:10:04.000Z");

const committed = structuredClone(session.document);
const byHandle = Object.fromEntries(committed.entities.map((entity) => [entity.handle, entity]));
if (["10", "20", "30", "50", "70", "80", "90", "91", "92", "93", "94"].some((handle) => byHandle[handle]?.kind !== "spline") || byHandle["61"]?.kind !== "polyline" || byHandle["40"] || byHandle["60"]) throw new Error("F-012 committed SPLINE matrix is incomplete.");
const kinkGeometryPreserved = byHandle["70"].definitionMethod === "control-vertices"
  && !byHandle["70"].fitPoints
  && byHandle["70"].controlPoints.length === kinkSource.controlPoints.length + kinkSource.degree
  && byHandle["70"].knots.length === kinkSource.knots.length + kinkSource.degree
  && kinkSamples.every((point, index) => pointClose(splinePointAtParameter(byHandle["70"], index / 40), point, 1e-7));
const cvRefineGeometryPreserved = byHandle["80"].definitionMethod === "control-vertices"
  && byHandle["80"].degree === 4
  && byHandle["80"].controlPoints.length === 7
  && byHandle["80"].knots.length === 12
  && byHandle["80"].knots.filter((value) => close(value, 0.5, 1e-8)).length === 2
  && refineSamples.every((point, index) => pointClose(splinePointAtParameter(byHandle["80"], index / 80), point, 1e-7));
const cvDeleteMatches = byHandle["90"].definitionMethod === "control-vertices"
  && byHandle["90"].degree === 3
  && JSON.stringify(byHandle["90"].controlPoints) === JSON.stringify([{ x: 0, y: -900 }, { x: 15, y: -865 }, { x: 100, y: -910 }, { x: 120, y: -900 }])
  && JSON.stringify(byHandle["90"].knots) === JSON.stringify([0, 0, 0, 0, 1, 1, 1, 1]);
const rationalRepeatedSource = variantSources["91"];
const rationalRepeatedMatches = byHandle["91"].degree === 3
  && byHandle["91"].controlPoints.length === 5
  && byHandle["91"].weights.length === 5
  && byHandle["91"].knots.filter((value) => close(value, 0.5)).length === 1;
const minimumDegreeMatches = byHandle["92"].degree === 2
  && JSON.stringify(byHandle["92"].controlPoints) === JSON.stringify([variantSources["92"].controlPoints[0], variantSources["92"].controlPoints[1], variantSources["92"].controlPoints[3]])
  && JSON.stringify(byHandle["92"].weights) === JSON.stringify([1, 1.25, 1])
  && JSON.stringify(byHandle["92"].knots) === JSON.stringify([0, 0, 0, 1, 1, 1]);
const periodicSource = variantSources["93"];
const periodicUnique = periodicSource.controlPoints.slice(0, 6).filter((_point, index) => index !== 2);
const periodicCompact = periodicSource.knots.slice(3, 10);
periodicCompact.splice(2, 1);
const periodicSpan = periodicCompact.at(-1) - periodicCompact[0];
const periodicExpectedKnots = [...periodicCompact.slice(2, -1).map((knot) => knot - periodicSpan), ...periodicCompact, ...periodicCompact.slice(1, 4).map((knot) => knot + periodicSpan)];
const periodicMatches = byHandle["93"].closed === true && byHandle["93"].periodic === true && byHandle["93"].degree === 3
  && JSON.stringify(byHandle["93"].controlPoints) === JSON.stringify([...periodicUnique, ...periodicUnique.slice(0, 3)])
  && JSON.stringify(byHandle["93"].knots) === JSON.stringify(periodicExpectedKnots);
const quadraticSource = variantSources["94"];
const quadraticMatches = byHandle["94"].degree === 2
  && JSON.stringify(byHandle["94"].controlPoints) === JSON.stringify(quadraticSource.controlPoints.filter((_point, index) => index !== 2))
  && JSON.stringify(byHandle["94"].knots) === JSON.stringify(quadraticSource.knots.filter((_knot, index) => index !== 4));
const endpointChecks = {
  openStart: pointClose(splinePointAtParameter(byHandle["10"], 0), byHandle["10"].fitPoints[0]),
  openEnd: pointClose(splinePointAtParameter(byHandle["10"], 1), byHandle["10"].fitPoints.at(-1)),
  closedSeam: pointClose(splinePointAtParameter(byHandle["20"], 0), splinePointAtParameter(byHandle["20"], 1)),
  cvStart: pointClose(splinePointAtParameter(byHandle["30"], 0), byHandle["30"].controlPoints[0]),
  cvEnd: pointClose(splinePointAtParameter(byHandle["30"], 1), byHandle["30"].controlPoints.at(-1)),
  objectStart: pointClose(splinePointAtParameter(byHandle["50"], 0), { x: 420, y: 0 }),
  objectEnd: pointClose(splinePointAtParameter(byHandle["50"], 1), { x: 560, y: 0 }),
  polylineStart: pointClose(byHandle["61"].vertices[0], { x: 200, y: -300 }),
  polylineEnd: pointClose(byHandle["61"].vertices.at(-1), { x: 380, y: -250 }),
  kinkStart: pointClose(splinePointAtParameter(byHandle["70"], 0), splinePointAtParameter(kinkSource, 0)),
  kinkEnd: pointClose(splinePointAtParameter(byHandle["70"], 1), splinePointAtParameter(kinkSource, 1)),
  cvRefineStart: pointClose(splinePointAtParameter(byHandle["80"], 0), splinePointAtParameter(refineSource, 0)),
  cvRefineEnd: pointClose(splinePointAtParameter(byHandle["80"], 1), splinePointAtParameter(refineSource, 1)),
  cvDeleteStart: pointClose(splinePointAtParameter(byHandle["90"], 0), { x: 0, y: -900 }),
  cvDeleteEnd: pointClose(splinePointAtParameter(byHandle["90"], 1), { x: 120, y: -900 }),
  rationalRepeatedStart: pointClose(splinePointAtParameter(byHandle["91"], 0), byHandle["91"].controlPoints[0]),
  rationalRepeatedEnd: pointClose(splinePointAtParameter(byHandle["91"], 1), byHandle["91"].controlPoints.at(-1)),
  minimumStart: pointClose(splinePointAtParameter(byHandle["92"], 0), byHandle["92"].controlPoints[0]),
  minimumEnd: pointClose(splinePointAtParameter(byHandle["92"], 1), byHandle["92"].controlPoints.at(-1)),
  periodicSeam: pointClose(splinePointAtParameter(byHandle["93"], 0), splinePointAtParameter(byHandle["93"], 1)),
  quadraticStart: pointClose(splinePointAtParameter(byHandle["94"], 0), byHandle["94"].controlPoints[0]),
  quadraticEnd: pointClose(splinePointAtParameter(byHandle["94"], 1), byHandle["94"].controlPoints.at(-1)),
};
if (Object.values(endpointChecks).some((value) => !value) || !kinkGeometryPreserved || !cvRefineGeometryPreserved || !cvDeleteMatches || !rationalRepeatedMatches || !minimumDegreeMatches || !periodicMatches || !quadraticMatches) throw new Error(`F-012 evaluated geometry mismatch: ${JSON.stringify({ endpointChecks, kinkGeometryPreserved, cvRefineGeometryPreserved, cvDeleteMatches, rationalRepeatedMatches, minimumDegreeMatches, periodicMatches, quadraticMatches })}`);

const exported = exportDxf(committed);
if (exported.report.skipped.length || [...exported.report.emittedHandles].sort().join() !== "10,20,30,50,61,70,80,90,91,92,93,94") throw new Error(`F-012 DXF export mismatch: ${JSON.stringify(exported.report)}`);
const strict = importDxf(exported.bytes, { documentId: "F-012-strict", now: "2026-08-31T07:10:05.000Z" });
if (strict.report.skipped.length || strict.report.warnings.length || strict.document.entities.length !== 12) throw new Error(`F-012 strict DXF read-back mismatch: ${JSON.stringify(strict.report)}`);
const independent = new DxfParser().parseSync(exported.text);
if (independent?.entities?.length !== 12 || independent.entities.filter(({ type }) => type === "SPLINE").length !== 11 || independent.entities.filter(({ type }) => type === "LWPOLYLINE").length !== 1) throw new Error("F-012 dxf-parser entity matrix mismatch.");
const raw = rawEntityRecords(exported.text);
const rawChecks = {
  openFitCount: rawNumber(raw.get("10"), 74) === 5,
  openFitPoints: byHandle["10"].fitPoints.every((point, index) => pointClose(fitPointsFromRaw(raw.get("10"))[index], point)),
  openTolerance: close(rawNumber(raw.get("10"), 44), 0.25),
  openStartTangent: pointClose(tangentFromRaw(raw.get("10"), 12, 22), byHandle["10"].startTangent),
  openEndTangent: pointClose(tangentFromRaw(raw.get("10"), 13, 23), byHandle["10"].endTangent),
  closedFlags: rawNumber(raw.get("20"), 70) === 11,
  closedFitCount: rawNumber(raw.get("20"), 74) === 4,
  cvRationalFlags: rawNumber(raw.get("30"), 70) === 12,
  cvWeightCount: rawValues(raw.get("30"), 41).length === 4,
  cvMovedAndWeighted: pointClose(byHandle["30"].controlPoints[1], { x: 255, y: 95 }) && close(byHandle["30"].weights[1], 2.5) && close(Number(rawValues(raw.get("30"), 41)[1]), 2.5),
  objectControlVertices: rawNumber(raw.get("50"), 71) === 3
    && rawNumber(raw.get("50"), 73) === 4
    && rawNumber(raw.get("50"), 74) === 0
    && rawValues(raw.get("50"), 40).map(Number).join() === "0,0,0,0,1,1,1,1"
    && pointClose(byHandle["50"].controlPoints[1], { x: 450, y: 80 })
    && byHandle["50"].definitionMethod === "control-vertices",
  polylineConversion: rawNumber(raw.get("61"), 90) === byHandle["61"].vertices.length
    && rawValues(raw.get("61"), 10).length === byHandle["61"].vertices.length
    && byHandle["61"].vertices.length > 4,
  fitKink: rawNumber(raw.get("70"), 71) === 3
    && rawNumber(raw.get("70"), 73) === byHandle["70"].controlPoints.length
    && rawNumber(raw.get("70"), 74) === 0
    && rawValues(raw.get("70"), 40).length === byHandle["70"].knots.length
    && byHandle["70"].definitionMethod === "control-vertices"
    && kinkGeometryPreserved,
  cvAddAndElevate: rawNumber(raw.get("80"), 71) === 4
    && rawNumber(raw.get("80"), 73) === 7
    && rawNumber(raw.get("80"), 74) === 0
    && rawValues(raw.get("80"), 40).length === 12
    && rawValues(raw.get("80"), 40).map(Number).filter((value) => close(value, 0.5, 1e-8)).length === 2
    && cvRefineGeometryPreserved,
  cvDelete: rawNumber(raw.get("90"), 71) === 3
    && rawNumber(raw.get("90"), 73) === 4
    && rawNumber(raw.get("90"), 74) === 0
    && rawValues(raw.get("90"), 40).map(Number).join() === "0,0,0,0,1,1,1,1"
    && cvDeleteMatches,
  cvDeleteRationalRepeated: rawNumber(raw.get("91"), 71) === 3
    && rawNumber(raw.get("91"), 73) === 5
    && rawValues(raw.get("91"), 41).length === 5
    && rawValues(raw.get("91"), 40).map(Number).filter((value) => close(value, 0.5)).length === 1
    && rationalRepeatedMatches,
  cvDeleteMinimumDegree: rawNumber(raw.get("92"), 71) === 2
    && rawNumber(raw.get("92"), 73) === 3
    && rawValues(raw.get("92"), 40).map(Number).join() === "0,0,0,1,1,1"
    && minimumDegreeMatches,
  cvDeletePeriodic: rawNumber(raw.get("93"), 70) === 11
    && rawNumber(raw.get("93"), 71) === 3
    && rawNumber(raw.get("93"), 73) === 8
    && periodicMatches,
  cvDeleteQuadratic: rawNumber(raw.get("94"), 71) === 2
    && rawNumber(raw.get("94"), 73) === 4
    && rawValues(raw.get("94"), 40).length === 7
    && quadraticMatches,
};
if (Object.values(rawChecks).some((value) => !value)) throw new Error(`F-012 raw DXF mismatch: ${JSON.stringify(rawChecks)}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-31T07:10:06.000Z");
const restored = await deserializeKDraw(kdrawBytes);
if (JSON.stringify(restored.document) !== JSON.stringify(committed) || restored.attachments.size !== 0) throw new Error("F-012 KDRAW1 read-back mismatch.");
const undone = session.undo("2026-08-31T07:10:07.000Z");
if (!undone || JSON.stringify(session.document.entities.find(({ handle }) => handle === "10")) !== JSON.stringify(beforeEdit)) throw new Error("F-012 SPLINEDIT atomic Undo mismatch.");
const redone = session.redo("2026-08-31T07:10:08.000Z");
if (!redone || JSON.stringify(session.document.entities) !== JSON.stringify(committed.entities)) throw new Error("F-012 SPLINEDIT atomic Redo mismatch.");
const evaluatedEndpointsByHandle = Object.fromEntries(committed.entities.filter(({ kind }) => kind === "spline").map((entity) => [entity.handle, {
  start: splinePointAtParameter(entity, entity.knots[entity.degree]),
  end: splinePointAtParameter(entity, entity.knots[entity.controlPoints.length]),
}]));

const report = {
  schemaVersion: 1,
  rowId: "F-012",
  status: "PASS",
  observedAt: new Date().toISOString(),
  source: "production SPL/SPLINE + SPE/SPLINEDIT registry -> CadSession -> production DXF/KDRAW1 -> strict importer + dxf-parser + raw group audit -> atomic Undo/Redo",
  checks: {
    registry: true,
    openFitAndTangents: true,
    closedPeriodicFit: true,
    rationalControlVertices: true,
    objectConversion: true,
    convertToPolyline: true,
    fitKink: true,
    cvAddAndElevate: true,
    cvDelete: true,
    cvDeleteVariants: true,
    splineEditAtomic: true,
    evaluatedEndpoints: endpointChecks,
    strictDxf: true,
    independentDxf: rawChecks,
    kdrawChecksum: true,
    atomicUndoRedo: true,
  },
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  committedDocument: committed,
  evaluatedEndpointsByHandle,
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-012 production SPLINE/SPLINEDIT DXF/KDRAW1 independent read-back PASS.");
