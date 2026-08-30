import { describe, expect, it } from "vitest";
import {
  CadSession,
  createEmptyDocument,
  executeStretch,
  parseStretchRegions,
  stretchCadEntity,
  stretchPointInPolygon,
  type StretchRegion,
} from "../src/index.js";

const crossing: StretchRegion = {
  kind: "crossing-window",
  points: [{ x: 40, y: -10 }, { x: 110, y: 20 }],
};
const delta = { x: 25, y: 5 };
const line = {
  kind: "line" as const,
  handle: "10",
  layerId: "0",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  appearance: { color: "#09f", linetypeId: "dash", lineweightMm: 0.5 },
  extensionData: { rowId: "F-027" },
};

describe("F-027 mutation-proven STRETCH ratchet", () => {
  it("kills whole-line, wrong-endpoint, property-loss and source-mutation mutants", () => {
    const source = structuredClone(line);
    expect(stretchCadEntity(line, [crossing], delta)).toEqual({
      entity: { ...line, start: { x: 0, y: 0 }, end: { x: 125, y: 5 } },
      mode: "stretch",
      movedPointCount: 1,
      selected: true,
      reason: null,
    });
    expect(line).toEqual(source);
  });

  it("kills boundary-exclusive, crossing-union and full-containment mutants", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    expect(stretchPointInPolygon({ x: 20, y: 10 }, polygon)).toBe(true);
    const second: StretchRegion = {
      kind: "crossing-polygon",
      points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
    };
    const bothEnds = stretchCadEntity(line, [crossing, second], delta);
    expect(bothEnds).toMatchObject({ mode: "stretch", movedPointCount: 2 });
    expect(bothEnds.entity).toMatchObject({ start: { x: 25, y: 5 }, end: { x: 125, y: 5 } });

    const enclosed = { ...line, start: { x: 60, y: 0 }, end: { x: 80, y: 0 } };
    expect(stretchCadEntity(enclosed, [crossing], delta)).toMatchObject({
      mode: "move",
      movedPointCount: 1,
      entity: { start: { x: 85, y: 5 }, end: { x: 105, y: 5 } },
    });
  });

  it("kills circle-curve selection and polyline bulge/width-loss mutants", () => {
    const circle = { kind: "circle" as const, handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 100 };
    const edgeOnly: StretchRegion = { kind: "crossing-window", points: [{ x: 95, y: -5 }, { x: 105, y: 5 }] };
    expect(stretchCadEntity(circle, [edgeOnly], delta)).toMatchObject({ selected: false, reason: "not-selected" });
    const centerOnly: StretchRegion = { kind: "crossing-window", points: [{ x: -5, y: -5 }, { x: 5, y: 5 }] };
    expect(stretchCadEntity(circle, [centerOnly], delta)).toMatchObject({ selected: false, reason: "not-selected" });
    const centerAndCurve: StretchRegion = { kind: "crossing-window", points: [{ x: -10, y: -10 }, { x: 110, y: 10 }] };
    expect(stretchCadEntity(circle, [centerAndCurve], delta)).toMatchObject({ mode: "move", entity: { center: { x: 25, y: 5 }, radius: 100 } });
    expect(stretchCadEntity(line, [crossing], { x: 0, y: 0 })).toMatchObject({ selected: true, reason: "no-op" });

    const polyline = {
      kind: "polyline" as const,
      handle: "30",
      layerId: "0",
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0.5, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: -0.25, startWidth: 4, endWidth: 6 },
        { x: 200, y: 0, startWidth: 6, endWidth: 8 },
      ],
    };
    expect(stretchCadEntity(polyline, [crossing], delta).entity).toEqual({
      ...polyline,
      vertices: [
        { ...polyline.vertices[0], bulge: 0.3996803834887157 },
        { ...polyline.vertices[1], x: 125, y: 5, bulge: -0.3325950526188696 },
        polyline.vertices[2],
      ],
    });
  });

  it("kills fixed-midpoint arc and ignored/generic ellipse endpoint mutants", () => {
    const endpointRegion: StretchRegion = { kind: "crossing-window", points: [{ x: 90, y: -10 }, { x: 110, y: 10 }] };
    const arc = stretchCadEntity({
      kind: "arc", handle: "40", layerId: "0", center: { x: 0, y: 0 }, radius: 100,
      startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true,
    }, [endpointRegion], delta);
    expect(arc.entity).toMatchObject({
      kind: "arc",
      center: { x: expect.closeTo(12.7957603151085, 10), y: expect.closeTo(-10.80921417988332, 10) },
      radius: expect.closeTo(113.3125, 10),
      startAngleRad: expect.closeTo(0.139975357410291, 10),
      endAngleRad: expect.closeTo(3.04605442683294, 10),
    });

    const ellipse = stretchCadEntity({
      kind: "ellipse", handle: "41", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI,
    }, [endpointRegion], delta);
    expect(ellipse).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    expect(ellipse.entity).toMatchObject({
      kind: "ellipse", center: { x: 12.5, y: 2.5 }, majorAxis: { x: -112.5, y: -2.5 },
      ratio: expect.closeTo(0.444334745702938, 10), startParameter: Math.PI, endParameter: Math.PI * 2,
    });

    const quarter = stretchCadEntity({
      kind: "ellipse", handle: "42", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2,
    }, [endpointRegion], delta);
    expect(quarter).toMatchObject({ mode: "stretch", movedPointCount: 1, reason: null });
    expect(quarter.entity).toMatchObject({
      kind: "ellipse",
      center: { x: expect.closeTo(9.852004872791, 10), y: expect.closeTo(-1.07776424224631, 10) },
      majorAxis: { x: expect.closeTo(115.564843901568, 10), y: expect.closeTo(2.120881991279924, 10) },
      ratio: expect.closeTo(0.444723039979619, 10),
      startParameter: expect.closeTo(0.077190120252004, 10),
      endParameter: expect.closeTo(1.647986447046899, 10),
    });

    const wrapped = stretchCadEntity({
      kind: "ellipse", handle: "43", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 5.5, endParameter: 7,
    }, [{ kind: "crossing-window", points: [{ x: 65, y: 20 }, { x: 85, y: 45 }] }], delta);
    expect(wrapped.entity).toMatchObject({
      kind: "ellipse",
      majorAxis: { x: expect.closeTo(-95.68145757452969, 10), y: expect.closeTo(29.35210104127352, 10) },
      startParameter: expect.closeTo(2.341890538582327, 10),
      endParameter: expect.closeTo(3.841890538582323, 10),
    });
  });

  it("kills malformed-selection, missing-target, split-transaction and locked-layer mutants", () => {
    expect(parseStretchRegions("40,-10;110,20 | 0,0;10,0;10,10;0,10")).toEqual([
      crossing,
      { kind: "crossing-polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ]);
    for (const malformed of ["0,0", "0,0;0,0", "0,0;10,0;20,0", "0,0;NaN,1"]) {
      expect(() => parseStretchRegions(malformed)).toThrow();
    }

    const document = createEmptyDocument({ documentId: "F-027-mutation" });
    document.layers.push({ id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(line, { ...line, handle: "20", layerId: "locked" });
    const source = structuredClone(document.entities);
    const result = executeStretch(document, {
      regions: [crossing],
      individualHandles: ["missing"],
      basePoint: { x: 0, y: 0 },
      destinationPoint: delta,
    });
    expect(result).toMatchObject({
      sourceHandles: ["10"],
      resultHandles: ["10"],
      movedHandles: [],
      stretchedHandles: ["10"],
      rejected: [{ handle: "missing", reason: "missing" }, { handle: "20", reason: "locked-layer" }],
      steps: [{ handle: "10", mode: "stretch", movedPointCount: 1 }],
    });
    expect(document.entities).toEqual(source);

    const session = new CadSession(document);
    session.commit({
      opId: "F-027-mutation",
      baseRevision: 0,
      commandId: "STRETCH",
      args: { regions: [crossing], delta },
      targetHandles: result.sourceHandles,
      resultHandles: result.resultHandles,
    }, result.changes);
    const committed = structuredClone(session.document.entities);
    expect(session.document.revision).toBe(1);
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(source);
    expect(session.redo()).not.toBeNull();
    expect(session.document.entities).toEqual(committed);
  });
});
