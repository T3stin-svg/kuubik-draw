import { describe, expect, it } from "vitest";
import { allocateEntityHandles, angleBetweenPointsDegrees, CadCommandInputError, createEmptyDocument, distanceBetweenPoints, executeCopy, executeErase, executeMirror, executeMove, executeRectangle, executeRotate, executeScale, mirrorCadEntity, mirrorCadPoint, parseAngleDegrees, parseCartesianPoint, parseCopyDestinations, parseMoveDestination, parseReferenceAngleInput, parseRotationAngleInput, parseScaleFactorInput, parseScaleLengthInput, resolveCadCommand, rotateCadEntity, rotateCadPoint, scaleCadEntity, scaleCadPoint, translateCadEntity } from "../src/index.js";

describe("RECTANGLE command registry", () => {
  it("parses explicit Cartesian coordinate input without mutating a document", () => {
    expect(parseCartesianPoint(" 100.25, -200.5 ")).toEqual({ x: 100.25, y: -200.5 });
    expect(() => parseCartesianPoint("100")).toThrow(CadCommandInputError);
    expect(() => parseCartesianPoint("100,")).toThrow(CadCommandInputError);
    expect(() => parseCartesianPoint("x,200")).toThrow(CadCommandInputError);
  });

  it("resolves AutoCAD-compatible command names through one registry", () => {
    expect(resolveCadCommand("rectang")?.id).toBe("RECTANGLE");
    expect(resolveCadCommand(" rectangle ")?.id).toBe("RECTANGLE");
    expect(resolveCadCommand("REC")?.id).toBe("RECTANGLE");
    expect(resolveCadCommand("unknown")).toBeNull();
  });

  it.each([
    [{ x: 100, y: 200 }, { x: 600, y: 900 }],
    [{ x: 600, y: 900 }, { x: 100, y: 200 }],
  ])("creates one closed four-vertex polyline while preserving corner order", (firstCorner, otherCorner) => {
    expect(executeRectangle({ handle: "10", layerId: "0", firstCorner, otherCorner })).toEqual([{
      type: "put",
      entity: {
        kind: "polyline",
        handle: "10",
        layerId: "0",
        closed: true,
        vertices: [
          { x: firstCorner.x, y: firstCorner.y },
          { x: otherCorner.x, y: firstCorner.y },
          { x: otherCorner.x, y: otherCorner.y },
          { x: firstCorner.x, y: otherCorner.y },
        ],
      },
    }]);
  });

  it("rejects degenerate and non-finite rectangles before a document mutation", () => {
    expect(() => executeRectangle({ handle: "10", layerId: "0", firstCorner: { x: 0, y: 0 }, otherCorner: { x: 0, y: 5 } })).toThrow(/non-zero/);
    expect(() => executeRectangle({ handle: "10", layerId: "0", firstCorner: { x: 0, y: 0 }, otherCorner: { x: Number.NaN, y: 5 } })).toThrow(/finite/);
  });
});

