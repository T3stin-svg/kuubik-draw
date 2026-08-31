import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { createControlVertexSpline, createFitPointSpline, prepareSplineCommand, splinePointAtParameter } from "../src/spline.js";
import { CadSession } from "../src/transaction.js";

function chordParameters(points: readonly { x: number; y: number }[]): number[] {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let cumulative = 0;
  return [0, ...lengths.map((length) => (cumulative += length) / total)];
}

function pointToPolylineDistance(point: { x: number; y: number }, vertices: readonly { x: number; y: number }[]): number {
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

describe("F-012 SPLINE creation kernel adapted from the WIP branch", () => {
  it("creates clamped control-vertex splines for degrees 1 through 10", () => {
    for (const degree of [1, 3, 10]) {
      const points = Array.from({ length: degree + 2 }, (_unused, index) => ({ x: index * 10, y: index % 2 ? 20 : 0 }));
      const spline = createControlVertexSpline({ handle: `CV-${degree}`, layerId: "0", controlPoints: points, degree });
      expect(spline).toMatchObject({ kind: "spline", degree, controlPoints: points, closed: false, periodic: false });
      expect(spline.extensionData).toMatchObject({ splineDefinition: { method: "control-vertices" } });
      expect(spline.knots).toHaveLength(points.length + degree + 1);
      expect(splinePointAtParameter(spline, 0)).toEqual(points[0]);
      expect(splinePointAtParameter(spline, 1)).toEqual(points.at(-1));
    }
  });

  it("matches the retained AutoCAD natural cubic golden control polygon for three Fit points", () => {
    const spline = createFitPointSpline({
      handle: "AUTOCAD-NATURAL", layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
    });
    expect(spline.controlPoints).toEqual([
      { x: expect.closeTo(0, 8), y: expect.closeTo(0, 8) },
      { x: expect.closeTo(12.363873458541713, 8), y: expect.closeTo(33.53553737561074, 8) },
      { x: expect.closeTo(38.86637713383941, 8), y: expect.closeTo(105.42042891307521, 8) },
      { x: expect.closeTo(78.73224477911864, 8), y: expect.closeTo(36.67467708092686, 8) },
      { x: expect.closeTo(100, 8), y: expect.closeTo(0, 8) },
    ]);
    expect(spline.knots).toEqual([0, 0, 0, 0, expect.closeTo(80.62257748298549 / 172.81802205591435, 10), 1, 1, 1, 1]);
  });

  it("interpolates each open Fit point and retains current-schema definition metadata", () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 50 }, { x: 60, y: -10 }, { x: 90, y: 30 }, { x: 130, y: 0 }];
    const spline = createFitPointSpline({ handle: "FIT", layerId: "0", fitPoints: points, knotParameterization: "chord" });
    chordParameters(points).forEach((parameter, index) => {
      expect(splinePointAtParameter(spline, parameter)).toEqual({ x: expect.closeTo(points[index]!.x, 8), y: expect.closeTo(points[index]!.y, 8) });
    });
    expect(spline.extensionData).toMatchObject({ splineDefinition: { method: "fit-points", fitPoints: points, fitTolerance: 0, knotParameterization: "chord" } });
  });

  it("uses Fit Tolerance as a real deterministic bounded approximation", () => {
    const fitPoints = [{ x: 0, y: 200 }, { x: 20, y: 270 }, { x: 60, y: 190 }, { x: 100, y: 260 }, { x: 140, y: 200 }];
    const exact = createFitPointSpline({ handle: "EXACT", layerId: "0", fitPoints });
    const approximate = createFitPointSpline({ handle: "TOLERANCE", layerId: "0", fitPoints, fitTolerance: 10 });
    expect(approximate.controlPoints).not.toEqual(exact.controlPoints);
    expect(approximate.knots).not.toEqual(exact.knots);
    const samples = Array.from({ length: 2001 }, (_unused, index) => splinePointAtParameter(approximate, index / 2000)!);
    const deviations = fitPoints.map((point) => pointToPolylineDistance(point, samples));
    expect(Math.max(...deviations)).toBeLessThanOrEqual(10);
    expect(Math.max(...deviations)).toBeGreaterThan(9.5);
    expect(deviations[0]).toBeLessThan(1e-8);
    expect(deviations.at(-1)).toBeLessThan(1e-8);

    const document = createEmptyDocument({ documentId: "fit-tolerance-preview-commit" });
    const input = { method: "fit" as const, handle: "20", layerId: "0", points: fitPoints, fitTolerance: 10 };
    const preview = prepareSplineCommand(document, input);
    const commit = prepareSplineCommand(document, input);
    expect(commit.entity).toEqual(preview.entity);
    expect(commit.entity.controlPoints).toEqual(approximate.controlPoints);
  });

  it("supports normalized endpoint tangents and closed periodic Fit/CV variants", () => {
    const tangent = createFitPointSpline({
      handle: "TANGENT", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }],
      startTangent: { x: 10, y: 0 }, endTangent: { x: 10, y: 0 },
    });
    expect(tangent.extensionData).toMatchObject({ splineDefinition: { startTangent: { x: 1, y: 0 }, endTangent: { x: 1, y: 0 } } });

    const points = [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 100 }, { x: -20, y: 70 }];
    const fit = createFitPointSpline({ handle: "CLOSED-FIT", layerId: "0", fitPoints: points, closed: true });
    const cv = createControlVertexSpline({ handle: "CLOSED-CV", layerId: "0", controlPoints: points, degree: 3, closed: true });
    expect(fit).toMatchObject({ closed: true, periodic: true });
    expect(cv).toMatchObject({ closed: true, periodic: true });
    expect(splinePointAtParameter(fit, 0)).toEqual({ x: expect.closeTo(0, 8), y: expect.closeTo(0, 8) });
    expect(splinePointAtParameter(fit, 1)).toEqual({ x: expect.closeTo(0, 8), y: expect.closeTo(0, 8) });
  });

  it("converts an eligible open polyline through SPLINE Object and preserves properties", () => {
    const document = createEmptyDocument({ documentId: "spline-object" });
    document.entities.push({
      kind: "polyline", handle: "10", layerId: "0", closed: false,
      appearance: { color: "#00ff00" }, extensionData: { source: "PEDIT-spline-fit" },
      vertices: [{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 70, y: -20 }, { x: 100, y: 0 }],
    });
    const result = prepareSplineCommand(document, { method: "object", handle: "20", sourceHandle: "10" });
    expect(result).toMatchObject({ commandId: "SPLINE", targetHandles: ["10"], resultHandles: ["20"] });
    expect(result.changes).toMatchObject([{ type: "delete", handle: "10" }, { type: "put", entity: { kind: "spline", handle: "20", appearance: { color: "#00ff00" } } }]);
    expect(result.entity.extensionData).toMatchObject({ source: "PEDIT-spline-fit", splineDefinition: { method: "control-vertices" } });
  });

  it("has preview=commit preparation and atomic Undo/Redo for Object replacement", () => {
    const document = createEmptyDocument({ documentId: "spline-atomic" });
    document.entities.push({ kind: "polyline", handle: "10", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: 50, y: 0 }, { x: 80, y: 20 }] });
    const input = { method: "object" as const, handle: "20", sourceHandle: "10" };
    const preview = prepareSplineCommand(document, input);
    const commitPreparation = prepareSplineCommand(document, input);
    expect(commitPreparation).toEqual(preview);
    const session = new CadSession(document);
    session.commit({ opId: "spline:1", baseRevision: 0, commandId: "SPLINE", args: input, targetHandles: preview.targetHandles, resultHandles: preview.resultHandles }, preview.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["20"]);
    session.undo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10"]);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["20"]);
  });

  it.each([
    () => createControlVertexSpline({ handle: "BAD", layerId: "0", controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }], degree: 3 }),
    () => createFitPointSpline({ handle: "BAD", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }] }),
    () => createFitPointSpline({ handle: "BAD", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], fitTolerance: -1 }),
    () => createFitPointSpline({ handle: "BAD", layerId: "0", fitPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], closed: true, startTangent: { x: 1, y: 0 } }),
  ])("rejects a mutated invalid input before changes", (mutation) => {
    expect(mutation).toThrow();
  });
});
