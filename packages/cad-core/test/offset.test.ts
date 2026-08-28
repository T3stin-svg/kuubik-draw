import { describe, expect, it } from "vitest";
import type { CadArc, CadCircle, CadEllipse, CadLine, CadPolyline } from "@kuubik/cad-schema";
import {
  CadCommandInputError,
  CadSession,
  createEmptyDocument,
  executeOffset,
  offsetCadEntity,
  parseOffsetDistance,
  parseOffsetPlacementPoints,
  resolveCadCommand,
} from "../src/index.js";

const line: CadLine = {
  kind: "line",
  handle: "10",
  layerId: "0",
  appearance: { color: "#ff0000", linetypeId: "DASHED", lineweightMm: 0.35 },
  extensionData: { owner: "F-021" },
  start: { x: 0, y: 0 },
  end: { x: 1000, y: 0 },
};

describe("OFFSET analytical geometry", () => {
  it("offsets LINE by Distance and exact Through distance beyond the finite endpoint", () => {
    expect(offsetCadEntity(line, "distance", 200, { x: 500, y: 10 })).toMatchObject({
      signedDistance: 200,
      entity: { kind: "line", start: { x: 0, y: 200 }, end: { x: 1000, y: 200 }, appearance: line.appearance },
    });
    expect(offsetCadEntity({ ...line, start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } }, "through", undefined, { x: 1500, y: 1375 })).toMatchObject({
      signedDistance: 375,
      entity: { start: { x: 0, y: 1375 }, end: { x: 1000, y: 1375 } },
    });
    const hugeLine: CadLine = { ...line, start: { x: 1e308, y: 0 }, end: { x: 1e308, y: 1e308 } };
    expect(offsetCadEntity(hugeLine, "distance", Number.MAX_VALUE, { x: Number.MAX_VALUE, y: 1 })).toMatchObject({
      entity: null,
      reason: "invalid-offset",
    });
  });

  it("creates concentric CIRCLE and orientation-correct ARC offsets and rejects collapse", () => {
    const circle: CadCircle = { kind: "circle", handle: "11", layerId: "0", center: { x: 0, y: 0 }, radius: 100 };
    expect(offsetCadEntity(circle, "distance", 20, { x: 150, y: 0 }).entity).toMatchObject({ radius: 120 });
    expect(offsetCadEntity(circle, "distance", 20, { x: 50, y: 0 }).entity).toMatchObject({ radius: 80 });
    expect(offsetCadEntity(circle, "through", undefined, { x: 137.5, y: 0 }).entity).toMatchObject({ radius: 137.5 });
    expect(offsetCadEntity(circle, "distance", 100, { x: 50, y: 0 })).toMatchObject({ entity: null, reason: "invalid-offset" });
    const hugeCircle: CadCircle = { ...circle, center: { x: 1e308, y: 0 } };
    expect(offsetCadEntity(hugeCircle, "distance", Number.MAX_VALUE, { x: 1.1e308, y: 0 })).toMatchObject({ entity: null, reason: "invalid-offset" });

    const ccw: CadArc = { kind: "arc", handle: "12", layerId: "0", center: { x: 0, y: 0 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true };
    const clockwise: CadArc = { ...ccw, handle: "13", counterClockwise: false };
    expect(offsetCadEntity(ccw, "distance", 20, { x: 150, y: 0 }).entity).toMatchObject({ radius: 120, counterClockwise: true });
    expect(offsetCadEntity(clockwise, "distance", 20, { x: 150, y: 0 }).entity).toMatchObject({ radius: 120, counterClockwise: false });
  });

  it("joins open, closed, collinear and bulged POLYLINE segments without changing style", () => {
    const open: CadPolyline = {
      kind: "polyline",
      handle: "20",
      layerId: "0",
      appearance: { color: "#00ff00" },
      closed: false,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    };
    expect(offsetCadEntity(open, "distance", 10, { x: 50, y: 50 }).entity).toMatchObject({
      kind: "polyline",
      appearance: { color: "#00ff00" },
      vertices: [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 100 }],
    });
    const collinear: CadPolyline = { ...open, handle: "21", vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] };
    expect(offsetCadEntity(collinear, "distance", 10, { x: 50, y: 25 }).entity).toMatchObject({
      vertices: [{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 100, y: 10 }],
    });
    const closed: CadPolyline = { ...open, handle: "22", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    expect(offsetCadEntity(closed, "distance", 10, { x: 50, y: 50 }).entity).toMatchObject({
      closed: true,
      vertices: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
    });
    const semicircle: CadPolyline = { ...open, handle: "23", vertices: [{ x: -100, y: 0, bulge: 1 }, { x: 100, y: 0 }] };
    expect(offsetCadEntity(semicircle, "distance", 20, { x: 0, y: -120 }).entity).toMatchObject({
      kind: "polyline",
      vertices: [{ x: -120, y: 0, bulge: 1 }, { x: 120, y: 0 }],
    });
    const concave: CadPolyline = {
      ...open,
      handle: "24",
      closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }],
    };
    expect(offsetCadEntity(concave, "distance", 60, { x: 10, y: 10 })).toMatchObject({
      entity: null,
      reason: "self-intersection",
    });
  });

  it("represents an ELLIPSE parallel curve as a cubic spline with bounded cardinal-point error", () => {
    const ellipse: CadEllipse = {
      kind: "ellipse",
      handle: "30",
      layerId: "0",
      appearance: { color: "#123456", lineweightMm: 0.5 },
      center: { x: 100, y: 50 },
      majorAxis: { x: 200, y: 0 },
      ratio: 0.5,
      startParameter: 0,
      endParameter: Math.PI * 2,
    };
    const result = offsetCadEntity(ellipse, "distance", 25, { x: 350, y: 50 });
    expect(result.signedDistance).toBe(-25);
    expect(result.entity).toMatchObject({ kind: "spline", degree: 3, closed: true, appearance: { color: "#123456" } });
    expect(result.entity.appearance).not.toHaveProperty("lineweightMm");
    if (!result.entity || result.entity.kind !== "spline") throw new Error("Expected spline output.");
    expect(result.entity.controlPoints[0]).toEqual({ x: 325, y: 50 });
    expect(result.entity.knots).toHaveLength(result.entity.controlPoints.length + 4);

    const inward = offsetCadEntity(ellipse, "distance", 20, { x: 100, y: 50 });
    expect(inward).toMatchObject({ signedDistance: 20, entity: { kind: "spline", closed: true } });
    const collapsed = offsetCadEntity(ellipse, "distance", 60, { x: 100, y: 50 });
    expect(collapsed).toMatchObject({
      signedDistance: 60,
      entity: { kind: "spline", closed: false },
      entities: [{ kind: "spline", closed: false }, { kind: "spline", closed: false }],
    });
    expect(collapsed.entities).toHaveLength(2);
  });
});

