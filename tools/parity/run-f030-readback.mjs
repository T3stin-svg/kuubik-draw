#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import DxfParser from "dxf-parser";
import {
  CadSession,
  createEmptyDocument,
  deserializeKDraw,
  executeMatchProperties,
  executeMatchPropertiesAcrossDocuments,
  executeMatchViewportProperties,
  matchCadEntityProperties,
  resolveCadCommand,
  resolveMatchPropertiesSettings,
  serializeKDraw,
} from "../../packages/cad-core/dist/index.js";
import { exportDxf, importDxf } from "../../packages/cad-dxf/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifactRoot, "F-030-kuubik.dxf");
const kdrawPath = resolve(artifactRoot, "F-030-kuubik.kdraw");
const reportPath = resolve(artifactRoot, "F-030-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const close = (left, right, tolerance = 1e-9) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
const sourcePaths = [
  "packages/cad-core/src/commands.ts",
  "packages/cad-core/src/index.ts",
  "packages/cad-core/src/match-properties.ts",
  "packages/cad-core/src/transaction.ts",
  "packages/cad-core/test/match-properties.test.ts",
  "packages/cad-core/test/f030-mutation-proven.test.ts",
  "packages/cad-dxf/src/import.ts",
  "packages/cad-dxf/src/index.ts",
  "packages/cad-dxf/test/f030-match-properties-roundtrip.test.ts",
  "tools/parity/run-f030-readback.mjs",
];

function entitySummary(entity) {
  const base = { handle: entity.handle, kind: entity.kind, layerId: entity.layerId, appearance: entity.appearance, extensionData: entity.extensionData };
  if (entity.kind === "line") return { ...base, start: entity.start, end: entity.end };
  if (entity.kind === "circle") return { ...base, center: entity.center, radius: entity.radius };
  throw new Error(`F-030 primary summary does not support ${entity.kind}.`);
}

function rawEntityRecords(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const records = [];
  let current = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]?.trim());
    const value = lines[index + 1] ?? "";
    if (!Number.isInteger(code)) throw new Error(`Malformed F-030 DXF group at line ${index + 1}.`);
    if (code === 0) { if (current) records.push(current); current = { type: value.trim(), groups: [] }; }
    else if (current) current.groups.push({ code, value: value.trim() });
  }
  if (current) records.push(current);
  return new Map(records.map((record) => [record.groups.find(({ code }) => code === 5)?.value, record]).filter(([handle]) => handle));
}
const rawValue = (record, code) => record?.groups?.find((group) => group.code === code)?.value;

const command = resolveCadCommand("MA");
if (!command || command.id !== "MATCHPROP") throw new Error("MA/MATCHPROP is missing from the production command registry.");
const document = createEmptyDocument({ documentId: "F-030-readback", now: "2026-08-30T18:00:00.000Z" });
document.layers.push(
  { id: "source", name: "SOURCE", visible: true, frozen: false, locked: false, plottable: true },
  { id: "target", name: "TARGET", visible: true, frozen: false, locked: false, plottable: true },
  { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
);
document.linetypes = [{ id: "hidden", name: "HIDDEN", description: "F-030", pattern: [5, -2] }];
document.entities = [
  {
    kind: "line", handle: "10", layerId: "source", start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
    appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "hidden", linetypeScale: 2.5, lineweightMm: 0.5, transparency: 40, thickness: -3.25 },
    extensionData: { source: true },
  },
  { kind: "line", handle: "20", layerId: "target", start: { x: 10, y: 20 }, end: { x: 70, y: 20 }, appearance: { color: "#00ff00", linetypeScale: 0.5 }, extensionData: { target: "line" } },
  { kind: "circle", handle: "30", layerId: "target", center: { x: 200, y: 100 }, radius: 30, appearance: { color: "#0000ff" }, extensionData: { target: "circle" } },
  { kind: "line", handle: "40", layerId: "locked", start: { x: 0, y: 200 }, end: { x: 100, y: 200 }, appearance: { color: "#00ffff" } },
];
const source = structuredClone(document);
const result = command.execute(document, { sourceHandle: "10", targetHandles: ["10", "20", "30", "40", "missing"] });
if (!exact(result.matchedHandles, ["20", "30"]) || !exact(result.rejected, [
  { handle: "10", reason: "source-target" }, { handle: "40", reason: "locked-layer" }, { handle: "missing", reason: "missing" },
])) throw new Error(`F-030 primary MATCHPROP setup failed: ${JSON.stringify(result)}`);
const expectedTargets = [source.entities[1], source.entities[2]].map((entity) => ({
  ...structuredClone(entity), layerId: "source", appearance: structuredClone(source.entities[0].appearance),
}));
const session = new CadSession(document);
session.commit({
  opId: "F-030-matchprop", baseRevision: 0, commandId: "MATCHPROP",
  args: { sourceHandle: "10", targetHandles: ["10", "20", "30", "40", "missing"] },
  targetHandles: ["20", "30"], resultHandles: result.matchedHandles,
}, result.changes, "2026-08-30T18:00:01.000Z");
const committed = structuredClone(session.document);
if (!exact(committed.entities[0], source.entities[0]) || !exact(committed.entities.slice(1, 3), expectedTargets)
  || !exact(committed.entities[3], source.entities[3])) throw new Error("F-030 committed identities, geometry, extension data or properties mismatch.");

