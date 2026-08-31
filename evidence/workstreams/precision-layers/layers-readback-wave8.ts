import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../packages/cad-core/src/layer-policy.js";
import { planCreateLayer, planSetEntityLayerProperties, planSetLayerToggle, readCadLayerContract } from "../../../packages/cad-core/src/layers.js";
import { profileCadSpatialIndexes } from "../../../packages/cad-renderer/src/selection-index.js";
import { LayerManagerController } from "../../../apps/web/src/features/layers/controller.js";
import { LayerManagerShellAdapter } from "../../../apps/web/src/features/layers/shell-adapter.js";

const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failure = (operation: () => unknown): string => {
  try {
    operation();
    return "DID_NOT_FAIL";
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
};

const source = createEmptyDocument({ documentId: "layers-wave8-evidence", now: "2026-08-31T18:00:00.000Z" });
source.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
source.entities = ["10", "11"].map((handle, index) => ({
  kind: "line" as const, handle, layerId: "0", start: { x: index, y: 0 }, end: { x: index, y: 1 },
  ...(index === 1 ? { appearance: { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.7 } } : {}),
}));

const shell = new LayerManagerShellAdapter(new LayerManagerController(source, {
  opIdPrefix: "layers-wave8", now: () => "2026-08-31T18:01:00.000Z",
}));
const commits = [
  shell.execute({ capability: "layers.create", name: "Steel", requestedId: "steel" }),
  shell.execute({ capability: "layers.create", name: "defpoints" }),
  shell.execute({ capability: "layers.rename", layerId: "steel", name: "Steel main" }),
  shell.execute({ capability: "layers.current", layerId: "steel" }),
  shell.execute({ capability: "layers.visibility", layerIds: ["steel"], visible: false }),
  shell.execute({ capability: "layers.visibility", layerIds: ["steel"], visible: true }),
  shell.execute({ capability: "layers.lock", layerIds: ["steel"], locked: true }),
  shell.execute({ capability: "layers.lock", layerIds: ["steel"], locked: false }),
  shell.execute({ capability: "layers.current", layerId: "0" }),
  shell.execute({ capability: "layers.freeze", layerIds: ["steel"], frozen: true }),
  shell.execute({ capability: "layers.freeze", layerIds: ["steel"], frozen: false }),
  shell.execute({ capability: "layers.color", layerIds: ["steel"], color: "#336699", colorMethod: "trueColor" }),
  shell.execute({ capability: "layers.linetype", layerIds: ["steel"], linetypeId: "dash" }),
  shell.execute({ capability: "layers.lineweight", layerIds: ["steel"], lineweightMm: 0.5 }),
  shell.execute({ capability: "layers.plot", layerIds: ["steel"], plottable: false }),
];
const beforeEntityUpdate = shell.document;
const entityCommit = shell.execute({
  capability: "layers.entity-properties", handles: ["10", "11", "10"],
  patch: { layerId: "steel", clearOverrides: true, color: null, linetypeId: null, lineweightMm: null },
});
const afterEntityUpdate = shell.document;
const undo = shell.undo();
const undoEntitiesEqual = JSON.stringify(shell.document.entities) === JSON.stringify(beforeEntityUpdate.entities);
const redo = shell.redo();
const redoEntitiesEqual = JSON.stringify(shell.document.entities) === JSON.stringify(afterEntityUpdate.entities);
const serialized = JSON.stringify(shell.document);
const reopened = JSON.parse(serialized) as typeof source;
const readback = readCadLayerContract(reopened);
const propertyIndex = createCadLayerPropertyIndex(reopened.layers, reopened.linetypes);

const invalidSource = structuredClone(reopened);
invalidSource.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
const failClosed = {
  duplicateName: failure(() => planCreateLayer(reopened, "steel MAIN")),
  invalidName: failure(() => planCreateLayer(reopened, "A/B")),
  defpointsPlot: failure(() => planSetLayerToggle(reopened, "Defpoints", "plottable", true)),
  lockedTarget: failure(() => planSetEntityLayerProperties(invalidSource, ["10"], { layerId: "locked" })),
  orphanLinetype: failure(() => {
    const invalid = structuredClone(reopened);
    invalid.layers.find((layer) => layer.id === "steel")!.appearance!.linetypeId = "orphan";
    readCadLayerContract(invalid);
  }),
};

const performanceDocument = createEmptyDocument({ documentId: "layers-wave8-50k" });
performanceDocument.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
performanceDocument.layers = Array.from({ length: 250 }, (_, index) => ({
  id: `L${index}`, name: index === 0 ? "0" : `Layer ${index}`,
  visible: index % 11 !== 0, frozen: index % 13 === 0, locked: index % 17 === 0, plottable: index % 19 !== 0,
  appearance: { color: `#${index.toString(16).padStart(6, "0")}`, colorMethod: "trueColor" as const, linetypeId: "dash", lineweightMm: (index % 10) / 10 },
}));
performanceDocument.currentLayerId = "L1";
performanceDocument.entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const, handle: index.toString(16).toUpperCase(), layerId: `L${index % 250}`,
  start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
  end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
}));
const performanceShell = new LayerManagerShellAdapter(new LayerManagerController(performanceDocument));
const spatialProfile = profileCadSpatialIndexes(performanceDocument.entities, {
  selectionPoint: { x: 25, y: 0 }, selectionTolerance: 6,
  snap: { modes: ["endpoint", "midpoint", "nearest"], cursor: { x: 25, y: 0 }, aperture: 6 },
  eligible: performanceShell.eligibility("select"), queryIterations: 100,
});
const performanceIndex = createCadLayerPropertyIndex(performanceDocument.layers, performanceDocument.linetypes);
const resolutionStarted = performance.now();
let resolutionChecksum = 0;
for (const entity of performanceDocument.entities) {
  resolutionChecksum += resolveCadEntityLayerProperties(entity, performanceIndex).lineweightMm ?? 0;
}
const resolutionMs = performance.now() - resolutionStarted;

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  command: "npx vite-node evidence/workstreams/precision-layers/layers-readback-wave8.ts",
  baselineCommit: "7bfa2bea649583129844444f9f5788a701ff21a4",
  branch: "work8/reio-precision-live",
  featureRows: ["F-072", "F-073", "F-074", "F-075", "F-076", "F-077", "F-078", "F-079"],
  operationReadback: {
    revisions: commits.map((commit) => commit.committed.committedRevision),
    commandIds: commits.map((commit) => commit.committed.operation.commandId),
    entityOperation: entityCommit.committed.operation,
    oneEntityRevision: entityCommit.committed.committedRevision === beforeEntityUpdate.revision + 1,
    undoRevision: undo?.committed.committedRevision ?? null,
    redoRevision: redo?.committed.committedRevision ?? null,
    undoEntitiesEqual,
    redoEntitiesEqual,
  },
  persistedReadback: {
    documentSha256: sha256(serialized),
    contractSha256: sha256(readback),
    currentLayerId: readback.currentLayerId,
    layers: readback.layers,
    entityLayerIds: readback.entities.map((entity) => [entity.handle, entity.layerId]),
  },
  resolvedByLayer: reopened.entities.map((entity) => ({ handle: entity.handle, ...resolveCadEntityLayerProperties(entity, propertyIndex) })),
  failClosed,
  performance: {
    ...spatialProfile.profile,
    selection: spatialProfile.selection,
    snap: spatialProfile.snap,
    byLayerResolutionMs: Number(resolutionMs.toFixed(4)),
    resolutionChecksum: Number(resolutionChecksum.toFixed(6)),
  },
}, null, 2)}\n`);