describe("OFFSET command transaction", () => {
  it("resolves O/OFFSET and validates Distance and placement inputs", () => {
    expect(resolveCadCommand("o")?.id).toBe("OFFSET");
    expect(resolveCadCommand(" OFFSET ")?.id).toBe("OFFSET");
    expect(parseOffsetDistance("200.5")).toBe(200.5);
    expect(parseOffsetPlacementPoints("500,100; 500,250")).toEqual([{ x: 500, y: 100 }, { x: 500, y: 250 }]);
    expect(() => parseOffsetDistance("0")).toThrow(CadCommandInputError);
    expect(() => parseOffsetPlacementPoints(" ")).toThrow(CadCommandInputError);
  });

  it("executes progressive Multiple in one atomic global undo step", () => {
    const document = createEmptyDocument({ documentId: "offset-multiple" });
    document.entities.push(line);
    const result = executeOffset(document, {
      targetHandles: [line.handle],
      mode: "distance",
      distance: 100,
      placementPoints: [{ x: 500, y: 100 }, { x: 500, y: 250 }],
      multiple: true,
      eraseSource: false,
      layerMode: "source",
    });
    expect(result).toMatchObject({ sourceHandles: ["10"], createdHandles: ["11", "12"], rejected: [], multiple: true });
    expect(result.steps).toEqual([
      { originalSourceHandle: "10", sourceHandle: "10", resultHandle: "11", placementIndex: 0, signedDistance: 100 },
      { originalSourceHandle: "10", sourceHandle: "11", resultHandle: "12", placementIndex: 1, signedDistance: 100 },
    ]);
    expect(result.changes).toMatchObject([
      { type: "put", entity: { handle: "11", start: { x: 0, y: 100 }, end: { x: 1000, y: 100 } } },
      { type: "put", entity: { handle: "12", start: { x: 0, y: 200 }, end: { x: 1000, y: 200 } } },
    ]);
    const session = new CadSession(document);
    session.commit({ opId: "F-021", baseRevision: 0, commandId: "OFFSET", args: {}, targetHandles: ["10"], resultHandles: result.createdHandles }, result.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12"]);
    session.undo();
    expect(session.document.entities).toEqual([line]);
  });

  it("supports Erase Yes, Layer Current, exact source restoration and local-Undo replay", () => {
    const document = createEmptyDocument({ documentId: "offset-erase" });
    document.layers.push({ id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true });
    document.currentLayerId = "current";
    document.entities.push({ ...line, layerId: "0", start: { x: 0, y: 3000 }, end: { x: 1000, y: 3000 } });
    const args = {
      targetHandles: [line.handle], mode: "distance" as const, distance: 250,
      placementPoints: [{ x: 500, y: 3250 }, { x: 500, y: 3500 }],
      multiple: true, eraseSource: true, layerMode: "current" as const,
    };
    const result = executeOffset(document, args);
    expect(result.changes).toMatchObject([
      { type: "delete", handle: "10" },
      { type: "put", entity: { handle: "12", layerId: "current", start: { x: 0, y: 3500 }, appearance: line.appearance, extensionData: line.extensionData } },
    ]);
    const locallyUndone = executeOffset(document, { ...args, placementPoints: args.placementPoints.slice(0, -1) });
    expect(locallyUndone.changes).toMatchObject([
      { type: "delete", handle: "10" },
      { type: "put", entity: { handle: "11", start: { x: 0, y: 3250 } } },
    ]);
    expect(args.placementPoints).toHaveLength(2);
  });

  it("commits AutoCAD-compatible inward ELLIPSE collapse as two open splines", () => {
    const document = createEmptyDocument({ documentId: "offset-ellipse-collapse" });
    document.entities.push({
      kind: "ellipse",
      handle: "10",
      layerId: "0",
      center: { x: 0, y: 0 },
      majorAxis: { x: 200, y: 0 },
      ratio: 0.5,
      startParameter: 0,
      endParameter: Math.PI * 2,
    });
    const result = executeOffset(document, {
      targetHandles: ["10"],
      mode: "distance",
      distance: 60,
      placementPoints: [{ x: 0, y: 0 }],
      multiple: false,
      eraseSource: false,
      layerMode: "source",
    });
    expect(result.createdHandles).toEqual(["11", "12"]);
    expect(result.changes).toMatchObject([
      { type: "put", entity: { kind: "spline", handle: "11", closed: false } },
      { type: "put", entity: { kind: "spline", handle: "12", closed: false } },
    ]);
    expect(result.steps.map((step) => step.resultHandle)).toEqual(["11", "12"]);
  });

  it("rejects missing, locked, hidden, unsupported, zero and source-coincident targets without mutation", () => {
    const document = createEmptyDocument({ documentId: "offset-reject" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
    );
    document.entities.push(
      { ...line, handle: "10", layerId: "locked" },
      { ...line, handle: "11", layerId: "hidden" },
      { kind: "text", handle: "12", layerId: "0", position: { x: 0, y: 0 }, text: "x", height: 10, rotationRad: 0 },
      { ...line, handle: "13" },
    );
    const result = executeOffset(document, {
      targetHandles: ["missing", "10", "11", "12", "13"],
      mode: "through",
      placementPoints: [{ x: 500, y: 0 }],
      multiple: false,
      eraseSource: false,
      layerMode: "source",
    });
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([
      { handle: "missing", placementIndex: null, reason: "missing" },
      { handle: "10", placementIndex: null, reason: "locked-layer" },
      { handle: "11", placementIndex: null, reason: "hidden-layer" },
      { handle: "12", placementIndex: 0, reason: "unsupported-entity" },
      { handle: "13", placementIndex: 0, reason: "side-on-source" },
    ]);
  });
});
