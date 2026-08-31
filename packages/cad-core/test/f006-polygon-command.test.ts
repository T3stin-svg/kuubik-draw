import type { CadPoint2 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareCompletePolygonCommand } from "../src/polygon-command.js";

function expectPoint(actual: CadPoint2, expected: CadPoint2, digits = 10): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

function pointDistance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

describe("F-006 complete POLYGON command", () => {
  it("matches inscribed square rotation and both orientations", () => {
    const ccw = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "P1", layerId: "0", sides: 4,
      construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 10, rotationRad: 0 },
    });
    expect(ccw.entity.vertices).toEqual([
      { x: 10, y: 0 },
      { x: expect.closeTo(0, 12), y: 10 },
      { x: -10, y: expect.closeTo(0, 12) },
      { x: expect.closeTo(0, 12), y: -10 },
    ]);
    expect(ccw.normalized).toMatchObject({ radius: 10, apothem: expect.closeTo(10 / Math.SQRT2, 12), orientation: "counter-clockwise" });
    expect(ccw.normalized.signedArea).toBeCloseTo(200, 10);

    const clockwise = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "P2", layerId: "0", sides: 4,
      construction: { mode: "center-inscribed", center: { x: 0, y: 0 }, radius: 10, rotationRad: Math.PI / 4, orientation: "clockwise" },
    });
    expectPoint(clockwise.entity.vertices[0]!, { x: 10 / Math.SQRT2, y: 10 / Math.SQRT2 });
    expect(clockwise.normalized.signedArea).toBeCloseTo(-200, 10);
  });

  it("treats circumscribed rotation as the first side normal", () => {
    const prepared = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "P3", layerId: "0", sides: 4,
      construction: { mode: "center-circumscribed", center: { x: 5, y: -7 }, apothem: 10, rotationRad: 0 },
    });
    expect(prepared.entity.vertices).toHaveLength(4);
    expectPoint(prepared.entity.vertices[0]!, { x: 15, y: -17 });
    expectPoint(prepared.entity.vertices[1]!, { x: 15, y: 3 });
    expectPoint({
      x: (prepared.entity.vertices[0]!.x + prepared.entity.vertices[1]!.x) / 2,
      y: (prepared.entity.vertices[0]!.y + prepared.entity.vertices[1]!.y) / 2,
    }, { x: 15, y: -7 });
    expect(prepared.normalized.radius).toBeCloseTo(10 / Math.cos(Math.PI / 4), 12);
  });

  it.each(["center-inscribed", "center-circumscribed"] as const)("places the %s numeric-radius bottom edge on snap rotation", (mode) => {
    const construction = mode === "center-inscribed"
      ? { mode, center: { x: 0, y: 0 }, radius: 10 * Math.SQRT2, rotationRad: 0, rotationInput: "numeric" as const }
      : { mode, center: { x: 0, y: 0 }, apothem: 10, rotationRad: 0, rotationInput: "numeric" as const };
    const prepared = prepareCompletePolygonCommand({ command: "POLYGON", handle: `NUM-${mode}`, layerId: "0", sides: 4, construction });
    expectPoint(prepared.entity.vertices[0]!, { x: -10, y: -10 });
    expectPoint(prepared.entity.vertices[1]!, { x: 10, y: -10 });
    expect(prepared.normalized.rotationInput).toBe("numeric");
  });

  it("uses edge picks exactly and places the polygon on the requested orientation side", () => {
    const left = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "P4", layerId: "0", sides: 3,
      construction: { mode: "edge", first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
    });
    expect(left.entity.vertices.slice(0, 2)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expectPoint(left.normalized.center, { x: 5, y: 5 / Math.sqrt(3) });
    expectPoint(left.entity.vertices[2]!, { x: 5, y: 5 * Math.sqrt(3) });
    expect(left.normalized.signedArea).toBeGreaterThan(0);

    const right = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "P5", layerId: "0", sides: 3,
      construction: { mode: "edge", first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, orientation: "clockwise" },
    });
    expect(right.entity.vertices.slice(0, 2)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(right.normalized.center.y).toBeCloseTo(-5 / Math.sqrt(3), 12);
    expect(right.normalized.signedArea).toBeLessThan(0);
  });

  it("normalizes large positive and negative rotations without geometry drift", () => {
    const base = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "R1", layerId: "0", sides: 7,
      construction: { mode: "center-inscribed", center: { x: 3, y: 4 }, radius: 12.5, rotationRad: Math.PI / 7 },
    });
    const wrapped = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "R2", layerId: "0", sides: 7,
      construction: { mode: "center-inscribed", center: { x: 3, y: 4 }, radius: 12.5, rotationRad: Math.PI / 7 - Math.PI * 20 },
    });
    for (let index = 0; index < base.entity.vertices.length; index += 1) {
      expectPoint(wrapped.entity.vertices[index]!, base.entity.vertices[index]!);
    }
    expect(wrapped.normalized.rotationRad).toBeCloseTo(base.normalized.rotationRad, 12);
  });

  it("supports the exact 3 through 1024 side-count boundary", () => {
    for (const sides of [3, 4, 5, 16, 255, 1023, 1024]) {
      const prepared = prepareCompletePolygonCommand({
        command: "POLYGON", handle: `N${sides}`, layerId: "0", sides,
        construction: { mode: "center-inscribed", center: { x: -20, y: 30 }, radius: 100, rotationRad: 0.123 },
      });
      expect(prepared.entity.vertices).toHaveLength(sides);
      expect(prepared.entity.closed).toBe(true);
      expect(prepared.normalized.sideLength).toBeCloseTo(200 * Math.sin(Math.PI / sides), 10);
    }
  });

  it("keeps 64 deterministic regularity and precision properties", () => {
    for (let index = 0; index < 64; index += 1) {
      const sides = 3 + index * 16;
      const center = { x: 1_000_000 + index / 7, y: -2_000_000 + index / 11 };
      const radius = 0.25 + index * 1.75;
      const orientation = index % 2 === 0 ? "counter-clockwise" as const : "clockwise" as const;
      const prepared = prepareCompletePolygonCommand({
        command: "POLYGON", handle: `Q${index}`, layerId: "0", sides,
        construction: { mode: "center-inscribed", center, radius, rotationRad: index * Math.PI / 37, orientation },
      });
      expect(prepared.entity.vertices).toHaveLength(sides);
      for (const vertex of prepared.entity.vertices) expect(pointDistance(center, vertex)).toBeCloseTo(radius, 8);
      for (let vertex = 0; vertex < sides; vertex += 1) {
        expect(pointDistance(prepared.entity.vertices[vertex]!, prepared.entity.vertices[(vertex + 1) % sides]!)).toBeCloseTo(prepared.normalized.sideLength, 8);
      }
      expect(Math.sign(prepared.normalized.signedArea)).toBe(orientation === "counter-clockwise" ? 1 : -1);
    }
  });
});
