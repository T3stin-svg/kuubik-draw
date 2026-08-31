import { describe, expect, it } from "vitest";
import { CAD_OSNAP_PRIORITY, CadSnapIndex, generateCadSnapCandidates } from "../src/snap.js";

describe("F-048..F-050 OSNAP", () => {
  it("generates ordered endpoint/midpoint/center/quadrant/intersection candidates", () => {
    const entities = [
      { kind: "line" as const, handle: "L1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line" as const, handle: "L2", layerId: "0", start: { x: 5, y: -5 }, end: { x: 5, y: 5 } },
      { kind: "circle" as const, handle: "C", layerId: "0", center: { x: 20, y: 0 }, radius: 5 },
    ];
    const candidates = generateCadSnapCandidates(entities, { modes: ["endpoint", "midpoint", "center", "quadrant", "intersection"], cursor: { x: 5, y: 0 }, aperture: 30 });
    expect(candidates.some((item) => item.mode === "intersection" && item.point.x === 5 && item.point.y === 0)).toBe(true);
    expect(candidates.filter((item) => item.handle === "C" && item.mode === "quadrant")).toHaveLength(4);
    expect(candidates.map((item) => item.priority)).toEqual([...candidates.map((item) => item.priority)].sort((a, b) => a - b));
    expect(CAD_OSNAP_PRIORITY).toMatchObject({ endpoint: 0, midpoint: 1, center: 2, quadrant: 3, intersection: 4, perpendicular: 5, tangent: 6, nearest: 7 });
  });

  it("generates perpendicular, tangent and nearest from the same nearby entity set", () => {
    const circle = { kind: "circle" as const, handle: "C", layerId: "0", center: { x: 0, y: 0 }, radius: 5 };
    const candidates = generateCadSnapCandidates([circle], { modes: ["perpendicular", "tangent", "nearest"], cursor: { x: 4, y: 3 }, aperture: 20, referencePoint: { x: 10, y: 0 } });
    expect(candidates.filter((item) => item.mode === "tangent")).toHaveLength(2);
    expect(candidates.some((item) => item.mode === "perpendicular" && item.point.x === 5 && item.point.y === 0)).toBe(true);
    expect(candidates.some((item) => item.mode === "nearest" && Math.hypot(item.point.x - 4, item.point.y - 3) < 1e-12)).toBe(true);
  });

  it("lets the shared layer predicate remove hidden/frozen but retain locked snap candidates", () => {
    const index = new CadSnapIndex();
    index.setEntities([
      { kind: "line", handle: "hidden", layerId: "H", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "line", handle: "locked", layerId: "L", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    ]);
    const hits = index.query({ modes: ["endpoint"], cursor: { x: 0, y: 0 }, aperture: 0.1 }, (entity) => entity.layerId === "L");
    expect(hits.map((hit) => hit.handle)).toEqual(["locked"]);
  });

  it("proves ellipse endpoint/quadrant/tangent candidates and filters trimmed-away points", () => {
    const full = {
      kind: "ellipse" as const, handle: "E", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2,
    };
    const fullCandidates = generateCadSnapCandidates([full], {
      modes: ["endpoint", "center", "quadrant", "tangent"], cursor: { x: 0, y: 0 }, aperture: 100, referencePoint: { x: 20, y: 0 },
    });
    expect(fullCandidates.filter((item) => item.mode === "endpoint")).toHaveLength(0);
    expect(fullCandidates.filter((item) => item.mode === "quadrant")).toHaveLength(4);
    const tangents = fullCandidates.filter((item) => item.mode === "tangent");
    expect(tangents).toHaveLength(2);
    tangents.forEach((item) => {
      const cosine = item.point.x / 10;
      const sine = item.point.y / 5;
      expect(cosine * cosine + sine * sine).toBeCloseTo(1, 12);
      const derivative = { x: -10 * sine, y: 5 * cosine };
      const toReference = { x: 20 - item.point.x, y: -item.point.y };
      expect(derivative.x * toReference.y - derivative.y * toReference.x).toBeCloseTo(0, 10);
    });

    const quarter = { ...full, handle: "EA", endParameter: Math.PI / 2 };
    const quarterCandidates = generateCadSnapCandidates([quarter], {
      modes: ["endpoint", "quadrant", "tangent"], cursor: { x: 0, y: 0 }, aperture: 100, referencePoint: { x: 20, y: 0 },
    });
    expect(quarterCandidates.filter((item) => item.mode === "endpoint")).toHaveLength(2);
    expect(quarterCandidates.filter((item) => item.mode === "quadrant")).toHaveLength(2);
    expect(quarterCandidates.filter((item) => item.mode === "tangent")).toHaveLength(1);
  });

  it("emits only provable spline candidates and fails closed for tangent and malformed geometry", () => {
    const spline = {
      kind: "spline" as const, handle: "S", layerId: "0", degree: 2,
      controlPoints: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }],
      knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false,
    };
    const crossing = { kind: "line" as const, handle: "L", layerId: "0", start: { x: 5, y: -1 }, end: { x: 5, y: 8 } };
    const candidates = generateCadSnapCandidates([spline, crossing], {
      modes: ["endpoint", "intersection", "perpendicular", "tangent", "nearest"],
      cursor: { x: 5, y: 5 }, aperture: 20, referencePoint: { x: 5, y: 8 },
    });
    expect(candidates.filter((item) => item.handle === "S" && item.mode === "endpoint")).toHaveLength(2);
    expect(candidates.some((item) => item.mode === "intersection" && item.otherHandle === "L" && item.point.x === 5 && Math.abs(item.point.y - 5) < 1e-6)).toBe(true);
    expect(candidates.some((item) => item.handle === "S" && item.mode === "perpendicular")).toBe(true);
    expect(candidates.some((item) => item.handle === "S" && item.mode === "nearest")).toBe(true);
    expect(candidates.some((item) => item.handle === "S" && item.mode === "tangent")).toBe(false);

    const malformed = { ...spline, handle: "BAD", knots: [0, 0, 1] };
    expect(generateCadSnapCandidates([malformed], {
      modes: ["endpoint", "midpoint", "intersection", "perpendicular", "tangent", "nearest"],
      cursor: { x: 0, y: 0 }, aperture: 100, referencePoint: { x: 1, y: 1 },
    })).toEqual([]);
  });
});
