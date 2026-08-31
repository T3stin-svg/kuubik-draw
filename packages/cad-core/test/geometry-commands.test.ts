import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import {
  GEOMETRY_COMMAND_ALIASES,
  GeometryCommandInputError,
  prepareGeometryCommand,
  type GeometryCommandInput,
} from "../src/geometry-commands.js";
import { CadSession } from "../src/transaction.js";

describe("geometry command constructions", () => {
  it("creates a LINE sequence, including Close, as one deterministic result", () => {
    const result = prepareGeometryCommand({
      command: "LINE",
      handles: ["10", "11", "12"],
      layerId: "0",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
      close: true,
    });
    expect(result.resultHandles).toEqual(["10", "11", "12"]);
    expect(result.entities).toEqual([
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
      { kind: "line", handle: "12", layerId: "0", start: { x: 10, y: 5 }, end: { x: 0, y: 0 } },
    ]);
  });

  it("preserves PLINE line/arc bulges and widths", () => {
    const result = prepareGeometryCommand({
      command: "PLINE",
      handle: "20",
      layerId: "0",
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 20, y: 0, bulge: Math.tan(Math.PI / 8) },
        { x: 20, y: 20 },
      ],
      closed: true,
    });
    expect(result.entities[0]).toMatchObject({ kind: "polyline", handle: "20", closed: true });
    expect(result.entities[0]).toHaveProperty("vertices.1.bulge", Math.tan(Math.PI / 8));
  });

  it.each([
    ["center-radius", { mode: "center-radius", center: { x: 5, y: 6 }, radius: 4 }, { center: { x: 5, y: 6 }, radius: 4 }],
    ["center-diameter", { mode: "center-diameter", center: { x: 5, y: 6 }, diameter: 8 }, { center: { x: 5, y: 6 }, radius: 4 }],
    ["2p", { mode: "2p", first: { x: 1, y: 2 }, second: { x: 9, y: 2 } }, { center: { x: 5, y: 2 }, radius: 4 }],
    ["3p", { mode: "3p", first: { x: 10, y: 0 }, second: { x: 0, y: 10 }, third: { x: -10, y: 0 } }, { center: { x: 0, y: 0 }, radius: 10 }],
  ] as const)("supports the CIRCLE %s construction", (_label, construction, expected) => {
    const result = prepareGeometryCommand({ command: "CIRCLE", handle: "30", layerId: "0", construction });
    expect(result.entities[0]).toMatchObject({ kind: "circle", ...expected });
  });

  it("constructs ARC variants with an explicit sweep direction", () => {
    const threePoint = prepareGeometryCommand({
      command: "ARC",
      handle: "40",
      layerId: "0",
      construction: { mode: "3p", start: { x: 10, y: 0 }, point: { x: 0, y: 10 }, end: { x: -10, y: 0 } },
    }).entities[0];
    expect(threePoint).toMatchObject({ kind: "arc", center: { x: 0, y: 0 }, radius: 10, counterClockwise: true });

    const includedAngle = prepareGeometryCommand({
      command: "ARC",
      handle: "41",
      layerId: "0",
      construction: { mode: "start-end-angle", start: { x: 1, y: 0 }, end: { x: 0, y: 1 }, includedAngleRad: Math.PI / 2 },
    }).entities[0];
    expect(includedAngle).toMatchObject({ kind: "arc", counterClockwise: true });
    expect((includedAngle as { center: { x: number; y: number } }).center.x).toBeCloseTo(0, 12);
    expect((includedAngle as { center: { x: number; y: number } }).center.y).toBeCloseTo(0, 12);
  });

  it("creates inscribed, circumscribed and edge-defined regular polygons", () => {
    const inscribed = prepareGeometryCommand({
      command: "POLYGON",
      handle: "50",
      layerId: "0",
      sides: 4,
      construction: { mode: "inscribed", center: { x: 0, y: 0 }, radiusPoint: { x: 10, y: 0 } },
    }).entities[0];
    expect(inscribed).toMatchObject({ kind: "polyline", closed: true });
    expect(inscribed).toHaveProperty("vertices.length", 4);

    const circumscribed = prepareGeometryCommand({
      command: "POLYGON",
      handle: "51",
      layerId: "0",
      sides: 4,
      construction: { mode: "circumscribed", center: { x: 0, y: 0 }, apothemPoint: { x: 10, y: 0 } },
    }).entities[0];
    expect(circumscribed).toHaveProperty("vertices.0.x", 10 / Math.cos(Math.PI / 4));

    const edge = prepareGeometryCommand({
      command: "POLYGON",
      handle: "52",
      layerId: "0",
      sides: 3,
      construction: { mode: "edge", first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, side: "left" },
    }).entities[0];
    expect(edge).toMatchObject({ kind: "polyline", closed: true });
    expect((edge as { vertices: { x: number; y: number }[] }).vertices[0]!.x).toBeCloseTo(0, 12);
    expect((edge as { vertices: { x: number; y: number }[] }).vertices[0]!.y).toBeCloseTo(0, 12);
  });

  it("creates full and partial ellipses from both AutoCAD-style input modes", () => {
    const full = prepareGeometryCommand({
      command: "ELLIPSE",
      handle: "60",
      layerId: "0",
      construction: { mode: "axis-end", firstAxisEnd: { x: -10, y: 0 }, secondAxisEnd: { x: 10, y: 0 }, minorRadius: 5 },
    }).entities[0];
    expect(full).toEqual({
      kind: "ellipse", handle: "60", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5,
      startParameter: 0, endParameter: Math.PI * 2,
    });

    const arc = prepareGeometryCommand({
      command: "ELLIPSE",
      handle: "61",
      layerId: "0",
      construction: { mode: "center", center: { x: 2, y: 3 }, majorAxisEnd: { x: 12, y: 3 }, minorRadius: 4 },
      startParameter: Math.PI / 4,
      endParameter: Math.PI,
    }).entities[0];
    expect(arc).toMatchObject({ kind: "ellipse", center: { x: 2, y: 3 }, ratio: 0.4, startParameter: Math.PI / 4, endParameter: Math.PI });
  });

  it("converts a closed outline into a bulged REVCLOUD polyline", () => {
    const result = prepareGeometryCommand({
      command: "REVCLOUD",
      handle: "70",
      layerId: "0",
      outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
      arcLengthMin: 4,
      arcLengthMax: 6,
    });
    expect(result.entities[0]).toMatchObject({ kind: "polyline", closed: true });
    expect(result.entities[0]).toHaveProperty("vertices.length", 12);
    expect(result.entities[0]).toHaveProperty("vertices.0.bulge", Math.tan(Math.PI / 6));
  });

  it("maps documented aliases without taking over the shared command registry", () => {
    expect(GEOMETRY_COMMAND_ALIASES.L).toBe("LINE");
    expect(GEOMETRY_COMMAND_ALIASES.PL).toBe("PLINE");
    expect(GEOMETRY_COMMAND_ALIASES.EL).toBe("ELLIPSE");
  });
});

