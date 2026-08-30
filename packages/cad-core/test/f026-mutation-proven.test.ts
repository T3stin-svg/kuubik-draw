import { describe, expect, it } from "vitest";
import { CadSession, breakCadEntity, createEmptyDocument, executeBreak, parseBreakTargetPicks } from "../src/index.js";

const line = {
  kind: "line" as const, handle: "10", layerId: "0",
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
  appearance: { color: "#09f", linetypeId: "dash", lineweightMm: 0.5 },
  extensionData: { rowId: "F-026" },
};

describe("F-026 mutation-proven BREAK ratchet", () => {
  it("kills unprojected-point, reversed-interval, property-loss and source-mutation mutants", () => {
    const source = structuredClone(line);
    const result = breakCadEntity(line, { x: 20, y: 50 }, { x: 80, y: -20 });
    expect(result).toMatchObject({
      reason: null,
      breakPoints: [{ x: 20, y: 0 }, { x: 80, y: 0 }],
      parameters: [0.2, 0.8],
      removedInterval: { start: 0.2, end: 0.8, wraps: false },
      entities: [
        { end: { x: 20, y: 0 }, appearance: { color: "#09f", linetypeId: "dash", lineweightMm: 0.5 }, extensionData: { rowId: "F-026" } },
        { start: { x: 80, y: 0 }, appearance: { color: "#09f", linetypeId: "dash", lineweightMm: 0.5 }, extensionData: { rowId: "F-026" } },
      ],
    });
    expect(line).toEqual(source);
  });

  it("kills closed-curve undirected and illegal single-point mutants", () => {
    const circle = { kind: "circle" as const, handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 100 };
    const wrapped = breakCadEntity(circle, { x: 0, y: 100 }, { x: 100, y: 0 });
    expect(wrapped).toMatchObject({ reason: null, removedInterval: { start: 0.25, end: 0, wraps: true }, entities: [{ kind: "arc" }] });
    if (wrapped.entities[0]?.kind !== "arc") throw new Error("Expected wrapped circle BREAK arc.");
    expect(wrapped.entities[0].startAngleRad).toBeCloseTo(Math.PI * 2, 11);
    expect(wrapped.entities[0].endAngleRad).toBeCloseTo(Math.PI * 2.5, 11);
    const atPoint = breakCadEntity(circle, { x: 0, y: 100 }, undefined, "at-point");
    expect(atPoint).toMatchObject({ reason: "closed-at-point", entities: [], breakPoints: null });
  });

  it("kills polyline path-collapse, bulge and interpolated-width mutants", () => {
    const polyline = {
      kind: "polyline" as const, handle: "30", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, bulge: 1, startWidth: 4, endWidth: 6 },
        { x: 100, y: 100, startWidth: 6, endWidth: 8 },
        { x: 200, y: 100 },
      ],
    };
    const result = breakCadEntity(polyline, { x: 25, y: 0 }, { x: 175, y: 100 });
    expect(result.entities).toEqual([
      { ...polyline, closed: false, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 2.5 }, { x: 25, y: 0, startWidth: 2, endWidth: 2.5 }] },
      { ...polyline, closed: false, vertices: [{ x: 175, y: 100, startWidth: 7.5, endWidth: 8 }, { x: 200, y: 100, startWidth: 7.5, endWidth: 8 }] },
    ]);
  });

  it("kills parser mode-confusion and malformed-target acceptance mutants", () => {
    expect(parseBreakTargetPicks("10@20,0>80,0; 20@50,0>@")).toEqual([
      { handle: "10", firstPoint: { x: 20, y: 0 }, secondPoint: { x: 80, y: 0 }, mode: "two-point" },
      { handle: "20", firstPoint: { x: 50, y: 0 }, mode: "at-point" },
    ]);
    for (const malformed of ["", "10", "10@20,0", "10@20,0>", "10 20@20,0>80,0", "10@NaN,0>80,0"]) {
      expect(() => parseBreakTargetPicks(malformed)).toThrow();
    }
  });

  it("kills unstable-handle, split-transaction and locked-vs-hidden-layer mutants", () => {
    const document = createEmptyDocument({ documentId: "F-026-mutation" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: true, locked: false, plottable: true },
    );
    document.entities.push(
      line,
      { ...line, handle: "20", start: { x: 0, y: 100 }, end: { x: 100, y: 100 } },
      { ...line, handle: "30", layerId: "locked" },
      { ...line, handle: "40", layerId: "hidden" },
    );
    const source = structuredClone(document.entities);
    const result = executeBreak(document, { targets: [
      { handle: "10", firstPoint: { x: 20, y: 0 }, secondPoint: { x: 80, y: 0 } },
      { handle: "20", firstPoint: { x: 50, y: 100 }, mode: "at-point" },
      { handle: "30", firstPoint: { x: 20, y: 0 }, secondPoint: { x: 80, y: 0 } },
      { handle: "40", firstPoint: { x: 20, y: 0 }, secondPoint: { x: 80, y: 0 } },
    ] });
    expect(result).toMatchObject({
      sourceHandles: ["10", "20", "40"], resultHandles: ["10", "41", "20", "42", "40", "43"], createdHandles: ["41", "42", "43"], multiple: true,
      rejected: [{ handle: "30", reason: "locked-layer" }],
    });
    expect(document.entities).toEqual(source);
    const session = new CadSession(document);
    session.commit({ opId: "F-026-mutation", baseRevision: 0, commandId: "BREAK", args: {}, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    const committed = structuredClone(session.document.entities);
    expect(session.undo()).not.toBeNull(); expect(session.document.entities).toEqual(source);
    expect(session.redo()).not.toBeNull(); expect(session.document.entities).toEqual(committed);
  });
});
