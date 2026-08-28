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

  it("renders a non-zero polyline bulge as an arc and refuses a fake spline control polygon", () => {
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
    expect(stats.drawnEntities).toBe(1);
  });
});
