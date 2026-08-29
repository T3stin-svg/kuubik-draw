import { describe, expect, it } from "vitest";
import type { CadEntity } from "@kuubik/cad-schema";
import { pickCadEntity, selectCadEntitiesByCrossingPolygon, selectCadEntitiesByFence, selectCadEntityHitsByCrossingPolygon, selectCadEntityHitsByFence } from "../src/index.js";

const entities: CadEntity[] = [
  { kind: "line", handle: "line", layerId: "0", start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
  { kind: "circle", handle: "circle", layerId: "0", center: { x: 30, y: 0 }, radius: 5 },
  { kind: "ellipse", handle: "ellipse", layerId: "0", center: { x: 50, y: 0 }, majorAxis: { x: 8, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
  { kind: "polyline", handle: "bulge", layerId: "0", vertices: [{ x: 60, y: 0, bulge: 1 }, { x: 80, y: 0 }], closed: false },
  { kind: "proxy", handle: "proxy", layerId: "0", originalType: "PROXY", raw: {} },
];

describe("exact CAD selection predicates", () => {
  it("returns a world-space pick with segment and parameter only inside tolerance", () => {
    expect(pickCadEntity(entities[0]!, { x: 2, y: 0.4 }, 0.5)).toEqual({
      handle: "line",
      point: { x: 2, y: 0 },
      distance: 0.4,
      segment: 0,
      parameter: 0.6,
    });
    expect(pickCadEntity(entities[0]!, { x: 2, y: 0.6 }, 0.5)).toBeNull();
    expect(pickCadEntity(entities[4]!, { x: 0, y: 0 }, 10)).toBeNull();
    expect(() => pickCadEntity(entities[0]!, { x: 0, y: 0 }, -1)).toThrow(TypeError);
  });

  it("uses finite analytical fence intersections for line, circle, ellipse and bulge arc", () => {
    expect(selectCadEntitiesByFence(entities, [{ x: 0, y: -10 }, { x: 0, y: 10 }])).toEqual(["line"]);
    expect(selectCadEntityHitsByFence(entities, [{ x: 0, y: -10 }, { x: 0, y: 10 }])).toEqual([{ handle: "line", pickPoint: { x: 0, y: 0 } }]);
    expect(selectCadEntitiesByFence(entities, [{ x: 25, y: 0 }, { x: 35, y: 0 }])).toEqual(["circle"]);
    expect(selectCadEntitiesByFence(entities, [{ x: 50, y: -10 }, { x: 50, y: 10 }])).toEqual(["ellipse"]);
    expect(selectCadEntitiesByFence(entities, [{ x: 70, y: -15 }, { x: 70, y: 15 }])).toEqual(["bulge"]);
    expect(selectCadEntitiesByFence(entities, [{ x: 0, y: 20 }, { x: 10, y: 20 }])).toEqual([]);
  });

  it("crossing-selects contained or intersecting curves but not a circle surrounding the window", () => {
    const polygon = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }];
    const surrounding: CadEntity = { kind: "circle", handle: "surrounding", layerId: "0", center: { x: 0, y: 0 }, radius: 100 };
    const inside: CadEntity = { kind: "line", handle: "inside", layerId: "0", start: { x: -1, y: 1 }, end: { x: 1, y: 1 } };
    expect(selectCadEntitiesByCrossingPolygon([...entities, surrounding, inside], polygon)).toEqual(["line", "inside"]);
    expect(selectCadEntityHitsByCrossingPolygon([...entities, surrounding, inside], polygon)).toEqual([
      { handle: "line", pickPoint: { x: 2, y: 0 } },
      { handle: "inside", pickPoint: { x: 0, y: 1 } },
    ]);
    expect(selectCadEntityHitsByCrossingPolygon([...entities, surrounding, inside], [{ x: -2, y: -2 }, { x: 2, y: 2 }])).toEqual([
      { handle: "line", pickPoint: { x: 2, y: 0 } },
      { handle: "inside", pickPoint: { x: 0, y: 1 } },
    ]);
  });

  it("rejects degenerate selection paths", () => {
    expect(() => selectCadEntitiesByFence(entities, [{ x: 0, y: 0 }])).toThrow(TypeError);
    expect(() => selectCadEntitiesByFence(entities, [{ x: 0, y: 0 }, { x: 0, y: 0 }])).toThrow(TypeError);
    expect(() => selectCadEntitiesByCrossingPolygon(entities, [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toThrow(TypeError);
  });
});
