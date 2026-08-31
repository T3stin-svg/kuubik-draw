import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../src/layer-policy.js";
import { planCreateLayer } from "../src/layers.js";

function seeded(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

describe("layer property and fuzz contract", () => {
  it("preserves ByLayer/override precedence for 2,000 seeded entities", () => {
    const document = createEmptyDocument({ documentId: "layer-properties" });
    document.linetypes = [{ id: "dash", name: "DASHED", pattern: [2, -1] }];
    document.layers[0] = { ...document.layers[0]!, appearance: { color: "#010203", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.5, transparency: 20 } };
    const index = createCadLayerPropertyIndex(document.layers, document.linetypes);
    for (let caseIndex = 1; caseIndex <= 2_000; caseIndex += 1) {
      const value = seeded(caseIndex);
      const overridden = (value & 1) === 1;
      const color = `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
      const entity = {
        kind: "line" as const, handle: String(caseIndex), layerId: "0",
        ...(overridden ? { appearance: { color, colorMethod: "trueColor" as const, lineweightMm: (value % 100) / 100 } } : {}),
        start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
      };
      const resolved = resolveCadEntityLayerProperties(entity, index);
      expect(resolved.color).toBe(overridden ? color : "#010203");
      expect(resolved.sources.color).toBe(overridden ? "entity" : "layer");
      expect(resolved.linetypeId).toBe("dash");
      expect(resolved.lineweightMm).toBe(overridden ? (value % 100) / 100 : 0.5);
    }
  });

  it("rejects 5,000 seeded reserved/control-name fuzz strings", () => {
    const reserved = ["<", ">", "/", "\\", "\"", ":", ";", "?", "*", "|", "=", ","];
    const document = createEmptyDocument({ documentId: "layer-name-fuzz" });
    for (let caseIndex = 0; caseIndex < 5_000; caseIndex += 1) {
      const token = caseIndex % 2 === 0 ? reserved[seeded(caseIndex + 1) % reserved.length]! : String.fromCharCode(seeded(caseIndex + 1) % 32);
      expect(() => planCreateLayer(document, `A${caseIndex}${token}B`)).toThrow();
    }
  });
});
