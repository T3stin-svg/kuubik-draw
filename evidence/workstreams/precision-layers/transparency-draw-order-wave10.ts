import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { planDrawOrderChanges, readCadDrawOrderContract } from "../../../packages/cad-core/src/draw-order.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../packages/cad-core/src/layer-policy.js";
import { planSetEntityLayerProperties } from "../../../packages/cad-core/src/layers.js";
import { resolveEntityPlotAppearance } from "../../../packages/cad-core/src/plot-style.js";
import { CadSession } from "../../../packages/cad-core/src/transaction.js";

const document = createEmptyDocument({ documentId: "wave10-readback", now: "2026-08-31T00:00:00Z" });
document.layers[0] = { ...document.layers[0]!, appearance: { transparency: 37.125 } };
document.entities = Array.from({ length: 50_000 }, (_, index) => ({
  kind: "line" as const,
  handle: `H${index}`,
  layerId: "0",
  ...(index === 1 ? { appearance: { transparency: 62.875 } } : {}),
  start: { x: index, y: 0 },
  end: { x: index + 1, y: 0 },
}));

const started = performance.now();
const selected = Array.from({ length: 100 }, (_, index) => `H${index * 499}`);
const order = planDrawOrderChanges(document, [...selected].reverse(), "front");
const planningMs = performance.now() - started;
const session = new CadSession(document);
session.commit({
  opId: "wave10:draw-order",
  baseRevision: 0,
  commandId: order.commandId,
  args: order.args,
  targetHandles: selected,
  resultHandles: selected,
}, order.changes, "2026-08-31T00:01:00Z");
const committed = readCadDrawOrderContract(session.document);
session.undo("2026-08-31T00:02:00Z");
const undone = readCadDrawOrderContract(session.document);
session.redo("2026-08-31T00:03:00Z");
const redone = readCadDrawOrderContract(session.document);

const clear = planSetEntityLayerProperties(session.document, ["H1"], { transparency: null });
const clearedEntity = (clear.changes[0] as { type: "put"; entity: typeof document.entities[number] }).entity;
const index = createCadLayerPropertyIndex(session.document.layers, session.document.linetypes);
const resolved = resolveCadEntityLayerProperties(clearedEntity, index);
const plotted = resolveEntityPlotAppearance(clearedEntity, session.document.layers);

console.log(JSON.stringify({
  baselineCommit: "c607df360f68714e87b475ffbbc1a889abf93306",
  featureRows: ["F-080", "F-086"],
  entityCount: document.entities.length,
  selectedCount: selected.length,
  planningMs: Number(planningMs.toFixed(3)),
  atomicChangeCount: order.changes.length,
  committedRevision: 1,
  committedFrontMatchesSelection: JSON.stringify(committed.orderedHandles.slice(-selected.length)) === JSON.stringify(selected),
  committedFrontFirst: committed.orderedHandles.at(-selected.length),
  committedFrontLast: committed.frontHandle,
  undoRestored: undone.orderedHandles[0] === "H0" && undone.orderedHandles.at(-1) === "H49999",
  redoRestored: JSON.stringify(redone.orderedHandles) === JSON.stringify(committed.orderedHandles),
  entityOverrideBefore: 62.875,
  byLayerAfterNull: resolved.transparency,
  transparencySourceAfterNull: resolved.sources.transparency,
  printOpacityAfterNull: plotted.opacity,
  geometryCoordinateReadback: clearedEntity.kind === "line" ? clearedEntity.start.x : null,
  autocadLiveReadback: "NOT_RUN",
  chromiumIntegratedUi: "NOT_RUN",
  canvasDrawOrderIntegration: "BLOCKED_RENDERER_OWNER",
  parityScoresChanged: false,
}, null, 2));
