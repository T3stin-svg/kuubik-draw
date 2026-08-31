import { describe, expect, it } from "vitest";
import { parseCadPrecisionInput, resolveCadPrecisionInput } from "../src/precision-input.js";
import { resolvePrecisionPoint } from "../src/precision.js";
import { convertCadLength, formatCadAngle, formatCadLength, withCadDisplayPrecision } from "../src/units.js";

describe("F-041/F-042/F-044 precision input", () => {
  it("uses one strict double parser for absolute, relative and direct-distance input", () => {
    expect(parseCadPrecisionInput("1.25e3,-0.0000000000000002")).toEqual({ kind: "absolute-cartesian", point: { x: 1250, y: -2e-16 } });
    expect(resolveCadPrecisionInput(parseCadPrecisionInput("@2.5,-4"), { x: 10, y: 20 })).toEqual({ x: 12.5, y: 16 });
    expect(resolveCadPrecisionInput(parseCadPrecisionInput("5"), { x: 1, y: 1 }, { x: 4, y: 5 })).toEqual({ x: 4, y: 5 });
    expect(() => parseCadPrecisionInput("10junk,20")).toThrow("finite length");
    expect(() => parseCadPrecisionInput("Infinity,0")).toThrow("finite length");
    expect(parseCadPrecisionInput("@10<45")).toEqual({ kind: "relative-polar", distance: 10, angleRad: Math.PI / 4 });
  });

  it("keeps negative polar angles and zero direct distance independent of cursor aids", () => {
    const absolute = resolvePrecisionPoint({
      basePoint: { x: 100, y: 200 }, cursorPoint: { x: 999, y: 999 }, input: "10<-450",
      modes: { ortho: true, polar: { incrementRad: Math.PI / 2 }, grid: { spacingX: 100, spacingY: 100 }, aperture: 10_000 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 999, y: 999 } }],
    });
    expect(absolute.source).toBe("typed-polar");
    expect(absolute.point.x).toBeCloseTo(0, 14);
    expect(absolute.point.y).toBeCloseTo(-10, 14);

    const zero = resolvePrecisionPoint({
      basePoint: { x: 1.25, y: -2.5 }, cursorPoint: { x: 999, y: 999 }, input: "-0",
      modes: { ortho: true, grid: { spacingX: 100, spacingY: 100 }, aperture: 10_000 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 999, y: 999 } }],
    });
    expect(zero).toEqual({
      point: { x: 1.25, y: -2.5 }, source: "direct-distance",
      stages: [{ stage: "direct-distance", point: { x: 1.25, y: -2.5 } }],
      parsedInput: { kind: "direct-distance", distance: 0 },
    });
  });

  it("keeps explicit Cartesian input exact while cursor aids share one deterministic pipeline", () => {
    const explicit = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 99, y: 51 }, input: "1.23456789012345,9.87654321098765",
      modes: { ortho: true, grid: { spacingX: 10, spacingY: 10 }, aperture: 100 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 0, y: 0 } }],
    });
    expect(explicit).toMatchObject({ source: "typed-cartesian", point: { x: 1.23456789012345, y: 9.87654321098765 } });

    const aided = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 4 }, input: "12",
      modes: { ortho: true, grid: { spacingX: 5, spacingY: 5 }, aperture: 1 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 10.5, y: 0 }, key: "A" }],
    });
    expect(aided.point).toEqual({ x: 10.5, y: 0 });
    expect(aided.stages.map((stage) => stage.stage)).toEqual(["ortho", "direct-distance", "grid", "osnap:endpoint"]);
  });

  it("uses ORTHO before POLAR and OSNAP before OTRACK with stable tie-breaking", () => {
    const result = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 8, y: 6 },
      modes: { ortho: true, polar: { incrementRad: Math.PI / 4 }, aperture: 2 },
      objectSnapCandidates: [
        { kind: "nearest", priority: 7, point: { x: 9, y: 0 }, key: "z" },
        { kind: "endpoint", priority: 0, point: { x: 9.5, y: 0 }, key: "a" },
      ],
      trackingCandidates: [{ kind: "otrack", priority: 0, point: { x: 10, y: 0 }, key: "track" }],
    });
    expect(result).toMatchObject({ source: "osnap", point: { x: 9.5, y: 0 } });
  });

  it("formats units/precision without changing the stored geometry value", () => {
    const value = 1234.567890123456;
    const units = { linear: "mm" as const, displayPrecision: 3, angularPrecision: 4 };
    expect(formatCadLength(value, units)).toBe("1234.568");
    expect(formatCadLength(value, units, "m", { decimalSeparator: "," })).toBe("1,235");
    expect(formatCadAngle(Math.PI / 3, units)).toBe("60.0000");
    expect(convertCadLength(304.8, "mm", "ft")).toBeCloseTo(1, 15);
    expect(value).toBe(1234.567890123456);
    expect(withCadDisplayPrecision(units, 12, 15)).toEqual({ linear: "mm", displayPrecision: 12, angularPrecision: 15 });
  });

  it("round-trips 2,000 seeded finite coordinate pairs without parser drift", () => {
    let seed = 0x1a2b3c4d;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 0x1_0000_0000 - 0.5) * 2e9;
    };
    for (let index = 0; index < 2_000; index += 1) {
      const x = random();
      const y = random();
      const parsed = parseCadPrecisionInput(`${x.toPrecision(17)},${y.toPrecision(17)}`);
      expect(parsed).toEqual({ kind: "absolute-cartesian", point: { x, y } });
    }
  });
});