const exported = exportDxf(committed);
if (exported.report.skipped.length) throw new Error(`F-030 DXF skipped output: ${JSON.stringify(exported.report.skipped)}`);
const strict = importDxf(exported.bytes, { documentId: "F-030-strict" });
const strictByHandle = new Map(strict.document.entities.map((entity) => [entity.handle, entity]));
const strictChecks = ["20", "30"].map((handle) => {
  const entity = strictByHandle.get(handle);
  const expected = expectedTargets.find((candidate) => candidate.handle === handle);
  return {
    handle,
    geometry: entity?.kind === expected?.kind && (entity.kind === "line" ? exact({ start: entity.start, end: entity.end }, { start: expected.start, end: expected.end }) : exact({ center: entity.center, radius: entity.radius }, { center: expected.center, radius: expected.radius })),
    layerName: strict.document.layers.find((layer) => layer.id === entity?.layerId)?.name === "SOURCE",
    linetypeName: strict.document.linetypes.find((linetype) => linetype.id === entity?.appearance?.linetypeId)?.name === "HIDDEN",
    linetypeScale: close(entity?.appearance?.linetypeScale, 2.5),
    lineweight: close(entity?.appearance?.lineweightMm, 0.5),
    transparency: entity?.appearance?.transparency === 40,
    thickness: close(entity?.appearance?.thickness, -3.25),
  };
});
if (strictChecks.some((check) => Object.entries(check).some(([key, value]) => key !== "handle" && value !== true))) throw new Error(`F-030 strict DXF mismatch: ${JSON.stringify(strictChecks)}`);
const dxfText = Buffer.from(exported.bytes).toString("latin1");
const independent = new DxfParser().parseSync(dxfText);
const independentByHandle = new Map((independent?.entities ?? []).map((entity) => [entity.handle, entity]));
const raw = rawEntityRecords(dxfText);
const independentChecks = ["20", "30"].map((handle) => {
  const entity = independentByHandle.get(handle);
  const record = raw.get(handle);
  const expected = expectedTargets.find((candidate) => candidate.handle === handle);
  return {
    handle,
    type: entity?.type === (expected?.kind === "line" ? "LINE" : "CIRCLE"),
    geometry: expected?.kind === "line"
      ? entity?.vertices?.length === 2 && exact(entity.vertices.map(({ x, y }) => ({ x, y })), [expected.start, expected.end])
      : close(entity?.center?.x, expected?.center.x) && close(entity?.center?.y, expected?.center.y) && close(entity?.radius, expected?.radius),
    layer: entity?.layer === "SOURCE",
    linetype: entity?.lineType === "HIDDEN" && close(entity?.lineTypeScale, 2.5),
    colorAndWeight: entity?.colorIndex === 1 && entity?.lineweight === 50,
    rawThickness: close(Number(rawValue(record, 39)), -3.25),
    rawTransparency: Number(rawValue(record, 440)) === 0x02000000 + Math.round(255 * (100 - 40) / 100),
  };
});
if (independentChecks.some((check) => Object.entries(check).some(([key, value]) => key !== "handle" && value !== true))) throw new Error(`F-030 independent DXF mismatch: ${JSON.stringify(independentChecks)}`);

const kdrawBytes = await serializeKDraw(committed, [], "2026-08-30T18:00:03.000Z");
const restored = await deserializeKDraw(kdrawBytes);
const documentEntry = restored.manifest.entries.find(({ path }) => path === restored.manifest.documentPath);
if (!documentEntry || restored.attachments.size || !exact(restored.document, committed)) throw new Error("F-030 KDRAW1 read-back mismatch.");
const undo = session.undo("2026-08-30T18:00:04.000Z");
if (!undo || !exact(session.document.entities, source.entities)) throw new Error("F-030 atomic Undo mismatch.");
const redo = session.redo("2026-08-30T18:00:05.000Z");
if (!redo || !exact(session.document.entities, committed.entities)) throw new Error("F-030 atomic Redo mismatch.");