describe("geometry command atomicity and input mutations", () => {
  it("commits a multi-segment LINE as one operation and undoes/redoes it atomically", () => {
    const document = createEmptyDocument({ documentId: "geometry-atomic" });
    const session = new CadSession(document);
    const input: GeometryCommandInput = {
      command: "LINE", handles: ["80", "81"], layerId: "0",
      points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
    };
    const prepared = prepareGeometryCommand(input);
    session.commit({
      opId: "geometry:1", baseRevision: 0, commandId: prepared.commandId, args: input,
      targetHandles: [], resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T12:00:00.000Z");
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["80", "81"]);
    expect(session.nextUndoCommandId).toBe("LINE");
    session.undo("2026-08-31T12:00:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T12:00:02.000Z");
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["80", "81"]);
  });

  it.each([
    { command: "LINE", handles: ["1"], layerId: "0", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
    { command: "PLINE", handle: "2", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0, bulge: Number.NaN }] },
    { command: "CIRCLE", handle: "3", layerId: "0", construction: { mode: "3p", first: { x: 0, y: 0 }, second: { x: 1, y: 1 }, third: { x: 2, y: 2 } } },
    { command: "ARC", handle: "4", layerId: "0", construction: { mode: "start-center-angle", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad: 0 } },
    { command: "POLYGON", handle: "5", layerId: "0", sides: 2, construction: { mode: "inscribed", center: { x: 0, y: 0 }, radiusPoint: { x: 1, y: 0 } } },
    { command: "ELLIPSE", handle: "6", layerId: "0", construction: { mode: "center", center: { x: 0, y: 0 }, majorAxisEnd: { x: 1, y: 0 }, minorRadius: 2 } },
    { command: "REVCLOUD", handle: "7", layerId: "0", outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], arcLengthMin: 2, arcLengthMax: 1 },
  ] as GeometryCommandInput[])("rejects a mutated invalid $command input before changes are returned", (input) => {
    expect(() => prepareGeometryCommand(input)).toThrow(GeometryCommandInputError);
  });
});