describe("ERASE command registry", () => {
  it("resolves AutoCAD-compatible aliases", () => {
    expect(resolveCadCommand("e")?.id).toBe("ERASE");
    expect(resolveCadCommand("DEL")?.id).toBe("ERASE");
    expect(resolveCadCommand("delete")?.id).toBe("ERASE");
  });

  it("deletes each editable handle once and truthfully rejects missing and locked targets", () => {
    const document = createEmptyDocument({ documentId: "erase" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
    );
    expect(executeErase(document, { targetHandles: ["10", "10", "11", "missing"] })).toEqual({
      changes: [{ type: "delete", handle: "10" }],
      erasedHandles: ["10"],
      rejected: [
        { handle: "11", reason: "locked-layer" },
        { handle: "missing", reason: "missing" },
      ],
    });
  });
});

describe("MOVE command registry", () => {
  it("resolves M/MOVE and parses absolute or @relative destination coordinates", () => {
    expect(resolveCadCommand("m")?.id).toBe("MOVE");
    expect(resolveCadCommand(" MOVE ")?.id).toBe("MOVE");
    expect(parseMoveDestination("600,950", { x: 100, y: 200 })).toEqual({ x: 600, y: 950 });
    expect(parseMoveDestination("@500,750", { x: 100, y: 200 })).toEqual({ x: 600, y: 950 });
    expect(() => parseMoveDestination("@500", { x: 100, y: 200 })).toThrow(CadCommandInputError);
  });

  it("moves an editable multi-selection once and preserves handles, style and polyline vertex data", () => {
    const document = createEmptyDocument({ documentId: "move" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 0, y: 1000, bulge: 0.5, startWidth: 2 }, { x: 1000, y: 1000, endWidth: 3 }] },
    );
    expect(executeMove(document, {
      targetHandles: ["10", "10", "11"],
      basePoint: { x: 100, y: 200 },
      destinationPoint: { x: 600, y: 950 },
    })).toEqual({
      changes: [
        { type: "put", entity: { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } },
        { type: "put", entity: { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 500, y: 1750, bulge: 0.5, startWidth: 2 }, { x: 1500, y: 1750, endWidth: 3 }] } },
      ],
      movedHandles: ["10", "11"],
      rejected: [],
      delta: { x: 500, y: 750 },
    });
  });

  it("translates every standard KDraw entity family exactly and refuses opaque proxies", () => {
    const delta = { x: 5, y: -2 };
    expect(translateCadEntity({ kind: "line", handle: "1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 2, y: 3 } }, delta)).toEqual({
      kind: "line", handle: "1", layerId: "0", start: { x: 5, y: -2 }, end: { x: 7, y: 1 },
    });
    expect(translateCadEntity({ kind: "polyline", handle: "2", layerId: "0", closed: true, vertices: [{ x: 0, y: 0, bulge: 0.5 }, { x: 2, y: 3, startWidth: 4, endWidth: 6 }] }, delta)).toEqual({
      kind: "polyline", handle: "2", layerId: "0", closed: true, vertices: [{ x: 5, y: -2, bulge: 0.5 }, { x: 7, y: 1, startWidth: 4, endWidth: 6 }],
    });
    expect(translateCadEntity({ kind: "circle", handle: "3", layerId: "0", center: { x: 1, y: 2 }, radius: 3 }, delta)).toEqual({ kind: "circle", handle: "3", layerId: "0", center: { x: 6, y: 0 }, radius: 3 });
    expect(translateCadEntity({ kind: "arc", handle: "4", layerId: "0", center: { x: 2, y: 3 }, radius: 4, startAngleRad: 0, endAngleRad: 1, counterClockwise: true }, delta)).toMatchObject({ center: { x: 7, y: 1 }, radius: 4, startAngleRad: 0, endAngleRad: 1 });
    expect(translateCadEntity({ kind: "ellipse", handle: "5", layerId: "0", center: { x: 3, y: 4 }, majorAxis: { x: 5, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: 6.28 }, delta)).toMatchObject({ center: { x: 8, y: 2 }, majorAxis: { x: 5, y: 0 } });
    expect(translateCadEntity({ kind: "spline", handle: "6", layerId: "0", degree: 2, controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false }, delta)).toMatchObject({ controlPoints: [{ x: 5, y: -2 }, { x: 6, y: -1 }, { x: 7, y: -2 }], knots: [0, 0, 0, 1, 1, 1] });
    expect(translateCadEntity({ kind: "mtext", handle: "7", layerId: "0", position: { x: 5, y: 6 }, text: "A", height: 2, rotationRad: 0 }, delta)).toMatchObject({ position: { x: 10, y: 4 }, text: "A" });
    expect(translateCadEntity({ kind: "leader", handle: "8", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }, delta)).toMatchObject({ vertices: [{ x: 5, y: -2 }, { x: 6, y: 0 }] });
    expect(translateCadEntity({ kind: "dimension", handle: "9", layerId: "0", dimensionKind: "linear", definitionPoints: [{ x: 0, y: 0 }, { x: 4, y: 0 }], styleId: "standard" }, delta)).toMatchObject({ definitionPoints: [{ x: 5, y: -2 }, { x: 9, y: -2 }] });
    expect(translateCadEntity({ kind: "hatch", handle: "A", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] }] }, delta)).toMatchObject({ loops: [{ isHole: false, vertices: [{ x: 5, y: -2 }, { x: 7, y: -2 }, { x: 7, y: 0 }] }] });
    expect(translateCadEntity({ kind: "blockRef", handle: "B", layerId: "0", blockId: "b", insertion: { x: 10, y: 20 }, scale: { x: 1, y: 1 }, rotationRad: 0 }, delta)).toMatchObject({ insertion: { x: 15, y: 18 }, blockId: "b" });
    expect(translateCadEntity({ kind: "proxy", handle: "C", layerId: "0", originalType: "ACAD_PROXY", raw: {} }, delta)).toBeNull();
  });

  it("rejects locked, missing and unsupported targets and treats zero displacement as a no-op", () => {
    const document = createEmptyDocument({ documentId: "move-guard" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "proxy", handle: "11", layerId: "0", originalType: "CUSTOM", raw: {} },
    );
    expect(executeMove(document, { targetHandles: ["10", "11", "missing"], basePoint: { x: 0, y: 0 }, destinationPoint: { x: 1, y: 1 } })).toEqual({
      changes: [],
      movedHandles: [],
      rejected: [
        { handle: "10", reason: "locked-layer" },
        { handle: "11", reason: "unsupported-entity" },
        { handle: "missing", reason: "missing" },
      ],
      delta: { x: 1, y: 1 },
    });
    expect(executeMove(document, { targetHandles: ["10", "missing"], basePoint: { x: 20, y: 30 }, destinationPoint: { x: 20, y: 30 } })).toEqual({
      changes: [], movedHandles: [], rejected: [], delta: { x: 0, y: 0 },
    });
  });
});