const settings = resolveMatchPropertiesSettings({ layer: false, linetype: false, linetypeScale: false, lineweight: false, transparency: false, thickness: false, plotStyle: false, material: false, dimension: false, polyline: false, text: false, viewport: false, multileader: false, hatch: false, table: false, centerObject: false });
const byLayerSource = { kind: "circle", handle: "B1", layerId: "source", center: { x: 0, y: 0 }, radius: 1 };
const selectiveTarget = { kind: "circle", handle: "B2", layerId: "target", center: { x: 2, y: 0 }, radius: 1, appearance: { color: "#00ff00", linetypeId: "hidden", linetypeScale: 4, lineweightMm: 0.7 } };
const selective = matchCadEntityProperties(byLayerSource, selectiveTarget, settings);

const polySource = { kind: "polyline", handle: "P1", layerId: "source", closed: false, vertices: [{ x: 0, y: 0, startWidth: 3, endWidth: 3 }, { x: 10, y: 0, startWidth: 3, endWidth: 3 }] };
const polyTarget = { kind: "polyline", handle: "P2", layerId: "target", closed: true, vertices: [{ x: 20, y: 0, bulge: 0.5 }, { x: 30, y: 0 }] };
const polyMatched = matchCadEntityProperties(polySource, polyTarget, resolveMatchPropertiesSettings({ layer: false }));
const textMatched = matchCadEntityProperties(
  { kind: "mtext", handle: "T1", layerId: "source", position: { x: 0, y: 0 }, text: "SOURCE", height: 5, rotationRad: 1, styleId: "source-text" },
  { kind: "text", handle: "T2", layerId: "target", position: { x: 10, y: 10 }, text: "KEEP", height: 2, rotationRad: 0 },
  resolveMatchPropertiesSettings({ layer: false }),
);
const dimensionMatched = matchCadEntityProperties(
  { kind: "dimension", handle: "D1", layerId: "source", dimensionKind: "linear", definitionPoints: [{ x: 0, y: 0 }], styleId: "source-dim", overrideText: "SOURCE" },
  { kind: "dimension", handle: "D2", layerId: "target", dimensionKind: "aligned", definitionPoints: [{ x: 1, y: 2 }], styleId: "target-dim", overrideText: "KEEP" },
  resolveMatchPropertiesSettings({ layer: false }),
);
const hatchMatched = matchCadEntityProperties(
  { kind: "hatch", handle: "H1", layerId: "source", pattern: "SOLID", associative: true, loops: [] },
  { kind: "hatch", handle: "H2", layerId: "target", pattern: "ANSI31", associative: false, loops: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], isHole: false }] },
  resolveMatchPropertiesSettings({ layer: false }),
);
const specialChecks = {
  selectiveByLayerDeletion: exact(selective, { ...selectiveTarget, appearance: { linetypeId: "hidden", linetypeScale: 4, lineweightMm: 0.7 } }),
  uniformPolylineWidthOnly: polyMatched.vertices.every((vertex) => vertex.startWidth === 3 && vertex.endWidth === 3) && polyMatched.vertices[0].bulge === 0.5,
  textWithoutContentOrGeometry: textMatched.text === "KEEP" && exact(textMatched.position, { x: 10, y: 10 }) && textMatched.height === 5 && textMatched.rotationRad === 1 && textMatched.styleId === "source-text",
  dimensionStyleOnly: dimensionMatched.styleId === "source-dim" && dimensionMatched.overrideText === "KEEP" && exact(dimensionMatched.definitionPoints, [{ x: 1, y: 2 }]),
  hatchPatternOnly: hatchMatched.pattern === "SOLID" && hatchMatched.associative === false && exact(hatchMatched.loops, [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], isHole: false }]),
};

