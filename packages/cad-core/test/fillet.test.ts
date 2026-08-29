import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadLine, CadPolyline } from "@kuubik/cad-schema";
import { CadCommandInputError, CadSession, createEmptyDocument, executeFillet, filletCadEntityPair, filletCadPolyline, parseFilletPairPicks, parseFilletRadius, resolveCadCommand } from "../src/index.js";

const horizontal: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: 0, y: 0 } };
const vertical: CadLine = { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
const distanceForTest = (first: { x: number; y: number }, second: { x: number; y: number }): number => Math.hypot(second.x - first.x, second.y - first.y);

describe("FILLET pair geometry", () => {
  it("rounds two selected line rays and returns exact tangent geometry without mutating inputs", () => {
    const firstBefore = structuredClone(horizontal); const secondBefore = structuredClone(vertical);
    const result = filletCadEntityPair(horizontal, { x: -50, y: 0 }, vertical, { x: 0, y: 50 }, 10);

    expect(result).toMatchObject({
      reason: null,
      center: { x: -10, y: 10 },
      tangentPoints: [{ x: -10, y: 0 }, { x: 0, y: 10 }],
      effectiveRadius: 10,
      firstEntity: { kind: "line", handle: "10", start: { x: -100, y: 0 }, end: { x: -10, y: 0 } },
      secondEntity: { kind: "line", handle: "20", start: { x: 0, y: 10 }, end: { x: 0, y: 100 } },
      arc: { kind: "arc", center: { x: -10, y: 10 }, radius: 10, counterClockwise: true },
    });
    expect(horizontal).toEqual(firstBefore);
    expect(vertical).toEqual(secondBefore);
  });

  it("uses radius zero as a sharp trim/extend corner and emits no arc", () => {
    const first: CadLine = { ...horizontal, end: { x: -10, y: 0 } };
    const second: CadLine = { ...vertical, start: { x: 0, y: 10 } };
    expect(filletCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, 0)).toMatchObject({
      reason: null,
      arc: null,
      tangentPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      firstEntity: { kind: "line", end: { x: 0, y: 0 } },
      secondEntity: { kind: "line", start: { x: 0, y: 0 } },
    });
  });

  it("rounds parallel lines with half their separation and ignores the stored radius", () => {
    const second: CadLine = { ...horizontal, handle: "20", start: { x: -100, y: 20 }, end: { x: 0, y: 20 } };
    const result = filletCadEntityPair(horizontal, { x: -40, y: 0 }, second, { x: -40, y: 20 }, 999);
    expect(result).toMatchObject({
      reason: null,
      effectiveRadius: 10,
      center: { x: -40, y: 10 },
      tangentPoints: [{ x: -40, y: 0 }, { x: -40, y: 20 }],
      arc: { radius: 10 },
    });
  });

  it("preserves the picked rays even when picks are close to the support intersection", () => {
    const result = filletCadEntityPair(horizontal, { x: -9, y: 0 }, vertical, { x: 0, y: 9 }, 10);
    expect(result).toMatchObject({
      reason: null,
      firstEntity: { kind: "line", start: { x: -100, y: 0 }, end: { x: -10, y: 0 } },
      secondEntity: { kind: "line", start: { x: 0, y: 10 }, end: { x: 0, y: 100 } },
    });

    const crossing: CadLine = { ...horizontal, start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
    expect(filletCadEntityPair(crossing, { x: -75, y: 0 }, vertical, { x: 0, y: 75 }, 10)).toMatchObject({
      firstEntity: { start: { x: -100, y: 0 }, end: { x: -10, y: 0 } },
    });
  });

  it("bows a parallel-line cap away from retained geometry at either selected end", () => {
    const first: CadLine = { ...horizontal, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const second: CadLine = { ...horizontal, handle: "20", start: { x: 0, y: 20 }, end: { x: 100, y: 20 } };
    const left = filletCadEntityPair(first, { x: 1, y: 0 }, second, { x: 1, y: 20 }, 999);
    expect(left).toMatchObject({
      firstEntity: { start: { x: 1, y: 0 }, end: { x: 100, y: 0 } },
      secondEntity: { start: { x: 1, y: 20 }, end: { x: 100, y: 20 } },
      arc: { center: { x: 1, y: 10 }, counterClockwise: false },
    });
    expect(left.arc && left.arc.center.x + left.arc.radius * Math.cos(left.arc.startAngleRad - Math.PI / 2)).toBeCloseTo(-9, 11);

    const right = filletCadEntityPair(first, { x: 99, y: 0 }, second, { x: 99, y: 20 }, 999);
    expect(right).toMatchObject({
      firstEntity: { start: { x: 0, y: 0 }, end: { x: 99, y: 0 } },
      secondEntity: { start: { x: 0, y: 20 }, end: { x: 99, y: 20 } },
      arc: { center: { x: 99, y: 10 }, counterClockwise: true },
    });
    expect(right.arc && right.arc.center.x + right.arc.radius * Math.cos(right.arc.startAngleRad + Math.PI / 2)).toBeCloseTo(109, 11);
  });

  it("handles internal line-circle and circle-circle tangency when the fillet radius exceeds source radii", () => {
    const line: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
    const circle: CadCircle = { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 20 }, radius: 5 };
    expect(filletCadEntityPair(line, { x: 15, y: 0 }, circle, { x: -5, y: 20 }, 20, "no-trim")).toMatchObject({
      reason: null,
      center: { x: 15, y: 20 },
      tangentPoints: [{ x: 15, y: 0 }, { x: -5, y: 20 }],
      arc: { radius: 20 },
    });

    const firstCircle: CadCircle = { ...circle, handle: "30", center: { x: -10, y: 0 } };
    const secondCircle: CadCircle = { ...circle, handle: "40", center: { x: 10, y: 0 } };
    const circlePair = filletCadEntityPair(firstCircle, { x: -13.333333333333, y: -3.7267799625 }, secondCircle, { x: 13.333333333333, y: -3.7267799625 }, 20, "no-trim");
    expect(circlePair.reason).toBeNull();
    expect(circlePair.center?.x).toBeCloseTo(0, 10);
    expect(Math.abs(circlePair.center?.y ?? 0)).toBeCloseTo(Math.sqrt(125), 10);
    expect(circlePair.tangentPoints?.map((point, index) => distanceForTest(point, index === 0 ? firstCircle.center : secondCircle.center))).toEqual([
      expect.closeTo(5, 10),
      expect.closeTo(5, 10),
    ]);
  });

  it("creates a tangent line-circle fillet and leaves the circle untrimmed", () => {
    const line: CadLine = { kind: "line", handle: "10", layerId: "a", start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
    const circle: CadCircle = { kind: "circle", handle: "20", layerId: "b", center: { x: 0, y: 30 }, radius: 10 };
    const result = filletCadEntityPair(line, { x: -30, y: 0 }, circle, { x: -10, y: 30 }, 10);
    expect(result.reason).toBeNull();
    expect(result.arc?.radius).toBe(10);
    expect(result.secondEntity).toEqual(circle);
    expect(result.tangentPoints?.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("honours No Trim and rejects unsupported or identical targets explicitly", () => {
    const result = filletCadEntityPair(horizontal, { x: -50, y: 0 }, vertical, { x: 0, y: 50 }, 10, "no-trim");
    expect(result).toMatchObject({ reason: null, firstEntity: horizontal, secondEntity: vertical });
    expect(result.arc).not.toBeNull();
    expect(filletCadEntityPair(horizontal, { x: 0, y: 0 }, horizontal, { x: 0, y: 0 }, 5).reason).toBe("same-target");
    const arc: CadArc = { kind: "arc", handle: "30", layerId: "0", center: { x: 0, y: 0 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true };
    expect(filletCadEntityPair(arc, { x: 10, y: 0 }, { kind: "proxy", handle: "40", layerId: "0", originalType: "X", raw: {} }, { x: 0, y: 0 }, 5).reason).toBe("unsupported-target");
  });
});

describe("FILLET Polyline geometry", () => {
  it("fillets every eligible rectangle vertex with tangent bulges", () => {
    const rectangle: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    };
    const result = filletCadPolyline(rectangle, 10);
    expect(result).toMatchObject({ reason: null, filletCount: 4, skippedVertices: [], entity: { kind: "polyline", closed: true } });
    expect(result.entity?.vertices).toHaveLength(8);
    expect(result.entity?.vertices.filter((vertex) => Math.abs(vertex.bulge ?? 0) > 0)).toHaveLength(4);
    expect(result.entity?.vertices[0]).toMatchObject({ x: 0, y: 10 });
    expect(result.entity?.vertices[0]?.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 11);
    expect(rectangle.vertices).toHaveLength(4);
  });

  it("skips corners that cannot accommodate the radius and refuses lossy bulge/width rewrites", () => {
    const short: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    };
    expect(filletCadPolyline(short, 10)).toMatchObject({ reason: "radius-too-large", filletCount: 0, skippedVertices: [1] });
    const bulged: CadPolyline = { ...short, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 5, y: 0 }, { x: 5, y: 5 }] };
    expect(filletCadPolyline(bulged, 1).reason).toBe("unsupported-target");
  });
});

describe("FILLET command transaction", () => {
  it("parses deterministic pick pairs and accepts the AutoCAD sharp radius zero", () => {
    expect(parseFilletPairPicks("10@-50,0>20@0,50; 30@150,0>40@100,50")).toEqual([
      { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
      { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
    ]);
    expect(parseFilletRadius("0")).toBe(0);
    expect(parseFilletPairPicks("10@-50,0>20@0,50~0")).toEqual([
      { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 }, radiusOverride: 0 },
    ]);
    expect(() => parseFilletPairPicks("10@0,0,20@1,1")).toThrow(CadCommandInputError);
    expect(() => parseFilletRadius("-1")).toThrow(CadCommandInputError);
  });

  it("resolves F/FILLET and commits Multiple pairs as one atomic Undo/Redo step", () => {
    expect(resolveCadCommand("f")?.id).toBe("FILLET");
    expect(resolveCadCommand(" FILLET ")?.id).toBe("FILLET");
    const document = createEmptyDocument({ documentId: "fillet-multiple" });
    document.entities.push(
      horizontal,
      vertical,
      { kind: "line", handle: "30", layerId: "0", start: { x: 100, y: 0 }, end: { x: 200, y: 0 } },
      { kind: "line", handle: "40", layerId: "0", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    );
    const args = {
      mode: "pairs" as const, radius: 10, trimMode: "trim" as const,
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
      ],
    };
    const result = executeFillet(document, args);
    expect(result).toMatchObject({
      rejected: [], multiple: true, createdHandles: ["41", "42"],
      steps: [
        { mode: "pair", sourceHandles: ["10", "20"], resultHandles: ["10", "20", "41"], effectiveRadius: 10 },
        { mode: "pair", sourceHandles: ["30", "40"], resultHandles: ["30", "40", "42"], effectiveRadius: 10 },
      ],
    });
    expect(result.changes).toHaveLength(6);
    expect(document.entities).toHaveLength(4);

    const session = new CadSession(document);
    session.commit({ opId: "F-024", baseRevision: 0, commandId: "FILLET", args, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "20", "30", "40", "41", "42"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "20", "30", "40", "41", "42"]);
  });

  it("routes Polyline mode through the same handle and reports too-short corners", () => {
    const document = createEmptyDocument({ documentId: "fillet-polyline" });
    document.entities.push(
      { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] },
      { kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] },
    );
    const result = executeFillet(document, { mode: "polyline", radius: 10, polylineHandles: ["10", "20"] });
    expect(result).toMatchObject({
      sourceHandles: ["10"], resultHandles: ["10"], createdHandles: [], multiple: true,
      rejected: [{ sourceIndex: 1, handles: ["20"], reason: "radius-too-large" }],
      steps: [{ mode: "polyline", sourceHandles: ["10"], resultHandles: ["10"], effectiveRadius: 10 }],
    });
    expect(result.changes).toEqual([{ type: "put", entity: expect.objectContaining({ kind: "polyline", handle: "10" }) }]);
  });

  it("refuses locked, hidden, missing and unsupported sources without partial corruption", () => {
    const document = createEmptyDocument({ documentId: "fillet-refusal" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
    );
    document.entities.push(
      { ...horizontal, layerId: "locked" },
      { ...vertical, layerId: "hidden" },
      { kind: "proxy", handle: "30", layerId: "0", originalType: "X", raw: {} },
    );
    const locked = executeFillet(document, { mode: "pairs", radius: 5, trimMode: "trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
    expect(locked).toMatchObject({ changes: [], rejected: [{ reason: "locked-layer" }] });
    const missing = executeFillet(document, { mode: "pairs", radius: 5, trimMode: "trim", pairs: [{ firstHandle: "missing", firstPickPoint: { x: 0, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
    expect(missing).toMatchObject({ changes: [], rejected: [{ reason: "missing" }] });
    const unsupported = executeFillet(document, { mode: "polyline", radius: 5, polylineHandles: ["30"] });
    expect(unsupported).toMatchObject({ changes: [], rejected: [{ reason: "unsupported-target" }] });
    expect(document.entities).toHaveLength(3);
    expect(() => executeFillet(document, { mode: "pairs", radius: -1, trimMode: "trim", pairs: [] })).toThrow(CadCommandInputError);
  });
});
