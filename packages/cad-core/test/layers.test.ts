import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { planDrawOrderChanges, reorderedCadEntities } from "../src/draw-order.js";
import { entityParticipates, layerParticipation } from "../src/layer-policy.js";
import { planCreateLayer, planDeleteLayer, planRenameLayer, planSetCurrentLayer, planSetLayerAppearance, planSetLayerToggle } from "../src/layers.js";
import { CadSession } from "../src/transaction.js";

const op = (baseRevision: number, commandId: string) => ({ opId: `${commandId}-${baseRevision}`, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] });

describe("F-072..F-080 layer contract", () => {
  it("plans and commits CRUD/current atomically with deterministic IDs", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "layers" }));
    const create = planCreateLayer(session.document, "Steel Main");
    expect(create).toMatchObject({ commandId: "LAYER_CREATE", changes: [{ type: "put-layer", layer: { id: "layer-steel-main" } }] });
    session.commit(op(0, create.commandId), create.changes);
    const current = planSetCurrentLayer(session.document, "layer-steel-main");
    session.commit(op(1, current.commandId), current.changes);
    const rename = planRenameLayer(session.document, "layer-steel-main", "Steel secondary");
    session.commit(op(2, rename.commandId), rename.changes);
    expect(session.document).toMatchObject({ currentLayerId: "layer-steel-main", layers: [{ id: "0" }, { id: "layer-steel-main", name: "Steel secondary" }] });
    expect(() => planRenameLayer(session.document, "0", "Default")).toThrow("Layer 0");
    expect(() => planDeleteLayer(session.document, "layer-steel-main")).toThrow("Current");
  });

  it("closes on/off, lock, freeze/thaw, plot and appearance properties", () => {
    const document = createEmptyDocument({ documentId: "layer-properties" });
    document.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
    const create = planCreateLayer(document, "A");
    const session = new CadSession(document);
    session.commit(op(0, create.commandId), create.changes);
    for (const [property, value] of [["visible", false], ["locked", true], ["frozen", true], ["plottable", false]] as const) {
      const toggle = planSetLayerToggle(session.document, "layer-a", property, value);
      session.commit(op(session.document.revision, `${toggle.commandId}-${property}`), toggle.changes);
    }
    const appearance = planSetLayerAppearance(session.document, "layer-a", { color: "#12aBcF", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.7, transparency: 45 });
    session.commit(op(session.document.revision, appearance.commandId), appearance.changes);
    expect(session.document.layers[1]).toMatchObject({ visible: false, locked: true, frozen: true, plottable: false, appearance: { color: "#12aBcF", linetypeId: "dash", lineweightMm: 0.7, transparency: 45 } });
    expect(() => planSetLayerAppearance(session.document, "layer-a", { transparency: 91 })).toThrow("0..90");
  });

  it("defines hidden/frozen/locked/non-plot participation once for every consumer", () => {
    const base = { id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true };
    expect(["render", "select", "snap", "print", "edit"].map((purpose) => layerParticipation(base, purpose as never).participates)).toEqual([true, true, true, true, true]);
    const locked = { ...base, locked: true };
    expect(["render", "select", "snap", "print", "edit"].map((purpose) => layerParticipation(locked, purpose as never))).toMatchObject([
      { participates: true }, { participates: true }, { participates: true }, { participates: true }, { participates: false, reason: "layer-locked" },
    ]);
    for (const unavailable of [{ ...base, visible: false }, { ...base, frozen: true }]) {
      expect(["render", "select", "snap", "print", "edit"].every((purpose) => !layerParticipation(unavailable, purpose as never).participates)).toBe(true);
    }
    expect(layerParticipation({ ...base, plottable: false }, "print")).toEqual({ participates: false, reason: "not-plottable" });
    expect(layerParticipation({ ...base, plottable: false }, "render").participates).toBe(true);
  });

  it("blocks deletion for model/block/paper/viewport references", () => {
    const document = createEmptyDocument({ documentId: "references" });
    document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
    document.entities.push({ kind: "line", handle: "10", layerId: "A", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    expect(() => planDeleteLayer(document, "A")).toThrow("1 references");
    expect(entityParticipates(document.entities[0]!, document.layers, "select").participates).toBe(true);
  });
});

describe("F-086 draw order", () => {
  it("moves stable entity groups front/back/above/below and one undo restores exact order", () => {
    const document = createEmptyDocument({ documentId: "order" });
    document.entities = ["A", "B", "C", "D"].map((handle, index) => ({ kind: "line" as const, handle, layerId: "0", start: { x: index, y: 0 }, end: { x: index, y: 1 } }));
    expect(reorderedCadEntities(document.entities, ["B", "C"], "front").map((entity) => entity.handle)).toEqual(["A", "D", "B", "C"]);
    expect(reorderedCadEntities(document.entities, ["B"], "below", "D").map((entity) => entity.handle)).toEqual(["A", "C", "B", "D"]);
    const planned = planDrawOrderChanges(document, ["B", "C"], "front");
    const session = new CadSession(document);
    session.commit(op(0, planned.commandId), planned.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(planned.orderedHandles);
    session.undo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["A", "B", "C", "D"]);
  });
});