describe("COPY command registry", () => {
  it("resolves CO/CP/COPY and parses one or repeated absolute/@relative destinations", () => {
    expect(resolveCadCommand("co")?.id).toBe("COPY");
    expect(resolveCadCommand(" CP ")?.id).toBe("COPY");
    expect(resolveCadCommand("copy")?.id).toBe("COPY");
    expect(parseCopyDestinations("600,950; @-300,100\n1100,1700", { x: 100, y: 200 })).toEqual([
      { x: 600, y: 950 },
      { x: -200, y: 300 },
      { x: 1100, y: 1700 },
    ]);
    expect(() => parseCopyDestinations(" ; \n", { x: 0, y: 0 })).toThrow(/at least one/);
  });

  it("allocates deterministic collision-free uppercase hexadecimal handles", () => {
    const document = createEmptyDocument({ documentId: "handles" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "line", handle: "legacy-id", layerId: "0", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
      { kind: "line", handle: "1A", layerId: "0", start: { x: 0, y: 2 }, end: { x: 1, y: 2 } },
    );
    document.blocks.push({
      id: "block-1",
      name: "Handle collision fixture",
      basePoint: { x: 0, y: 0 },
      entities: [{ kind: "line", handle: "1B", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
    });
    expect(allocateEntityHandles(document, 3)).toEqual(["1C", "1D", "1E"]);
    expect(() => allocateEntityHandles(document, -1)).toThrow(CadCommandInputError);
  });

  it("copies the original pickset to every destination, preserves properties and leaves originals untouched", () => {
    const document = createEmptyDocument({ documentId: "copy" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 0, y: 1000, bulge: 0.5, startWidth: 2 }, { x: 1000, y: 1000, endWidth: 3 }] },
    );
    expect(executeCopy(document, {
      targetHandles: ["10", "10", "11"],
      basePoint: { x: 100, y: 200 },
      destinationPoints: [{ x: 600, y: 950 }, { x: -200, y: 300 }],
    })).toEqual({
      changes: [
        { type: "put", entity: { kind: "line", handle: "12", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } },
        { type: "put", entity: { kind: "polyline", handle: "13", layerId: "0", closed: false, vertices: [{ x: 500, y: 1750, bulge: 0.5, startWidth: 2 }, { x: 1500, y: 1750, endWidth: 3 }] } },
        { type: "put", entity: { kind: "line", handle: "14", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: -300, y: 100 }, end: { x: 700, y: 100 } } },
        { type: "put", entity: { kind: "polyline", handle: "15", layerId: "0", closed: false, vertices: [{ x: -300, y: 1100, bulge: 0.5, startWidth: 2 }, { x: 700, y: 1100, endWidth: 3 }] } },
      ],
      sourceHandles: ["10", "11"],
      copiedHandles: ["12", "13", "14", "15"],
      rejected: [],
      deltas: [{ x: 500, y: 750 }, { x: -300, y: 100 }],
    });
    expect(document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });

  it("allows coincident copies and rejects locked, missing and opaque proxy targets once per source", () => {
    const document = createEmptyDocument({ documentId: "copy-guards" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "proxy", handle: "12", layerId: "0", originalType: "CUSTOM", raw: { preserved: true } },
    );
    expect(executeCopy(document, {
      targetHandles: ["10", "11", "12", "missing"],
      basePoint: { x: 20, y: 30 },
      destinationPoints: [{ x: 20, y: 30 }],
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "13", layerId: "0", start: { x: 1, y: 2 }, end: { x: 3, y: 4 } } }],
      sourceHandles: ["10"],
      copiedHandles: ["13"],
      rejected: [
        { handle: "11", reason: "locked-layer" },
        { handle: "12", reason: "unsupported-entity" },
        { handle: "missing", reason: "missing" },
      ],
      deltas: [{ x: 0, y: 0 }],
    });
  });
});

