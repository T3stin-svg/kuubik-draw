import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadEllipse, CadEntity, CadLine, CadPolyline, CadSpline } from "@kuubik/cad-schema";
import { CadCommandInputError, CadSession, createEmptyDocument, executeTrim, extendCadEntity, parseCadHandleList, parseTrimTargetPicks, resolveCadCommand, trimCadEntity, trimCurvesOfEntity, trimPointAt } from "../src/index.js";

const vertical = (handle: string, x: number, y1 = -100, y2 = 100): CadLine => ({
  kind: "line",
  handle,
  layerId: "0",
  start: { x, y: y1 },
  end: { x, y: y2 },
});

describe("TRIM analytical geometry", () => {
  it("removes the picked interval of a line between multiple cutting edges", () => {
    const target: CadLine = {
      kind: "line",
      handle: "10",
      layerId: "walls",
      appearance: { color: "#ff0000", linetypeId: "DASHED", lineweightMm: 0.35 },
      extensionData: { owner: "F-022" },
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    };
    const before = structuredClone(target);
    const result = trimCadEntity(target, { x: 50, y: 0 }, [vertical("20", 25), vertical("21", 75)]);

    expect(result).toMatchObject({
      reason: null,
      removedInterval: { start: 0.25, end: 0.75, wraps: false },
      intersectionPoints: [{ x: 25, y: 0 }, { x: 75, y: 0 }],
      entities: [
        { kind: "line", handle: "10", layerId: "walls", start: { x: 0, y: 0 }, end: { x: 25, y: 0 }, appearance: target.appearance, extensionData: target.extensionData },
        { kind: "line", handle: "10", layerId: "walls", start: { x: 75, y: 0 }, end: { x: 100, y: 0 }, appearance: target.appearance, extensionData: target.extensionData },
      ],
    });
    expect(target).toEqual(before);
    expect(result.entities[0]?.appearance).not.toBe(target.appearance);
    expect(result.entities[0]?.extensionData).not.toBe(target.extensionData);
  });

  it("trims a line end at one cutting edge", () => {
    const target: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    expect(trimCadEntity(target, { x: 10, y: 0 }, [vertical("20", 25)])).toMatchObject({
      reason: null,
      entities: [{ kind: "line", start: { x: 25, y: 0 }, end: { x: 100, y: 0 } }],
    });
  });

  it("requires two cuts for a closed circle and returns the complementary arc", () => {
    const target: CadCircle = { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 };
    const result = trimCadEntity(target, { x: 10, y: 0 }, [vertical("20", 5)]);
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({ kind: "arc", handle: "10", center: { x: 0, y: 0 }, radius: 10, counterClockwise: true });
    expect(result.intersectionPoints).toHaveLength(2);
    expect(result.removedInterval?.wraps).toBe(true);
  });

  it("trims an open clockwise arc without changing its orientation", () => {
    const target: CadArc = {
      kind: "arc",
      handle: "10",
      layerId: "0",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngleRad: 0,
      endAngleRad: Math.PI,
      counterClockwise: false,
    };
    const result = trimCadEntity(target, { x: 0, y: -10 }, [vertical("20", -5), vertical("21", 5)]);
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(2);
    expect(result.entities.every((entity) => entity.kind === "arc" && !entity.counterClockwise)).toBe(true);
  });

  it("splits a full ellipse analytically against a line", () => {
    const target: CadEllipse = {
      kind: "ellipse",
      handle: "10",
      layerId: "0",
      center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 },
      ratio: 0.5,
      startParameter: 0,
      endParameter: Math.PI * 2,
    };
    const result = trimCadEntity(target, { x: 10, y: 0 }, [vertical("20", 0)]);
    expect(result).toMatchObject({ reason: null, entities: [{ kind: "ellipse", handle: "10", ratio: 0.5 }] });
    expect(result.intersectionPoints).toEqual([{ x: 0, y: 5 }, { x: 0, y: -5 }]);
  });

  it("splits an open rational spline with exact knot insertion", () => {
    const target: CadSpline = {
      kind: "spline", handle: "10", layerId: "splines",
      appearance: { color: "#00ff00", lineweightMm: 0.35 }, extensionData: { rowId: "F-022" },
      degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 100 }, { x: 200 / 3, y: -100 }, { x: 100, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
    };
    const before = structuredClone(target);
    const result = trimCadEntity(target, { x: 50, y: 0 }, [vertical("20", 25), vertical("21", 75)]);
    expect(result.reason).toBeNull();
    expect(result.intersectionPoints).toEqual([{ x: 25, y: 28.125 }, { x: 75, y: -28.125 }]);
    expect(result.entities).toHaveLength(2);
    const [left, right] = result.entities as CadSpline[];
    expect(left).toMatchObject({ kind: "spline", handle: "10", degree: 3, closed: false, periodic: false, appearance: target.appearance, extensionData: target.extensionData });
    expect(left.controlPoints.at(-1)).toEqual({ x: 25, y: 28.125 });
    expect(right.controlPoints[0]).toEqual({ x: 75, y: -28.125 });
    expect(left.knots).toEqual([0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25]);
    expect(right.knots).toEqual([0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1]);
    expect(left.weights).toEqual([2, 2, 2, 2]);
    expect(right.weights).toEqual([2, 2, 2, 2]);
    expect(target).toEqual(before);
  });

  it("finds a spline-line tangency between tessellation samples", () => {
    const tangentParameter = 0.37;
    const target: CadSpline = {
      kind: "spline", handle: "10", layerId: "splines", degree: 2,
      controlPoints: [
        { x: 0, y: tangentParameter ** 2 },
        { x: 0.5, y: tangentParameter ** 2 - tangentParameter },
        { x: 1, y: (1 - tangentParameter) ** 2 },
      ],
      knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false,
    };
    const horizontal: CadLine = {
      kind: "line", handle: "20", layerId: "0",
      start: { x: -1, y: 0 }, end: { x: 2, y: 0 },
    };

    const result = trimCadEntity(target, { x: 0.1, y: 0.08 }, [horizontal]);

    expect(result.reason).toBeNull();
    expect(result.intersectionPoints).toHaveLength(1);
    expect(result.intersectionPoints[0]?.x).toBeCloseTo(tangentParameter, 7);
    expect(result.intersectionPoints[0]?.y).toBeCloseTo(0, 8);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.kind).toBe("spline");
  });

  it("finds the same tangency when the cutting line is encoded as a linear spline", () => {
    const tangentParameter = 0.37;
    const target: CadSpline = {
      kind: "spline", handle: "10", layerId: "splines", degree: 2,
      controlPoints: [
        { x: 0, y: tangentParameter ** 2 },
        { x: 0.5, y: tangentParameter ** 2 - tangentParameter },
        { x: 1, y: (1 - tangentParameter) ** 2 },
      ],
      knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false,
    };
    const boundary: CadSpline = {
      kind: "spline", handle: "20", layerId: "splines", degree: 1,
      controlPoints: [{ x: -1, y: 0 }, { x: 2, y: 0 }],
      knots: [0, 0, 1, 1], closed: false, periodic: false,
    };

    const result = trimCadEntity(target, { x: 0.1, y: 0.08 }, [boundary]);

    expect(result.reason).toBeNull();
    expect(result.intersectionPoints).toHaveLength(1);
    expect(result.intersectionPoints[0]?.x).toBeCloseTo(tangentParameter, 7);
    expect(result.intersectionPoints[0]?.y).toBeCloseTo(0, 8);
  });

  it("finds an ellipse-circle tangency between numeric samples", () => {
    const target: CadEllipse = {
      kind: "ellipse", handle: "10", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2,
    };
    const angle = 0.37 * Math.PI * 2;
    const tangentPoint = { x: 10 * Math.cos(angle), y: 5 * Math.sin(angle) };
    const rawNormal = { x: Math.cos(angle) / 10, y: Math.sin(angle) / 5 };
    const normalLength = Math.hypot(rawNormal.x, rawNormal.y);
    const radius = 3;
    const boundary: CadCircle = {
      kind: "circle", handle: "20", layerId: "0", radius,
      center: {
        x: tangentPoint.x + radius * rawNormal.x / normalLength,
        y: tangentPoint.y + radius * rawNormal.y / normalLength,
      },
    };

    const result = trimCadEntity(target, tangentPoint, [boundary]);

    expect(result.reason).toBe("ambiguous-tangent");
    expect(result.intersectionPoints).toHaveLength(1);
    expect(result.intersectionPoints[0]?.x).toBeCloseTo(tangentPoint.x, 6);
    expect(result.intersectionPoints[0]?.y).toBeCloseTo(tangentPoint.y, 6);
  });

  it("splits a non-uniform rational spline without losing valid knot or weight topology", () => {
    const target: CadSpline = {
      kind: "spline", handle: "10", layerId: "splines", degree: 2,
      controlPoints: [
        { x: 0, y: 0 }, { x: 20, y: 30 }, { x: 45, y: -10 },
        { x: 70, y: 25 }, { x: 100, y: 0 },
      ],
      knots: [0, 0, 0, 0.4, 0.7, 1, 1, 1],
      weights: [1, 0.75, 1.5, 0.8, 1.25], closed: false, periodic: false,
    };
    const curve = trimCurvesOfEntity(target)[0]!;
    const firstCut = trimPointAt(curve, 0.25);
    const secondCut = trimPointAt(curve, 0.75);
    const before = structuredClone(target);

    const result = trimCadEntity(target, trimPointAt(curve, 0.5), [
      vertical("20", firstCut.x, firstCut.y - 100, firstCut.y + 100),
      vertical("21", secondCut.x, secondCut.y - 100, secondCut.y + 100),
    ]);

    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(2);
    for (const entity of result.entities) {
      expect(entity.kind).toBe("spline");
      if (entity.kind !== "spline") continue;
      expect(entity.knots).toHaveLength(entity.controlPoints.length + entity.degree + 1);
      expect(entity.weights).toHaveLength(entity.controlPoints.length);
      expect(entity.weights?.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
      expect(entity.knots.every((knot, index) => index === 0 || knot >= entity.knots[index - 1]!)).toBe(true);
    }
    expect(target).toEqual(before);
  });

  it("opens a closed linear spline and joins the exact complement across its seam", () => {
    const target: CadSpline = {
      kind: "spline", handle: "10", layerId: "0", degree: 1,
      controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }],
      knots: [0, 0, 1, 2, 3, 4, 4], closed: true, periodic: false,
    };
    const result = trimCadEntity(target, { x: 10, y: 5 }, [vertical("20", 5, -5, 15)]);
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(1);
    const output = result.entities[0] as CadSpline;
    expect(output).toMatchObject({ kind: "spline", degree: 1, closed: false, periodic: false });
    expect(output.controlPoints[0]).toEqual({ x: 5, y: 10 });
    expect(output.controlPoints.at(-1)).toEqual({ x: 5, y: 0 });
    expect(output.knots.length).toBe(output.controlPoints.length + output.degree + 1);
  });

  it("preserves an open bulged polyline and interpolates widths at both cut points", () => {
    const target: CadPolyline = {
      kind: "polyline",
      handle: "10",
      layerId: "0",
      appearance: { color: "#00ff00" },
      closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 6 },
        { x: 100, y: 0, bulge: 1 },
        { x: 200, y: 0 },
      ],
    };
    const result = trimCadEntity(target, { x: 50, y: 0 }, [vertical("20", 25), vertical("21", 75)]);
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toMatchObject({
      kind: "polyline",
      closed: false,
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 3 }, { x: 25, y: 0, startWidth: 2, endWidth: 3 }],
      appearance: target.appearance,
    });
    expect(result.entities[1]).toMatchObject({
      kind: "polyline",
      closed: false,
      vertices: [{ x: 75, y: 0, startWidth: 5, endWidth: 6 }, { x: 100, y: 0, bulge: 1 }, { x: 200, y: 0 }],
    });
  });

  it("opens a closed polyline and keeps the complement of the picked interval", () => {
    const target: CadPolyline = {
      kind: "polyline",
      handle: "10",
      layerId: "0",
      closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    };
    const boundary: CadLine = { kind: "line", handle: "20", layerId: "0", start: { x: -5, y: 5 }, end: { x: 15, y: 5 } };
    const result = trimCadEntity(target, { x: 5, y: 10 }, [boundary]);
    expect(result).toMatchObject({
      reason: null,
      entities: [{
        kind: "polyline",
        closed: false,
        vertices: [{ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
      }],
    });
  });

  it("supports Edge Extend without treating the boundary as a finite segment", () => {
    const target: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const shortBoundary = vertical("20", 50, 10, 20);
    expect(trimCadEntity(target, { x: 10, y: 0 }, [shortBoundary], { edgeMode: "no-extend" }).reason).toBe("no-intersection");
    expect(trimCadEntity(target, { x: 10, y: 0 }, [shortBoundary], { edgeMode: "extend" })).toMatchObject({
      reason: null,
      entities: [{ kind: "line", start: { x: 50, y: 0 }, end: { x: 100, y: 0 } }],
    });
  });

  it("rejects tangency, absent cuts, unsupported entities and invalid picks without mutation", () => {
    const circle: CadCircle = { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 };
    expect(trimCadEntity(circle, { x: 0, y: 10 }, [vertical("20", 10)]).reason).toBe("ambiguous-tangent");
    expect(trimCadEntity(circle, { x: 0, y: 10 }, [vertical("20", 20)]).reason).toBe("no-intersection");
    const proxy: CadEntity = { kind: "proxy", handle: "30", layerId: "0", originalType: "ACAD_PROXY_ENTITY", raw: {} };
    expect(trimCadEntity(proxy, { x: 0, y: 0 }, [vertical("20", 0)]).reason).toBe("unsupported-target");
    expect(trimCadEntity(circle, { x: Number.NaN, y: 0 }, [vertical("20", 0)]).reason).toBe("degenerate-geometry");
  });

  it("matches AutoCAD by ignoring HATCH display loops as cutting edges and refusing HATCH targets", () => {
    const target: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 50 }, end: { x: 100, y: 50 } };
    const hatch: CadEntity = {
      kind: "hatch", handle: "20", layerId: "0", pattern: "SOLID", associative: false,
      loops: [{ isHole: false, vertices: [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }] }],
    };
    expect(trimCadEntity(target, { x: 50, y: 50 }, [hatch])).toMatchObject({ reason: "no-intersection", entities: [] });
    expect(trimCadEntity(hatch, { x: 25, y: 50 }, [target]).reason).toBe("unsupported-target");
  });
});

