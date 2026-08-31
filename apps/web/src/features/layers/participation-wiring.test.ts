import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { entityParticipates } from "../../../../../packages/cad-core/src/layer-policy.js";
import { CadCanvasRenderer, type Canvas2DContext } from "../../../../../packages/cad-renderer/src/renderer.js";
import { CadSelectionIndex } from "../../../../../packages/cad-renderer/src/selection-index.js";
import { CadSnapIndex } from "../../../../../packages/cad-renderer/src/snap.js";
import { exportSvg } from "../../../../../packages/cad-print/src/index.js";

function fakeContext(): Canvas2DContext {
  return {
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined, arc: () => undefined, ellipse: () => undefined,
    stroke: () => undefined, fill: () => undefined, fillText: () => undefined, save: () => undefined, restore: () => undefined,
    scale: () => undefined, rotate: () => undefined, translate: () => undefined, clearRect: () => undefined, setLineDash: () => undefined,
    strokeStyle: "#fff", fillStyle: "#fff", lineWidth: 1, globalAlpha: 1, font: "10px sans-serif", textAlign: "left",
  };
}

describe("locked/off/frozen/non-plottable consumer wiring matrix", () => {
  it("keeps render/select/snap/edit/print semantics identical across real consumers", () => {
    const document = createEmptyDocument({ documentId: "participation-matrix" });
    document.layers = [
      { id: "normal", name: "normal", visible: true, frozen: false, locked: false, plottable: true },
      { id: "locked", name: "locked", visible: true, frozen: false, locked: true, plottable: true },
      { id: "off", name: "off", visible: false, frozen: false, locked: false, plottable: true },
      { id: "frozen", name: "frozen", visible: true, frozen: true, locked: false, plottable: true },
      { id: "nonplot", name: "nonplot", visible: true, frozen: false, locked: false, plottable: false },
    ];
    document.currentLayerId = "normal";
    document.entities = document.layers.map((layer, index) => ({
      kind: "line" as const, handle: layer.id, layerId: layer.id,
      start: { x: 0, y: index * 10 }, end: { x: 5, y: index * 10 },
    }));
    const eligible = (purpose: "select" | "snap") => (entity: (typeof document.entities)[number]) => entityParticipates(entity, document.layers, purpose).participates;

    const renderer = new CadCanvasRenderer();
    renderer.setEntities(document.entities);
    expect(renderer.render(fakeContext(), {
      world: { minX: -1, minY: -1, maxX: 10, maxY: 50 }, widthPx: 110, heightPx: 510, devicePixelRatio: 1,
    }, document.layers).drawnEntities).toBe(3);

    const selection = new CadSelectionIndex();
    const snap = new CadSnapIndex();
    selection.setEntities(document.entities);
    snap.setEntities(document.entities);
    const selected = document.entities.filter((entity, index) => selection.pick({ x: 0, y: index * 10 }, 0.1, eligible("select")).some((hit) => hit.handle === entity.handle)).map((entity) => entity.handle);
    const snapped = document.entities.filter((entity, index) => snap.query({ modes: ["endpoint"], cursor: { x: 0, y: index * 10 }, aperture: 0.1 }, eligible("snap")).some((hit) => hit.handle === entity.handle)).map((entity) => entity.handle);
    expect(selected).toEqual(["normal", "locked", "nonplot"]);
    expect(snapped).toEqual(selected);
    expect(document.entities.filter((entity) => entityParticipates(entity, document.layers, "edit").participates).map((entity) => entity.handle)).toEqual(["normal", "nonplot"]);

    const svg = exportSvg(document, { widthMm: 297, heightMm: 210, scaleDenominator: 1, origin: { x: 0, y: 0 } }).text;
    expect(document.entities.map((entity) => [entity.handle, svg.includes(`data-handle="${entity.handle}"`)])).toEqual([
      ["normal", true], ["locked", true], ["off", false], ["frozen", false], ["nonplot", false],
    ]);
  });
});
