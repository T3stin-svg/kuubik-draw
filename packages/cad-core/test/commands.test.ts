import { describe, expect, it } from "vitest";
import { allocateEntityHandles, CadCommandInputError, createEmptyDocument, executeCopy, executeErase, executeMove, executeRectangle, parseCartesianPoint, parseCopyDestinations, parseMoveDestination, resolveCadCommand, translateCadEntity } from "../src/index.js";

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
