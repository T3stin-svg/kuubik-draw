import { describe, expect, it } from "vitest";
import { EllipseCommandInputError, prepareCompleteEllipseCommand } from "../src/ellipse-command.js";

const base = { command: "ELLIPSE" as const, handle: "E7", layerId: "0" };

describe("F-007 ELLIPSE mutation-proven guards", () => {
  it("kills identity, point, collapsed-axis and axis-distance mutants", () => {
    expect(() => prepareCompleteEllipseCommand({ ...base, handle: "", construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 } })).toThrow(EllipseCommandInputError);
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "center-major-minor", center: { x: Number.NaN, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 } })).toThrowError(expect.objectContaining({ code: "INVALID_POINT" }));
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 0, y: 0 }, minorDistance: 5 } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_AXIS" }));
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "axis-endpoints", firstAxisEnd: { x: 1, y: 1 }, secondAxisEnd: { x: 1, y: 1 }, otherAxisDistance: 5 } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_AXIS" }));
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 0 } })).toThrowError(expect.objectContaining({ code: "INVALID_AXIS_DISTANCE" }));
  });

  it("kills center-mode minor/major inversion while allowing Axis-End first-minor", () => {
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 5, y: 0 }, minorDistance: 10 } })).toThrowError(expect.objectContaining({ code: "MINOR_EXCEEDS_MAJOR" }));
    const swapped = prepareCompleteEllipseCommand({ ...base, construction: { mode: "axis-endpoints", firstAxisEnd: { x: -5, y: 0 }, secondAxisEnd: { x: 5, y: 0 }, otherAxisDistance: 10 } });
    expect(swapped.normalized).toMatchObject({ firstAxisWasMajor: false, majorRadius: 10, minorRadius: 5 });
  });

  it("kills non-finite, coincident and invalid-direction arc mutants", () => {
    const construction = { mode: "center-major-minor" as const, center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 };
    expect(() => prepareCompleteEllipseCommand({ ...base, construction, arc: { mode: "parameters", startParameter: Number.POSITIVE_INFINITY, endParameter: 1 } })).toThrowError(expect.objectContaining({ code: "INVALID_ARC_VALUE" }));
    expect(() => prepareCompleteEllipseCommand({ ...base, construction, arc: { mode: "angles", startAngleRad: 1, endAngleRad: 1 + Math.PI * 2 } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_ARC" }));
    expect(() => prepareCompleteEllipseCommand({ ...base, construction, arc: { mode: "parameters", startParameter: 0, endParameter: 1, direction: "sideways" } as never })).toThrowError(expect.objectContaining({ code: "INVALID_ARC_DIRECTION" }));
  });

  it("kills near-degenerate and overflow geometry before a change exists", () => {
    expect(() => prepareCompleteEllipseCommand({ ...base, construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 1, y: 0 }, minorDistance: 1e-12 } })).toThrowError(expect.objectContaining({ code: "INVALID_AXIS_DISTANCE" }));
    expect(() => prepareCompleteEllipseCommand({
      ...base,
      construction: { mode: "center-major-minor", center: { x: 1.7e308, y: 0 }, majorAxisEnd: { x: 1e308, y: 0 }, minorDistance: 5e307 },
    })).toThrowError(expect.objectContaining({ code: "NUMERIC_OVERFLOW" }));
  });

  it("locks angle conversion and clockwise storage against plausible mutants", () => {
    const prepared = prepareCompleteEllipseCommand({
      ...base,
      construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 },
      arc: { mode: "angles", startAngleRad: Math.PI / 4, endAngleRad: Math.PI, direction: "clockwise" },
    });
    expect(prepared.normalized.requestedStartParameter).toBeCloseTo(Math.atan2(10, 5), 12);
    expect(prepared.entity.startParameter).toBeCloseTo(Math.PI, 12);
    expect(prepared.entity.endParameter).toBeCloseTo(Math.atan2(10, 5), 12);
    expect(prepared.changes).toEqual([{ type: "put", entity: prepared.entity }]);
  });
});
