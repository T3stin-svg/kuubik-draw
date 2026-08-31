import { describe, expect, it } from "vitest";
import type { CadPoint2, CadSpline } from "@kuubik/cad-schema";
import {
  addSplineControlVertex,
  addSplineFitKink,
  addSplineFitPoint,
  CadSession,
  closestSplineParameter,
  createControlVertexSpline,
  convertSplineToPolyline,
  createEmptyDocument,
  createFitPointSpline,
  deleteSplineFitPoint,
  deleteSplineControlVertex,
  elevateSplineOrder,
  executeSpline,
  executeSplineEdit,
  joinSplineWithLine,
  mirrorCadEntity,
  moveSplineControlVertex,
  moveSplineFitPoint,
  purgeSplineFitData,
  reverseSpline,
  rotateCadEntity,
  resolveCadCommand,
  scaleCadEntity,
  setSplineFitProperties,
  setSplineClosed,
  setSplineControlVertexWeight,
  splinePointAtParameter,
  stretchCadEntity,
  translateCadEntity,
} from "../src/index.js";

const AUTO_CAD_JOIN_SOURCE: CadSpline = {
  kind: "spline",
  handle: "401",
  layerId: "F012_FIT",
  appearance: { colorIndex: 2, lineweight: 50 },
  definitionMethod: "fit-points",
  degree: 3,
  closed: false,
  periodic: false,
  fitPoints: [{ x: 0, y: -3800 }, { x: 40, y: -3760 }, { x: 100, y: -3800 }],
  fitTolerance: 1e-10,
  controlPoints: [
    { x: 0, y: -3800 },
    { x: 12.815484685091203, y: -3781.4369030629814 },
    { x: 41.96757099153979, y: -3739.2104077473214 },
    { x: 79.15849594660654, y: -3778.1683008106793 },
    { x: 100, y: -3800 },
  ],
  knots: [0, 0, 0, 0, 56.568542494923804, 128.6795680042036, 128.6795680042036, 128.6795680042036, 128.6795680042036],
};

describe("F-012 SPLINEDIT Join", () => {
  it("matches the AutoCAD 2024 Fit SPLINE + coincident LINE control polygon within numerical precision", () => {
    const joined = joinSplineWithLine(AUTO_CAD_JOIN_SOURCE, { kind: "line", handle: "402", layerId: "0", start: { x: 100, y: -3800 }, end: { x: 150, y: -3780 } });
    expect(joined).toMatchObject({ handle: "401", layerId: "F012_FIT", appearance: { colorIndex: 2, lineweight: 50 }, definitionMethod: "control-vertices", degree: 3, closed: false, periodic: false });
    expect(joined).not.toHaveProperty("fitPoints");
    expect(joined.controlPoints.slice(-4)).toEqual([
      { x: expect.closeTo(100, 11), y: expect.closeTo(-3800, 11) },
      { x: expect.closeTo(116.66666666666669, 11), y: expect.closeTo(-3793.333333333334, 11) },
      { x: expect.closeTo(133.33333333333334, 11), y: expect.closeTo(-3786.6666666666674, 11) },
      { x: expect.closeTo(150, 11), y: expect.closeTo(-3780.000000000001, 11) },
    ]);
    expect(joined.knots).toEqual([0, 0, 0, 0, 56.568542494923804, 128.6795680042036, 128.6795680042036, 128.6795680042036, 129.6795680042036, 129.6795680042036, 129.6795680042036, 129.6795680042036]);
    expect(joined.weights).toEqual(Array(8).fill(1));
  });

  it("normalizes either LINE direction and both source endpoints", () => {
    const appended = joinSplineWithLine(AUTO_CAD_JOIN_SOURCE, { kind: "line", handle: "A", layerId: "0", start: { x: 150, y: -3780 }, end: { x: 100, y: -3800 } });
    expect(appended.controlPoints.at(-1)).toEqual({ x: 150, y: -3780 });
    const prepended = joinSplineWithLine(AUTO_CAD_JOIN_SOURCE, { kind: "line", handle: "B", layerId: "0", start: { x: -50, y: -3780 }, end: { x: 0, y: -3800 } });
    expect(prepended.controlPoints[0]).toEqual({ x: -50, y: -3780 });
    expect(prepended.controlPoints.at(-1)).toEqual({ x: 100, y: -3800 });
    expect(() => joinSplineWithLine(AUTO_CAD_JOIN_SOURCE, { kind: "line", handle: "C", layerId: "0", start: { x: 101, y: -3800 }, end: { x: 150, y: -3780 } })).toThrow(/coincident endpoints/u);
  });

  it("deletes the joined LINE and preserves the source handle in one typed command", () => {
    const document = createEmptyDocument({ documentId: "F-012-join", now: "2026-08-31T07:50:00.000Z" });
    document.layers.push({ id: "F012_FIT", name: "F012_FIT", visible: true, frozen: false, locked: false, plottable: true });
    document.entities = [AUTO_CAD_JOIN_SOURCE, { kind: "line", handle: "402", layerId: "0", start: { x: 100, y: -3800 }, end: { x: 150, y: -3780 } }];
    const result = executeSplineEdit(document, { targetHandle: "401", actions: [{ type: "join", targetHandles: ["402"] }] });
    expect(result.rejected).toEqual([]);
    expect(result.changes).toEqual([
      { type: "delete", handle: "402" },
      { type: "put", entity: expect.objectContaining({ kind: "spline", handle: "401", controlPoints: expect.any(Array) }) },
    ]);
    expect(executeSplineEdit(document, { targetHandle: "401", actions: [{ type: "join", targetHandles: ["missing"] }] }).rejected).toEqual([{ handle: "missing", reason: "join-target-missing" }]);
  });
});

function evaluate(spline: CadSpline, parameter: number): CadPoint2 {
  const point = splinePointAtParameter(spline, parameter);
  if (!point) throw new Error("Expected a valid SPLINE point.");
  return point;
}

function parameters(points: readonly CadPoint2[]): number[] {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let sum = 0;
  return [0, ...lengths.map((value) => (sum += value) / total)];
}

