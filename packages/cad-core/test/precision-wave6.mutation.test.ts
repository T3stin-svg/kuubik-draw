import { describe, expect, it } from "vitest";
import { resolvePrecisionPoint } from "../src/precision.js";

describe("F-041/F-042/F-044..F-047 mutation guards", () => {
  it("kills mutations that let cursor aids alter explicit Cartesian or polar input", () => {
    const candidates = [{ kind: "endpoint", priority: 0, key: "endpoint:A", point: { x: 999, y: 999 } }];
    const modes = { ortho: true, polar: { incrementRad: Math.PI / 2 }, grid: { spacingX: 100, spacingY: 100 }, aperture: 10_000 };
    expect(resolvePrecisionPoint({ basePoint: { x: 5, y: 6 }, cursorPoint: { x: 999, y: 999 }, input: "1.25,2.5", modes, objectSnapCandidates: candidates })).toMatchObject({
      source: "typed-cartesian", point: { x: 1.25, y: 2.5 }, stages: [],
    });
    const polar = resolvePrecisionPoint({ basePoint: { x: 5, y: 6 }, cursorPoint: { x: 999, y: 999 }, input: "@2<90", modes, objectSnapCandidates: candidates });
    expect(polar.source).toBe("typed-polar");
    expect(polar.point.x).toBeCloseTo(5, 14);
    expect(polar.point.y).toBeCloseTo(8, 14);
    expect(polar.stages).toEqual([]);
  });

  it("kills stage-order mutations across ORTHO, direct distance, GRID, OSNAP and OTRACK", () => {
    const result = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 4 }, input: "12",
      modes: { ortho: true, polar: { incrementRad: Math.PI / 4 }, grid: { spacingX: 5, spacingY: 5 }, aperture: 1 },
      objectSnapCandidates: [{ kind: "intersection", priority: 4, key: "intersection:A:B", point: { x: 10.5, y: 0 } }],
      trackingCandidates: [{ kind: "otrack", priority: 0, key: "track:A", point: { x: 10.1, y: 0 } }],
    });
    expect(result).toMatchObject({ source: "osnap", point: { x: 10.5, y: 0 } });
    expect(result.stages.map(({ stage }) => stage)).toEqual(["ortho", "direct-distance", "grid", "osnap:intersection"]);

    const tracking = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 4 }, input: "12",
      modes: { polar: { incrementRad: Math.PI / 4 }, grid: { spacingX: 5, spacingY: 5 }, aperture: 1 },
      trackingCandidates: [{ kind: "otrack", priority: 0, key: "track:A", point: { x: 10.1, y: 10.1 } }],
    });
    expect(tracking.source).toBe("otrack");
    expect(tracking.stages.map(({ stage }) => stage)).toEqual(["polar", "direct-distance", "grid", "otrack:otrack"]);
  });
});
