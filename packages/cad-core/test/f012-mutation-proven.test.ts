import { describe, expect, it } from "vitest";
import {
  addSplineControlVertex,
  addSplineFitKink,
  createControlVertexSpline,
  createFitPointSpline,
  convertSplineToPolyline,
  createEmptyDocument,
  deleteSplineControlVertex,
  executeSplineEdit,
  joinSplineWithLine,
  elevateSplineOrder,
  moveSplineControlVertex,
  setSplineClosed,
  setSplineControlVertexWeight,
  executeSpline,
  splinePointAtParameter,
  stretchCadEntity,
  translateCadEntity,
} from "../src/index.js";

const points = [{ x: 0, y: 0 }, { x: 15, y: 80 }, { x: 65, y: -20 }, { x: 120, y: 0 }];

describe("F-012 mutation-proven ratchets", () => {
  it("kills SPLINEDIT Join handle, C0-knot, target-retention and rational-weight mutants", () => {
    const source = createFitPointSpline({ handle: "J1", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 100, y: 0 }] });
    const line = { kind: "line" as const, handle: "J2", layerId: "0", start: { x: 100, y: 0 }, end: { x: 150, y: 20 } };
    const joined = joinSplineWithLine(source, line);
    expect(joined.handle).toBe("J1");
    expect(joined.controlPoints.at(-1)).toEqual(line.end);
    expect(new Set(joined.knots.slice(-7)).size).toBe(2);
    expect(joined.weights).toEqual(Array(joined.controlPoints.length).fill(1));
    const document = createEmptyDocument({ documentId: "F-012-join-mutation", now: "2026-08-31T07:50:00.000Z" });
    document.entities = [source, line];
    const result = executeSplineEdit(document, { targetHandle: "J1", actions: [{ type: "join", targetHandles: ["J2"] }] });
    expect(result.changes[0]).toEqual({ type: "delete", handle: "J2" });
    expect(result.changes[1]).toMatchObject({ type: "put", entity: { handle: "J1" } });
  });
  it("kills method, degree and knot-parameterization mutants", () => {
    const chord = createFitPointSpline({ handle: "10", layerId: "0", fitPoints: points, knotParameterization: "chord" });
    const uniform = createFitPointSpline({ handle: "10", layerId: "0", fitPoints: points, knotParameterization: "uniform" });
    expect(chord.definitionMethod).toBe("fit-points");
    expect(chord.degree).toBe(3);
    expect(chord.knotParameterization).toBe("chord");
    expect(uniform.knotParameterization).toBe("uniform");
    expect(chord.controlPoints).not.toEqual(uniform.controlPoints);
    expect(() => executeSpline({ handle: "11", layerId: "0", method: "control-vertices", degree: 10, points })).toThrow(/degree plus one/u);
  });

  it("kills metadata-only and unbounded Fit Tolerance mutants", () => {
    const exact = createFitPointSpline({ handle: "T0", layerId: "0", fitPoints: points });
    const approximate = createFitPointSpline({ handle: "T10", layerId: "0", fitPoints: points, fitTolerance: 10 });
    expect(approximate.fitTolerance).toBe(10);
    expect(approximate.controlPoints).not.toEqual(exact.controlPoints);
    expect(approximate.controlPoints[0]).toEqual({ x: expect.closeTo(points[0]!.x, 10), y: expect.closeTo(points[0]!.y, 10) });
    expect(approximate.controlPoints.at(-1)).toEqual({ x: expect.closeTo(points.at(-1)!.x, 10), y: expect.closeTo(points.at(-1)!.y, 10) });
  });

  it("kills in-place and fit-defined SPLINE Object conversion mutants", () => {
    const document = createEmptyDocument({ documentId: "F-012-object-mutation", now: "2026-08-31T04:50:40.894Z" });
    document.entities = [{ kind: "polyline", handle: "7D", layerId: "0", closed: false, vertices: points }];
    const changes = executeSpline({ handle: "8C", method: "object", sourceHandle: "7D" }, document);
    expect(changes[0]).toEqual({ type: "delete", handle: "7D" });
    expect(changes[1]).toMatchObject({ type: "put", entity: { kind: "spline", handle: "8C", definitionMethod: "control-vertices", degree: 3 } });
    if (changes[1]?.type !== "put" || changes[1].entity.kind !== "spline") throw new Error("Expected converted SPLINE.");
    expect(changes[1].entity).not.toHaveProperty("fitPoints");
    expect(changes[1].entity.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("kills stale fit-metadata and transform-only-control-points mutants", () => {
    const source = createFitPointSpline({ handle: "10", layerId: "0", fitPoints: points });
    const moved = translateCadEntity(source, { x: 7, y: -9 });
    expect(moved).toMatchObject({ kind: "spline", fitPoints: points.map((point) => ({ x: point.x + 7, y: point.y - 9 })) });
    const stretched = stretchCadEntity(source, [{ kind: "crossing-window", points: [{ x: -1, y: -1 }, { x: 1, y: 1 }] }], { x: 5, y: 0 });
    expect(stretched.entity).toMatchObject({ kind: "spline", definitionMethod: "control-vertices" });
    expect(stretched.entity).not.toHaveProperty("fitPoints");
  });

  it("kills open/closed, periodic-seam and endpoint-tangent mutants", () => {
    const closed = createFitPointSpline({ handle: "12", layerId: "0", fitPoints: points, closed: true });
    expect(closed).toMatchObject({ closed: true, periodic: true, definitionMethod: "fit-points" });
    const seamStart = splinePointAtParameter(closed, 0);
    const seamEnd = splinePointAtParameter(closed, 1);
    expect(seamStart).toEqual({ x: expect.closeTo(seamEnd!.x, 9), y: expect.closeTo(seamEnd!.y, 9) });

    const startTangent = { x: 160, y: 20 };
    const endTangent = { x: 100, y: -60 };
    const tangent = createFitPointSpline({ handle: "13", layerId: "0", fitPoints: points, startTangent, endTangent });
    const normalize = (value: { x: number; y: number }) => {
      const length = Math.hypot(value.x, value.y);
      return { x: value.x / length, y: value.y / length };
    };
    const normalizedStart = normalize(startTangent);
    const normalizedEnd = normalize(endTangent);
    expect(tangent).toMatchObject({ startTangent: normalizedStart, endTangent: normalizedEnd, closed: false, periodic: false });
    const chordLengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
    const totalLength = chordLengths.reduce((sum, value) => sum + value, 0);
    const firstSpan = chordLengths[0]! / totalLength;
    const lastSpan = chordLengths.at(-1)! / totalLength;
    const first0 = tangent.controlPoints[0]!;
    const first1 = tangent.controlPoints[1]!;
    const last0 = tangent.controlPoints.at(-2)!;
    const last1 = tangent.controlPoints.at(-1)!;
    expect({ x: 3 * (first1.x - first0.x) / firstSpan, y: 3 * (first1.y - first0.y) / firstSpan }).toEqual({
      x: expect.closeTo(normalizedStart.x, 9),
      y: expect.closeTo(normalizedStart.y, 9),
    });
    expect({ x: 3 * (last1.x - last0.x) / lastSpan, y: 3 * (last1.y - last0.y) / lastSpan }).toEqual({
      x: expect.closeTo(normalizedEnd.x, 9),
      y: expect.closeTo(normalizedEnd.y, 9),
    });
  });

  it("kills Fit Kink metadata-only, shape-changing and single-knot mutants", () => {
    const source = createFitPointSpline({ handle: "KINK", layerId: "0", fitPoints: points });
    const target = splinePointAtParameter(source, 0.43)!;
    const before = Array.from({ length: 41 }, (_unused, index) => splinePointAtParameter(source, index / 40)!);
    const kink = addSplineFitKink(source, target);
    expect(kink.definitionMethod).toBe("control-vertices");
    expect(kink).not.toHaveProperty("fitPoints");
    expect(kink.controlPoints).toHaveLength(source.controlPoints.length + source.degree);
    const repeated = kink.knots.find((value, index, values) => index > 0 && index < values.length - 1
      && values.filter((candidate) => Math.abs(candidate - value) < 1e-9).length === source.degree);
    expect(repeated).toBeDefined();
    before.forEach((point, index) => expect(splinePointAtParameter(kink, index / 40)).toEqual({
      x: expect.closeTo(point.x, 8),
      y: expect.closeTo(point.y, 8),
    }));
  });

  it("kills CV Add metadata-only and shape-changing mutants", () => {
    const source = createControlVertexSpline({ handle: "CV-ADD", layerId: "0", degree: 3, controlPoints: points });
    const target = splinePointAtParameter(source, 0.5)!;
    const before = Array.from({ length: 41 }, (_unused, index) => splinePointAtParameter(source, index / 40)!);
    const added = addSplineControlVertex(source, target);
    expect(added.controlPoints).toHaveLength(source.controlPoints.length + 1);
    expect(added.knots).toHaveLength(source.knots.length + 1);
    expect(added.knots.filter((value) => Math.abs(value - 0.5) < 1e-9)).toHaveLength(1);
    before.forEach((point, index) => expect(splinePointAtParameter(added, index / 40)).toEqual({
      x: expect.closeTo(point.x, 9),
      y: expect.closeTo(point.y, 9),
    }));
  });

  it("kills CV Delete no-op, wrong-control and wrong-knot mutants", () => {
    const source = createControlVertexSpline({
      handle: "CV-DELETE",
      layerId: "0",
      degree: 3,
      controlPoints: points,
      weights: [1, 1.25, 0.8, 1],
    });
    const first = addSplineControlVertex(source, splinePointAtParameter(source, 0.3)!);
    const refined = addSplineControlVertex(first, splinePointAtParameter(first, 0.7)!);
    const deleted = deleteSplineControlVertex(refined, 2);
    expect(deleted.controlPoints).toEqual(refined.controlPoints.filter((_point, index) => index !== 2));
    expect(deleted.weights).toEqual(refined.weights?.filter((_weight, index) => index !== 2));
    expect(deleted.knots).toEqual(refined.knots.filter((_knot, index) => index !== 4));
    expect(deleted.handle).toBe(refined.handle);
    expect(deleted.layerId).toBe(refined.layerId);
    const minimum = deleteSplineControlVertex(source, 2);
    expect(minimum.degree).toBe(2);
    expect(minimum.controlPoints).toEqual([points[0], points[1], points[3]]);
    expect(minimum.weights).toEqual([1, 1.25, 1]);
    expect(minimum.knots).toEqual([0, 0, 0, 1, 1, 1]);
    const periodic = createControlVertexSpline({ handle: "CV-DELETE-PERIODIC", layerId: "0", degree: 3, closed: true, controlPoints: [...points, { x: 160, y: 30 }], weights: [1, 1.25, 0.8, 1, 1.1] });
    const periodicDeleted = deleteSplineControlVertex(periodic, 2);
    expect(periodicDeleted).toMatchObject({ closed: true, periodic: true });
    expect(periodicDeleted.controlPoints.slice(0, 4)).toEqual([points[0], points[1], points[3], { x: 160, y: 30 }]);
    expect(periodicDeleted.controlPoints.slice(4)).toEqual(periodicDeleted.controlPoints.slice(0, 3));
    expect(periodicDeleted.weights?.slice(4)).toEqual(periodicDeleted.weights?.slice(0, 3));
    const compact = periodic.knots.slice(3, 9);
    compact.splice(2, 1);
    const period = compact.at(-1)! - compact[0]!;
    expect(periodicDeleted.knots).toEqual([...compact.slice(1, -1).map((knot) => knot - period), ...compact, ...compact.slice(1, 4).map((knot) => knot + period)]);
  });

  it("kills CV Elevate metadata-only, wrong-order and shape-changing mutants", () => {
    const source = createControlVertexSpline({
      handle: "CV-ELEVATE",
      layerId: "0",
      degree: 3,
      controlPoints: points,
      weights: [1, 1.25, 0.8, 1],
    });
    const added = addSplineControlVertex(source, splinePointAtParameter(source, 0.5)!);
    const before = Array.from({ length: 81 }, (_unused, index) => splinePointAtParameter(added, index / 80)!);
    const elevated = elevateSplineOrder(added, 5);
    expect(elevated.degree).toBe(4);
    expect(elevated.controlPoints).toHaveLength(7);
    expect(elevated.knots).toHaveLength(12);
    expect(elevated.knots.filter((value) => Math.abs(value - 0.5) < 1e-9)).toHaveLength(2);
    before.forEach((point, index) => expect(splinePointAtParameter(elevated, index / 80)).toEqual({
      x: expect.closeTo(point.x, 8),
      y: expect.closeTo(point.y, 8),
    }));
  });

  it("kills non-atomic SPLINEDIT and locked-layer mutation mutants", () => {
    const source = createFitPointSpline({ handle: "10", layerId: "0", fitPoints: points });
    const document = createEmptyDocument({ documentId: "F-012-mutation", now: "2026-08-31T07:05:00.000Z" });
    document.entities = [source];
    const refused = executeSplineEdit(document, {
      targetHandle: "10",
      actions: [{ type: "fit-purge" }, { type: "fit-add", index: 1, point: { x: 5, y: 5 } }],
    });
    expect(refused).toMatchObject({ changes: [], editedHandles: [], rejected: [{ handle: "10", reason: "requires-fit-definition" }], appliedActions: [] });
    expect(document.entities).toEqual([source]);
    const locked = executeSplineEdit({ ...document, layers: document.layers.map((layer) => ({ ...layer, locked: true })) }, {
      targetHandle: "10",
      actions: [{ type: "reverse" }],
    });
    expect(locked).toMatchObject({ changes: [], editedHandles: [], rejected: [{ handle: "10", reason: "locked-layer" }] });
  });

  it("kills periodic CV duplicate, weight and Open/Close mutants", () => {
    const open = executeSpline({ handle: "30", layerId: "0", method: "control-vertices", degree: 3, points })[0];
    if (open?.type !== "put" || open.entity.kind !== "spline") throw new Error("Expected a control-vertex SPLINE.");
    const closed = setSplineClosed(open.entity, true);
    const moved = moveSplineControlVertex(closed, 1, { x: 25, y: 95 });
    const weighted = setSplineControlVertexWeight(moved, 1, 2.25);
    const visibleCount = weighted.controlPoints.length - weighted.degree;
    expect(weighted.controlPoints[1]).toEqual({ x: 25, y: 95 });
    expect(weighted.controlPoints[visibleCount + 1]).toEqual({ x: 25, y: 95 });
    expect(weighted.weights?.[1]).toBe(2.25);
    expect(weighted.weights?.[visibleCount + 1]).toBe(2.25);
    expect(setSplineClosed(weighted, false)).toMatchObject({ closed: false, periodic: false, controlPoints: expect.arrayContaining([{ x: 25, y: 95 }]), weights: [1, 2.25, 1, 1] });
  });

  it("kills in-place, fixed-resolution and midpoint-only Convert to Polyline mutants", () => {
    const source = createFitPointSpline({
      handle: "8D",
      layerId: "0",
      fitPoints: [{ x: 200, y: -300 }, { x: 240, y: -220 }, { x: 310, y: -330 }, { x: 380, y: -250 }],
    });
    const coarse = convertSplineToPolyline(source, "8E", 2);
    const precise = convertSplineToPolyline(source, "8F", 10);
    expect(precise.handle).toBe("8F");
    expect(precise.kind).toBe("polyline");
    expect(precise.vertices.length).toBeGreaterThan(coarse.vertices.length);
    for (const fitPoint of source.fitPoints!) {
      expect(Math.min(...precise.vertices.map((vertex) => Math.hypot(vertex.x - fitPoint.x, vertex.y - fitPoint.y)))).toBeLessThan(1e-8);
    }

    const document = createEmptyDocument({ documentId: "F-012-polyline-mutation", now: "2026-08-31T09:10:00.000Z" });
    document.entities = [source];
    const result = executeSplineEdit(document, { targetHandle: "8D", actions: [{ type: "convert-polyline", precision: 10 }] });
    expect(result.changes[0]).toEqual({ type: "delete", handle: "8D" });
    expect(result.changes[1]).toMatchObject({ type: "put", entity: { kind: "polyline", handle: "8E" } });
    expect(result.editedHandles).toEqual(["8E"]);
  });
});