describe("TRIM Shift-Extend geometry", () => {
  it("extends the picked line endpoint to the nearest boundary", () => {
    const target: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } };
    expect(extendCadEntity(target, { x: 20, y: 0 }, [vertical("20", 0), vertical("21", 100)])).toMatchObject({
      reason: null,
      endpoint: "start",
      intersectionPoint: { x: 0, y: 0 },
      entity: { kind: "line", start: { x: 0, y: 0 }, end: { x: 80, y: 0 } },
    });
    expect(extendCadEntity(target, { x: 80, y: 0 }, [vertical("20", 0), vertical("21", 100)])).toMatchObject({
      reason: null,
      endpoint: "end",
      intersectionPoint: { x: 100, y: 0 },
      entity: { kind: "line", start: { x: 20, y: 0 }, end: { x: 100, y: 0 } },
    });
  });

  it("extends open arc, ellipse and polyline supports while rejecting closed curves", () => {
    const arc: CadArc = { kind: "arc", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true };
    const extendedArc = extendCadEntity(arc, { x: 0, y: 10 }, [vertical("20", -10)]);
    expect(extendedArc).toMatchObject({
      reason: null,
      endpoint: "end",
      entity: { kind: "arc", counterClockwise: true },
    });
    expect(extendedArc.entity?.kind === "arc" ? extendedArc.entity.endAngleRad : Number.NaN).toBeCloseTo(Math.PI, 11);
    const ellipse: CadEllipse = { kind: "ellipse", handle: "11", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 };
    const extendedEllipse = extendCadEntity(ellipse, { x: 0, y: 5 }, [vertical("20", -10)]);
    expect(extendedEllipse).toMatchObject({
      reason: null,
      entity: { kind: "ellipse" },
    });
    expect(extendedEllipse.entity?.kind === "ellipse" ? extendedEllipse.entity.endParameter : Number.NaN).toBeCloseTo(Math.PI, 11);
    const polyline: CadPolyline = { kind: "polyline", handle: "12", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] };
    expect(extendCadEntity(polyline, { x: 20, y: 0 }, [vertical("20", 30)])).toMatchObject({
      reason: null,
      entity: { kind: "polyline", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 }] },
    });
    const circle: CadCircle = { kind: "circle", handle: "13", layerId: "0", center: { x: 0, y: 0 }, radius: 10 };
    expect(extendCadEntity(circle, { x: 10, y: 0 }, [vertical("20", 20)]).reason).toBe("unsupported-target");
  });
});

