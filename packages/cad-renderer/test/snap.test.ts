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
});
