import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerFeatureModel } from "./model.js";

describe("layer feature wiring", () => {
  it("routes CRUD/properties/policy/draw order through the core planners", () => {
    const document = createEmptyDocument({ documentId: "web-layers" });
    document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: true, plottable: true });
    document.entities = [
      { kind: "line", handle: "1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "line", handle: "2", layerId: "A", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
    ];
    const model = new LayerFeatureModel(document);
    expect(model.create("B").commandId).toBe("LAYER_CREATE");
    expect(model.rename("A", "A2").commandId).toBe("LAYER_RENAME");
    expect(model.toggle("A", "visible", false).commandId).toBe("LAYER_ON");
    expect(model.appearance("A", { color: "#ff0000", transparency: 25 }).commandId).toBe("LAYER_PROPERTIES");
    expect(model.participates(document.entities[1]!, "select")).toBe(true);
    expect(model.participates(document.entities[1]!, "edit")).toBe(false);
    expect(model.drawOrder(["1"], "front").orderedHandles).toEqual(["2", "1"]);
  });
});