describe("ROTATE command registry", () => {
  it("resolves RO/ROTATE and parses numeric, point and Reference angle input", () => {
    expect(resolveCadCommand("ro")?.id).toBe("ROTATE");
    expect(resolveCadCommand(" ROTATE ")?.id).toBe("ROTATE");
    expect(parseAngleDegrees("-45.5")).toBe(-45.5);
    expect(parseRotationAngleInput("135", { x: 100, y: 200 })).toBe(135);
    expect(parseRotationAngleInput("100,1200", { x: 100, y: 200 })).toBe(90);
    expect(parseReferenceAngleInput("45", { x: 100, y: 200 })).toBe(45);
    expect(parseReferenceAngleInput("1100,1200", { x: 100, y: 200 })).toBe(45);
    expect(parseReferenceAngleInput("100,200; 1100,1200", { x: 0, y: 0 })).toBe(45);
    expect(angleBetweenPointsDegrees({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(-90);
    expect(() => parseAngleDegrees("Infinity")).toThrow(CadCommandInputError);
    expect(() => parseReferenceAngleInput("100,200; 100,200", { x: 0, y: 0 })).toThrow(/coincide/);
    expect(() => parseReferenceAngleInput("0,0; 1,0; 2,0", { x: 0, y: 0 })).toThrow(/Reference angle/);
  });

  it("rotates points and every standard KDraw entity family counterclockwise around a base", () => {
    const base = { x: 100, y: 200 };
    const quarterTurn = Math.PI / 2;
    expect(rotateCadPoint({ x: 1100, y: 200 }, base, quarterTurn)).toEqual({ x: 100, y: 1200 });
    expect(rotateCadEntity({ kind: "line", handle: "1", layerId: "0", start: { x: 100, y: 200 }, end: { x: 1100, y: 200 } }, base, quarterTurn)).toMatchObject({ start: { x: 100, y: 200 }, end: { x: 100, y: 1200 } });
    expect(rotateCadEntity({ kind: "polyline", handle: "2", layerId: "0", closed: false, vertices: [{ x: 100, y: 200, bulge: 0.5, startWidth: 2 }, { x: 1100, y: 200, endWidth: 3 }] }, base, quarterTurn)).toMatchObject({ vertices: [{ x: 100, y: 200, bulge: 0.5, startWidth: 2 }, { x: 100, y: 1200, endWidth: 3 }] });
    expect(rotateCadEntity({ kind: "circle", handle: "3", layerId: "0", center: { x: 300, y: 200 }, radius: 25 }, base, quarterTurn)).toMatchObject({ center: { x: 100, y: 400 }, radius: 25 });
    expect(rotateCadEntity({ kind: "arc", handle: "4", layerId: "0", center: { x: 500, y: 200 }, radius: 30, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true }, base, quarterTurn)).toMatchObject({ center: { x: 100, y: 600 }, startAngleRad: Math.PI / 2, endAngleRad: Math.PI });
    expect(rotateCadEntity({ kind: "ellipse", handle: "5", layerId: "0", center: { x: 700, y: 200 }, majorAxis: { x: 50, y: 10 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 }, base, quarterTurn)).toMatchObject({ center: { x: 100, y: 800 }, majorAxis: { x: -10, y: 50 } });
    expect(rotateCadEntity({ kind: "spline", handle: "6", layerId: "0", degree: 2, controlPoints: [{ x: 100, y: 200 }, { x: 150, y: 275 }, { x: 200, y: 200 }], knots: [0, 0, 0, 1, 1, 1], closed: false, periodic: false }, base, quarterTurn)).toMatchObject({ controlPoints: [{ x: 100, y: 200 }, { x: 25, y: 250 }, { x: 100, y: 300 }] });
    expect(rotateCadEntity({ kind: "text", handle: "7", layerId: "0", position: { x: 1100, y: 200 }, text: "A", height: 20, rotationRad: 0.25 }, base, quarterTurn)).toMatchObject({ position: { x: 100, y: 1200 }, rotationRad: 0.25 + Math.PI / 2 });
    expect(rotateCadEntity({ kind: "mtext", handle: "8", layerId: "0", position: { x: 100, y: 300 }, text: "B", height: 20, rotationRad: 0 }, base, quarterTurn)).toMatchObject({ position: { x: 0, y: 200 }, rotationRad: Math.PI / 2 });
    expect(rotateCadEntity({ kind: "leader", handle: "9", layerId: "0", vertices: [{ x: 100, y: 200 }, { x: 200, y: 300 }] }, base, quarterTurn)).toMatchObject({ vertices: [{ x: 100, y: 200 }, { x: 0, y: 300 }] });
    expect(rotateCadEntity({ kind: "dimension", handle: "A", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 100, y: 250 }], styleId: "STANDARD" }, base, quarterTurn)).toMatchObject({ definitionPoints: [{ x: 100, y: 200 }, { x: 100, y: 300 }, { x: 50, y: 200 }] });
    expect(rotateCadEntity({ kind: "hatch", handle: "B", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 100, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 300 }] }] }, base, quarterTurn)).toMatchObject({ loops: [{ vertices: [{ x: 100, y: 200 }, { x: 100, y: 300 }, { x: 0, y: 300 }] }] });
    expect(rotateCadEntity({ kind: "blockRef", handle: "C", layerId: "0", blockId: "b", insertion: { x: 300, y: 200 }, scale: { x: 1.5, y: 0.5 }, rotationRad: 0.25 }, base, quarterTurn)).toMatchObject({ insertion: { x: 100, y: 400 }, rotationRad: 0.25 + Math.PI / 2, scale: { x: 1.5, y: 0.5 } });
    expect(rotateCadEntity({ kind: "proxy", handle: "D", layerId: "0", originalType: "CUSTOM", raw: { preserved: true } }, base, quarterTurn)).toBeNull();
  });

  it("applies relative and Reference rotation once while preserving handles/styles and rejecting guarded targets", () => {
    const document = createEmptyDocument({ documentId: "rotate" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
      { kind: "proxy", handle: "12", layerId: "0", originalType: "CUSTOM", raw: {} },
    );
    expect(executeRotate(document, {
      targetHandles: ["10", "10", "11", "12", "missing"],
      basePoint: { x: 100, y: 200 },
      angle: { mode: "reference", referenceAngleDeg: 45, newAngleDeg: 135 },
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 300, y: 100 }, end: { x: 300, y: 1100 } } }],
      rotatedHandles: ["10"],
      rejected: [
        { handle: "11", reason: "locked-layer" },
        { handle: "12", reason: "unsupported-entity" },
        { handle: "missing", reason: "missing" },
      ],
      deltaAngleDeg: 90,
    });
    expect(executeRotate(document, {
      targetHandles: ["10"], basePoint: { x: 0, y: 0 }, angle: { mode: "relative", angleDeg: -90 },
    }).changes[0]).toMatchObject({ entity: { end: { x: 0, y: -1000 } } });
  });

  it("treats zero, full-turn and equal Reference angles as no-op without rejects or undo changes", () => {
    const document = createEmptyDocument({ documentId: "rotate-noop" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    for (const angle of [
      { mode: "relative", angleDeg: 0 } as const,
      { mode: "relative", angleDeg: 360 } as const,
      { mode: "reference", referenceAngleDeg: 45, newAngleDeg: 45 } as const,
    ]) {
      expect(executeRotate(document, { targetHandles: ["10", "missing"], basePoint: { x: 0, y: 0 }, angle })).toEqual({
        changes: [], rotatedHandles: [], rejected: [], deltaAngleDeg: angle.mode === "relative" ? angle.angleDeg : 0,
      });
    }
  });
});

