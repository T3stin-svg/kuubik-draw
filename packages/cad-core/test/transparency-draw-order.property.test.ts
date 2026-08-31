import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { reorderedCadEntities } from "../src/draw-order.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../src/layer-policy.js";
import { planSetEntityLayerProperties, planSetLayerAppearance } from "../src/layers.js";
import { validateCadTransparency } from "../src/plot-style.js";

function seeded(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

describe("F-080/F-086 property and fuzz contract", () => {
  it("preserves selected and remaining source order for 2,000 seeded multi-selections", () => {
    const entities = Array.from({ length: 24 }, (_, index) => ({
      kind: "line" as const, handle: `H${index}`, layerId: "0", start: { x: index, y: 0 }, end: { x: index, y: 1 },
    }));
    for (let caseIndex = 1; caseIndex <= 2_000; caseIndex += 1) {
      const mask = seeded(caseIndex) | 1;
      const selected = entities.filter((_, index) => ((mask >>> (index % 31)) & 1) === 1).map((entity) => entity.handle);
      const input = (caseIndex & 1) === 0 ? [...selected].reverse() : [...selected, selected[0]!];
      const action = (caseIndex & 2) === 0 ? "front" : "back";
      const output = reorderedCadEntities(entities, input, action).map((entity) => entity.handle);
      const moving = entities.filter((entity) => selected.includes(entity.handle)).map((entity) => entity.handle);
      const remaining = entities.filter((entity) => !selected.includes(entity.handle)).map((entity) => entity.handle);
      expect(output).toEqual(action === "front" ? [...remaining, ...moving] : [...moving, ...remaining]);
      expect(new Set(output).size).toBe(entities.length);
    }
  });

  it("round-trips 2,000 finite fractional transparency overrides exactly", () => {
    const document = createEmptyDocument({ documentId: "transparency-properties" });
    const entity = { kind: "line" as const, handle: "A", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
    document.entities = [entity];
    for (let caseIndex = 0; caseIndex < 2_000; caseIndex += 1) {
      const value = (seeded(caseIndex + 1) % 900_000_001) / 10_000_000;
      const layerPlan = planSetLayerAppearance(document, "0", { transparency: value });
      const layer = (layerPlan.changes[0] as { layer: typeof document.layers[number] }).layer;
      const entityPlan = planSetEntityLayerProperties(document, ["A"], { transparency: value });
      const changed = (entityPlan.changes[0] as { entity: typeof entity & { appearance: { transparency: number } } }).entity;
      expect(layer.appearance?.transparency).toBe(value);
      expect(changed.appearance.transparency).toBe(value);
      expect(resolveCadEntityLayerProperties(changed, createCadLayerPropertyIndex([layer], document.linetypes)).transparency).toBe(value);
    }
  });

  it("rejects 5,000 seeded non-finite/out-of-range/type mutations", () => {
    const invalid: unknown[] = [-Infinity, Infinity, Number.NaN, -0.0000001, 90.0000001, "40", {}, [], true];
    const document = createEmptyDocument({ documentId: "transparency-fuzz" });
    for (let caseIndex = 0; caseIndex < 5_000; caseIndex += 1) {
      const value = invalid[seeded(caseIndex + 1) % invalid.length];
      expect(() => validateCadTransparency(value as number)).toThrow();
      expect(() => planSetLayerAppearance(document, "0", { transparency: value as number })).toThrow("0..90");
      expect(() => planSetEntityLayerProperties(document, ["missing"], { transparency: value as number })).toThrow("0..90");
    }
  });
});
