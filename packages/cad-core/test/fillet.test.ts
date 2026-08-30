import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadEllipse, CadLine, CadPolyline, CadRay, CadSpline, CadXline } from "@kuubik/cad-schema";
import { CadCommandInputError, CadSession, createEmptyDocument, executeFillet, filletCadEntityPair, filletCadPolyline, filletCadPolylineSegmentPair, filletCadPolylineSegmentWithEntity, parseFilletPairPicks, parseFilletRadius, resolveCadCommand } from "../src/index.js";

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

  it("matches AutoCAD 2024 RAY/XLINE Trim and No Trim geometry", () => {
    const ray: CadRay = {
      kind: "ray", handle: "10", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 4, y: 0 },
      appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
    };
    const xline: CadXline = {
      kind: "xline", handle: "20", layerId: "0", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 3 },
      appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
    };
    const line: CadLine = {
      kind: "line", handle: "30", layerId: "0", start: { x: 100, y: 10 }, end: { x: 100, y: 100 },
      appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
    };

    expect(filletCadEntityPair(ray, { x: 80, y: 0 }, line, { x: 100, y: 20 }, 10, "trim")).toMatchObject({
      reason: null,
      center: { x: 90, y: 10 },
      tangentPoints: [{ x: 90, y: 0 }, { x: 100, y: 10 }],
      firstEntity: { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 90, y: 0 } },
      secondEntity: { kind: "line", handle: "30", start: { x: 100, y: 10 }, end: { x: 100, y: 100 } },
      arc: { kind: "arc", center: { x: 90, y: 10 }, radius: 10 },
    });

    expect(filletCadEntityPair(xline, { x: 100, y: 20 }, ray, { x: 80, y: 0 }, 10, "trim")).toMatchObject({
      reason: null,
      firstEntity: { kind: "ray", handle: "20", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 1 } },
      secondEntity: { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 90, y: 0 } },
      arc: { kind: "arc", center: { x: 90, y: 10 }, radius: 10 },
    });

    expect(filletCadEntityPair(ray, { x: 80, y: 0 }, xline, { x: 100, y: 20 }, 10, "no-trim")).toMatchObject({
      reason: null,
      firstEntity: ray,
      secondEntity: xline,
      arc: { kind: "arc", center: { x: 90, y: 10 }, radius: 10 },
    });
    expect(ray).toMatchObject({ kind: "ray", direction: { x: 4, y: 0 } });
    expect(xline).toMatchObject({ kind: "xline", direction: { x: 0, y: 3 } });
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

  it("matches the AutoCAD 2024 line-full-ellipse Trim geometry and preserves the closed ellipse", () => {
    const line: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: -200, y: 0 }, end: { x: 0, y: 0 } };
    const ellipse: CadEllipse = { kind: "ellipse", handle: "20", layerId: "0", center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 };
    const result = filletCadEntityPair(line, { x: -20, y: 0 }, ellipse, { x: 2, y: 10 }, 10);
    expect(result.reason).toBeNull();
    expect(result.firstEntity).toMatchObject({ kind: "line", start: { x: -200, y: 0 } });
    expect((result.firstEntity as CadLine).end.x).toBeCloseTo(-8.55777007055, 5);
    expect(result.secondEntity).toEqual(ellipse);
    expect(result.center?.x).toBeCloseTo(-8.55777007055, 5);
    expect(result.center?.y).toBeCloseTo(10, 5);
    expect(result.arc?.radius).toBe(10);
    expect(result.tangentPoints?.every((point) => Math.abs(distanceForTest(point, result.center!) - 10) < 1e-5)).toBe(true);
  });

  it("trims a clamped rational spline endpoint and keeps exact NURBS data on the retained interval", () => {
    const line: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 100, y: 0 }, end: { x: 300, y: 0 } };
    const spline: CadSpline = {
      kind: "spline", handle: "20", layerId: "0", degree: 3,
      controlPoints: [{ x: 300, y: 0 }, { x: 300, y: 40 }, { x: 360, y: 60 }, { x: 400, y: 100 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 2, 3, 4], closed: false, periodic: false,
    };
    const result = filletCadEntityPair(line, { x: 280, y: 0 }, spline, { x: 302, y: 10 }, 10);
    expect(result.reason).toBeNull();
    expect(result.firstEntity).toMatchObject({ kind: "line", start: { x: 100, y: 0 } });
    expect((result.firstEntity as CadLine).end.x).toBeLessThan(300);
    expect(result.secondEntity).toMatchObject({ kind: "spline", degree: 3, weights: expect.any(Array), closed: false, periodic: false });
    expect((result.secondEntity as CadSpline).controlPoints[0]).not.toEqual(spline.controlPoints[0]);
    expect(result.arc?.radius).toBe(10);
    expect(result.tangentPoints?.every((point) => Math.abs(distanceForTest(point, result.center!) - 10) < 1e-5)).toBe(true);
    expect(spline.controlPoints[0]).toEqual({ x: 300, y: 0 });
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
    expect(result.entity?.vertices[0]).toMatchObject({ x: 10, y: 0 });
    expect(result.entity?.vertices[1]?.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 11);
    expect(rectangle.vertices).toHaveLength(4);
  });

  it("skips corners that cannot accommodate the radius and honours FILLETPOLYARC", () => {
    const short: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    };
    expect(filletCadPolyline(short, 10)).toMatchObject({ reason: "radius-too-large", filletCount: 0, skippedVertices: [1] });
    const bulged: CadPolyline = {
      kind: "polyline", handle: "20", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: Math.tan(Math.PI / 8), startWidth: 4, endWidth: 8 },
        { x: 150, y: 50, startWidth: 8, endWidth: 10 },
        { x: 150, y: 150, startWidth: 10, endWidth: 12 },
        { x: 50, y: 150, startWidth: 12, endWidth: 14 },
      ],
    };
    const current = filletCadPolyline(bulged, 10, { filletPolylineArc: 1 });
    // Vertex 1 is already tangent (line into the quarter-circle), so only the
    // arc-to-line and final line-to-line corners need new fillets.
    expect(current).toMatchObject({ reason: null, filletCount: 2, skippedVertices: [1] });
    expect(current.entity?.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 0)).toBe(true);
    expect(current.entity?.vertices.every((vertex) => vertex.startWidth === undefined || Number.isFinite(vertex.startWidth))).toBe(true);
    expect(filletCadPolyline(bulged, 10, { filletPolylineArc: 0 })).toMatchObject({ reason: null, filletCount: 2, skippedVertices: [] });
    const noTrim = filletCadPolyline(bulged, 10, { trimMode: "no-trim", filletPolylineArc: 1 });
    expect(noTrim.entity).toEqual(bulged);
    expect(noTrim.arcs).toHaveLength(2);
  });

  it("matches the AutoCAD 2024 FILLETPOLYARC legacy/current live matrix", () => {
    const source = (xOffset: number): CadPolyline => ({
      kind: "polyline", handle: xOffset === 0 ? "FPA0" : "FPA1", layerId: "0", closed: false,
      vertices: [
        { x: xOffset, y: 1400 },
        { x: xOffset + 100, y: 1400, bulge: 0.2 },
        { x: xOffset + 160, y: 1460 },
        { x: xOffset + 160, y: 1540 },
      ],
    });
    expect(filletCadPolyline(source(0), 10, { filletPolylineArc: 0 }).entity?.vertices).toEqual([
      { x: 0, y: 1400 },
      { x: 150, y: 1400, bulge: 0.414213562373 },
      { x: 160, y: 1410 },
      { x: 160, y: 1540 },
    ]);
    const current = filletCadPolyline(source(300), 10, { filletPolylineArc: 1 }).entity?.vertices;
    const expectedCurrent = [
      { x: 300, y: 1400 },
      { x: 397.972826303728, y: 1400, bulge: 0.102829884701 },
      { x: 401.957808971661, y: 1400.828309145213, bulge: 0.189997598761 },
      { x: 459.171690854788, y: 1458.04219102834, bulge: 0.1028298847 },
      { x: 460, y: 1462.02717369627 },
      { x: 460, y: 1540 },
    ];
    expect(current).toHaveLength(expectedCurrent.length);
    expectedCurrent.forEach((expected, index) => {
      expect(current?.[index]?.x).toBeCloseTo(expected.x, 8);
      expect(current?.[index]?.y).toBeCloseTo(expected.y, 8);
      if (expected.bulge !== undefined) expect(current?.[index]?.bulge).toBeCloseTo(expected.bulge, 9);
      else expect(current?.[index]?.bulge).toBeUndefined();
    });
  });

  it("fillets selected adjacent polyline segments and keeps No Trim external", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      appearance: { color: "#abcdef" }, extensionData: { source: "f024" },
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };
    const trimmed = filletCadPolylineSegmentPair(polyline, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 }, 10, "trim");
    expect(trimmed).toMatchObject({ reason: null, arc: null, firstEntity: { kind: "polyline", handle: "10", closed: true } });
    expect(trimmed.firstEntity?.kind === "polyline" ? trimmed.firstEntity.vertices : []).toEqual([
      { x: 0, y: 0, startWidth: 2, endWidth: 3.8 },
      { x: 90, y: 0, bulge: 0.414213562373, startWidth: 3.8, endWidth: 4.2 },
      { x: 100, y: 10, startWidth: 4.2, endWidth: 6 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(trimmed.firstEntity).toMatchObject({ appearance: polyline.appearance, extensionData: polyline.extensionData });
    const reversed = filletCadPolylineSegmentPair(polyline, 1, { x: 100, y: 20 }, 0, { x: 80, y: 0 }, 10, "trim");
    expect(reversed.firstEntity).toEqual(trimmed.firstEntity);
    const noTrim = filletCadPolylineSegmentPair(polyline, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 }, 10, "no-trim");
    expect(noTrim.firstEntity).toEqual(polyline);
    expect(noTrim.arc).toMatchObject({ kind: "arc", radius: 10 });
  });

  it("replaces one intervening arc, supports radius zero, and closes an open polyline through its free segments", () => {
    const withMiddleArc: CadPolyline = {
      kind: "polyline", handle: "20", layerId: "0", closed: true,
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0, bulge: Math.tan(Math.PI / 8) },
        { x: 150, y: 50 },
        { x: 150, y: 150 },
        { x: 0, y: 150 },
      ],
    };
    const replacement = filletCadPolylineSegmentPair(withMiddleArc, 0, { x: 80, y: 0 }, 2, { x: 150, y: 70 }, 10, "trim");
    expect(replacement.firstEntity?.kind === "polyline" ? replacement.firstEntity.vertices : []).toEqual([
      { x: 0, y: 0 },
      { x: 140, y: 0, bulge: 0.414213562373 },
      { x: 150, y: 10 },
      { x: 150, y: 150 },
      { x: 0, y: 150 },
    ]);
    const sharp = filletCadPolylineSegmentPair(withMiddleArc, 0, { x: 80, y: 0 }, 2, { x: 150, y: 70 }, 0, "trim");
    expect(sharp.firstEntity?.kind === "polyline" ? sharp.firstEntity.vertices : []).toEqual([
      { x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 },
    ]);
    const polylineSharp = filletCadPolyline(withMiddleArc, 0, { filletPolylineArc: 0 });
    expect(polylineSharp).toMatchObject({ reason: null, filletCount: 1, skippedVertices: [] });
    expect(polylineSharp.entity?.vertices).toEqual([
      { x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 },
    ]);
    expect(filletCadPolyline(withMiddleArc, 0, { trimMode: "no-trim" })).toMatchObject({ entity: withMiddleArc, arcs: [], filletCount: 0 });
    const straight = { ...withMiddleArc, vertices: withMiddleArc.vertices.map(({ bulge: _bulge, ...vertex }) => vertex) };
    expect(filletCadPolyline(straight, 0)).toMatchObject({ entity: straight, arcs: [], filletCount: 0 });

    const open: CadPolyline = {
      kind: "polyline", handle: "30", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    };
    const closed = filletCadPolylineSegmentPair(open, 0, { x: 0, y: 90 }, 2, { x: 100, y: 90 }, 10, "trim");
    expect(closed).toMatchObject({ reason: null, effectiveRadius: 50, firstEntity: { kind: "polyline", closed: true } });
    expect(closed.firstEntity?.kind === "polyline" ? closed.firstEntity.vertices : []).toEqual([
      { x: 0, y: 90 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 90, bulge: 1 },
    ]);
    const nativeOpen: CadPolyline = {
      kind: "polyline", handle: "31", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 1200 }, { x: 0, y: 1100 }, { x: 100, y: 1100 }, { x: 20, y: 1200 }],
    };
    const nativeClosed = filletCadPolylineSegmentPair(nativeOpen, 0, { x: 0, y: 1190 }, 2, { x: 28, y: 1190 }, 10, "trim");
    expect(nativeClosed.firstEntity?.kind === "polyline" ? nativeClosed.firstEntity.vertices : []).toEqual([
      { x: 0, y: 1196.492189406418 },
      { x: 0, y: 1100 },
      { x: 100, y: 1100 },
      { x: 17.80868809443, y: 1202.739139881962, bulge: 0.708958225374 },
    ]);
    expect(nativeClosed.firstEntity).toMatchObject({ closed: true });
  });

  it("fillets a selected polyline segment with a separate entity in either selection order", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }],
    };
    const line: CadLine = { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    const forward = filletCadPolylineSegmentWithEntity(polyline, 0, { x: 80, y: 0 }, line, { x: 100, y: 20 }, 10, "trim", true);
    expect(forward).toMatchObject({
      reason: null,
      firstEntity: { kind: "polyline", vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 3.8 }, { x: 90, y: 0 }] },
      secondEntity: { kind: "line", start: { x: 100, y: 10 }, end: { x: 100, y: 100 } },
      arc: { center: { x: 90, y: 10 }, radius: 10 },
      joinedPolyline: {
        handle: "10",
        vertices: [
          { x: 0, y: 0, startWidth: 2, endWidth: 3.8 },
          { x: 90, y: 0, bulge: 0.414213562373, startWidth: 3.8, endWidth: 3.8 },
          { x: 100, y: 10, startWidth: 3.8, endWidth: 3.8 },
          { x: 100, y: 100, startWidth: 3.8, endWidth: 3.8 },
        ],
      },
    });
    const reverse = filletCadPolylineSegmentWithEntity(polyline, 0, { x: 80, y: 0 }, line, { x: 100, y: 20 }, 10, "trim", false);
    expect(reverse.firstEntity).toEqual(forward.secondEntity);
    expect(reverse.secondEntity).toEqual(forward.firstEntity);
    expect(reverse.joinedPolyline).toEqual(forward.joinedPolyline);
    expect(filletCadPolylineSegmentWithEntity(polyline, 0, { x: 80, y: 0 }, line, { x: 100, y: 20 }, 10, "no-trim", true)).toMatchObject({
      firstEntity: polyline, secondEntity: line, arc: { radius: 10 },
    });
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
    expect(parseFilletPairPicks("10#0@80,0>10#1@100,20")).toEqual([
      { firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 80, y: 0 }, secondHandle: "10", secondSegment: 1, secondPickPoint: { x: 100, y: 20 } },
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

  it("matches AutoCAD 2024 created-arc layer and appearance rules", () => {
    const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, linetypeId: "DASHED", lineweightMm: 0.5, transparency: 0.25 };
    const sameLayer = createEmptyDocument({ documentId: "fillet-appearance-same" });
    sameLayer.entities.push({ ...horizontal, appearance }, { ...vertical });
    const sameResult = executeFillet(sameLayer, { mode: "pairs", radius: 10, trimMode: "no-trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
    const sameArc = sameResult.changes.find((change) => change.type === "put" && change.entity.kind === "arc");
    expect(sameArc).toMatchObject({ type: "put", entity: { layerId: "0" } });
    expect(sameArc?.type === "put" ? sameArc.entity.appearance : null).toEqual(appearance);

    const crossLayer = createEmptyDocument({ documentId: "fillet-appearance-cross" });
    crossLayer.layers.push(
      { id: "a", name: "A", visible: true, frozen: false, locked: false, plottable: true },
      { id: "b", name: "B", visible: true, frozen: false, locked: false, plottable: true },
      { id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true },
    );
    crossLayer.currentLayerId = "current";
    crossLayer.entities.push({ ...horizontal, layerId: "a", appearance }, { ...vertical, layerId: "b" });
    const crossResult = executeFillet(crossLayer, { mode: "pairs", radius: 10, trimMode: "no-trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
    const crossArc = crossResult.changes.find((change) => change.type === "put" && change.entity.kind === "arc");
    expect(crossArc).toMatchObject({ type: "put", entity: { layerId: "current" } });
    expect(crossArc?.type === "put" ? crossArc.entity.appearance : null).toEqual({ lineweightMm: 0.5 });

    const parametric = createEmptyDocument({ documentId: "fillet-appearance-parametric" });
    parametric.entities.push(
      { kind: "line", handle: "10", layerId: "0", appearance, start: { x: -200, y: 0 }, end: { x: 0, y: 0 } },
      { kind: "ellipse", handle: "20", layerId: "0", center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
    );
    const parametricResult = executeFillet(parametric, { mode: "pairs", radius: 10, trimMode: "trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -20, y: 0 }, secondHandle: "20", secondPickPoint: { x: 2, y: 10 } }] });
    const parametricArc = parametricResult.changes.find((change) => change.type === "put" && change.entity.kind === "arc");
    expect(parametricArc).toMatchObject({ type: "put", entity: { layerId: "0" } });
    expect(parametricArc?.type === "put" ? parametricArc.entity.appearance : null).toEqual({ color: "#ff0000", colorMethod: "aci", aciIndex: 1 });
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

  it("commits same-polyline segment picks and Polyline No Trim arcs as atomic transactions", () => {
    const document = createEmptyDocument({ documentId: "fillet-polyline-segments" });
    const source: CadPolyline = {
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };
    document.entities.push(source);
    const pair = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 80, y: 0 }, secondHandle: "10", secondSegment: 1, secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(pair).toMatchObject({
      sourceHandles: ["10"], resultHandles: ["10"], createdHandles: [], rejected: [],
      steps: [{ sourceHandles: ["10", "10"], resultHandles: ["10"], effectiveRadius: 10 }],
    });
    expect(pair.changes).toHaveLength(1);

    const noTrim = executeFillet(document, { mode: "polyline", radius: 10, trimMode: "no-trim", filletPolylineArc: 1, polylineHandles: ["10"] });
    expect(noTrim).toMatchObject({
      sourceHandles: ["10"], resultHandles: ["11", "12", "13", "14"], createdHandles: ["11", "12", "13", "14"], rejected: [],
      steps: [{ mode: "polyline", sourceHandles: ["10"], resultHandles: ["11", "12", "13", "14"], skippedVertices: [] }],
    });
    expect(noTrim.changes).toHaveLength(4);
    expect(noTrim.changes.every((change) => change.type === "put" && change.entity.kind === "arc")).toBe(true);

    const session = new CadSession(document);
    session.commit({ opId: "F-024-polyline-no-trim", baseRevision: 0, commandId: "FILLET", args: {}, targetHandles: noTrim.sourceHandles, resultHandles: noTrim.resultHandles }, noTrim.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12", "13", "14"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12", "13", "14"]);
  });

  it("commits AutoCAD-compatible RAY/XLINE conversions and No Trim preservation atomically", () => {
    const document = createEmptyDocument({ documentId: "fillet-construction-lines" });
    document.entities.push(
      {
        kind: "ray", handle: "10", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 4, y: 0 },
        appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
      },
      {
        kind: "xline", handle: "20", layerId: "0", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 3 },
        appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
      },
    );
    const trim = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: 80, y: 0 }, secondHandle: "20", secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(trim).toMatchObject({
      sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], createdHandles: ["21"], rejected: [],
      steps: [{ sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], effectiveRadius: 10 }],
    });
    expect(trim.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 90, y: 0 } }) },
      { type: "put", entity: expect.objectContaining({ kind: "ray", handle: "20", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 1 } }) },
      { type: "put", entity: expect.objectContaining({ kind: "arc", handle: "21", layerId: "0", appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000" } }) },
    ]);

    const session = new CadSession(document);
    session.commit({ opId: "F-024-ray-xline", baseRevision: 0, commandId: "FILLET", args: {}, targetHandles: trim.sourceHandles, resultHandles: trim.resultHandles }, trim.changes);
    expect(session.document.entities.map((entity) => `${entity.handle}:${entity.kind}`)).toEqual(["10:line", "20:ray", "21:arc"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.map((entity) => `${entity.handle}:${entity.kind}`)).toEqual(["10:line", "20:ray", "21:arc"]);

    const noTrim = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "no-trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: 80, y: 0 }, secondHandle: "20", secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(noTrim).toMatchObject({ sourceHandles: ["10", "20"], resultHandles: ["21"], createdHandles: ["21"], rejected: [] });
    expect(noTrim.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ kind: "arc", handle: "21", appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000" } }) },
    ]);
    expect(document.entities.map((entity) => entity.kind)).toEqual(["ray", "xline"]);
  });

  it("commits mixed polyline-segment and line pairs without losing the polyline handle", () => {
    const document = createEmptyDocument({ documentId: "fillet-mixed-polyline" });
    document.entities.push(
      { kind: "polyline", handle: "10", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    );
    const result = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 80, y: 0 }, secondHandle: "20", secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(result).toMatchObject({ sourceHandles: ["10", "20"], resultHandles: ["10"], createdHandles: [], rejected: [] });
    expect(result.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ kind: "polyline", handle: "10", vertices: [{ x: 0, y: 0 }, { x: 90, y: 0, bulge: 0.414213562373 }, { x: 100, y: 10 }, { x: 100, y: 100 }] }) },
      { type: "delete", handle: "20" },
    ]);
  });

  it("refuses locked, missing and unsupported sources without partial corruption", () => {
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

  it("matches AutoCAD explicit-handle FILLET on off and frozen layers", () => {
    for (const layer of [
      { id: "off", name: "OFF", visible: false, frozen: false, locked: false, plottable: true },
      { id: "frozen", name: "FROZEN", visible: true, frozen: true, locked: false, plottable: true },
    ]) {
      const document = createEmptyDocument({ documentId: `fillet-${layer.id}` });
      document.layers.push(layer);
      document.entities.push({ ...horizontal, layerId: layer.id }, { ...vertical, layerId: layer.id });
      const result = executeFillet(document, {
        mode: "pairs", radius: 10, trimMode: "trim",
        pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
      });
      expect(result).toMatchObject({ rejected: [], sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"] });
      expect(result.changes).toHaveLength(3);
    }
  });
});