describe("SCALE command registry", () => {
  it("resolves SC/SCALE and parses a positive numeric factor and Reference lengths", () => {
    const base = { x: 100, y: 200 };
    expect(resolveCadCommand("sc")?.id).toBe("SCALE");
    expect(resolveCadCommand(" SCALE ")?.id).toBe("SCALE");
    expect(parseScaleFactorInput("2.5", base)).toBe(2.5);
    expect(() => parseScaleFactorInput("100,1200", base)).toThrow(CadCommandInputError);
    expect(parseScaleLengthInput("1000", base)).toBe(1000);
    expect(parseScaleLengthInput("1100,200", base)).toBe(1000);
    expect(parseScaleLengthInput("100,200; 1100,200", { x: 0, y: 0 })).toBe(1000);
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    for (const value of ["0", "-2", "Infinity", "NaN", ""]) {
      expect(() => parseScaleFactorInput(value, base)).toThrow(CadCommandInputError);
    }
    expect(() => parseScaleLengthInput("100,200;100,200", base)).toThrow(/coincide/);
    expect(() => parseScaleLengthInput("0,0;1,0;2,0", base)).toThrow(/Scale length/);
  });

  it("scales points and every standard KDraw entity family around a base", () => {
    const base = { x: 100, y: 200 };
    expect(scaleCadPoint({ x: 1100, y: 1200 }, base, 2)).toEqual({ x: 2100, y: 2200 });
    expect(scaleCadEntity({ kind: "line", handle: "1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 50, y: 0 } }, base, 2)).toMatchObject({ start: { x: -100, y: -200 }, end: { x: 0, y: -200 } });
    expect(scaleCadEntity({ kind: "polyline", handle: "2", layerId: "0", closed: false, vertices: [{ x: 100, y: 0, bulge: 0.5, startWidth: 2 }, { x: 200, y: 0, endWidth: 3 }] }, base, 2)).toMatchObject({ vertices: [{ x: 100, y: -200, bulge: 0.5, startWidth: 4 }, { x: 300, y: -200, endWidth: 6 }] });
    expect(scaleCadEntity({ kind: "circle", handle: "3", layerId: "0", center: { x: 300, y: 0 }, radius: 25 }, base, 2)).toMatchObject({ center: { x: 500, y: -200 }, radius: 50 });
    expect(scaleCadEntity({ kind: "arc", handle: "4", layerId: "0", center: { x: 500, y: 0 }, radius: 30, startAngleRad: 0.25, endAngleRad: 1.5, counterClockwise: true }, base, 2)).toMatchObject({ center: { x: 900, y: -200 }, radius: 60, startAngleRad: 0.25, endAngleRad: 1.5 });
    expect(scaleCadEntity({ kind: "ellipse", handle: "5", layerId: "0", center: { x: 700, y: 0 }, majorAxis: { x: 50, y: 10 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 }, base, 2)).toMatchObject({ center: { x: 1300, y: -200 }, majorAxis: { x: 100, y: 20 }, ratio: 0.5 });
    expect(scaleCadEntity({ kind: "spline", handle: "6", layerId: "0", degree: 2, controlPoints: [{ x: 900, y: 0 }, { x: 950, y: 75 }, { x: 1000, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.75, 1], closed: false, periodic: false }, base, 2)).toMatchObject({ controlPoints: [{ x: 1700, y: -200 }, { x: 1800, y: -50 }, { x: 1900, y: -200 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.75, 1] });
    expect(scaleCadEntity({ kind: "text", handle: "7", layerId: "0", position: { x: 1100, y: 0 }, text: "A", height: 20, rotationRad: 0.25 }, base, 2)).toMatchObject({ position: { x: 2100, y: -200 }, height: 40, rotationRad: 0.25 });
    expect(scaleCadEntity({ kind: "mtext", handle: "8", layerId: "0", position: { x: 1250, y: 0 }, text: "B", height: 20, rotationRad: 0 }, base, 2)).toMatchObject({ position: { x: 2400, y: -200 }, height: 40 });
    expect(scaleCadEntity({ kind: "leader", handle: "9", layerId: "0", vertices: [{ x: 1400, y: 0 }, { x: 1450, y: 50 }] }, base, 2)).toMatchObject({ vertices: [{ x: 2700, y: -200 }, { x: 2800, y: -100 }] });
    expect(scaleCadEntity({ kind: "dimension", handle: "A", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 1550, y: 0 }, { x: 1650, y: 0 }, { x: 1550, y: 50 }], styleId: "STANDARD" }, base, 2)).toMatchObject({ definitionPoints: [{ x: 3000, y: -200 }, { x: 3200, y: -200 }, { x: 3000, y: -100 }] });
    expect(scaleCadEntity({ kind: "hatch", handle: "B", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 1700, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 100 }] }] }, base, 2)).toMatchObject({ loops: [{ vertices: [{ x: 3300, y: -200 }, { x: 3500, y: -200 }, { x: 3500, y: 0 }] }] });
    expect(scaleCadEntity({ kind: "blockRef", handle: "C", layerId: "0", blockId: "b", insertion: { x: 1900, y: 0 }, scale: { x: 1.5, y: -0.5 }, rotationRad: 0.25 }, base, 2)).toMatchObject({ insertion: { x: 3700, y: -200 }, scale: { x: 3, y: -1 }, rotationRad: 0.25 });
    expect(scaleCadEntity({ kind: "proxy", handle: "D", layerId: "0", originalType: "CUSTOM", raw: { preserved: true } }, base, 2)).toBeNull();
  });

  it("applies Reference scale once while preserving handles/styles and rejecting guarded targets", () => {
    const document = createEmptyDocument({ documentId: "scale" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
      { kind: "proxy", handle: "12", layerId: "0", originalType: "CUSTOM", raw: {} },
    );
    expect(executeScale(document, {
      targetHandles: ["10", "10", "11", "12", "missing"],
      basePoint: { x: 100, y: 200 },
      scale: { mode: "reference", referenceLength: 1000, newLength: 2000 },
      copy: false,
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, start: { x: -100, y: -200 }, end: { x: 1900, y: -200 } } }],
      sourceHandles: ["10"],
      scaledHandles: ["10"],
      createdHandles: [],
      rejected: [
        { handle: "11", reason: "locked-layer" },
        { handle: "12", reason: "unsupported-entity" },
        { handle: "missing", reason: "missing" },
      ],
      factor: 2,
      copy: false,
    });
  });

  it("creates a same-factor scaled copy with a fresh global handle and leaves sources unchanged", () => {
    const document = createEmptyDocument({ documentId: "scale-copy" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
    document.blocks.push({ id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    expect(executeScale(document, {
      targetHandles: ["10"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 1 }, copy: true,
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "12", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } } }],
      sourceHandles: ["10"], scaledHandles: [], createdHandles: ["12"], rejected: [], factor: 1, copy: true,
    });
    expect(document.entities).toHaveLength(1);
  });

  it("treats factor one as a no-op and rejects zero, negative or invalid Reference ratios", () => {
    const document = createEmptyDocument({ documentId: "scale-noop" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    expect(executeScale(document, {
      targetHandles: ["10", "missing"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 1 }, copy: false,
    })).toEqual({
      changes: [], sourceHandles: ["10"], scaledHandles: [], createdHandles: [],
      rejected: [{ handle: "missing", reason: "missing" }], factor: 1, copy: false,
    });
    for (const scale of [
      { mode: "factor", factor: 0 } as const,
      { mode: "factor", factor: -1 } as const,
      { mode: "reference", referenceLength: 0, newLength: 1 } as const,
      { mode: "reference", referenceLength: 1, newLength: 0 } as const,
    ]) {
      expect(() => executeScale(document, { targetHandles: ["10"], basePoint: { x: 0, y: 0 }, scale, copy: false })).toThrow(/greater than zero/);
    }
  });

  it("rejects scale operations that overflow or collapse finite geometry", () => {
    const document = createEmptyDocument({ documentId: "scale-extremes" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 1, y: 1 }, end: { x: 2, y: 2 } });

    expect(() => executeScale(document, {
      targetHandles: ["10"], basePoint: { x: 0, y: 0 }, scale: { mode: "factor", factor: 1e308 }, copy: false,
    })).toThrow(CadCommandInputError);
    expect(() => executeScale(document, {
      targetHandles: ["10"], basePoint: { x: 1, y: 1 }, scale: { mode: "factor", factor: Number.MIN_VALUE }, copy: false,
    })).toThrow(CadCommandInputError);
    expect(() => scaleCadEntity({
      kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 1e-300,
    }, { x: 0, y: 0 }, 1e-300)).toThrow(CadCommandInputError);
  });
});

describe("MIRROR command registry", () => {
  it("resolves MI/MIRROR and reflects points around an arbitrary two-point line", () => {
    expect(resolveCadCommand("mi")?.id).toBe("MIRROR");
    expect(resolveCadCommand(" MIRROR ")?.id).toBe("MIRROR");
    expect(mirrorCadPoint({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(mirrorCadPoint({ x: 10, y: 5 }, { x: 10, y: -5 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 5 });
    expect(() => mirrorCadPoint({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(CadCommandInputError);
    expect(() => mirrorCadPoint({ x: Number.POSITIVE_INFINITY, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toThrow(CadCommandInputError);
  });

  it("mirrors all twelve native entity families with handedness and properties preserved", () => {
    const axisStart = { x: 10, y: -100 };
    const axisEnd = { x: 10, y: 100 };
    expect(mirrorCadEntity({ kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00" }, start: { x: 0, y: 0 }, end: { x: 2, y: 1 } }, axisStart, axisEnd)).toMatchObject({ start: { x: 20, y: 0 }, end: { x: 18, y: 1 }, appearance: { color: "#f00" } });
    expect(mirrorCadEntity({ kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 1, y: 2, bulge: 0.5, startWidth: 4 }, { x: 3, y: 4 }] }, axisStart, axisEnd)).toMatchObject({ vertices: [{ x: 19, y: 2, bulge: -0.5, startWidth: 4 }, { x: 17, y: 4 }] });
    expect(mirrorCadEntity({ kind: "circle", handle: "12", layerId: "0", center: { x: 2, y: 3 }, radius: 5 }, axisStart, axisEnd)).toMatchObject({ center: { x: 18, y: 3 }, radius: 5 });
    expect(mirrorCadEntity({ kind: "arc", handle: "13", layerId: "0", center: { x: 4, y: 3 }, radius: 5, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true }, axisStart, axisEnd)).toMatchObject({ center: { x: 16, y: 3 }, startAngleRad: Math.PI, endAngleRad: Math.PI / 2, counterClockwise: false });
    expect(mirrorCadEntity({ kind: "ellipse", handle: "14", layerId: "0", center: { x: 5, y: 3 }, majorAxis: { x: 3, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 }, axisStart, axisEnd)).toMatchObject({ center: { x: 15, y: 3 }, majorAxis: { x: -3, y: 0 }, startParameter: 0, endParameter: Math.PI * 2 });
    expect(mirrorCadEntity({ kind: "spline", handle: "15", layerId: "0", degree: 2, controlPoints: [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 2, 1], closed: false, periodic: false }, axisStart, axisEnd)).toMatchObject({ controlPoints: [{ x: 19, y: 0 }, { x: 18, y: 1 }, { x: 17, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 2, 1] });
    expect(mirrorCadEntity({ kind: "text", handle: "16", layerId: "0", position: { x: 3, y: 0 }, text: "READ", height: 20, rotationRad: 0, styleId: "standard" }, axisStart, axisEnd)).toMatchObject({ position: { x: 17, y: 0 }, text: "READ", rotationRad: 0, styleId: "standard" });
    expect(mirrorCadEntity({ kind: "mtext", handle: "17", layerId: "0", position: { x: 4, y: 0 }, text: "READ", height: 20, rotationRad: 0.25 }, axisStart, axisEnd)).toMatchObject({ position: { x: 16, y: 0 }, rotationRad: Math.PI * 2 - 0.25 });
    expect(mirrorCadEntity({ kind: "leader", handle: "18", layerId: "0", vertices: [{ x: 1, y: 0 }, { x: 2, y: 2 }], text: "L" }, axisStart, axisEnd)).toMatchObject({ vertices: [{ x: 19, y: 0 }, { x: 18, y: 2 }], text: "L" });
    expect(mirrorCadEntity({ kind: "dimension", handle: "19", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }], styleId: "standard" }, axisStart, axisEnd)).toMatchObject({ definitionPoints: [{ x: 19, y: 0 }, { x: 18, y: 0 }, { x: 19, y: 2 }], styleId: "standard" });
    expect(mirrorCadEntity({ kind: "hatch", handle: "1A", layerId: "0", pattern: "SOLID", associative: true, loops: [{ vertices: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], isHole: false }] }, axisStart, axisEnd)).toMatchObject({ loops: [{ vertices: [{ x: 19, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 1 }], isHole: false }] });
    expect(mirrorCadEntity({ kind: "blockRef", handle: "1B", layerId: "0", blockId: "B", insertion: { x: 2, y: 0 }, scale: { x: 2, y: 3 }, rotationRad: 0.5, attributes: { TAG: "V" } }, axisStart, axisEnd)).toMatchObject({ insertion: { x: 18, y: 0 }, scale: { x: -2, y: 3 }, rotationRad: Math.PI * 2 - 0.5, attributes: { TAG: "V" } });
    expect(mirrorCadEntity({ kind: "proxy", handle: "1C", layerId: "0", originalType: "ACAD_PROXY", raw: {} }, axisStart, axisEnd)).toBeNull();
  });

  it("changes text alignment only when MIRRTEXT=0 readability adds a 180-degree flip", () => {
    const text = {
      kind: "text" as const, handle: "10", layerId: "0", position: { x: 3, y: 2 },
      text: "READ", height: 20, rotationRad: 0, styleId: "standard",
      extensionData: { kuubikMirrorTextAlign: "start" },
    };
    expect(mirrorCadEntity(text, { x: -10, y: 0 }, { x: 10, y: 0 })).toMatchObject({
      position: { x: 3, y: -2 }, rotationRad: 0,
      extensionData: { kuubikMirrorTextAlign: "start" },
    });
    expect(mirrorCadEntity(text, { x: 0, y: 0 }, { x: 1, y: 1 })).toMatchObject({
      position: { x: 2, y: 3 }, rotationRad: Math.PI / 2,
      extensionData: { kuubikMirrorTextAlign: "start" },
    });
    expect(mirrorCadEntity(text, { x: 10, y: -10 }, { x: 10, y: 10 })).toMatchObject({
      position: { x: 17, y: 2 }, rotationRad: 0,
      extensionData: { kuubikMirrorTextAlign: "end" },
    });
  });

  it("preserves sources by default, allocates fresh global handles and reports explicit rejections", () => {
    const document = createEmptyDocument({ documentId: "mirror-copy" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
      { kind: "proxy", handle: "12", layerId: "0", originalType: "X", raw: {} },
    );
    document.blocks.push({ id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "13", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    expect(executeMirror(document, {
      targetHandles: ["10", "10", "11", "12", "missing"], axisStart: { x: 5, y: -1 }, axisEnd: { x: 5, y: 1 }, eraseSource: false,
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "14", layerId: "0", start: { x: 10, y: 0 }, end: { x: 9, y: 0 } } }],
      sourceHandles: ["10"], mirroredHandles: ["14"], createdHandles: ["14"],
      rejected: [
        { handle: "11", reason: "locked-layer" },
        { handle: "12", reason: "unsupported-entity" },
        { handle: "missing", reason: "missing" },
      ],
      eraseSource: false,
    });
    expect(document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12"]);
  });

  it("replaces editable sources under their stable handles when erase source is Yes", () => {
    const document = createEmptyDocument({ documentId: "mirror-replace" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 2, y: 0 } });
    expect(executeMirror(document, {
      targetHandles: ["10"], axisStart: { x: 5, y: -1 }, axisEnd: { x: 5, y: 1 }, eraseSource: true,
    })).toEqual({
      changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 0 }, end: { x: 8, y: 0 } } }],
      sourceHandles: ["10"], mirroredHandles: ["10"], createdHandles: [], rejected: [], eraseSource: true,
    });
  });
});
