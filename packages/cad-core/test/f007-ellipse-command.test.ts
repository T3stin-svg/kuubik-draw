import type { CadPoint2 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareCompleteEllipseCommand } from "../src/ellipse-command.js";

function expectPoint(actual: CadPoint2, expected: CadPoint2, digits = 10): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe("F-007 complete ELLIPSE command", () => {
  it("matches center, rotated major endpoint and minor-distance golden", () => {
    const angle = Math.PI / 6;
    const prepared = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E1", layerId: "0",
      construction: {
        mode: "center-major-minor",
        center: { x: 5, y: -7 },
        majorAxisEnd: { x: 5 + 20 * Math.cos(angle), y: -7 + 20 * Math.sin(angle) },
        minorDistance: 8,
      },
    });
    expect(prepared.entity).toMatchObject({ kind: "ellipse", handle: "E1", layerId: "0", center: { x: 5, y: -7 }, ratio: 0.4, startParameter: 0, endParameter: Math.PI * 2 });
    expectPoint(prepared.entity.majorAxis, { x: 20 * Math.cos(angle), y: 20 * Math.sin(angle) });
    expect(prepared.normalized).toMatchObject({ majorRadius: 20, minorRadius: 8, rotationRad: expect.closeTo(angle, 12), firstAxisWasMajor: true, shape: "full" });
    expectPoint(prepared.normalized.requestedStartPoint, prepared.normalized.requestedEndPoint);
  });

  it("constructs from axis endpoints when the first axis is major or minor", () => {
    const firstMajor = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E2", layerId: "0",
      construction: { mode: "axis-endpoints", firstAxisEnd: { x: -10, y: 0 }, secondAxisEnd: { x: 10, y: 0 }, otherAxisDistance: 5 },
    });
    expect(firstMajor.entity).toMatchObject({ center: { x: 0, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5 });
    expect(firstMajor.normalized.firstAxisWasMajor).toBe(true);

    const firstMinor = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E3", layerId: "0",
      construction: { mode: "axis-endpoints", firstAxisEnd: { x: -5, y: 0 }, secondAxisEnd: { x: 5, y: 0 }, otherAxisDistance: 10 },
    });
    expect(firstMinor.entity).toMatchObject({ center: { x: 0, y: 0 }, majorAxis: { x: 0, y: 10 }, ratio: 0.5 });
    expect(firstMinor.normalized).toMatchObject({ majorRadius: 10, minorRadius: 5, rotationRad: Math.PI / 2, firstAxisWasMajor: false });
  });

  it("creates parameter arcs with wrap and explicit clockwise locus", () => {
    const wrapped = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E4", layerId: "0",
      construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 },
      arc: { mode: "parameters", startParameter: 5.5, endParameter: 0.5 },
    });
    expect(wrapped.entity.startParameter).toBe(5.5);
    expect(wrapped.entity.endParameter).toBe(0.5);
    expect(wrapped.normalized.sweepParameterRad).toBeCloseTo(Math.PI * 2 - 5, 12);

    const clockwise = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E5", layerId: "0",
      construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 },
      arc: { mode: "parameters", startParameter: 0, endParameter: Math.PI / 2, direction: "clockwise" },
    });
    expect(clockwise.entity).toMatchObject({ startParameter: Math.PI / 2, endParameter: 0 });
    expect(clockwise.normalized.sweepParameterRad).toBeCloseTo(Math.PI * 3 / 2, 12);
    expectPoint(clockwise.normalized.requestedStartPoint, { x: 10, y: 0 });
    expectPoint(clockwise.normalized.requestedEndPoint, { x: 0, y: 5 });
  });

  it("converts geometric polar start/end angles to ellipse parameters", () => {
    const prepared = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E6", layerId: "0",
      construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 10, y: 0 }, minorDistance: 5 },
      arc: { mode: "angles", startAngleRad: Math.PI / 4, endAngleRad: Math.PI },
    });
    expect(prepared.entity.startParameter).toBeCloseTo(Math.atan2(10, 5), 12);
    expect(prepared.entity.endParameter).toBeCloseTo(Math.PI, 12);
    expectPoint(prepared.normalized.requestedStartPoint, { x: Math.sqrt(20), y: Math.sqrt(20) });
    expectPoint(prepared.normalized.requestedEndPoint, { x: -10, y: 0 });
  });

  it("distinguishes explicit full ellipse from coincident arc endpoints", () => {
    const full = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "E7", layerId: "0",
      construction: { mode: "center-major-minor", center: { x: 0, y: 0 }, majorAxisEnd: { x: 1, y: 0 }, minorDistance: 1 },
      arc: { mode: "full" },
    });
    expect(full.entity).toMatchObject({ ratio: 1, startParameter: 0, endParameter: Math.PI * 2 });
    expect(full.normalized.sweepParameterRad).toBe(Math.PI * 2);
  });

  it("keeps 64 rotated full/arc geometry properties precise", () => {
    for (let index = 1; index <= 64; index += 1) {
      const rotation = index * Math.PI / 41;
      const major = 10 + index * 0.75;
      const minor = major * (0.05 + (index % 19) / 20);
      const center = { x: 1_000_000 + index / 3, y: -2_000_000 + index / 7 };
      const prepared = prepareCompleteEllipseCommand({
        command: "ELLIPSE", handle: `P${index}`, layerId: "0",
        construction: {
          mode: "center-major-minor", center,
          majorAxisEnd: { x: center.x + major * Math.cos(rotation), y: center.y + major * Math.sin(rotation) },
          minorDistance: minor,
        },
        arc: index % 2 === 0
          ? { mode: "full" }
          : { mode: "parameters", startParameter: index / 17, endParameter: index / 17 + 1.25, direction: index % 3 === 0 ? "clockwise" : "counter-clockwise" },
      });
      expect(prepared.normalized.majorRadius).toBeCloseTo(major, 8);
      expect(prepared.normalized.minorRadius).toBeCloseTo(minor, 8);
      expect(prepared.entity.ratio).toBeCloseTo(minor / major, 9);
      expect(prepared.normalized.requestedStartPoint.x).toBeTypeOf("number");
      expect(prepared.normalized.requestedStartPoint.y).toBeTypeOf("number");
      expect(prepared.normalized.sweepParameterRad).toBeGreaterThan(0);
      expect(prepared.normalized.sweepParameterRad).toBeLessThanOrEqual(Math.PI * 2);
    }
  });
});
