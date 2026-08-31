import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { planDrawOrderChanges, readCadDrawOrderContract } from "../../../../../packages/cad-core/src/draw-order.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../../../packages/cad-core/src/layer-policy.js";

describe("F-080/F-086 50k performance", () => {
  it("plans a stable 100-entity draw-order move and resolves 50k transparency values", () => {
    const document = createEmptyDocument({ documentId: "f080-f086-50k" });
    document.layers[0] = { ...document.layers[0]!, appearance: { transparency: 33.333333333333336 } };
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const, handle: `H${index}`, layerId: "0",
      ...(index % 3 === 0 ? { appearance: { transparency: (index % 901) / 10 } } : {}),
      start: { x: index, y: 0 }, end: { x: index + 1, y: 0 },
    }));
    const selected = Array.from({ length: 100 }, (_, index) => `H${index * 499}`);
    const started = performance.now();
    const planned = planDrawOrderChanges(document, [...selected].reverse(), "front");
    const readback = readCadDrawOrderContract(document);
    const index = createCadLayerPropertyIndex(document.layers, document.linetypes);
    const checksum = document.entities.reduce((sum, entity) => sum + (resolveCadEntityLayerProperties(entity, index).transparency ?? 0), 0);
    const elapsedMs = performance.now() - started;
    expect(readback.orderedHandles).toHaveLength(50_000);
    expect(planned.orderedHandles.slice(-100)).toEqual(selected);
    expect(planned.changes).toHaveLength(200);
    expect(checksum).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 10_000);
});
