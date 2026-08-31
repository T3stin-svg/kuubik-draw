import { describe, expect, it } from "vitest";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../../../packages/cad-core/src/layer-policy.js";
import { CadCanvasRenderer, type Canvas2DContext } from "../../../../../packages/cad-renderer/src/renderer.js";

function contextFixture() {
  const dashes: number[][] = [];
  const strokes: Array<{ color: string; width: number; alpha: number }> = [];
  const context: Canvas2DContext = {
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined, arc: () => undefined, ellipse: () => undefined,
    stroke: () => strokes.push({ color: String(context.strokeStyle), width: context.lineWidth, alpha: context.globalAlpha }),
    fill: () => undefined, fillText: () => undefined, save: () => undefined, restore: () => undefined,
    scale: () => undefined, rotate: () => undefined, translate: () => undefined, clearRect: () => undefined,
    setLineDash: (segments) => dashes.push([...segments]),
    strokeStyle: "#fff", fillStyle: "#fff", lineWidth: 1, globalAlpha: 1, font: "10px sans-serif", textAlign: "left",
  };
  return { context, dashes, strokes };
}

describe("ByLayer renderer wiring", () => {
  it("renders the same indexed inherited color, linetype, lineweight and transparency resolved by core", () => {
    const layers = [{
      id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true,
      appearance: { color: "#336699", colorMethod: "trueColor" as const, linetypeId: "dash", linetypeScale: 2, lineweightMm: 0.5, transparency: 25 },
    }];
    const linetypes = [{ id: "dash", name: "DASHED", pattern: [2, -1] }];
    const entity = { kind: "line" as const, handle: "10", layerId: "A", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const resolved = resolveCadEntityLayerProperties(entity, createCadLayerPropertyIndex(layers, linetypes));
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([entity]);
    renderer.setLinetypes(linetypes);
    const { context, dashes, strokes } = contextFixture();
    renderer.render(context, { world: { minX: -1, minY: -1, maxX: 11, maxY: 1 }, widthPx: 120, heightPx: 20, devicePixelRatio: 1 }, layers, null, [], {
      plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true }, pixelsPerMillimeter: 4,
    });
    expect(resolved).toMatchObject({ color: "#336699", linetypeId: "dash", linetypeScale: 2, lineweightMm: 0.5, transparency: 25 });
    expect(dashes).toContainEqual([4, 2]);
    expect(strokes).toContainEqual({ color: "#336699", width: 0.2, alpha: 0.75 });
  });
});
