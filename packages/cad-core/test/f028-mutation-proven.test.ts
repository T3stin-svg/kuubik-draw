import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeLengthen, lengthenCadEntity } from "../src/index.js";

describe("F-028 mutation-proven ratchet", () => {
  it("fails if picked-endpoint or whole-polyline-length semantics are replaced", () => {
    const polyline = {
      kind: "polyline" as const, handle: "10", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    };
    const result = lengthenCadEntity(polyline, { x: 100, y: 100 }, { mode: "percent", value: 150 });
    expect(result.entity).toMatchObject({ vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }] });
    expect(result.newLength).toBeCloseTo(300, 8);
  });

  it("fails if a tapered terminal arc stops extrapolating its width with length", () => {
    const polyline = {
      kind: "polyline" as const, handle: "11", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: 0.5, startWidth: 4, endWidth: 6 },
        { x: 200, y: 0, startWidth: 6, endWidth: 8 },
      ],
    };
    const result = lengthenCadEntity(polyline, { x: 200, y: 0 }, { mode: "delta", value: 25 });
    expect(result.entity).toMatchObject({
      vertices: [
        { startWidth: 2, endWidth: 4 },
        { startWidth: 4, endWidth: expect.closeTo(6.431362086458, 11) },
        { startWidth: 6, endWidth: 8 },
      ],
    });
  });

  it("fails if Multiple stops using evolving geometry or stops being one final change", () => {
    const document = createEmptyDocument({ documentId: "F-028-mutation" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    const result = executeLengthen(document, {
      mode: "delta", value: 25,
      targets: [
        { handle: "10", pickPoint: { x: 100, y: 0 } },
        { handle: "10", pickPoint: { x: 125, y: 0 } },
      ],
    });
    expect(result.changes).toEqual([{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 150, y: 0 } } }]);
    expect(result.steps).toHaveLength(2);
  });

  it("fails if rational control-point SPLINE support is falsely advertised again", () => {
    const spline = {
      kind: "spline" as const, handle: "50", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 40, y: 80 }, { x: 80, y: 80 }, { x: 120, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false,
    };
    expect(lengthenCadEntity(spline, { x: 120, y: 0 }, { mode: "delta", value: 25 })).toMatchObject({ entity: null, reason: "unsupported-target" });
    expect(lengthenCadEntity(spline, { x: 120, y: 0 }, { mode: "dynamic", point: { x: 150, y: -40 } })).toMatchObject({ entity: null, reason: "unsupported-target" });
  });
});
