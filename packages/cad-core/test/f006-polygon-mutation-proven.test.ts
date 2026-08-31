import { describe, expect, it } from "vitest";
import { PolygonCommandInputError, prepareCompletePolygonCommand } from "../src/polygon-command.js";

const base = { command: "POLYGON" as const, handle: "P6", layerId: "0", sides: 6 };

describe("F-006 POLYGON mutation-proven guards", () => {
  it("kills identity and side-count boundary mutants", () => {
    expect(() => prepareCompletePolygonCommand({ ...base, handle: "", construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 1 } })).toThrow(PolygonCommandInputError);
    for (const sides of [2, 2.5, 1025, Number.NaN]) {
      expect(() => prepareCompletePolygonCommand({ ...base, sides, construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 1 } })).toThrowError(expect.objectContaining({ code: "INVALID_SIDE_COUNT" }));
    }
  });

  it("kills invalid point, size, rotation and orientation mutants", () => {
    expect(() => prepareCompletePolygonCommand({ ...base, construction: { mode: "center-inscribed", center: { x: Number.POSITIVE_INFINITY, y: 0 }, radius: 1 } })).toThrowError(expect.objectContaining({ code: "INVALID_POINT" }));
    expect(() => prepareCompletePolygonCommand({ ...base, construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 0 } })).toThrowError(expect.objectContaining({ code: "INVALID_SIZE" }));
    expect(() => prepareCompletePolygonCommand({ ...base, construction: { mode: "center-circumscribed", center: { x: 0, y: 0 }, apothem: Number.NaN } })).toThrowError(expect.objectContaining({ code: "INVALID_SIZE" }));
    expect(() => prepareCompletePolygonCommand({ ...base, construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 1, rotationRad: Number.NaN } })).toThrowError(expect.objectContaining({ code: "INVALID_ROTATION" }));
    expect(() => prepareCompletePolygonCommand({
      ...base,
      construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 1, orientation: "inside-out" } as never,
    })).toThrowError(expect.objectContaining({ code: "INVALID_ORIENTATION" }));
    expect(() => prepareCompletePolygonCommand({
      ...base,
      construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 1, rotationInput: "guess" } as never,
    })).toThrowError(expect.objectContaining({ code: "INVALID_ROTATION_INPUT" }));
  });

  it("kills collapsed-edge and numeric-overflow mutants before changes exist", () => {
    expect(() => prepareCompletePolygonCommand({ ...base, construction: { mode: "edge", first: { x: 1, y: 1 }, second: { x: 1, y: 1 } } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_EDGE" }));
    expect(() => prepareCompletePolygonCommand({
      ...base,
      construction: { mode: "center-inscribed", center: { x: Number.MAX_VALUE, y: Number.MAX_VALUE }, radius: Number.MAX_VALUE },
    })).toThrowError(expect.objectContaining({ code: "NUMERIC_OVERFLOW" }));
  });

  it("locks circumscribed apothem semantics and winding against plausible mutants", () => {
    const prepared = prepareCompletePolygonCommand({
      ...base,
      sides: 8,
      construction: { mode: "center-circumscribed", center: { x: 0, y: 0 }, apothem: 25, rotationRad: Math.PI / 3, orientation: "clockwise" },
    });
    const first = prepared.entity.vertices[0]!;
    const second = prepared.entity.vertices[1]!;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    expect(Math.hypot(midpoint.x, midpoint.y)).toBeCloseTo(25, 10);
    expect(Math.atan2(midpoint.y, midpoint.x)).toBeCloseTo(Math.PI / 3, 10);
    expect(prepared.normalized.signedArea).toBeLessThan(0);
    expect(prepared.changes).toEqual([{ type: "put", entity: prepared.entity }]);
  });
});