const viewportDocument = createEmptyDocument({ documentId: "F-030-viewport" });
const sourceViewport = { id: "source-vp", center: { x: 10, y: 10 }, width: 200, height: 100, viewCenter: { x: 1000, y: 2000 }, viewHeight: 5000, twistAngleRad: 0.5, locked: true, on: false, shadePlot: "wireframe", snapEnabled: true, gridEnabled: true, ucsIconVisible: false, ucsIconAtOrigin: false, clipBoundary: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }], layerOverrides: { source: { frozen: true, color: "#ff0000" } } };
const targetViewport = { id: "target-vp", center: { x: 300, y: 200 }, width: 80, height: 40, viewCenter: { x: -500, y: 700 }, viewHeight: 400, twistAngleRad: -0.25, locked: false, on: true, shadePlot: "hidden", snapEnabled: false, gridEnabled: false, ucsIconVisible: true, ucsIconAtOrigin: true, clipBoundary: [{ x: 260, y: 180 }, { x: 340, y: 180 }, { x: 340, y: 220 }, { x: 260, y: 220 }], layerOverrides: { target: { frozen: false, color: "#00ff00" } } };
viewportDocument.layouts.push({ id: "paper", name: "Layout 1", kind: "paper", viewports: [sourceViewport, targetViewport] });
const viewportResult = executeMatchViewportProperties(viewportDocument, { layoutId: "paper", viewportId: "source-vp" }, [{ layoutId: "paper", viewportId: "target-vp" }]);
const viewportMatched = viewportResult.changes[0]?.layouts?.find(({ id }) => id === "paper")?.viewports.find(({ id }) => id === "target-vp");
const viewportCheck = exact(viewportMatched, { ...targetViewport, viewHeight: 2000, locked: true, on: false, shadePlot: "wireframe", snapEnabled: true, gridEnabled: true, ucsIconVisible: false, ucsIconAtOrigin: false });

const sourceDocument = createEmptyDocument({ documentId: "F-030-source" });
sourceDocument.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true, appearance: { linetypeId: "dash" } });
sourceDocument.linetypes.push({ id: "dash", name: "DASH", pattern: [5, -2] });
sourceDocument.entities.push({ kind: "line", handle: "10", layerId: "A", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, appearance: { linetypeId: "dash" } });
const targetDocument = createEmptyDocument({ documentId: "F-030-target" });
targetDocument.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
targetDocument.linetypes.push({ id: "dash", name: "DASH", pattern: [1, -1] });
targetDocument.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 5, y: 5 }, end: { x: 6, y: 5 } });
const cross = executeMatchPropertiesAcrossDocuments(sourceDocument, targetDocument, { sourceHandle: "10", targetHandles: ["10"] });
const crossSession = new CadSession(targetDocument);
crossSession.commit({ opId: "F-030-cross", baseRevision: 0, commandId: "MATCHPROP", args: { sourceDocumentId: "F-030-source" }, targetHandles: ["10"], resultHandles: ["10"] }, cross.changes, "2026-08-30T18:10:00.000Z");
const crossCheck = cross.resourceImports.some(({ kind, action, targetId }) => kind === "linetype" && action === "import" && targetId === "dash$matchprop1")
  && cross.resourceImports.some(({ kind, action, targetId }) => kind === "layer" && action === "import" && targetId === "A$matchprop1")
  && crossSession.document.entities[0].layerId === "A$matchprop1" && crossSession.document.entities[0].appearance?.linetypeId === "dash$matchprop1"
  && crossSession.undo() !== null && exact(crossSession.document.entities, targetDocument.entities) && exact(crossSession.document.layers, targetDocument.layers) && exact(crossSession.document.linetypes, targetDocument.linetypes);
if (Object.values(specialChecks).some((value) => value !== true) || !viewportCheck || !crossCheck) throw new Error(`F-030 special/resource mismatch: ${JSON.stringify({ specialChecks, viewportCheck, crossCheck })}`);

const report = {
  schemaVersion: 1,
  rowId: "F-030",
  status: "PASS",
  observedAt: new Date().toISOString(),
  source: "production MA/MATCHPROP registry -> basic/special/viewport/cross-document predicates -> atomic commit -> production DXF/KDRAW1 -> strict importer + dxf-parser -> Undo/Redo",
  checks: { registry: true, exactBasicProperties: true, identityGeometryExtensionPreserved: true, typedRefusals: true, strictDxf: true, independentDxf: true, kdrawChecksum: true, atomicUndoRedo: true, specialProperties: true, viewportProperties: true, crossDocumentResources: true },
  implementationSha256: Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]))),
  sourceDocument: source,
  committedDocument: committed,
  expected: committed.entities.map(entitySummary),
  rejected: result.rejected,
  strictChecks,
  independentChecks,
  specialChecks,
  viewport: { source: sourceViewport, target: targetViewport, committed: viewportMatched, check: viewportCheck },
  crossDocument: { resourceImports: cross.resourceImports, committedEntity: crossSession.document.entities[0], check: crossCheck },
  dxf: { sha256: sha256(exported.bytes), byteLength: exported.bytes.byteLength, emittedHandles: exported.report.emittedHandles },
  kdraw: { sha256: sha256(kdrawBytes), byteLength: kdrawBytes.byteLength, documentSha256: documentEntry.sha256 },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(dxfPath, exported.bytes);
await writeFile(kdrawPath, kdrawBytes);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-030 production MATCHPROP basic/special/viewport/resource DXF/KDRAW1 independent read-back with atomic Undo/Redo PASS.");
