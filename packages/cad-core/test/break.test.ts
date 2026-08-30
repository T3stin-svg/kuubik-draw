import { describe, expect, it } from "vitest";
import type { CadEntity, CadLine, CadPolyline, CadSpline } from "@kuubik/cad-schema";
import {
  CadCommandInputError,
  CadSession,
  breakCadEntity,
  createEmptyDocument,
  executeBreak,
  resolveCadCommand,
} from "../src/index.js";

const line: CadLine = {
  kind: "line",
  handle: "10",
  layerId: "0",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  appearance: { color: "#ff0000", linetypeId: "dashed", lineweightMm: 0.35 },
  extensionData: { parityRow: "F-026" },
};

const spline: CadSpline = {
  kind: "spline",
  handle: "60",
  layerId: "0",
  degree: 3,
  controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 0 }, { x: 200 / 3, y: 0 }, { x: 100, y: 0 }],
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
  weights: [2, 2, 2, 2],
  closed: false,
  periodic: false,
  extensionData: { parityRow: "F-026" },
};

describe("F-026 BREAK clean-room geometry", () => {
  it("removes a two-point interval from a line and preserves source properties", () => {
    const source = structuredClone(line);
    const result = breakCadEntity(line, { x: 25, y: 9 }, { x: 75, y: -4 });
    expect(result).toEqual({
      entities: [
        { ...line, start: { x: 0, y: 0 }, end: { x: 25, y: 0 } },
        { ...line, start: { x: 75, y: 0 }, end: { x: 100, y: 0 } },
      ],
      breakPoints: [{ x: 25, y: 0 }, { x: 75, y: 0 }],
      parameters: [0.25, 0.75],
      removedInterval: { start: 0.25, end: 0.75, wraps: false },
      mode: "two-point",
      reason: null,
    });
    expect(line).toEqual(source);
  });

  it("BREAK at point creates two exact open pieces without deleting an interval", () => {
    const result = breakCadEntity(line, { x: 40, y: 5 }, undefined, "at-point");
    expect(result).toMatchObject({
      reason: null,
      mode: "at-point",
      removedInterval: null,
      breakPoints: [{ x: 40, y: 0 }, { x: 40, y: 0 }],
      entities: [
        { kind: "line", start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
        { kind: "line", start: { x: 40, y: 0 }, end: { x: 100, y: 0 } },
      ],
    });
  });

  it("uses the source direction for circle and full-ellipse removal", () => {
    const circle = breakCadEntity(
      { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    );
    expect(circle).toMatchObject({
      reason: null,
      removedInterval: { start: 0, end: 0.25, wraps: false },
      entities: [{ kind: "arc", handle: "20", center: { x: 0, y: 0 }, radius: 100, counterClockwise: true }],
    });
    if (circle.entities[0]?.kind !== "arc") throw new Error("Expected a circle BREAK to produce an arc.");
    expect(circle.entities[0].startAngleRad).toBeCloseTo(Math.PI / 2, 11);
    expect(circle.entities[0].endAngleRad).toBeCloseTo(Math.PI * 2, 11);

    const ellipse = breakCadEntity(
      { kind: "ellipse", handle: "30", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
      { x: 100, y: 0 },
      { x: 0, y: 50 },
    );
    expect(ellipse).toMatchObject({ reason: null, entities: [{ kind: "ellipse" }] });
    if (ellipse.entities[0]?.kind !== "ellipse") throw new Error("Expected an ellipse BREAK to preserve ellipse type.");
    expect(ellipse.entities[0].startParameter).toBeCloseTo(Math.PI / 2, 11);
    expect(ellipse.entities[0].endParameter).toBeCloseTo(Math.PI * 2, 11);
  });

  it("rejects closed objects at one point and still splits an open polyline", () => {
    const circle = breakCadEntity(
      { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 100 },
      { x: 0, y: 100 },
      undefined,
      "at-point",
    );
    expect(circle).toMatchObject({ reason: "closed-at-point", entities: [] });

    const closed: CadPolyline = {
      kind: "polyline", handle: "40", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };
    expect(breakCadEntity(closed, { x: 50, y: 0 }, undefined, "at-point")).toMatchObject({ reason: "closed-at-point", entities: [] });

    const open = { ...closed, closed: false };
    const polyline = breakCadEntity(open, { x: 100, y: 50 }, undefined, "at-point");
    expect(polyline).toMatchObject({ reason: null, removedInterval: null, entities: [{ kind: "polyline", closed: false }, { kind: "polyline", closed: false }] });
    expect(polyline.entities[0]).toMatchObject({ kind: "polyline", vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] });
    expect(polyline.entities[1]).toMatchObject({ kind: "polyline", vertices: [{ x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
  });

  it("matches the AutoCAD-live single-point capability matrix for an open ellipse and spline", () => {
    const ellipse = {
      kind: "ellipse" as const,
      handle: "30",
      layerId: "0",
      center: { x: 0, y: 0 },
      majorAxis: { x: 100, y: 0 },
      ratio: 0.5,
      startParameter: 0,
      endParameter: Math.PI,
    };
    const ellipseResult = breakCadEntity(ellipse, { x: 0, y: 50 }, undefined, "at-point");
    expect(ellipseResult).toMatchObject({
      reason: null,
      mode: "at-point",
      removedInterval: null,
      entities: [{ kind: "ellipse" }, { kind: "ellipse" }],
    });
    expect(ellipseResult.entities).toHaveLength(2);
    expect(breakCadEntity(spline, { x: 50, y: 0 }, undefined, "at-point")).toMatchObject({
      reason: "unsupported-target",
      mode: "at-point",
      entities: [],
      breakPoints: null,
    });
  });

  it("removes across multiple open polyline segments and keeps bulge/width data", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "40", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: 1, startWidth: 4, endWidth: 6 },
        { x: 100, y: 100, startWidth: 6, endWidth: 8 },
        { x: 200, y: 100 },
      ],
    };
    const result = breakCadEntity(polyline, { x: 25, y: 0 }, { x: 175, y: 100 });
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]).toMatchObject({ kind: "polyline", closed: false, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 2.5 }, { x: 25, y: 0 }] });
    expect(result.entities[1]).toMatchObject({ kind: "polyline", closed: false, vertices: [{ x: 175, y: 100, startWidth: 7.5, endWidth: 8 }, { x: 200, y: 100 }] });
  });

  it("splits a rational cubic spline with valid exact sub-splines", () => {
    const source = structuredClone(spline);
    const result = breakCadEntity(spline, { x: 25, y: 0 }, { x: 75, y: 0 });
    expect(result.reason).toBeNull();
    expect(result.entities).toHaveLength(2);
    for (const piece of result.entities) {
      expect(piece).toMatchObject({ kind: "spline", degree: 3, closed: false, periodic: false, extensionData: { parityRow: "F-026" } });
      if (piece.kind === "spline") {
        expect(piece.knots).toHaveLength(piece.controlPoints.length + piece.degree + 1);
        expect(piece.weights).toHaveLength(piece.controlPoints.length);
      }
    }
    expect(spline).toEqual(source);
  });

  it("rejects unsupported, invalid, coincident and endpoint no-op inputs without output", () => {
    expect(breakCadEntity({ kind: "text", handle: "70", layerId: "0", position: { x: 0, y: 0 }, height: 10, value: "x", rotationRad: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ reason: "unsupported-target", entities: [] });
    expect(breakCadEntity(line, { x: Number.NaN, y: 0 }, { x: 50, y: 0 })).toMatchObject({ reason: "invalid-point", entities: [] });
    expect(breakCadEntity(line, { x: 50, y: 1 }, { x: 50, y: -1 })).toMatchObject({ reason: "coincident-points", entities: [] });
    expect(breakCadEntity(line, { x: 0, y: 0 }, undefined, "at-point")).toMatchObject({ reason: "no-op", entities: [] });
  });

  it("preserves the projected line partition across a seeded off-curve fuzz matrix", () => {
    let state = 0xF026;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let index = 0; index < 64; index += 1) {
      const first = 25 + random() * 425;
      const second = 550 + random() * 425;
      const source: CadLine = { ...line, end: { x: 1000, y: 0 } };
      const result = breakCadEntity(
        source,
        { x: first, y: (random() - 0.5) * 1000 },
        { x: second, y: (random() - 0.5) * 1000 },
      );
      expect(result.reason).toBeNull();
      expect(result.breakPoints?.[0]?.x).toBeCloseTo(first, 9);
      expect(result.breakPoints?.[1]?.x).toBeCloseTo(second, 9);
      expect(result.breakPoints?.[0]?.y).toBe(0);
      expect(result.breakPoints?.[1]?.y).toBe(0);
      expect(result.entities).toHaveLength(2);
      const keptLength = result.entities.reduce((sum, entity) => {
        if (entity.kind !== "line") throw new Error("Seeded BREAK line matrix emitted a non-line entity.");
        return sum + Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
      }, 0);
      expect(keptLength + (second - first)).toBeCloseTo(1000, 9);
      expect(source).toEqual({ ...line, end: { x: 1000, y: 0 } });
    }
  });
});