describe("TRIM command transaction", () => {
  it("parses deterministic handle@x,y target sequences and cutting-edge lists", () => {
    expect(parseTrimTargetPicks("10@50,0; 11@50,20")).toEqual([
      { handle: "10", pickPoint: { x: 50, y: 0 }, action: "trim" },
      { handle: "11", pickPoint: { x: 50, y: 20 }, action: "trim" },
    ]);
    expect(parseTrimTargetPicks("10@5,0", "erase")).toEqual([
      { handle: "10", pickPoint: { x: 5, y: 0 }, action: "erase" },
    ]);
    expect(parseCadHandleList("20, 21;20\n22")).toEqual(["20", "21", "22"]);
    expect(() => parseTrimTargetPicks("10,50,0")).toThrow(CadCommandInputError);
    expect(() => parseTrimTargetPicks(" ")).toThrow(CadCommandInputError);
  });

  it("resolves TR/TRIM and commits multiple targets as one atomic undo step", () => {
    expect(resolveCadCommand("tr")?.id).toBe("TRIM");
    expect(resolveCadCommand(" TRIM ")?.id).toBe("TRIM");
    const document = createEmptyDocument({ documentId: "trim-standard" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 20 }, end: { x: 100, y: 20 } },
      vertical("20", 25),
      vertical("21", 75),
    );
    const args = {
      mode: "standard" as const,
      cuttingEdgeHandles: ["20", "21"],
      targets: [
        { handle: "10", pickPoint: { x: 50, y: 0 } },
        { handle: "11", pickPoint: { x: 50, y: 20 } },
      ],
      edgeMode: "no-extend" as const,
      projectMode: "none" as const,
    };
    const result = executeTrim(document, args);
    expect(result).toMatchObject({
      rejected: [],
      targetHandles: ["10", "11"],
      resultHandles: ["10", "22", "11", "23"],
      steps: [
        { action: "trim", sourceHandle: "10", resultHandles: ["10", "22"] },
        { action: "trim", sourceHandle: "11", resultHandles: ["11", "23"] },
      ],
    });
    expect(result.changes).toHaveLength(4);
    expect(document.entities).toHaveLength(4);

    const session = new CadSession(document);
    session.commit({
      opId: "F-022",
      baseRevision: 0,
      commandId: "TRIM",
      args,
      targetHandles: result.targetHandles,
      resultHandles: result.resultHandles,
    }, result.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "20", "21", "22", "23"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);

    const locallyUndone = executeTrim(document, { ...args, targets: args.targets.slice(0, -1) });
    expect(locallyUndone.steps).toHaveLength(1);
    expect(locallyUndone.resultHandles).toEqual(["10", "22"]);
    expect(args.targets).toHaveLength(2);
  });

  it("supports explicit Erase and Quick-mode no-intersection erase", () => {
    const document = createEmptyDocument({ documentId: "trim-erase" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 100 }, end: { x: 10, y: 100 } },
    );
    const quick = executeTrim(document, {
      mode: "quick",
      cuttingEdgeHandles: [],
      targets: [{ handle: "10", pickPoint: { x: 5, y: 0 } }],
      edgeMode: "no-extend",
      projectMode: "view",
    });
    expect(quick).toMatchObject({
      changes: [{ type: "delete", handle: "10" }],
      steps: [{ action: "quick-erase", sourceHandle: "10" }],
    });
    const erased = executeTrim(document, {
      mode: "standard",
      cuttingEdgeHandles: ["20"],
      targets: [{ handle: "10", pickPoint: { x: 5, y: 0 }, action: "erase" }],
      edgeMode: "extend",
      projectMode: "ucs",
    });
    expect(erased).toMatchObject({
      changes: [{ type: "delete", handle: "10" }],
      steps: [{ action: "erase", sourceHandle: "10" }],
    });
    const session = new CadSession(document);
    session.commit({ opId: "F-022-quick", baseRevision: 0, commandId: "TRIM", args: {}, targetHandles: ["10"], resultHandles: [] }, quick.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["20"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
  });

  it("routes Shift-Extend through the same ordered atomic command", () => {
    const document = createEmptyDocument({ documentId: "trim-extend" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } },
      vertical("20", 100),
    );
    const result = executeTrim(document, {
      mode: "standard",
      cuttingEdgeHandles: ["20"],
      targets: [{ handle: "10", pickPoint: { x: 80, y: 0 }, action: "extend" }],
      edgeMode: "no-extend",
      projectMode: "none",
    });
    expect(result).toMatchObject({
      rejected: [],
      resultHandles: ["10"],
      steps: [{ action: "extend", sourceHandle: "10", resultHandles: ["10"], intersectionPoints: [{ x: 100, y: 0 }] }],
      changes: [{ type: "put", entity: { kind: "line", handle: "10", end: { x: 100, y: 0 } } }],
    });
  });

  it("expands a transformed block container as a cutting boundary and prevents cycles", () => {
    const document = createEmptyDocument({ documentId: "trim-block-boundary" });
    document.blocks.push(
      { id: "cut", name: "CUT", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "child", layerId: "0", start: { x: 0, y: -10 }, end: { x: 0, y: 10 } }] },
      { id: "cycle", name: "CYCLE", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "nested", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
    );
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "blockRef", handle: "20", layerId: "0", blockId: "cut", insertion: { x: 50, y: 0 }, scale: { x: 2, y: 3 }, rotationRad: 0 },
      { kind: "blockRef", handle: "21", layerId: "0", blockId: "cycle", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 },
    );
    const result = executeTrim(document, {
      mode: "standard", cuttingEdgeHandles: ["20", "21"],
      targets: [{ handle: "10", pickPoint: { x: 10, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    });
    expect(result).toMatchObject({
      rejected: [],
      changes: [{ type: "put", entity: { kind: "line", handle: "10", start: { x: 50, y: 0 }, end: { x: 100, y: 0 } } }],
    });
  });

  it("filters nested block cutting geometry by its effective visible and thawed layer", () => {
    const document = createEmptyDocument({ documentId: "trim-block-layer-visibility" });
    document.layers.push(
      { id: "insert", name: "INSERT", visible: true, frozen: false, locked: false, plottable: true },
      { id: "hidden", name: "HIDDEN_CHILD", visible: false, frozen: false, locked: false, plottable: true },
      { id: "frozen", name: "FROZEN_CHILD", visible: true, frozen: true, locked: false, plottable: true },
    );
    document.blocks.push({
      id: "layered-cut",
      name: "LAYERED_CUT",
      basePoint: { x: 0, y: 0 },
      entities: [
        { kind: "line", handle: "inherited", layerId: "0", start: { x: 25, y: -10 }, end: { x: 25, y: 10 } },
        { kind: "line", handle: "hidden-child", layerId: "hidden", start: { x: 50, y: -10 }, end: { x: 50, y: 10 } },
        { kind: "line", handle: "frozen-child", layerId: "frozen", start: { x: 75, y: -10 }, end: { x: 75, y: 10 } },
      ],
    });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "blockRef", handle: "20", layerId: "insert", blockId: "layered-cut", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 },
    );

    const result = executeTrim(document, {
      mode: "standard",
      cuttingEdgeHandles: ["20"],
      targets: [{ handle: "10", pickPoint: { x: 10, y: 0 } }],
      edgeMode: "no-extend",
      projectMode: "none",
    });

    expect(result.rejected).toEqual([]);
    expect(result.steps).toMatchObject([{ intersectionPoints: [{ x: 25, y: 0 }] }]);
    expect(result.changes).toEqual([
      { type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 25, y: 0 }, end: { x: 100, y: 0 } } },
    ]);
  });

  it("keeps circle, arc and ellipse boundaries under a non-uniform block transform", () => {
    const document = createEmptyDocument({ documentId: "trim-non-uniform-conic-boundaries" });
    document.blocks.push({
      id: "conics",
      name: "CONICS",
      basePoint: { x: 0, y: 0 },
      entities: [
        { kind: "circle", handle: "circle", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
        { kind: "arc", handle: "arc", layerId: "0", center: { x: 0, y: 30 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
        { kind: "ellipse", handle: "ellipse", layerId: "0", center: { x: 0, y: 60 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
      ],
    });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: -30, y: 0 }, end: { x: 30, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: -30, y: 35 }, end: { x: 30, y: 35 } },
      { kind: "line", handle: "12", layerId: "0", start: { x: -30, y: 60 }, end: { x: 30, y: 60 } },
      { kind: "blockRef", handle: "20", layerId: "0", blockId: "conics", insertion: { x: 0, y: 0 }, scale: { x: 2, y: 1 }, rotationRad: 0 },
    );

    const result = executeTrim(document, {
      mode: "standard",
      cuttingEdgeHandles: ["20"],
      targets: [
        { handle: "10", pickPoint: { x: 0, y: 0 } },
        { handle: "11", pickPoint: { x: 0, y: 35 } },
        { handle: "12", pickPoint: { x: 0, y: 60 } },
      ],
      edgeMode: "no-extend",
      projectMode: "none",
    });

    expect(result.rejected).toEqual([]);
    expect(result.steps).toMatchObject([
      { action: "trim", sourceHandle: "10" },
      { action: "trim", sourceHandle: "11" },
      { action: "trim", sourceHandle: "12" },
    ]);
    result.steps.forEach((step, index) => {
      expect(step.intersectionPoints).toHaveLength(2);
      step.intersectionPoints.forEach((point) => expect(point.y).toBeCloseTo([0, 35, 60][index]!, 9));
    });
    expect(result.steps.every((step) => step.resultHandles.length === 2)).toBe(true);
    expect(result.changes).toHaveLength(6);
  });

  it("rejects missing, locked and hidden targets without mutating the document", () => {
    const document = createEmptyDocument({ documentId: "trim-reject" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
    );
    document.entities.push(
      { kind: "line", handle: "10", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "line", handle: "11", layerId: "hidden", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      vertical("20", 50),
    );
    const before = structuredClone(document);
    const result = executeTrim(document, {
      mode: "standard",
      cuttingEdgeHandles: ["20"],
      targets: [
        { handle: "missing", pickPoint: { x: 0, y: 0 } },
        { handle: "10", pickPoint: { x: 25, y: 0 } },
        { handle: "11", pickPoint: { x: 25, y: 0 } },
      ],
      edgeMode: "no-extend",
      projectMode: "none",
    });
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([
      { handle: "missing", targetIndex: 0, reason: "missing" },
      { handle: "10", targetIndex: 1, reason: "locked-layer" },
      { handle: "11", targetIndex: 2, reason: "hidden-layer" },
    ]);
    expect(document).toEqual(before);
  });
});