function pointToPolylineDistance(point: CadPoint2, vertices: readonly CadPoint2[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const start = vertices[index]!;
    const end = vertices[index + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    minimum = Math.min(minimum, Math.hypot(point.x - start.x - ratio * dx, point.y - start.y - ratio * dy));
  }
  return minimum;
}

describe("F-012 SPLINE creation kernel", () => {
  it("wires SPL and SPLINE through the registry into one put change", () => {
    expect(resolveCadCommand("spl")?.id).toBe("SPLINE");
    const command = resolveCadCommand("SPLINE");
    if (!command || command.id !== "SPLINE") throw new Error("SPLINE command is missing from the registry.");
    expect(command.execute({
      handle: "12",
      layerId: "0",
      method: "fit",
      points: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
      knotParameterization: "sqrt-chord",
    })).toEqual(executeSpline({
      handle: "12",
      layerId: "0",
      method: "fit",
      points: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
      knotParameterization: "sqrt-chord",
    }));
    expect(command.execute({ handle: "13", layerId: "0", method: "control-vertices", degree: 2, points: [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }] })).toMatchObject([{
      type: "put",
      entity: { kind: "spline", handle: "13", definitionMethod: "control-vertices", degree: 2 },
    }]);
  });

  it("matches AutoCAD SPLINE Object replacement for an open PEDIT spline-fit polyline", () => {
    const document = createEmptyDocument({ documentId: "F-012-object", now: "2026-08-31T04:50:40.894Z" });
    document.entities = [{
      kind: "polyline", handle: "7D", layerId: "0", closed: false,
      appearance: { color: "#00ff00" }, extensionData: { source: "PEDIT-spline-fit" },
      vertices: [{ x: 200, y: 0 }, { x: 230, y: 50 }, { x: 270, y: -20 }, { x: 320, y: 0 }],
    }];
    const changes = executeSpline({ handle: "8C", method: "object", sourceHandle: "7D" }, document);
    expect(changes).toEqual([
      { type: "delete", handle: "7D" },
      { type: "put", entity: {
        kind: "spline", handle: "8C", layerId: "0", definitionMethod: "control-vertices", degree: 3,
        controlPoints: [{ x: 200, y: 0 }, { x: 230, y: 50 }, { x: 270, y: -20 }, { x: 320, y: 0 }],
        knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false, periodic: false,
        appearance: { color: "#00ff00" }, extensionData: { source: "PEDIT-spline-fit" },
      } },
    ]);
    expect(() => executeSpline({ handle: "8D", method: "object", sourceHandle: "MISSING" }, document)).toThrow(/does not exist/u);
    const bulged = structuredClone(document);
    if (bulged.entities[0]?.kind === "polyline") bulged.entities[0].vertices[1]!.bulge = 0.5;
    expect(() => executeSpline({ handle: "8E", method: "object", sourceHandle: "7D" }, bulged)).toThrow(/without bulges or widths/u);
  });

  it("creates clamped control-vertex splines for AutoCAD degrees 1 through 10", () => {
    for (const degree of [1, 3, 10]) {
      const points = Array.from({ length: degree + 2 }, (_unused, index) => ({ x: index * 10, y: index % 2 ? 20 : 0 }));
      const spline = createControlVertexSpline({ handle: `CV-${degree}`, layerId: "0", controlPoints: points, degree });
      expect(spline).toMatchObject({ definitionMethod: "control-vertices", degree, controlPoints: points, closed: false, periodic: false });
      expect(spline.knots).toHaveLength(points.length + degree + 1);
      expect(evaluate(spline, 0)).toEqual(points[0]);
      expect(evaluate(spline, 1)).toEqual(points.at(-1));
    }
  });

  it("interpolates every chord-parameterized fit point, including the three-point cubic case", () => {
    for (const points of [
      [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
      [{ x: 0, y: 0 }, { x: 20, y: 50 }, { x: 60, y: -10 }, { x: 90, y: 30 }, { x: 130, y: 0 }],
    ]) {
      const spline = createFitPointSpline({ handle: "FIT", layerId: "0", fitPoints: points });
      expect(spline).toMatchObject({ definitionMethod: "fit-points", degree: 3, fitPoints: points, fitTolerance: 0, knotParameterization: "chord" });
      parameters(points).forEach((parameter, index) => expect(evaluate(spline, parameter)).toEqual({
        x: expect.closeTo(points[index]!.x, 8),
        y: expect.closeTo(points[index]!.y, 8),
      }));
    }
  });

  it("matches the AutoCAD 2024 natural cubic control polygon for three Fit points", () => {
    const spline = createFitPointSpline({
      handle: "AUTOCAD-NATURAL",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
    });
    expect(spline.controlPoints).toHaveLength(5);
    expect(spline.controlPoints).toEqual([
      { x: expect.closeTo(0, 8), y: expect.closeTo(0, 8) },
      { x: expect.closeTo(12.363873458541713, 8), y: expect.closeTo(33.53553737561074, 8) },
      { x: expect.closeTo(38.86637713383941, 8), y: expect.closeTo(105.42042891307521, 8) },
      { x: expect.closeTo(78.73224477911864, 8), y: expect.closeTo(36.67467708092686, 8) },
      { x: expect.closeTo(100, 8), y: expect.closeTo(0, 8) },
    ]);
    expect(spline.knots).toEqual([0, 0, 0, 0, expect.closeTo(80.62257748298549 / 172.81802205591435, 10), 1, 1, 1, 1]);
  });

  it("uses non-zero Fit Tolerance as a real bounded approximation instead of metadata only", () => {
    const fitPoints = [{ x: 0, y: 200 }, { x: 20, y: 270 }, { x: 60, y: 190 }, { x: 100, y: 260 }, { x: 140, y: 200 }];
    const exact = createFitPointSpline({ handle: "EXACT", layerId: "0", fitPoints });
    const approximate = createFitPointSpline({ handle: "TOLERANCE", layerId: "0", fitPoints, fitTolerance: 10 });
    expect(approximate).toMatchObject({ fitPoints, fitTolerance: 10, controlPoints: expect.any(Array) });
    expect(approximate.controlPoints).not.toEqual(exact.controlPoints);
    expect(approximate.knots).not.toEqual(exact.knots);
    expect(approximate.controlPoints).toHaveLength(7);
    const samples = Array.from({ length: 2001 }, (_unused, index) => evaluate(approximate, index / 2000));
    const deviations = fitPoints.map((point) => samples.slice(1).reduce((minimum, end, index) => Math.min(
      minimum,
      (() => {
        const start = samples[index]!;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const parameter = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
        return Math.hypot(point.x - (start.x + parameter * dx), point.y - (start.y + parameter * dy));
      })(),
    ), Number.POSITIVE_INFINITY));
    expect(Math.max(...deviations)).toBeLessThanOrEqual(10);
    expect(Math.max(...deviations)).toBeGreaterThan(9.5);
    expect(deviations[0]).toBeLessThan(1e-8);
    expect(deviations.at(-1)).toBeLessThan(1e-8);
  });

  it("creates a closed periodic Fit spline with an exact C2 seam and a closed periodic CV spline", () => {
    const fitPoints = [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 100 }, { x: -20, y: 70 }];
    const fit = createFitPointSpline({ handle: "CLOSED-FIT", layerId: "0", fitPoints, closed: true });
    expect(fit).toMatchObject({ definitionMethod: "fit-points", degree: 3, fitPoints, closed: true, periodic: true });
    const lengths = fitPoints.map((point, index) => Math.hypot(fitPoints[(index + 1) % fitPoints.length]!.x - point.x, fitPoints[(index + 1) % fitPoints.length]!.y - point.y));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    let parameter = 0;
    fitPoints.forEach((point, index) => {
      expect(evaluate(fit, parameter)).toEqual({ x: expect.closeTo(point.x, 8), y: expect.closeTo(point.y, 8) });
      parameter += lengths[index]! / total;
    });
    expect(evaluate(fit, 1)).toEqual({ x: expect.closeTo(fitPoints[0]!.x, 8), y: expect.closeTo(fitPoints[0]!.y, 8) });
    const firstLength = lengths[0]! / total;
    const lastLength = lengths.at(-1)! / total;
    const [first0, first1, first2] = fit.controlPoints;
    const last0 = fit.controlPoints.at(-3)!; const last1 = fit.controlPoints.at(-2)!; const last2 = fit.controlPoints.at(-1)!;
    const derivativeStart = { x: 3 * (first1!.x - first0!.x) / firstLength, y: 3 * (first1!.y - first0!.y) / firstLength };
    const derivativeEnd = { x: 3 * (last2.x - last1.x) / lastLength, y: 3 * (last2.y - last1.y) / lastLength };
    const secondStart = { x: 6 * (first2!.x - 2 * first1!.x + first0!.x) / firstLength ** 2, y: 6 * (first2!.y - 2 * first1!.y + first0!.y) / firstLength ** 2 };
    const secondEnd = { x: 6 * (last2.x - 2 * last1.x + last0.x) / lastLength ** 2, y: 6 * (last2.y - 2 * last1.y + last0.y) / lastLength ** 2 };
    expect(derivativeStart).toEqual({ x: expect.closeTo(derivativeEnd.x, 8), y: expect.closeTo(derivativeEnd.y, 8) });
    expect(secondStart).toEqual({ x: expect.closeTo(secondEnd.x, 7), y: expect.closeTo(secondEnd.y, 7) });

    const cv = createControlVertexSpline({ handle: "CLOSED-CV", layerId: "0", degree: 3, controlPoints: fitPoints, closed: true });
    expect(cv).toMatchObject({ definitionMethod: "control-vertices", degree: 3, closed: true, periodic: true });
    expect(cv.controlPoints).toHaveLength(7);
    expect(evaluate(cv, cv.knots[cv.degree]!)).toEqual({
      x: expect.closeTo(evaluate(cv, cv.knots[cv.controlPoints.length]!).x, 8),
      y: expect.closeTo(evaluate(cv, cv.knots[cv.controlPoints.length]!).y, 8),
    });
  });

  it("honors explicit open Fit start/end tangent vectors while retaining exact fit points", () => {
    const fitPoints = [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 20 }, { x: 140, y: 0 }];
    const startTangent = { x: 180, y: 0 };
    const endTangent = { x: 120, y: -80 };
    const spline = createFitPointSpline({ handle: "TANGENT", layerId: "0", fitPoints, startTangent, endTangent });
    const normalizedStart = { x: 1, y: 0 };
    const endLength = Math.hypot(endTangent.x, endTangent.y);
    const normalizedEnd = { x: endTangent.x / endLength, y: endTangent.y / endLength };
    expect(spline).toMatchObject({ definitionMethod: "fit-points", startTangent: normalizedStart, endTangent: normalizedEnd, closed: false, periodic: false });
    const values = parameters(fitPoints);
    fitPoints.forEach((point, index) => expect(evaluate(spline, values[index]!)).toEqual({
      x: expect.closeTo(point.x, 8),
      y: expect.closeTo(point.y, 8),
    }));
    const firstLength = values[1]!;
    const lastLength = 1 - values.at(-2)!;
    const first0 = spline.controlPoints[0]!; const first1 = spline.controlPoints[1]!;
    const last0 = spline.controlPoints.at(-2)!; const last1 = spline.controlPoints.at(-1)!;
    expect({ x: 3 * (first1.x - first0.x) / firstLength, y: 3 * (first1.y - first0.y) / firstLength }).toEqual({
      x: expect.closeTo(normalizedStart.x, 8), y: expect.closeTo(normalizedStart.y, 8),
    });
    expect({ x: 3 * (last1.x - last0.x) / lastLength, y: 3 * (last1.y - last0.y) / lastLength }).toEqual({
      x: expect.closeTo(normalizedEnd.x, 8), y: expect.closeTo(normalizedEnd.y, 8),
    });
  });

  it("adds AutoCAD Fit Kink as geometry-preserving degree-multiplicity refinement and purges Fit data", () => {
    const source = {
      ...createFitPointSpline({
        handle: "KINK",
        layerId: "A",
        fitPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 70, y: -60 }, { x: 110, y: 60 }, { x: 150, y: 0 }],
      }),
      appearance: { color: "#00ff00", colorMethod: "trueColor" as const },
      extensionData: { rowId: "F-012" },
    };
    const targetParameter = 0.45;
    const targetPoint = evaluate(source, targetParameter);
    const samples = Array.from({ length: 101 }, (_unused, index) => evaluate(source, index / 100));
    const kink = addSplineFitKink(source, targetPoint);
    expect(kink).toMatchObject({
      handle: "KINK",
      layerId: "A",
      definitionMethod: "control-vertices",
      appearance: source.appearance,
      extensionData: source.extensionData,
    });
    expect(kink).not.toHaveProperty("fitPoints");
    expect(kink).not.toHaveProperty("fitTolerance");
    expect(kink.controlPoints).toHaveLength(source.controlPoints.length + source.degree);
    expect(kink.knots).toHaveLength(source.knots.length + source.degree);
    const refinedParameter = closestSplineParameter(kink, targetPoint);
    expect(refinedParameter).toBeCloseTo(targetParameter, 9);
    expect(kink.knots.filter((value) => Math.abs(value - refinedParameter) < 1e-8)).toHaveLength(source.degree);
    expect(kink.controlPoints.some((point) => Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y) < 1e-8)).toBe(true);
    samples.forEach((point, index) => expect(evaluate(kink, index / 100)).toEqual({
      x: expect.closeTo(point.x, 8),
      y: expect.closeTo(point.y, 8),
    }));

    const document = createEmptyDocument({ documentId: "F-012-KINK", now: "2026-08-31T08:45:00.000Z" });
    document.entities = [source];
    const result = executeSplineEdit(document, { targetHandle: source.handle, actions: [{ type: "fit-kink", point: targetPoint }] });
    expect(result).toMatchObject({ editedHandles: [source.handle], rejected: [], appliedActions: [{ type: "fit-kink", point: targetPoint }] });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ type: "put", entity: { definitionMethod: "control-vertices", handle: source.handle } });
  });

  it("matches AutoCAD Refine/Add with one geometry-preserving interior knot insertion", () => {
    const source = {
      ...createControlVertexSpline({
        handle: "CV-ADD",
        layerId: "A",
        degree: 3,
        controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }],
      }),
      appearance: { color: "#00ff00", lineweightMm: 0.35 },
      extensionData: { rowId: "F-012", source: "AutoCAD-Refine-Add" },
    };
    const target = evaluate(source, 0.5);
    const samples = Array.from({ length: 101 }, (_unused, index) => evaluate(source, index / 100));
    const added = addSplineControlVertex(source, target);

    expect(added).toMatchObject({
      handle: source.handle,
      layerId: source.layerId,
      definitionMethod: "control-vertices",
      degree: 3,
      appearance: source.appearance,
      extensionData: source.extensionData,
      controlPoints: [
        { x: 0, y: 0 },
        { x: 15, y: 35 },
        { x: 55, y: 25 },
        { x: 100, y: -10 },
        { x: 120, y: 0 },
      ],
      knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
    });
    const deleted = deleteSplineControlVertex(added, 2);
    expect(deleted).toMatchObject({
      handle: source.handle,
      layerId: source.layerId,
      appearance: source.appearance,
      extensionData: source.extensionData,
      degree: 3,
      controlPoints: [added.controlPoints[0], added.controlPoints[1], added.controlPoints[3], added.controlPoints[4]],
      knots: source.knots,
    });
    samples.forEach((point, index) => expect(evaluate(added, index / 100)).toEqual({
      x: expect.closeTo(point.x, 9),
      y: expect.closeTo(point.y, 9),
    }));
    const elevated = elevateSplineOrder(added, 5);
    expect(elevated.controlPoints).toEqual([
      { x: expect.closeTo(0, 9), y: expect.closeTo(0, 9) },
      { x: expect.closeTo(11.25, 9), y: expect.closeTo(26.25, 9) },
      { x: expect.closeTo(25, 9), y: expect.closeTo(32.5, 9) },
      { x: expect.closeTo(55.625, 9), y: expect.closeTo(21.875, 9) },
      { x: expect.closeTo(88.75, 9), y: expect.closeTo(-1.25, 9) },
      { x: expect.closeTo(105, 9), y: expect.closeTo(-7.5, 9) },
      { x: expect.closeTo(120, 9), y: expect.closeTo(0, 9) },
    ]);
    expect(elevated.knots).toEqual([0, 0, 0, 0, 0, 0.5, 0.5, 1, 1, 1, 1, 1]);
    expect(source.controlPoints).toEqual([{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }]);
    expect(() => addSplineControlVertex(source, source.controlPoints[0]!)).toThrow(/interior point/u);
  });

  it("matches the AutoCAD open multi-span CV Delete index-to-knot matrix", () => {
    const source = createControlVertexSpline({
      handle: "CV-DELETE-MATRIX",
      layerId: "A",
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }],
      weights: [1, 1.2, 0.8, 1],
    });
    const first = addSplineControlVertex(source, evaluate(source, 0.3));
    const refined = addSplineControlVertex(first, evaluate(first, 0.7));
    expect(refined.controlPoints).toHaveLength(6);
    expect(refined.knots).toEqual([0, 0, 0, 0, expect.closeTo(0.3, 9), expect.closeTo(0.7, 9), 1, 1, 1, 1]);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const deleted = deleteSplineControlVertex(refined, index);
      expect(deleted.controlPoints).toEqual(refined.controlPoints.filter((_point, candidate) => candidate !== index));
      expect(deleted.weights).toEqual(refined.weights?.filter((_weight, candidate) => candidate !== index));
      const expectedKnots = [...refined.knots];
      expectedKnots.splice(index <= 2 ? 4 : 5, 1);
      expect(deleted.knots).toEqual(expectedKnots);
    }
    for (const index of [0, 1, 2, 3]) {
      const reduced = deleteSplineControlVertex(source, index);
      expect(reduced).toMatchObject({
        degree: 2,
        controlPoints: source.controlPoints.filter((_point, candidate) => candidate !== index),
        weights: source.weights?.filter((_weight, candidate) => candidate !== index),
        knots: [0, 0, 0, 1, 1, 1],
      });
    }
    const repeated = addSplineControlVertex(addSplineControlVertex(source, evaluate(source, 0.5)), evaluate(source, 0.5));
    expect(repeated.knots).toEqual([0, 0, 0, 0, 0.5, 0.5, 1, 1, 1, 1]);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const deleted = deleteSplineControlVertex(repeated, index);
      expect(deleted.controlPoints).toEqual(repeated.controlPoints.filter((_point, candidate) => candidate !== index));
      expect(deleted.weights).toEqual(repeated.weights?.filter((_weight, candidate) => candidate !== index));
      expect(deleted.knots).toEqual([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
    }
    const quadratic = createControlVertexSpline({
      handle: "CV-DELETE-QUADRATIC",
      layerId: "A",
      degree: 2,
      controlPoints: [{ x: 0, y: 0 }, { x: 20, y: 50 }, { x: 55, y: 25 }, { x: 90, y: -10 }, { x: 120, y: 0 }],
    });
    quadratic.knots = [0, 0, 0, 0.4270400187638943, 0.6594094180738139, 1, 1, 1];
    for (const index of [0, 1, 2, 3, 4]) {
      const deleted = deleteSplineControlVertex(quadratic, index);
      const expectedKnots = [...quadratic.knots];
      expectedKnots.splice(index <= 1 ? 3 : 4, 1);
      expect(deleted.controlPoints).toEqual(quadratic.controlPoints.filter((_point, candidate) => candidate !== index));
      expect(deleted.knots).toEqual(expectedKnots);
    }
    const periodic = createControlVertexSpline({
      handle: "CV-DELETE-PERIODIC",
      layerId: "A",
      degree: 3,
      closed: true,
      controlPoints: [{ x: 0, y: 0 }, { x: 20, y: 50 }, { x: 55, y: 25 }, { x: 90, y: -10 }, { x: 120, y: 0 }, { x: 75, y: -35 }],
      weights: [1, 1.2, 0.8, 1.5, 1, 0.9],
    });
    const periodicDeleted = deleteSplineControlVertex(periodic, 2);
    const periodicUniquePoints = periodic.controlPoints.slice(0, 6).filter((_point, candidate) => candidate !== 2);
    const periodicUniqueWeights = periodic.weights!.slice(0, 6).filter((_weight, candidate) => candidate !== 2);
    expect(periodicDeleted).toMatchObject({ closed: true, periodic: true, degree: 3 });
    expect(periodicDeleted.controlPoints).toEqual([...periodicUniquePoints, ...periodicUniquePoints.slice(0, 3)]);
    expect(periodicDeleted.weights).toEqual([...periodicUniqueWeights, ...periodicUniqueWeights.slice(0, 3)]);
    const compact = periodic.knots.slice(3, 10);
    compact.splice(2, 1);
    const period = compact.at(-1)! - compact[0]!;
    expect(periodicDeleted.knots).toEqual([...compact.slice(2, -1).map((knot) => knot - period), ...compact, ...compact.slice(1, 4).map((knot) => knot + period)]);
    const seamStart = splinePointAtParameter(periodicDeleted, periodicDeleted.knots[3]!)!;
    const seamEnd = splinePointAtParameter(periodicDeleted, periodicDeleted.knots[8]!)!;
    expect(seamStart).toEqual({ x: expect.closeTo(seamEnd.x, 10), y: expect.closeTo(seamEnd.y, 10) });
    expect(() => deleteSplineControlVertex(refined, -1)).toThrow(/outside the control-vertex range/u);
    expect(() => deleteSplineControlVertex({ ...refined, closed: true, periodic: false }, 2)).toThrow(/coherent closed\/periodic/u);
    const linear = createControlVertexSpline({ handle: "CV-DELETE-LINEAR", layerId: "A", degree: 1, controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(() => deleteSplineControlVertex(linear, 0)).toThrow(/linear SPLINE/u);
  });

  it("matches AutoCAD Refine/Elevate order 5 without changing rational geometry", () => {
    const source = createControlVertexSpline({
      handle: "CV-ELEVATE",
      layerId: "A",
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -20 }, { x: 120, y: 0 }],
      weights: [1, 1.5, 0.75, 1],
    });
    const added = addSplineControlVertex(source, evaluate(source, 0.5));
    const samples = Array.from({ length: 201 }, (_unused, index) => evaluate(added, index / 200));
    const elevated = elevateSplineOrder({ ...added, extensionData: { rowId: "F-012" } }, 5);

    expect(elevated).toMatchObject({
      handle: source.handle,
      layerId: source.layerId,
      definitionMethod: "control-vertices",
      degree: 4,
      closed: false,
      periodic: false,
      extensionData: { rowId: "F-012" },
    });
    expect(elevated.controlPoints).toHaveLength(7);
    expect(elevated.knots).toHaveLength(12);
    expect(elevated.knots).toEqual([0, 0, 0, 0, 0, 0.5, 0.5, 1, 1, 1, 1, 1]);
    expect(elevated.weights).toHaveLength(7);
    samples.forEach((point, index) => expect(evaluate(elevated, index / 200)).toEqual({
      x: expect.closeTo(point.x, 8),
      y: expect.closeTo(point.y, 8),
    }));
    expect(() => elevateSplineOrder(added, 4)).toThrow(/integer order from 5 through 26/u);
    expect(() => elevateSplineOrder(added, 27)).toThrow(/integer order from 5 through 26/u);

    const document = createEmptyDocument({ documentId: "F-012-CV-REFINE", now: "2026-08-31T09:20:00.000Z" });
    document.entities = [source];
    const actions = [
      { type: "cv-add", point: evaluate(source, 0.5) },
      { type: "cv-elevate", order: 5 },
    ] as const;
    const result = executeSplineEdit(document, { targetHandle: source.handle, actions });
    expect(result).toMatchObject({
      editedHandles: [source.handle],
      rejected: [],
      appliedActions: actions,
      changes: [{ type: "put", entity: { handle: source.handle, degree: 4, controlPoints: expect.any(Array), knots: expect.any(Array) } }],
    });
    if (result.changes[0]?.type !== "put" || result.changes[0].entity.kind !== "spline") throw new Error("Expected refined SPLINE.");
    expect(result.changes[0].entity.controlPoints).toHaveLength(7);
    expect(result.changes[0].entity.knots).toHaveLength(12);
  });

  it("keeps seeded rational CV families invariant through Add and multi-order Elevate", () => {
    let seed = 0xF012;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let degree = 1; degree <= 5; degree += 1) {
      const controlPoints = Array.from({ length: degree + 3 }, (_unused, index) => ({
        x: index * 30 + random() * 5,
        y: (random() - 0.5) * 120,
      }));
      const source = createControlVertexSpline({
        handle: `SEEDED-${degree}`,
        layerId: "0",
        degree,
        controlPoints,
        weights: controlPoints.map(() => 0.5 + random() * 1.5),
      });
      const before = Array.from({ length: 161 }, (_unused, index) => evaluate(source, index / 160));
      const added = addSplineControlVertex(source, evaluate(source, 0.37));
      const elevated = elevateSplineOrder(added, degree + 3);
      expect(elevated.degree).toBe(degree + 2);
      expect(elevated.weights?.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
      before.forEach((point, index) => expect(evaluate(elevated, index / 160)).toEqual({
        x: expect.closeTo(point.x, 7),
        y: expect.closeTo(point.y, 7),
      }));
      expect(source.controlPoints).toEqual(controlPoints);
    }
  });

  it("rejects invalid degree, weights, tolerance and duplicate fit segments before commit", () => {
    expect(() => createControlVertexSpline({ handle: "1", layerId: "0", controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], degree: 3 })).toThrow(/degree plus one/u);
    expect(() => createControlVertexSpline({ handle: "1", layerId: "0", controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], degree: 1, weights: [1, 0] })).toThrow(/positive/u);
    expect(() => createFitPointSpline({ handle: "2", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }] })).toThrow(/duplicates/u);
    expect(() => createFitPointSpline({ handle: "2", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], fitTolerance: -1 })).toThrow(/non-negative/u);
    expect(() => createFitPointSpline({ handle: "2", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], startTangent: { x: 0, y: 0 } })).toThrow(/non-zero/u);
    expect(() => createFitPointSpline({ handle: "2", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], closed: true, startTangent: { x: 1, y: 0 } })).toThrow(/does not accept/u);
  });

  it("keeps fit data coherent through affine commands and discards stale fit metadata after a CV stretch", () => {
    const source = createFitPointSpline({
      handle: "FIT",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
    });
    const moved = translateCadEntity(source, { x: 10, y: -5 });
    expect(moved).toMatchObject({ kind: "spline", fitPoints: [{ x: 10, y: -5 }, { x: 50, y: 65 }, { x: 110, y: -5 }] });
    const rotated = rotateCadEntity({ ...source, startTangent: { x: 10, y: 0 } }, { x: 0, y: 0 }, Math.PI / 2);
    expect(rotated).toMatchObject({ kind: "spline", fitPoints: [{ x: 0, y: 0 }, { x: -70, y: 40 }, { x: 0, y: 100 }], startTangent: { x: 0, y: 10 } });
    expect(scaleCadEntity(source, { x: 0, y: 0 }, 2)).toMatchObject({ kind: "spline", fitPoints: [{ x: 0, y: 0 }, { x: 80, y: 140 }, { x: 200, y: 0 }] });
    expect(mirrorCadEntity(source, { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ kind: "spline", fitPoints: [{ x: 0, y: 0 }, { x: 40, y: -70 }, { x: 100, y: 0 }] });
    const stretched = stretchCadEntity(source, [{ kind: "crossing-window", points: [{ x: -1, y: -1 }, { x: 1, y: 1 }] }], { x: 5, y: 0 });
    expect(stretched.entity).toMatchObject({ kind: "spline", definitionMethod: "control-vertices" });
    expect(stretched.entity).not.toHaveProperty("fitPoints");
    expect(source.fitPoints).toEqual([{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }]);
  });

  it("reverses Fit and rational CV definitions without changing the evaluated curve", () => {
    const fit = createFitPointSpline({
      handle: "REVERSE-FIT",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 25, y: 60 }, { x: 80, y: 20 }, { x: 120, y: 0 }],
      startTangent: { x: 100, y: 20 },
      endTangent: { x: 70, y: -30 },
    });
    const reversedFit = reverseSpline(fit);
    expect(reversedFit).toMatchObject({
      fitPoints: [...fit.fitPoints!].reverse(),
      startTangent: { x: expect.closeTo(-fit.endTangent!.x, 12), y: expect.closeTo(-fit.endTangent!.y, 12) },
      endTangent: { x: expect.closeTo(-fit.startTangent!.x, 12), y: expect.closeTo(-fit.startTangent!.y, 12) },
    });
    for (const parameter of [0, 0.1, 0.35, 0.7, 1]) {
      expect(evaluate(reversedFit, parameter)).toEqual({
        x: expect.closeTo(evaluate(fit, 1 - parameter).x, 8),
        y: expect.closeTo(evaluate(fit, 1 - parameter).y, 8),
      });
    }

    const cv = createControlVertexSpline({
      handle: "REVERSE-CV",
      layerId: "0",
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: -10 }, { x: 120, y: 0 }],
      weights: [1, 0.6, 1.4, 1],
    });
    const reversedCv = reverseSpline(cv);
    expect(reversedCv.weights).toEqual([1, 1.4, 0.6, 1]);
    for (const parameter of [0, 0.2, 0.5, 0.8, 1]) {
      expect(evaluate(reversedCv, parameter)).toEqual({
        x: expect.closeTo(evaluate(cv, 1 - parameter).x, 8),
        y: expect.closeTo(evaluate(cv, 1 - parameter).y, 8),
      });
    }
  });

  it("edits Fit points/properties and purges Fit data while retaining entity metadata", () => {
    const source = {
      ...createFitPointSpline({
        handle: "EDIT-FIT",
        layerId: "A",
        fitPoints: [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 70, y: 20 }, { x: 100, y: 0 }],
      }),
      appearance: { color: "#ff0000", colorMethod: "trueColor" as const },
      extensionData: { provenance: "F-012" },
    };
    const added = addSplineFitPoint(source, 2, { x: 50, y: 45 });
    expect(added.fitPoints).toHaveLength(5);
    expect(added.fitPoints?.[2]).toEqual({ x: 50, y: 45 });
    const moved = moveSplineFitPoint(added, 1, { x: 25, y: 80 });
    expect(moved.fitPoints?.[1]).toEqual({ x: 25, y: 80 });
    const deleted = deleteSplineFitPoint(moved, 2);
    expect(deleted.fitPoints).toEqual([{ x: 0, y: 0 }, { x: 25, y: 80 }, { x: 70, y: 20 }, { x: 100, y: 0 }]);
    const configured = setSplineFitProperties(deleted, {
      fitTolerance: 0.25,
      knotParameterization: "uniform",
      startTangent: { x: 120, y: 0 },
      endTangent: { x: 80, y: -40 },
    });
    expect(configured).toMatchObject({
      fitTolerance: 0.25,
      knotParameterization: "uniform",
      startTangent: { x: 1, y: 0 },
      endTangent: { x: expect.closeTo(2 / Math.sqrt(5), 12), y: expect.closeTo(-1 / Math.sqrt(5), 12) },
      appearance: source.appearance,
      extensionData: source.extensionData,
    });
    const purged = purgeSplineFitData(configured);
    expect(purged).toMatchObject({ definitionMethod: "control-vertices", appearance: source.appearance, extensionData: source.extensionData });
    expect(purged).not.toHaveProperty("fitPoints");
    for (const parameter of [0, 0.2, 0.5, 0.8, 1]) expect(evaluate(purged, parameter)).toEqual(evaluate(configured, parameter));
    expect(() => deleteSplineFitPoint(createFitPointSpline({ handle: "SHORT", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }] }), 1)).toThrow(/at least three remaining/u);
    expect(() => addSplineFitPoint(source, 9, { x: 0, y: 0 })).toThrow(/outside/u);
  });

  it("wires SPE/SPLINEDIT into one all-or-nothing command and one global Undo step", () => {
    const document = createEmptyDocument({ documentId: "F-012-SPLINEDIT", now: "2026-08-31T07:00:00.000Z" });
    const source = createFitPointSpline({
      handle: "10",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 70, y: 20 }, { x: 100, y: 0 }],
    });
    document.entities = [source];
    const command = resolveCadCommand("SPE");
    if (!command || command.id !== "SPLINEDIT") throw new Error("SPLINEDIT command is missing from the registry.");
    const actions = [
      { type: "fit-add", index: 2, point: { x: 50, y: 45 } },
      { type: "fit-move", index: 1, point: { x: 25, y: 75 } },
      { type: "fit-delete", index: 3 },
      { type: "fit-properties", fitTolerance: 0.1, knotParameterization: "uniform" },
      { type: "reverse" },
    ] as const;
    const result = command.execute(document, { targetHandle: "10", actions });
    expect(result).toMatchObject({ editedHandles: ["10"], rejected: [], changes: [{ type: "put", entity: { handle: "10", fitTolerance: 0.1, knotParameterization: "uniform" } }] });
    expect(result.appliedActions).toEqual(actions);
    const session = new CadSession(document);
    session.commit({
      opId: "F-012-SPLINEDIT-op",
      baseRevision: 0,
      commandId: "SPLINEDIT",
      args: { targetHandle: "10", actions },
      targetHandles: ["10"],
      resultHandles: ["10"],
    }, result.changes, "2026-08-31T07:00:01.000Z");
    expect(session.document.revision).toBe(1);
    expect(session.document.entities[0]).not.toEqual(source);
    expect(session.undo("2026-08-31T07:00:02.000Z")?.operation).toMatchObject({ commandId: "UNDO", args: { originalOpId: "F-012-SPLINEDIT-op" } });
    expect(session.document.entities).toEqual([source]);
    expect(session.redo("2026-08-31T07:00:03.000Z")?.operation.commandId).toBe("SPLINEDIT");
    expect(session.document.revision).toBe(3);

    const cv = createControlVertexSpline({ handle: "20", layerId: "0", controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 70, y: 40 }, { x: 100, y: 0 }] });
    const cvDocument = { ...document, entities: [cv] };
    expect(executeSplineEdit(cvDocument, { targetHandle: "20", actions: [{ type: "fit-delete", index: 1 }] })).toMatchObject({ changes: [], rejected: [{ handle: "20", reason: "requires-fit-definition" }] });
    expect(executeSplineEdit({ ...cvDocument, layers: cvDocument.layers.map((layer) => ({ ...layer, locked: true })) }, { targetHandle: "20", actions: [{ type: "reverse" }] })).toMatchObject({ changes: [], rejected: [{ handle: "20", reason: "locked-layer" }] });
    expect(() => executeSplineEdit(document, { targetHandle: "10", actions: [{ type: "fit-add", index: 99, point: { x: 0, y: 0 } }] })).toThrow(/outside/u);
  });

  it("moves/weights visible CVs coherently and opens/closes both definition methods", () => {
    const openCv = createControlVertexSpline({
      handle: "CV-EDIT",
      layerId: "0",
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: 40 }, { x: 120, y: 0 }],
    });
    const closedCv = setSplineClosed(openCv, true);
    expect(closedCv).toMatchObject({ closed: true, periodic: true });
    expect(closedCv.controlPoints).toHaveLength(7);
    const moved = moveSplineControlVertex(closedCv, 1, { x: 35, y: 90 });
    expect(moved.controlPoints[1]).toEqual({ x: 35, y: 90 });
    expect(moved.controlPoints[5]).toEqual({ x: 35, y: 90 });
    const weighted = setSplineControlVertexWeight(moved, 1, 2.5);
    expect(weighted.weights).toEqual([1, 2.5, 1, 1, 1, 2.5, 1]);
    const reopened = setSplineClosed(weighted, false);
    expect(reopened).toMatchObject({ closed: false, periodic: false, controlPoints: [{ x: 0, y: 0 }, { x: 35, y: 90 }, { x: 80, y: 40 }, { x: 120, y: 0 }], weights: [1, 2.5, 1, 1] });

    const tangentFit = createFitPointSpline({
      handle: "FIT-CLOSE",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 20 }, { x: 140, y: 0 }],
      startTangent: { x: 100, y: 0 },
      endTangent: { x: 80, y: -20 },
    });
    const closedFit = setSplineClosed(tangentFit, true);
    expect(closedFit).toMatchObject({ closed: true, periodic: true, definitionMethod: "fit-points" });
    expect(closedFit).not.toHaveProperty("startTangent");
    expect(closedFit).not.toHaveProperty("endTangent");
    expect(evaluate(closedFit, 0)).toEqual({ x: expect.closeTo(evaluate(closedFit, 1).x, 8), y: expect.closeTo(evaluate(closedFit, 1).y, 8) });
    const openedFit = setSplineClosed(closedFit, false);
    expect(openedFit).toMatchObject({ closed: false, periodic: false, fitPoints: tangentFit.fitPoints });

    expect(() => moveSplineControlVertex(tangentFit, 0, { x: 1, y: 1 })).toThrow(/control-vertex-defined/u);
    expect(() => setSplineControlVertexWeight(openCv, 0, 0)).toThrow(/positive/u);
  });

  it("executes CV Move/Weight and Close/Open as one typed SPLINEDIT action sequence", () => {
    const document = createEmptyDocument({ documentId: "F-012-CV-EDIT", now: "2026-08-31T07:20:00.000Z" });
    const source = createControlVertexSpline({
      handle: "30",
      layerId: "0",
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 80, y: 40 }, { x: 120, y: 0 }],
    });
    document.entities = [source];
    const result = executeSplineEdit(document, {
      targetHandle: "30",
      actions: [
        { type: "cv-move", index: 1, point: { x: 35, y: 90 } },
        { type: "cv-weight", index: 1, weight: 2.5 },
        { type: "close" },
        { type: "open" },
      ],
    });
    expect(result).toMatchObject({
      rejected: [],
      editedHandles: ["30"],
      changes: [{ type: "put", entity: { kind: "spline", handle: "30", closed: false, periodic: false, controlPoints: [{ x: 0, y: 0 }, { x: 35, y: 90 }, { x: 80, y: 40 }, { x: 120, y: 0 }], weights: [1, 2.5, 1, 1] } }],
    });
    const fit = createFitPointSpline({ handle: "40", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }] });
    expect(executeSplineEdit({ ...document, entities: [fit] }, { targetHandle: "40", actions: [{ type: "cv-weight", index: 0, weight: 2 }] })).toMatchObject({
      changes: [],
      rejected: [{ handle: "40", reason: "requires-control-vertex-definition" }],
    });
  });

  it("converts the measured precision-10 SPLINE to a new-handle bounded linear polyline atomically", () => {
    const source = createFitPointSpline({
      handle: "10",
      layerId: "0",
      fitPoints: [{ x: 200, y: -300 }, { x: 240, y: -220 }, { x: 310, y: -330 }, { x: 380, y: -250 }],
    });
    source.appearance = { color: "#ff0000", lineweightMm: 0.5 };
    source.extensionData = { owner: "F-012" };
    const precision2 = convertSplineToPolyline(source, "11", 2);
    const precision10 = convertSplineToPolyline(source, "12", 10);
    expect(precision10).toMatchObject({
      kind: "polyline",
      handle: "12",
      layerId: "0",
      closed: false,
      appearance: source.appearance,
      extensionData: source.extensionData,
    });
    expect(precision10.vertices.length).toBeGreaterThan(precision2.vertices.length);
    expect(precision10.vertices[0]).toEqual(evaluate(source, source.knots[source.degree]!));
    expect(precision10.vertices.at(-1)).toEqual(evaluate(source, source.knots[source.controlPoints.length]!));
    const maximumDeviation = Array.from({ length: 1001 }, (_unused, index) => {
      const start = source.knots[source.degree]!;
      const end = source.knots[source.controlPoints.length]!;
      return pointToPolylineDistance(evaluate(source, start + (end - start) * index / 1000), precision10.vertices);
    }).reduce((maximum, value) => Math.max(maximum, value), 0);
    expect(maximumDeviation).toBeLessThan(1);

    const document = createEmptyDocument({ documentId: "F-012-CONVERT", now: "2026-08-31T09:00:00.000Z" });
    document.entities = [source];
    const action = { type: "convert-polyline", precision: 10 } as const;
    const result = executeSplineEdit(document, { targetHandle: "10", actions: [action] });
    expect(result).toMatchObject({
      editedHandles: ["11"],
      rejected: [],
      appliedActions: [action],
      changes: [{ type: "delete", handle: "10" }, { type: "put", entity: { kind: "polyline", handle: "11" } }],
    });
    const session = new CadSession(document);
    session.commit({
      opId: "F-012-CONVERT-op",
      baseRevision: 0,
      commandId: "SPLINEDIT",
      args: { targetHandle: "10", actions: [action] },
      targetHandles: ["10"],
      resultHandles: ["11"],
    }, result.changes, "2026-08-31T09:00:01.000Z");
    expect(session.document.entities).toEqual([expect.objectContaining({ kind: "polyline", handle: "11" })]);
    session.undo("2026-08-31T09:00:02.000Z");
    expect(session.document.entities).toEqual([source]);
    session.redo("2026-08-31T09:00:03.000Z");
    expect(session.document.entities).toEqual([expect.objectContaining({ kind: "polyline", handle: "11" })]);

    expect(() => convertSplineToPolyline(source, "12", 10.5)).toThrow(/integer from 0 through 99/u);
    expect(() => executeSplineEdit(document, { targetHandle: "10", actions: [action, { type: "reverse" }] })).toThrow(/final staged action/u);
  });
});
