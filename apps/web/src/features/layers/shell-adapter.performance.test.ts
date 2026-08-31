import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { profileCadSpatialIndexes } from "../../../../../packages/cad-renderer/src/selection-index.js";
import { LayerManagerController } from "./controller.js";
import { LayerManagerShellAdapter } from "./shell-adapter.js";

describe("Layer Manager 50,000-object spatial regression", () => {
  it("keeps indexed selection and snap bounded with layer eligibility", () => {
    const document = createEmptyDocument({ documentId: "layer-shell-50k" });
    document.layers = [
      { id: "normal", name: "normal", visible: true, frozen: false, locked: false, plottable: true },
      { id: "locked", name: "locked", visible: true, frozen: false, locked: true, plottable: true },
      { id: "off", name: "off", visible: false, frozen: false, locked: false, plottable: true },
      { id: "frozen", name: "frozen", visible: true, frozen: true, locked: false, plottable: true },
    ];
    document.currentLayerId = "normal";
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const,
      handle: index.toString(16).toUpperCase(),
      layerId: document.layers[index % document.layers.length]!.id,
      start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
      end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
    }));
    const shell = new LayerManagerShellAdapter(new LayerManagerController(document));
    const result = profileCadSpatialIndexes(document.entities, {
      selectionPoint: { x: 5, y: 0 }, selectionTolerance: 6,
      snap: { modes: ["endpoint", "midpoint", "nearest"], cursor: { x: 5, y: 0 }, aperture: 6 },
      eligible: shell.eligibility("select"), queryIterations: 100,
    });
    expect(result.selection.map((hit) => hit.handle)).toEqual(["0"]);
    expect(result.profile).toMatchObject({ entityCount: 50_000, queryIterations: 100, selectionHits: 1 });
    expect(result.profile.selectionBuildMs + result.profile.snapBuildMs).toBeLessThan(5_000);
    expect(result.profile.queryMs).toBeLessThan(5_000);
    expect(result.profile.p95QueryMs).toBeLessThan(100);
    expect(result.profile.maxQueryMs).toBeLessThan(200);
  });
});
