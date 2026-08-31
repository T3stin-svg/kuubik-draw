import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { planDrawOrderChanges, readCadDrawOrderContract, reorderedCadEntities } from "../src/draw-order.js";
import { planSetEntityLayerProperties, readCadLayerContract } from "../src/layers.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "f080-f086-mutations" });
  document.layers.push(
    { id: "open", name: "open", visible: true, frozen: false, locked: false, plottable: true },
    { id: "locked", name: "locked", visible: true, frozen: false, locked: true, plottable: true },
    { id: "off", name: "off", visible: false, frozen: false, locked: false, plottable: true },
    { id: "frozen", name: "frozen", visible: true, frozen: true, locked: false, plottable: true },
  );
  document.entities = ["A", "B", "C", "D"].map((handle, x) => ({ kind: "line" as const, handle, layerId: "open", start: { x, y: 0 }, end: { x, y: 1 } }));
  return document;
}

describe("F-080/F-086 mutation guards", () => {
  it("kills invalid action/reference/missing/duplicate-handle mutations", () => {
    const document = fixture();
    expect(() => reorderedCadEntities(document.entities, ["A"], "sideways" as never)).toThrow("Unsupported");
    expect(() => reorderedCadEntities(document.entities, [], "front")).toThrow("at least one");
    expect(() => reorderedCadEntities(document.entities, ["missing"], "front")).toThrow("missing handle");
    expect(() => reorderedCadEntities(document.entities, ["A"], "above")).toThrow("reference");
    expect(() => reorderedCadEntities(document.entities, ["A"], "above", "A")).toThrow("unselected");
    expect(() => reorderedCadEntities(document.entities, ["A"], "above", "missing")).toThrow("does not exist");
    expect(() => reorderedCadEntities(document.entities, ["A"], "front", "B")).toThrow("does not accept");
    expect(() => reorderedCadEntities([...document.entities, document.entities[0]!], ["A"], "front")).toThrow("duplicate");
  });

  it("distinguishes above/below and emits only the stable moving group's changes", () => {
    const document = fixture();
    expect(reorderedCadEntities(document.entities, ["B"], "above", "C").map((entity) => entity.handle)).toEqual(["A", "C", "B", "D"]);
    expect(reorderedCadEntities(document.entities, ["B"], "below", "C").map((entity) => entity.handle)).toEqual(["A", "B", "C", "D"]);
    const plan = planDrawOrderChanges(document, ["D", "B", "B"], "back");
    expect(plan.args.handles).toEqual(["B", "D"]);
    expect(plan.changes.map((change) => change.type)).toEqual(["delete", "delete", "put", "put"]);
  });

  it("rejects draw-order edits and entity transparency overrides on locked/off/frozen layers", () => {
    for (const layerId of ["locked", "off", "frozen"]) {
      const document = fixture();
      document.entities[0] = { ...document.entities[0]!, layerId };
      const before = structuredClone(document);
      expect(() => planDrawOrderChanges(document, ["A"], "front")).toThrow(layerId === "locked" ? "layer-locked" : `layer-${layerId}`);
      expect(document).toEqual(before);
    }
    const document = fixture();
    document.entities[0] = { ...document.entities[0]!, layerId: "locked" };
    expect(() => planSetEntityLayerProperties(document, ["A"], { transparency: 25 })).toThrow("locked layer");
  });

  it("fails closed on malformed reopened transparency/draw-order state", () => {
    const badTransparency = fixture();
    badTransparency.layers[1]!.appearance = { transparency: 90.0001 };
    expect(() => readCadLayerContract(badTransparency)).toThrow("0 to 90");
    const missingLayer = fixture();
    missingLayer.entities[0] = { ...missingLayer.entities[0]!, layerId: "missing" };
    expect(() => readCadDrawOrderContract(missingLayer)).toThrow();
  });
});
