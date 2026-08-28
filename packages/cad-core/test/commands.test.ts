import { describe, expect, it } from "vitest";
import { CadCommandInputError, createEmptyDocument, executeErase, executeRectangle, parseCartesianPoint, resolveCadCommand } from "../src/index.js";

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
