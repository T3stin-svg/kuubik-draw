import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { planDrawOrderChanges, readCadDrawOrderContract, reorderedCadEntities } from "../src/draw-order.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../src/layer-policy.js";
import { planSetEntityLayerProperties, planSetLayerAppearance, readCadLayerContract } from "../src/layers.js";
import { resolveEntityPlotAppearance } from "../src/plot-style.js";
import { CadSession } from "../src/transaction.js";
import { deserializeKDraw, serializeKDraw } from "../src/container.js";
import golden from "./transparency-draw-order.golden.json";

function fixture() {
  const document = createEmptyDocument({ documentId: "f080-f086", now: "2026-08-31T00:00:00Z" });
  document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
  document.entities = ["A", "B", "C", "D", "E"].map((handle, x) => ({
    kind: "line" as const, handle, layerId: "A", start: { x, y: 0 }, end: { x, y: 1 },
  }));
  return document;
}

describe("F-080/F-086 golden contract", () => {
  it("matches front/back/above/below goldens independently of selection order", () => {
    const document = fixture();
    for (const example of golden.drawOrder) {
      const result = reorderedCadEntities(document.entities, example.handles, example.action as never, example.referenceHandle);
      expect(result.map((entity) => entity.handle)).toEqual(example.expected);
      expect(reorderedCadEntities(document.entities, [...example.handles].reverse(), example.action as never, example.referenceHandle)
        .map((entity) => entity.handle)).toEqual(example.expected);
    }
  });

  it("resolves exact unrounded layer/entity transparency and print opacity", () => {
    for (const example of golden.transparency) {
      const document = fixture();
      document.layers[1]!.appearance = { transparency: example.layer };
      const entity = { ...document.entities[0]!, ...(example.entity === null ? {} : { appearance: { transparency: example.entity } }) };
      const resolved = resolveCadEntityLayerProperties(entity, createCadLayerPropertyIndex(document.layers, document.linetypes));
      const plotted = resolveEntityPlotAppearance(entity, document.layers, { profile: "color", plotLineweights: true, plotTransparency: true });
      expect(resolved.transparency).toBe(example.expected);
      expect(resolved.sources.transparency).toBe(example.source);
      expect(plotted.transparencyPercent).toBe(example.expected);
      expect(plotted.opacity).toBe(example.opacity);
    }
  });

  it("restores entity ByLayer with null and preserves one atomic revision through reopen/Undo/Redo", async () => {
    const document = fixture();
    document.layers[1]!.appearance = { transparency: 37.125 };
    document.entities[0]!.appearance = { transparency: 80.25 };
    const session = new CadSession(document);
    const transparency = planSetEntityLayerProperties(session.document, ["A"], { transparency: null });
    session.commit({ opId: "transparency", baseRevision: 0, commandId: transparency.commandId, args: transparency.args, targetHandles: transparency.targetHandles, resultHandles: transparency.resultHandles }, transparency.changes);
    expect(session.document.entities[0]!.appearance).toBeUndefined();
    expect(resolveCadEntityLayerProperties(session.document.entities[0]!, createCadLayerPropertyIndex(session.document.layers, session.document.linetypes)).transparency).toBe(37.125);

    const order = planDrawOrderChanges(session.document, ["B", "D"], "front");
    session.commit({ opId: "order", baseRevision: 1, commandId: order.commandId, args: order.args, targetHandles: ["B", "D"], resultHandles: ["B", "D"] }, order.changes);
    const committed = session.document.entities.map((entity) => entity.handle);
    expect(session.document.revision).toBe(2);
    expect(readCadDrawOrderContract(session.document).orderedHandles).toEqual(committed);
    session.undo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["A", "B", "C", "D", "E"]);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(committed);

    const reopened = (await deserializeKDraw(await serializeKDraw(session.document))).document;
    expect(readCadLayerContract(reopened).layers[1]!.appearance?.transparency).toBe(37.125);
    expect(readCadDrawOrderContract(reopened).orderedHandles).toEqual(committed);
  });

  it("clears layer transparency without inventing a rounded/default geometry value", () => {
    const document = fixture();
    document.layers[1]!.appearance = { transparency: 44.44444444444444 };
    const plan = planSetLayerAppearance(document, "A", { transparency: null });
    expect(plan.changes).toEqual([{ type: "put-layer", layer: expect.objectContaining({ id: "A" }) }]);
    expect((plan.changes[0] as { layer: { appearance?: unknown } }).layer.appearance).toBeUndefined();
    expect(document.entities).toEqual(fixture().entities);
  });
});
