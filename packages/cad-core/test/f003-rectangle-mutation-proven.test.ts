import { describe, expect, it } from "vitest";
import { prepareRectangleCommand, RectangleCommandInputError } from "../src/rectangle-command.js";

const base = {
  command: "RECTANGLE" as const,
  handle: "10",
  layerId: "0",
  construction: { mode: "dimensions" as const, firstCorner: { x: 0, y: 0 }, length: 100, width: 50 },
};

describe("F-003 RECTANGLE mutation-proven guards", () => {
  it("kills identity, finite-coordinate, dimension, area and rotation mutants", () => {
    expect(() => prepareRectangleCommand({ ...base, handle: "" })).toThrow(RectangleCommandInputError);
    expect(() => prepareRectangleCommand({ ...base, construction: { ...base.construction, firstCorner: { x: Number.NaN, y: 0 } } })).toThrow(/finite coordinates/);
    expect(() => prepareRectangleCommand({ ...base, construction: { ...base.construction, length: 0 } })).toThrow(/greater than zero/);
    expect(() => prepareRectangleCommand({ ...base, construction: { ...base.construction, direction: { length: 0 as 1, width: 1 } } })).toThrow(/must be 1 or -1/);
    expect(() => prepareRectangleCommand({ ...base, rotationRad: Number.POSITIVE_INFINITY })).toThrow(/rotation must be finite/);
    expect(() => prepareRectangleCommand({
      ...base,
      construction: { mode: "area", firstCorner: { x: 0, y: 0 }, area: -1, knownDimension: { axis: "length", value: 10 } },
    })).toThrow(/area must be finite and greater than zero/);
  });

  it("kills chamfer, fillet, width and conflicting-style mutants", () => {
    expect(() => prepareRectangleCommand({ ...base, chamfer: { firstDistance: -1, secondDistance: 0 } })).toThrow(/non-negative/);
    expect(() => prepareRectangleCommand({ ...base, chamfer: { firstDistance: 50, secondDistance: 5 } })).toThrow(/non-zero straight edges/);
    expect(() => prepareRectangleCommand({ ...base, filletRadius: 25 })).toThrow(/non-zero straight edges/);
    expect(() => prepareRectangleCommand({ ...base, width: Number.NaN })).toThrow(/non-negative/);
    expect(() => prepareRectangleCommand({ ...base, chamfer: { firstDistance: 5, secondDistance: 5 }, filletRadius: 5 })).toThrow(/cannot both be active/);
  });

  it("rejects non-zero Elevation, normalizes zero options, and retains signed Thickness", () => {
    expect(() => prepareRectangleCommand({ ...base, elevation: 0.01 })).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_ELEVATION" }));
    expect(() => prepareRectangleCommand({ ...base, thickness: Number.NaN })).toThrowError(expect.objectContaining({ code: "INVALID_THICKNESS" }));
    const normalized = prepareRectangleCommand({ ...base, elevation: -0, thickness: -6, width: 0, chamfer: { firstDistance: 0, secondDistance: 0 }, filletRadius: 0 });
    expect(normalized.normalized).toMatchObject({ elevation: 0, thickness: -6, polylineWidth: 0, chamfer: null, filletRadius: 0 });
    expect(normalized.entity.appearance).toEqual({ thickness: -6 });
    expect(normalized.entity.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(normalized.entity.vertices.every((point) => point.startWidth === undefined && point.endWidth === undefined && point.bulge === undefined)).toBe(true);
  });

  it("kills reversed-winding and missing-fillet-bulge mutants", () => {
    const counterclockwise = prepareRectangleCommand({ ...base, filletRadius: 5 });
    const clockwise = prepareRectangleCommand({ ...base, construction: { ...base.construction, direction: { length: 1, width: -1 } }, filletRadius: 5 });
    expect(counterclockwise.normalized.clockwise).toBe(false);
    expect(clockwise.normalized.clockwise).toBe(true);
    expect(counterclockwise.entity.vertices.filter((point) => point.bulge! > 0)).toHaveLength(4);
    expect(clockwise.entity.vertices.filter((point) => point.bulge! < 0)).toHaveLength(4);
  });
});
