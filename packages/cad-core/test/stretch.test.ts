import { describe, expect, it } from "vitest";
import type { CadArc, CadEllipse, CadEntity, CadLine, CadPolyline, CadSpline } from "@kuubik/cad-schema";
import {
  CadCommandInputError,
  CadSession,
  createEmptyDocument,
  executeStretch,
  resolveCadCommand,
  stretchCadEntity,
  type StretchRegion,
} from "../src/index.js";

const crossing: StretchRegion = {
  kind: "crossing-window",
  points: [{ x: 40, y: -10 }, { x: 110, y: 20 }],
};
const delta = { x: 25, y: 5 };
const line: CadLine = {
  kind: "line",
  handle: "10",
  layerId: "0",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  appearance: { color: "#ff0000", linetypeId: "dashed", lineweightMm: 0.35 },
  extensionData: { parityRow: "F-027" },
};

describe("F-027 STRETCH clean-room geometry", () => {
  it("moves only a crossing-enclosed line endpoint and preserves source properties", () => {
    const source = structuredClone(line);
    expect(stretchCadEntity(line, [crossing], delta)).toEqual({
      entity: { ...line, end: { x: 125, y: 5 } },
      mode: "stretch",
      movedPointCount: 1,
      selected: true,
      reason: null,
    });
    expect(line).toEqual(source);
  });

  it("moves a fully enclosed object and an individually selected object as whole entities", () => {
    const inside: CadLine = { ...line, start: { x: 60, y: 0 }, end: { x: 80, y: 0 } };
    expect(stretchCadEntity(inside, [crossing], delta)).toMatchObject({
      mode: "move",
      entity: { start: { x: 85, y: 5 }, end: { x: 105, y: 5 } },
    });
    expect(stretchCadEntity(line, [], delta, true)).toMatchObject({
      mode: "move",
      entity: { start: { x: 25, y: 5 }, end: { x: 125, y: 5 } },
    });
  });

  it("unions crossing polygons, preserves widths and scales one-ended arc bulges by chord length", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "20", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0.5, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: -0.25, startWidth: 4, endWidth: 6 },
        { x: 200, y: 0, startWidth: 6, endWidth: 8 },
      ],
    };
    const second: StretchRegion = { kind: "crossing-polygon", points: [{ x: 190, y: -10 }, { x: 210, y: -10 }, { x: 210, y: 10 }, { x: 190, y: 10 }] };
    const result = stretchCadEntity(polyline, [crossing, second], delta);
    expect(result).toMatchObject({ mode: "stretch", movedPointCount: 2, reason: null });
    expect(result.entity).toEqual({
      ...polyline,
      vertices: [
        { ...polyline.vertices[0], bulge: 0.3996803834887157 },
        { ...polyline.vertices[1], x: 125, y: 5 },
        { ...polyline.vertices[2], x: 225, y: 5 },
      ],
    });
  });

  it("moves circle/ellipse centers only after their visible curve is crossing-selected", () => {
    const centerOnly: StretchRegion = { kind: "crossing-window", points: [{ x: -5, y: -5 }, { x: 5, y: 5 }] };
    const centerAndCurve: StretchRegion = { kind: "crossing-window", points: [{ x: -10, y: -10 }, { x: 110, y: 10 }] };
    const circle: CadEntity = { kind: "circle", handle: "30", layerId: "0", center: { x: 0, y: 0 }, radius: 100 };
    const ellipse: CadEntity = { kind: "ellipse", handle: "31", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 };
    for (const entity of [circle, ellipse]) {
      expect(stretchCadEntity(entity, [centerOnly], delta)).toMatchObject({ selected: false, reason: "not-selected" });
      expect(stretchCadEntity(entity, [centerAndCurve], delta)).toMatchObject({ mode: "move", movedPointCount: 1, reason: null });
    }
    const anchored: CadEntity[] = [
      { kind: "blockRef", handle: "32", layerId: "0", blockId: "symbol", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0, attributes: { TAG: "A" } },
      { kind: "text", handle: "33", layerId: "0", position: { x: 0, y: 0 }, text: "A", height: 2.5, rotationRad: 0 },
    ];
    for (const entity of anchored) expect(stretchCadEntity(entity, [centerOnly], delta)).toMatchObject({ mode: "move", movedPointCount: 1, reason: null });
  });

  it("does not treat an arc center or an ellipse midpoint as a command stretch point", () => {
    const arc: CadArc = { kind: "arc", handle: "34", layerId: "0", center: { x: 0, y: 0 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true };
    const centerAndTop: StretchRegion = { kind: "crossing-window", points: [{ x: -10, y: -10 }, { x: 10, y: 110 }] };
    expect(stretchCadEntity(arc, [centerAndTop], delta)).toMatchObject({ selected: false, reason: "not-selected" });

    const ellipse: CadEllipse = { kind: "ellipse", handle: "35", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 };
    const midpoint: StretchRegion = { kind: "crossing-window", points: [{ x: 60, y: 25 }, { x: 80, y: 45 }] };
    expect(stretchCadEntity(ellipse, [midpoint], delta)).toMatchObject({ selected: false, reason: "not-selected" });
  });

  it("matches AutoCAD 2024's transported-sagitta arc stretch", () => {
    const arc: CadArc = { kind: "arc", handle: "40", layerId: "0", center: { x: 0, y: 0 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true };
    const region: StretchRegion = { kind: "crossing-window", points: [{ x: 90, y: -10 }, { x: 110, y: 10 }] };
    const result = stretchCadEntity(arc, [region], delta);
    expect(result).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    if (result.entity?.kind !== "arc") throw new Error("Expected a stretched arc.");
    const point = (angle: number) => ({ x: result.entity!.kind === "arc" ? result.entity.center.x + result.entity.radius * Math.cos(angle) : 0, y: result.entity!.kind === "arc" ? result.entity.center.y + result.entity.radius * Math.sin(angle) : 0 });
    expect(result.entity.center.x).toBeCloseTo(12.7957603151085, 10);
    expect(result.entity.center.y).toBeCloseTo(-10.80921417988332, 10);
    expect(result.entity.radius).toBeCloseTo(113.3125, 10);
    expect(result.entity.startAngleRad).toBeCloseTo(0.139975357410291, 10);
    expect(result.entity.endAngleRad).toBeCloseTo(3.04605442683294, 10);
    expect(point(result.entity.startAngleRad).x).toBeCloseTo(125, 8);
    expect(point(result.entity.startAngleRad).y).toBeCloseTo(5, 8);
    expect(point(result.entity.endAngleRad).x).toBeCloseTo(-100, 8);
    expect(point(result.entity.endAngleRad).y).toBeCloseTo(0, 8);
  });

  it("matches AutoCAD 2024's half, quarter, arbitrary and general ellipse-arc endpoint reconstruction", () => {
    const ellipse: CadEllipse = {
      kind: "ellipse", handle: "41", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI,
    };
    const startRegion: StretchRegion = { kind: "crossing-window", points: [{ x: 90, y: -10 }, { x: 110, y: 10 }] };
    const result = stretchCadEntity(ellipse, [startRegion], delta);
    expect(result).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    if (result.entity?.kind !== "ellipse") throw new Error("Expected a stretched ellipse.");
    expect(result.entity.center.x).toBeCloseTo(12.5, 10);
    expect(result.entity.center.y).toBeCloseTo(2.5, 10);
    expect(result.entity.majorAxis.x).toBeCloseTo(-112.5, 10);
    expect(result.entity.majorAxis.y).toBeCloseTo(-2.5, 10);
    expect(result.entity.ratio).toBeCloseTo(0.444334745702938, 10);
    expect(result.entity.startParameter).toBeCloseTo(Math.PI, 10);
    expect(result.entity.endParameter).toBeCloseTo(Math.PI * 2, 10);

    const quarter = { ...ellipse, handle: "42", endParameter: Math.PI / 2 };
    const quarterResult = stretchCadEntity(quarter, [startRegion], delta);
    if (quarterResult.entity?.kind !== "ellipse") throw new Error("Expected a stretched quarter ellipse.");
    expect(quarterResult).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    expect(quarterResult.entity.center.x).toBeCloseTo(9.852004872791, 10);
    expect(quarterResult.entity.center.y).toBeCloseTo(-1.07776424224631, 10);
    expect(quarterResult.entity.majorAxis.x).toBeCloseTo(115.564843901568, 10);
    expect(quarterResult.entity.majorAxis.y).toBeCloseTo(2.120881991279924, 10);
    expect(quarterResult.entity.ratio).toBeCloseTo(0.444723039979619, 10);
    expect(quarterResult.entity.startParameter).toBeCloseTo(0.077190120252004, 10);
    expect(quarterResult.entity.endParameter).toBeCloseTo(1.647986447046899, 10);

    const arbitrary = { ...ellipse, handle: "43", startParameter: 0.3, endParameter: 2.2 };
    const arbitraryStart = { x: 100 * Math.cos(0.3), y: 50 * Math.sin(0.3) };
    const arbitraryRegion: StretchRegion = {
      kind: "crossing-window",
      points: [{ x: arbitraryStart.x - 5, y: arbitraryStart.y - 5 }, { x: arbitraryStart.x + 5, y: arbitraryStart.y + 5 }],
    };
    const arbitraryResult = stretchCadEntity(arbitrary, [arbitraryRegion], delta);
    if (arbitraryResult.entity?.kind !== "ellipse") throw new Error("Expected a stretched arbitrary ellipse arc.");
    expect(arbitraryResult.entity.center.x).toBeCloseTo(11.829841509392, 10);
    expect(arbitraryResult.entity.center.y).toBeCloseTo(1.85597636325139, 10);
    expect(arbitraryResult.entity.majorAxis.x).toBeCloseTo(115.0044951266435, 10);
    expect(arbitraryResult.entity.majorAxis.y).toBeCloseTo(2.012807544972077, 10);
    expect(arbitraryResult.entity.ratio).toBeCloseTo(0.436048585567155, 10);
    expect(arbitraryResult.entity.startParameter).toBeCloseTo(0.325000916237422, 10);
    expect(arbitraryResult.entity.endParameter).toBeCloseTo(2.225000916237421, 10);
    expect(arbitraryResult.entity.endParameter - arbitraryResult.entity.startParameter).toBeCloseTo(1.9, 12);

    const general = { ...ellipse, handle: "45", endParameter: 2.2 };
    const generalResult = stretchCadEntity(general, [startRegion], delta);
    if (generalResult.entity?.kind !== "ellipse") throw new Error("Expected a stretched general ellipse arc.");
    expect(generalResult.entity.center.x).toBeCloseTo(11.635257118392, 10);
    expect(generalResult.entity.center.y).toBeCloseTo(1.727492471203771, 10);
    expect(generalResult.entity.majorAxis.x).toBeCloseTo(113.458656164376, 10);
    expect(generalResult.entity.majorAxis.y).toBeCloseTo(1.499879904856769, 10);
    expect(generalResult.entity.ratio).toBeCloseTo(0.443593165956495, 10);
    expect(generalResult.entity.startParameter).toBeCloseTo(0.035246266949151, 10);
    expect(generalResult.entity.endParameter).toBeCloseTo(2.235246266949152, 10);
  });

  it("matches AutoCAD 2024's rotated half-ellipse endpoint reconstruction", () => {
    const ellipse: CadEllipse = {
      kind: "ellipse", handle: "44", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 80, y: 60 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI,
    };
    const startRegion: StretchRegion = { kind: "crossing-window", points: [{ x: 70, y: 50 }, { x: 90, y: 70 }] };
    const result = stretchCadEntity(ellipse, [startRegion], delta);
    expect(result).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    if (result.entity?.kind !== "ellipse") throw new Error("Expected a stretched rotated ellipse.");
    expect(result.entity.center.x).toBeCloseTo(12.5, 10);
    expect(result.entity.center.y).toBeCloseTo(2.5, 10);
    expect(result.entity.majorAxis.x).toBeCloseTo(-92.5, 10);
    expect(result.entity.majorAxis.y).toBeCloseTo(-62.5, 10);
    expect(result.entity.ratio).toBeCloseTo(0.447885929022389, 10);
    expect(result.entity.startParameter).toBeCloseTo(Math.PI, 10);
    expect(result.entity.endParameter).toBeCloseTo(Math.PI * 2, 10);
  });

  it("preserves arbitrary rotated ellipse-arc endpoints and parameter sweep across seeded cases", () => {
    const pointAt = (ellipse: CadEllipse, parameter: number) => {
      const majorLength = Math.hypot(ellipse.majorAxis.x, ellipse.majorAxis.y);
      const minor = {
        x: -ellipse.majorAxis.y / majorLength * majorLength * ellipse.ratio,
        y: ellipse.majorAxis.x / majorLength * majorLength * ellipse.ratio,
      };
      return {
        x: ellipse.center.x + ellipse.majorAxis.x * Math.cos(parameter) + minor.x * Math.sin(parameter),
        y: ellipse.center.y + ellipse.majorAxis.y * Math.cos(parameter) + minor.y * Math.sin(parameter),
      };
    };
    const cases = [
      { rotation: 0.2, ratio: 0.35, start: 0.1, sweep: 0.8 },
      { rotation: -0.7, ratio: 0.6, start: 1.1, sweep: 1.5 },
      { rotation: 1.2, ratio: 0.45, start: 2.4, sweep: 2.2 },
      { rotation: -1.4, ratio: 0.8, start: 4.8, sweep: 4.0 },
    ];
    cases.forEach((fixture, index) => {
      const source: CadEllipse = {
        kind: "ellipse", handle: `4${index + 6}`, layerId: "0", center: { x: index * 300, y: index * 25 },
        majorAxis: { x: 120 * Math.cos(fixture.rotation), y: 120 * Math.sin(fixture.rotation) },
        ratio: fixture.ratio, startParameter: fixture.start, endParameter: fixture.start + fixture.sweep,
      };
      const sourceStart = pointAt(source, source.startParameter);
      const sourceEnd = pointAt(source, source.endParameter);
      const region: StretchRegion = {
        kind: "crossing-window",
        points: [{ x: sourceStart.x - 0.1, y: sourceStart.y - 0.1 }, { x: sourceStart.x + 0.1, y: sourceStart.y + 0.1 }],
      };
      const result = stretchCadEntity(source, [region], delta);
      if (result.entity?.kind !== "ellipse") throw new Error(`Expected seeded ellipse ${index} to stretch.`);
      const outputStart = pointAt(result.entity, result.entity.startParameter);
      const outputEnd = pointAt(result.entity, result.entity.endParameter);
      expect(outputStart.x).toBeCloseTo(sourceStart.x + delta.x, 8);
      expect(outputStart.y).toBeCloseTo(sourceStart.y + delta.y, 8);
      expect(outputEnd.x).toBeCloseTo(sourceEnd.x, 8);
      expect(outputEnd.y).toBeCloseTo(sourceEnd.y, 8);
      expect(result.entity.endParameter - result.entity.startParameter).toBeCloseTo(fixture.sweep, 10);
      expect(result.entity.ratio).toBeGreaterThan(0);
      expect(result.entity.ratio).toBeLessThanOrEqual(1);
    });
  });

  it("matches AutoCAD 2024 for an ellipse arc whose parameter interval crosses 2pi", () => {
    const source: CadEllipse = {
      kind: "ellipse", handle: "4A", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 5.5, endParameter: 7,
    };
    const region: StretchRegion = { kind: "crossing-window", points: [{ x: 65, y: 20 }, { x: 85, y: 45 }] };
    const result = stretchCadEntity(source, [region], delta);
    if (result.entity?.kind !== "ellipse") throw new Error("Expected the wrapped ellipse arc to stretch.");
    expect(result).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    expect(result.entity.center.x).toBeCloseTo(16.321187837475, 10);
    expect(result.entity.center.y).toBeCloseTo(24.74162641794247, 10);
    expect(result.entity.majorAxis.x).toBeCloseTo(-95.68145757452969, 10);
    expect(result.entity.majorAxis.y).toBeCloseTo(29.35210104127352, 10);
    expect(result.entity.ratio).toBeCloseTo(0.576564048333548, 10);
    expect(result.entity.startParameter).toBeCloseTo(2.341890538582327, 10);
    expect(result.entity.endParameter).toBeCloseTo(3.841890538582323, 10);
  });

  it("canonicalizes a valid sub-millimetre ellipse arc without an absolute-area rejection", () => {
    const source: CadEllipse = {
      kind: "ellipse", handle: "49", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 0.001, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2,
    };
    const tinyDelta = { x: 0.00025, y: 0.00005 };
    const region: StretchRegion = {
      kind: "crossing-window",
      points: [{ x: 0.0004, y: -0.001 }, { x: 0.002, y: 0.001 }],
    };
    const result = stretchCadEntity(source, [region], tinyDelta);
    if (result.entity?.kind !== "ellipse") throw new Error("Expected a sub-millimetre ellipse arc to stretch.");
    const pointAt = (ellipse: CadEllipse, parameter: number) => {
      const majorLength = Math.hypot(ellipse.majorAxis.x, ellipse.majorAxis.y);
      const minor = { x: -ellipse.majorAxis.y * ellipse.ratio, y: ellipse.majorAxis.x * ellipse.ratio };
      return {
        x: ellipse.center.x + ellipse.majorAxis.x * Math.cos(parameter) + minor.x * Math.sin(parameter),
        y: ellipse.center.y + ellipse.majorAxis.y * Math.cos(parameter) + minor.y * Math.sin(parameter),
        majorLength,
      };
    };
    const outputStart = pointAt(result.entity, result.entity.startParameter);
    const outputEnd = pointAt(result.entity, result.entity.endParameter);
    expect(outputStart.x).toBeCloseTo(0.001 + tinyDelta.x, 11);
    expect(outputStart.y).toBeCloseTo(tinyDelta.y, 11);
    expect(outputEnd.x).toBeCloseTo(0, 11);
    expect(outputEnd.y).toBeCloseTo(0.0005, 11);
    expect(outputStart.majorLength).toBeGreaterThan(1e-6);
  });

  it("moves spline control points, leader vertices, dimension points and hatch vertices inside the crossing union", () => {
    const region: StretchRegion = { kind: "crossing-window", points: [{ x: 90, y: -10 }, { x: 110, y: 110 }] };
    const spline: CadSpline = {
      kind: "spline", handle: "50", layerId: "0", degree: 2,
      controlPoints: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }],
      knots: [0, 0, 0, 1, 1, 1], weights: [2, 3, 2], closed: false, periodic: false,
    };
    const splineResult = stretchCadEntity(spline, [region], delta);
    expect(splineResult.entity).toMatchObject({ controlPoints: [{ x: 0, y: 0 }, { x: 125, y: 105 }, { x: 200, y: 0 }], knots: spline.knots, weights: spline.weights });
    const leader = stretchCadEntity({ kind: "leader", handle: "51", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 100, y: 100 }], text: "A" }, [region], delta);
    expect(leader.entity).toMatchObject({ vertices: [{ x: 0, y: 0 }, { x: 125, y: 105 }], text: "A" });
    const dimension = stretchCadEntity({ kind: "dimension", handle: "52", layerId: "0", dimensionKind: "linear", definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }], styleId: "standard" }, [region], delta);
    expect(dimension.entity).toMatchObject({ definitionPoints: [{ x: 0, y: 0 }, { x: 125, y: 5 }] });
    const hatch = stretchCadEntity({ kind: "hatch", handle: "53", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }] }, [region], delta);
    expect(hatch.entity).toMatchObject({ loops: [{ vertices: [{ x: 0, y: 0 }, { x: 125, y: 5 }, { x: 125, y: 105 }] }] });
  });

  it("fails closed for invalid polygons, zero displacement and selected proxy data", () => {
    expect(() => stretchCadEntity(line, [{ kind: "crossing-polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] }], delta)).toThrow(TypeError);
    expect(stretchCadEntity(line, [crossing], { x: 0, y: 0 })).toMatchObject({ entity: null, selected: true, reason: "no-op" });
    expect(stretchCadEntity({ kind: "proxy", handle: "60", layerId: "0", originalType: "ACAD_PROXY", raw: {}, bounds: { min: { x: 50, y: 0 }, max: { x: 60, y: 10 } } }, [crossing], delta)).toMatchObject({ selected: true, reason: "unsupported-target" });
  });
});

describe("F-027 STRETCH typed command", () => {
  it("registers S/STRETCH and requires a real selection", () => {
    expect(resolveCadCommand("s")?.id).toBe("STRETCH");
    expect(resolveCadCommand("STRETCH")?.id).toBe("STRETCH");
    expect(() => executeStretch(createEmptyDocument({ documentId: "F-027-empty" }), { regions: [], individualHandles: [], basePoint: { x: 0, y: 0 }, destinationPoint: { x: 1, y: 0 } })).toThrow(CadCommandInputError);
  });

  it("stretches, moves, rejects locked/missing targets and commits atomically", () => {
    const document = createEmptyDocument({ documentId: "F-027-command" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      line,
      { ...line, handle: "20", start: { x: 60, y: 10 }, end: { x: 80, y: 10 } },
      { ...line, handle: "30", layerId: "locked", start: { x: 0, y: 15 }, end: { x: 100, y: 15 } },
    );
    const before = structuredClone(document.entities);
    const result = executeStretch(document, {
      regions: [crossing],
      individualHandles: ["20", "missing"],
      basePoint: { x: 0, y: 0 },
      destinationPoint: delta,
    });
    expect(result).toMatchObject({
      sourceHandles: ["10", "20"], resultHandles: ["10", "20"],
      stretchedHandles: ["10"], movedHandles: ["20"], delta,
      rejected: [{ handle: "missing", reason: "missing" }, { handle: "30", reason: "locked-layer" }],
      steps: [{ handle: "10", mode: "stretch", movedPointCount: 1 }, { handle: "20", mode: "move", movedPointCount: 1 }],
    });
    const session = new CadSession(document);
    session.commit({ opId: "F-027-command", baseRevision: 0, commandId: "STRETCH", args: { regions: [crossing], delta }, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 125, y: 5 } });
    const committed = structuredClone(session.document.entities);
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(before);
    expect(session.redo()).not.toBeNull();
    expect(session.document.entities).toEqual(committed);
  });
});
