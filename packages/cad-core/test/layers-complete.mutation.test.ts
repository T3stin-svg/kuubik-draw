import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../src/layer-policy.js";
import { planCreateLayer, planSetEntityLayerProperties, planSetLayerAppearance, planSetLayerToggle, readCadLayerContract } from "../src/layers.js";

describe("complete layer mutation guards", () => {
  it("kills special-layer, orphan, locked-target and stale-color-metadata mutants", () => {
    const document = createEmptyDocument({ documentId: "layer-mutation" });
    const defpoints = planCreateLayer(document, "DEFPOINTS").changes[0];
    expect(defpoints).toMatchObject({ type: "put-layer", layer: { name: "Defpoints", plottable: false } });
    if (defpoints?.type !== "put-layer") throw new Error("Expected Defpoints layer plan.");
    document.layers.push(defpoints.layer, { id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 }, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    expect(() => planSetLayerToggle(document, "Defpoints", "plottable", true)).toThrow();
    expect(() => planSetEntityLayerProperties(document, ["10"], { layerId: "locked" })).toThrow();
    const cleared = planSetEntityLayerProperties(document, ["10"], { color: null });
    expect(cleared.changes[0]).toMatchObject({ type: "put", entity: { handle: "10" } });
    if (cleared.changes[0]?.type !== "put") throw new Error("Expected entity update.");
    expect(cleared.changes[0].entity.appearance).toBeUndefined();
    document.layers[0]!.appearance = { linetypeId: "missing" };
    expect(() => readCadLayerContract(document)).toThrow(/missing/u);
    expect(() => resolveCadEntityLayerProperties(document.entities[0]!, createCadLayerPropertyIndex(document.layers, document.linetypes))).toThrow(/missing/u);
  });

  it("kills partial color metadata created by independent patch application", () => {
    const document = createEmptyDocument({ documentId: "layer-color-mutation" });
    expect(() => planSetLayerAppearance(document, "0", { colorMethod: "trueColor" })).toThrow(/requires an RGB render color/u);
  });
});
