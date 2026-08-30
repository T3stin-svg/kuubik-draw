import { describe, expect, it } from "vitest";
import { CadCanvasRenderer, pannedViewportWorldCenter, viewportScreenToWorld, viewportWorldToScreen, type Canvas2DContext } from "../src/index.js";

function fakeContext() {
  const calls: Array<[string, ...number[]]> = [];
  const context: Canvas2DContext = {
    beginPath: () => calls.push(["begin"]),
    moveTo: (x, y) => calls.push(["move", x, y]),
    lineTo: (x, y) => calls.push(["line", x, y]),
    arc: (x, y, radius, start, end, ccw) => calls.push([ccw ? "arc-ccw" : "arc-cw", x, y, radius, start, end]),
    ellipse: () => undefined,
    stroke: () => calls.push(["stroke"]),
    fill: () => calls.push(["fill"]),
    fillText: (_text, x, y) => calls.push(["text", x, y]),
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    scale: (x, y) => calls.push(["scale", x, y]),
    rotate: (angle) => calls.push(["rotate", angle]),
    translate: (x, y) => calls.push(["translate", x, y]),
    clearRect: () => undefined,
    strokeStyle: "#fff",
    fillStyle: "#fff",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "left",
  };
  return { context, calls };
}

describe("Canvas2D parity invariants", () => {
  it("uses the shared F-103 plot resolver for ByLayer ink, physical width and solid-hatch alpha", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([
      { kind: "line", handle: "10", layerId: "INK", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "hatch", handle: "11", layerId: "INK", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] },
    ]);
    const { context, calls } = fakeContext();
    renderer.render(context, { world: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, widthPx: 200, heightPx: 200, devicePixelRatio: 1 }, [
      { id: "INK", name: "Ink", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#f00", lineweightMm: 0.7, transparency: 40 } },
    ], null, [], {
      plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
      pixelsPerMillimeter: 4,
    });
    expect(calls).toContainEqual(["fill"]);
    expect(context.strokeStyle).toBe("#000000");
    expect(context.fillStyle).toBe("#000000");
    expect(context.lineWidth).toBeCloseTo(0.28, 12);
    expect(context.globalAlpha).toBeCloseTo(0.6, 12);
  });

  it("previews AutoCAD zero-width plot output as one device pixel without changing its semantic width", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const { context } = fakeContext();
    renderer.render(context, { world: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, widthPx: 200, heightPx: 200, devicePixelRatio: 2 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true, appearance: { lineweightMm: 0.7 } },
    ], null, [], { plotStyle: { profile: "color", plotLineweights: false, plotTransparency: true }, pixelsPerMillimeter: 4 });
    // 0.05 world units × 10 px/unit × DPR 2 = exactly one device pixel.
    expect(context.lineWidth).toBeCloseTo(0.05, 12);
  });

  it("does not misrepresent a patterned hatch as a solid fill", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{
      kind: "hatch", handle: "12", layerId: "0", pattern: "ANSI31", associative: false,
      loops: [{ isHole: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
    }]);
    const { context, calls } = fakeContext();

    renderer.render(context, { world: { minX: -1, minY: -1, maxX: 11, maxY: 11 }, widthPx: 120, heightPx: 120, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);

    expect(calls).not.toContainEqual(["fill"]);
    expect(calls).toContainEqual(["stroke"]);
  });

  it("shares one invertible letterboxed screen transform with cursor zoom and rotated pan", () => {
    const viewport = {
      world: { minX: -100, minY: -50, maxX: 100, maxY: 50 },
      widthPx: 400,
      heightPx: 400,
      devicePixelRatio: 2,
      rotationRad: Math.PI / 6,
    };
    const world = { x: 30, y: -10 };
    const screen = viewportWorldToScreen(viewport, world);
    expect(viewportScreenToWorld(viewport, screen)).toEqual({
      x: expect.closeTo(world.x, 12),
      y: expect.closeTo(world.y, 12),
    });
    expect(viewportWorldToScreen(viewport, { x: 0, y: 0 })).toEqual({ x: 200, y: 200 });
    expect(pannedViewportWorldCenter(viewport, { x: 80, y: -50 })).toEqual({
      x: expect.closeTo(-47.14101615137755, 12),
      y: expect.closeTo(-1.650635094610969, 12),
    });
  });

  it("uses one uniform world scale and letterboxes a mismatched viewport", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{ kind: "circle", handle: "10", layerId: "0", center: { x: 50, y: 50 }, radius: 10 }]);
    const { context, calls } = fakeContext();
    renderer.render(context, { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 400, heightPx: 200, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);
    expect(calls).toContainEqual(["scale", 2, -2]);
    expect(calls).toContainEqual(["translate", 200, 100]);
    expect(calls).toContainEqual(["translate", -50, -50]);
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

  it("renders MIRRTEXT=0 text with its reflected rotation and end alignment", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{
      kind: "text", handle: "10", layerId: "0", position: { x: 20, y: 30 },
      text: "READ", height: 10, rotationRad: Math.PI / 4,
      extensionData: { kuubikMirrorTextAlign: "end" },
    }]);
    const { context, calls } = fakeContext();
    renderer.render(context, { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 100, heightPx: 100, devicePixelRatio: 1 }, [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ]);
    expect(calls).toContainEqual(["translate", 20, 30]);
    expect(calls).toContainEqual(["rotate", Math.PI / 4]);
    expect(context.textAlign).toBe("right");
  });

  it("applies an AutoCAD-positive view twist and culls against the rotated world rectangle", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([
      { kind: "line", handle: "inside", layerId: "0", start: { x: 110, y: 0 }, end: { x: 120, y: 0 } },
      { kind: "line", handle: "outside", layerId: "0", start: { x: 200, y: 200 }, end: { x: 210, y: 200 } },
    ]);
    const { context, calls } = fakeContext();
    const stats = renderer.render(context, {
      world: { minX: -100, minY: -50, maxX: 100, maxY: 50 },
      widthPx: 400,
      heightPx: 200,
      devicePixelRatio: 1,
      rotationRad: Math.PI / 6,
    }, [{ id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true }]);
    expect(calls).toContainEqual(["rotate", Math.PI / 6]);
    expect(calls).toContainEqual(["move", 110, 0]);
    expect(calls).not.toContainEqual(["move", 200, 200]);
    expect(stats.visibleCandidates).toBe(1);
  });

  it("keeps RAY/XLINE out of finite extents while clipping both across the active viewport", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([
      { kind: "ray", handle: "10", layerId: "0", basePoint: { x: 0, y: 50 }, direction: { x: 10, y: 0 } },
      { kind: "xline", handle: "20", layerId: "0", basePoint: { x: 50, y: 50 }, direction: { x: 0, y: 2 } },
      { kind: "line", handle: "30", layerId: "0", start: { x: 500, y: 500 }, end: { x: 510, y: 500 } },
    ]);
    expect(renderer.visibleHandles({ minX: 0, minY: 0, maxX: 100, maxY: 100 })).toEqual(["10", "20"]);

    const { context, calls } = fakeContext();
    const stats = renderer.render(
      context,
      { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 100, heightPx: 100, devicePixelRatio: 1 },
      [{ id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true }],
    );
    expect(stats).toEqual({ totalEntities: 3, visibleCandidates: 2, drawnEntities: 2 });
    expect(calls).toContainEqual(["move", 0, 50]);
    expect(calls.some(([name, x, y]) => name === "line" && x > 100 && y === 50)).toBe(true);
    expect(calls.some(([name, x, y]) => name === "move" && x === 50 && y < 0)).toBe(true);
    expect(calls.some(([name, x, y]) => name === "line" && x === 50 && y > 100)).toBe(true);
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

  it("hides replaced source geometry while rendering a MIRROR erase-Yes preview", () => {
    const renderer = new CadCanvasRenderer();
    renderer.setEntities([{ kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 10 }, end: { x: 20, y: 10 } }]);
    const { context, calls } = fakeContext();
    const stats = renderer.render(
      context,
      { world: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, widthPx: 100, heightPx: 100, devicePixelRatio: 1 },
      [{ id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true }],
      [{ kind: "line", handle: "10", layerId: "0", start: { x: 90, y: 10 }, end: { x: 80, y: 10 } }],
      ["10"],
    );
    expect(stats).toEqual({ totalEntities: 1, visibleCandidates: 1, drawnEntities: 1 });
    expect(calls).not.toContainEqual(["move", 10, 10]);
    expect(calls).toContainEqual(["move", 90, 10]);
  });
});