describe("F-026 BREAK typed command", () => {
  it("is registered with BR/BREAK/BREAKATPOINT aliases and rejects an empty command", () => {
    expect(resolveCadCommand("br")?.id).toBe("BREAK");
    expect(resolveCadCommand("BREAK")?.id).toBe("BREAK");
    expect(resolveCadCommand("breakatpoint")?.id).toBe("BREAK");
    const document = createEmptyDocument({ documentId: "F-026-empty" });
    expect(() => executeBreak(document, { targets: [] })).toThrow(CadCommandInputError);
  });

  it("allocates stable handles, preserves draw order and commits as one Undo/Redo operation", () => {
    const document = createEmptyDocument({ documentId: "F-026-command" });
    document.entities.push(line, { ...line, handle: "20", start: { x: 0, y: 100 }, end: { x: 100, y: 100 } });
    const before = structuredClone(document.entities);
    const result = executeBreak(document, {
      targets: [
        { handle: "10", firstPoint: { x: 25, y: 0 }, secondPoint: { x: 75, y: 0 }, mode: "two-point" },
        { handle: "20", firstPoint: { x: 50, y: 100 }, mode: "at-point" },
      ],
    });
    expect(result).toMatchObject({
      sourceHandles: ["10", "20"], resultHandles: ["10", "21", "20", "22"], createdHandles: ["21", "22"],
      rejected: [], multiple: true,
    });
    const session = new CadSession(document);
    session.commit({ opId: "F-026-command", baseRevision: 0, commandId: "BREAK", args: { targets: result.steps }, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "20", "21", "22"]);
    const committed = structuredClone(session.document.entities);
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(before);
    expect(session.redo()).not.toBeNull();
    expect(session.document.entities).toEqual(committed);
  });

  it("edits explicit hidden/frozen handles but rejects locked, missing and unsupported targets", () => {
    const document = createEmptyDocument({ documentId: "F-026-reject" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: true, locked: false, plottable: true },
    );
    document.entities.push(
      { ...line, layerId: "locked" },
      { ...line, handle: "20", layerId: "hidden" },
      { kind: "text", handle: "30", layerId: "0", position: { x: 0, y: 0 }, height: 10, value: "x", rotationRad: 0 },
    );
    const source = structuredClone(document);
    const result = executeBreak(document, { targets: [
      { handle: "10", firstPoint: { x: 25, y: 0 }, secondPoint: { x: 75, y: 0 } },
      { handle: "20", firstPoint: { x: 25, y: 0 }, secondPoint: { x: 75, y: 0 } },
      { handle: "30", firstPoint: { x: 0, y: 0 }, secondPoint: { x: 1, y: 0 } },
      { handle: "missing", firstPoint: { x: 0, y: 0 }, secondPoint: { x: 1, y: 0 } },
    ] });
    expect(result.sourceHandles).toEqual(["20"]);
    expect(result.resultHandles).toEqual(["20", "31"]);
    expect(result.rejected.map(({ reason }) => reason)).toEqual(["locked-layer", "unsupported-target", "missing"]);
    expect(document).toEqual(source);
  });
});
