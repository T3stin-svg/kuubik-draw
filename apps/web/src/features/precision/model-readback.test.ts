import { describe, expect, it } from "vitest";
import { normalizeDynamicAngle, normalizePrecisionUnits, PrecisionFeatureModel } from "./model.js";

describe("Dynamic Input exact coordinate/distance/angle read-back", () => {
  it("keeps raw doubles while normalizing only display precision and angle range", () => {
    const model = new PrecisionFeatureModel();
    const request = { basePoint: { x: 10, y: 10 }, cursorPoint: { x: 4.87654321, y: 4.12345679 } };
    const readback = model.dynamicInput(request, { linear: "mm", displayPrecision: 3, angularPrecision: 4 });
    const distance = Math.hypot(-5.12345679, -5.87654321);
    const angle = normalizeDynamicAngle(Math.atan2(-5.87654321, -5.12345679));
    expect(readback).toEqual({
      point: { x: 4.87654321, y: 4.12345679 },
      coordinate: { x: 4.87654321, y: 4.12345679 },
      delta: { x: -5.12345679, y: -5.87654321 },
      distanceValue: distance, angleRad: angle,
      units: { linear: "mm", displayPrecision: 3, angularPrecision: 4 },
      unitsContract: {
        schemaVersion: 1, drawingUnit: "mm", insertionUnit: "mm",
        lengthFormat: "decimal", lengthPrecision: 3,
        angleFormat: "decimal-degrees", anglePrecision: 4,
        decimalSeparator: ".", clockwise: false, baseAngleRad: 0,
      },
      x: "4.877", y: "4.123", distance: distance.toFixed(3),
      angle: (angle * 180 / Math.PI).toFixed(4),
      angleDeg: (angle * 180 / Math.PI).toFixed(4), source: "cursor",
    });
    expect(readback.angleRad).toBeGreaterThan(Math.PI);
    expect(readback.point).toEqual(request.cursorPoint);
  });

  it("normalizes negative zero and rejects invalid unit precision without rounding geometry", () => {
    const model = new PrecisionFeatureModel();
    const readback = model.dynamicInput({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: -0, y: -0 } }, { linear: "m", displayPrecision: 15, angularPrecision: 15 });
    expect(Object.is(readback.point.x, -0)).toBe(false);
    expect(Object.is(readback.angleRad, -0)).toBe(false);
    expect(readback.point).toEqual({ x: 0, y: 0 });
    expect(normalizePrecisionUnits({ linear: "cm", displayPrecision: 6, angularPrecision: 7 })).toEqual({ linear: "cm", displayPrecision: 6, angularPrecision: 7 });
    expect(() => normalizePrecisionUnits({ linear: "mm", displayPrecision: 16, angularPrecision: 2 })).toThrow("0 to 15");
  });
});
