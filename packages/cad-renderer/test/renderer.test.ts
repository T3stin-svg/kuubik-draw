import { describe, expect, it } from "vitest";
import { CadCanvasRenderer, type Canvas2DContext } from "../src/index.js";

function fakeContext() {
  const calls: Array<[string, ...number[]]> = [];
  const context: Canvas2DContext = {
    beginPath: () => calls.push(["begin"]),
    moveTo: (x, y) => calls.push(["move", x, y]),
    lineTo: (x, y) => calls.push(["line", x, y]),
    arc: (x, y, radius, start, end, ccw) => calls.push([ccw ? "arc-ccw" : "arc-cw", x, y, radius, start, end]),
    ellipse: () => undefined,
    stroke: () => calls.push(["stroke"]),
    fillText: (_text, x, y) => calls.push(["text", x, y]),
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    scale: (x, y) => calls.push(["scale", x, y]),
    rotate: (angle) => calls.push(["rotate", angle]),
    translate: (x, y) => calls.push(["translate", x, y]),
    clearRect: () => undefined,
    strokeStyle: "#fff",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
  };
  return { context, calls };
}

describe("Canvas2D parity invariants", () => {
  it("uses one uniform world scale and letterboxes a mismatched viewport", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{ kind: "circle", handle: "10", layerId: "0", center: { x: 50, y: 50 }, radius: 10 }]);
    const { context, calls } = fakeContext();
    renderer.render(context, { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 400, heightPx: 200, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);
    expect(calls).toContainEqual(["scale", 2, -2]);
    expect(calls).toContainEqual(["translate", 100, 200]);
  });

  it("renders a non-zero polyline bulge as an arc and a real NURBS rather than its control polygon", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([
      { kind: "polyline", handle: "10", layerId: "0", vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }], closed: false },
      { kind: "spline", handle: "11", layerId: "0", degree: 2, controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false },
    ]);
    const { context, calls } = fakeContext();
    const stats = renderer.render(context, { world: { minX: -1, minY: -1, maxX: 11, maxY: 6 }, widthPx: 120, heightPx: 70, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);
    expect(calls.some(([name]) => name === "arc-cw")).toBe(true);
    expect(stats.drawnEntities).toBe(2);
  });

  it("renders a transformed block reference and prevents recursive block cycles", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setBlocks([
      { id: "symbol", name: "Symbol", basePoint: { x: 5, y: 5 }, entities: [{ kind: "line", handle: "child", layerId: "0", start: { x: 5, y: 5 }, end: { x: 15, y: 5 } }] },
      { id: "cycle", name: "Cycle", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "nested", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
    ]);
    renderer.setEntities([
      { kind: "blockRef", handle: "10", layerId: "0", blockId: "symbol", insertion: { x: 40, y: 50 }, scale: { x: 2, y: 3 }, rotationRad: Math.PI / 2 },
      { kind: "blockRef", handle: "11", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 },
    ]);
    const { context, calls } = fakeContext();
    const stats = renderer.render(context, { world: { minX: -1, minY: -1, maxX: 100, maxY: 100 }, widthPx: 101, heightPx: 101, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);
    expect(calls).toContainEqual(["translate", 40, 50]);
    expect(calls).toContainEqual(["rotate", Math.PI / 2]);
    expect(calls).toContainEqual(["scale", 2, 3]);
    expect(stats.drawnEntities).toBe(1);
  });

  it("indexes transformed block geometry even when its insertion point is outside the viewport", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setBlocks([{
      id: "wide",
      name: "Wide",
      basePoint: { x: 0, y: 0 },
      entities: [{ kind: "line", handle: "child", layerId: "0", start: { x: -100, y: 0 }, end: { x: 0, y: 0 } }],
    }]);
    renderer.setEntities([{
      kind: "blockRef", handle: "10", layerId: "0", blockId: "wide",
      insertion: { x: 150, y: 50 }, scale: { x: 1, y: 2 }, rotationRad: 0,
    }]);
    expect(renderer.visibleHandles({ minX: 40, minY: 40, maxX: 60, maxY: 60 })).toEqual(["10"]);
    expect(renderer.visibleHandles({ minX: 0, minY: 0, maxX: 40, maxY: 40 })).toEqual([]);
  });

  it("renders every MOVE preview entity without adding it to the spatial index", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const { context } = fakeContext();
    const stats = renderer.render(
      context,
      { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 100, heightPx: 100, devicePixelRatio: 1 },
      [{ id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true }],
      [
        { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 30 }, end: { x: 30, y: 30 } },
        { kind: "circle", handle: "11", layerId: "0", center: { x: 50, y: 50 }, radius: 5 },
      ],
    );
    expect(stats).toEqual({ totalEntities: 1, visibleCandidates: 1, drawnEntities: 3 });
    expect(renderer.visibleHandles({ minX: 15, minY: 15, maxX: 60, maxY: 60 })).toEqual([]);
  });
});
