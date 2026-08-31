import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../../../packages/cad-core/src/layer-policy.js";

describe("50,000-entity indexed ByLayer regression", () => {
  it("resolves all entity properties without scanning layers per entity", () => {
    const document = createEmptyDocument({ documentId: "bylayer-50k" });
    document.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
    document.layers = Array.from({ length: 250 }, (_, index) => ({
      id: `L${index}`, name: index === 0 ? "0" : `Layer ${index}`, visible: true, frozen: false, locked: false, plottable: true,
      appearance: { color: `#${index.toString(16).padStart(6, "0")}`, colorMethod: "trueColor" as const, linetypeId: "dash", lineweightMm: (index % 10) / 10, transparency: index % 90 },
    }));
    document.currentLayerId = "L0";
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const, handle: index.toString(16), layerId: `L${index % 250}`,
      ...(index % 7 === 0 ? { appearance: { lineweightMm: 0.7 } } : {}),
      start: { x: index, y: 0 }, end: { x: index + 1, y: 0 },
    }));
    const propertyIndex = createCadLayerPropertyIndex(document.layers, document.linetypes);
    const started = performance.now();
    let checksum = 0;
    for (const entity of document.entities) checksum += resolveCadEntityLayerProperties(entity, propertyIndex).lineweightMm ?? 0;
    const elapsedMs = performance.now() - started;
    expect(checksum).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
