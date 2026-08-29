import { describe, expect, it } from "vitest";
import { CadSession, createEmptyDocument, executeFillet, filletCadEntityPair, filletCadPolyline } from "../src/index.js";

const first = { kind: "line" as const, handle: "10", layerId: "0", appearance: { color: "#09f" }, extensionData: { rowId: "F-024" }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } };
const second = { kind: "line" as const, handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };

describe("F-024 mutation-proven FILLET ratchet", () => {
  it("kills pick-quadrant, tangent, radius, direction, property-loss and source-mutation mutants", () => {
    const beforeFirst = structuredClone(first); const beforeSecond = structuredClone(second);
    expect(filletCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, 10)).toMatchObject({
      reason: null, center: { x: -10, y: 10 }, effectiveRadius: 10,
      tangentPoints: [{ x: -10, y: 0 }, { x: 0, y: 10 }],
      firstEntity: { end: { x: -10, y: 0 }, appearance: { color: "#09f" }, extensionData: { rowId: "F-024" } },
      secondEntity: { start: { x: 0, y: 10 } },
      arc: { radius: 10, counterClockwise: true },
    });
    expect(first).toEqual(beforeFirst); expect(second).toEqual(beforeSecond);
  });

  it("kills zero-radius, No Trim and parallel-radius mutants", () => {
    expect(filletCadEntityPair({ ...first, end: { x: -10, y: 0 } }, { x: -50, y: 0 }, { ...second, start: { x: 0, y: 10 } }, { x: 0, y: 50 }, 0)).toMatchObject({
      arc: null, firstEntity: { end: { x: 0, y: 0 } }, secondEntity: { start: { x: 0, y: 0 } }, effectiveRadius: 0,
    });
    expect(filletCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, 10, "no-trim")).toMatchObject({ firstEntity: first, secondEntity: second, arc: { radius: 10 } });
    const parallel = { ...first, handle: "20", start: { x: -100, y: 20 }, end: { x: 0, y: 20 } };
    expect(filletCadEntityPair(first, { x: -40, y: 0 }, parallel, { x: -40, y: 20 }, 999)).toMatchObject({ effectiveRadius: 10, center: { x: -40, y: 10 } });
  });

  it("kills picked-ray, parallel-cap-direction and radius-larger-than-circle mutants", () => {
    expect(filletCadEntityPair(first, { x: -9, y: 0 }, second, { x: 0, y: 9 }, 10)).toMatchObject({
      firstEntity: { start: { x: -100, y: 0 }, end: { x: -10, y: 0 } },
      secondEntity: { start: { x: 0, y: 10 }, end: { x: 0, y: 100 } },
    });
    const capFirst = { ...first, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const capSecond = { ...second, start: { x: 0, y: 20 }, end: { x: 100, y: 20 } };
    expect(filletCadEntityPair(capFirst, { x: 1, y: 0 }, capSecond, { x: 1, y: 20 }, 500)).toMatchObject({ arc: { counterClockwise: false } });
    expect(filletCadEntityPair(capFirst, { x: 99, y: 0 }, capSecond, { x: 99, y: 20 }, 500)).toMatchObject({ arc: { counterClockwise: true } });

    const line = { ...first, start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
    const circle = { kind: "circle" as const, handle: "30", layerId: "0", center: { x: 0, y: 20 }, radius: 5 };
    expect(filletCadEntityPair(line, { x: 15, y: 0 }, circle, { x: -5, y: 20 }, 20, "no-trim")).toMatchObject({
      center: { x: 15, y: 20 }, tangentPoints: [{ x: 15, y: 0 }, { x: -5, y: 20 }], arc: { radius: 20 },
    });
  });

  it("kills the Shift second-object radius override without changing the stored command radius", () => {
    const document = createEmptyDocument({ documentId: "F-024-shift" });
    document.entities.push({ ...first, end: { x: -10, y: 0 } }, { ...second, start: { x: 0, y: 10 } });
    const result = executeFillet(document, {
      mode: "pairs",
      radius: 25,
      trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 }, radiusOverride: 0 }],
    });
    expect(result).toMatchObject({ radius: 25, createdHandles: [], steps: [{ effectiveRadius: 0, tangentPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }] });
    expect(result.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ handle: "10", end: { x: 0, y: 0 } }) },
      { type: "put", entity: expect.objectContaining({ handle: "20", start: { x: 0, y: 0 } }) },
    ]);
  });

  it("kills Polyline all-corners, bulge-sign, short-segment and lossy-width mutants", () => {
    const rectangle = { kind: "polyline" as const, handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
    const rounded = filletCadPolyline(rectangle, 10);
    expect(rounded).toMatchObject({ reason: null, filletCount: 4, skippedVertices: [] });
    expect(rounded.entity?.vertices).toHaveLength(8);
    expect(rounded.entity?.vertices.filter((vertex) => (vertex.bulge ?? 0) > 0)).toHaveLength(4);
    const tooShort = { ...rectangle, closed: false, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] };
    expect(filletCadPolyline(tooShort, 10)).toMatchObject({ entity: null, reason: "radius-too-large", skippedVertices: [1] });
    expect(filletCadPolyline({ ...rectangle, vertices: [{ x: 0, y: 0, startWidth: 2 }, ...rectangle.vertices.slice(1)] }, 10).reason).toBe("unsupported-target");
  });

  it("kills split-Multiple, unstable-handle and one-sided atomic Undo/Redo mutants", () => {
    const document = createEmptyDocument({ documentId: "F-024-mutation" });
    document.entities.push(first, second, { ...first, handle: "30", start: { x: 100, y: 0 }, end: { x: 200, y: 0 } }, { ...second, handle: "40", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } });
    const source = structuredClone(document.entities);
    const result = executeFillet(document, { mode: "pairs", radius: 10, trimMode: "trim", pairs: [
      { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
      { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
    ] });
    expect(result).toMatchObject({ createdHandles: ["41", "42"], multiple: true, rejected: [] });
    const session = new CadSession(document);
    session.commit({ opId: "F-024-mutation", baseRevision: 0, commandId: "FILLET", args: {}, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    const committed = structuredClone(session.document.entities);
    expect(committed.map((entity) => entity.handle)).toEqual(["10", "20", "30", "40", "41", "42"]);
    expect(session.undo()).not.toBeNull(); expect(session.document.entities).toEqual(source);
    expect(session.redo()).not.toBeNull(); expect(session.document.entities).toEqual(committed);
  });
});
