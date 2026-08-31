import { describe, expect, it } from "vitest";
import { prepareArrayCommand, ArrayCommandInputError } from "../src/array-commands.js";
import { createEmptyDocument } from "../src/document.js";
import { PeditInputError, preparePeditCommand } from "../src/pedit.js";
import { quickSelect, selectSimilar } from "../src/selection-query.js";
import { CadSession } from "../src/transaction.js";

function arrayDocument() {
  const document = createEmptyDocument({ documentId: "array", now: "2026-08-31T00:00:00.000Z" });
  document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "A", appearance: { color: "#ff0000", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  );
  return document;
}

describe("ARRAY and ARRAYPATH", () => {
  it("creates a rectangular row/column golden layout while retaining the source", () => {
    const result = prepareArrayCommand(arrayDocument(), {
      command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 },
      rows: 2, columns: 3, rowVector: { x: 0, y: 20 }, columnVector: { x: 30, y: 0 },
    });
    expect(result).toMatchObject({ commandId: "ARRAYRECT", itemCount: 6, sourceHandles: ["10"] });
    expect(result.changes.map((change) => change.type === "put" ? change.entity : null)).toMatchObject([
      { start: { x: 30, y: 0 }, end: { x: 40, y: 0 } },
      { start: { x: 60, y: 0 }, end: { x: 70, y: 0 } },
      { start: { x: 0, y: 20 }, end: { x: 10, y: 20 } },
      { start: { x: 30, y: 20 }, end: { x: 40, y: 20 } },
      { start: { x: 60, y: 20 }, end: { x: 70, y: 20 } },
    ]);
  });

  it("supports polar fill-angle and Rotate items options", () => {
    const result = prepareArrayCommand(arrayDocument(), {
      command: "ARRAYPOLAR", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, center: { x: 0, y: 0 },
      items: 4, fillAngleRad: Math.PI * 2, rotateItems: true,
    });
    expect(result).toMatchObject({ itemCount: 4 });
    const copies = result.changes.map((change) => change.type === "put" ? change.entity : null);
    expect(copies[0]).toMatchObject({ kind: "line", start: { x: 0, y: 0 } });
    expect((copies[0] as { end: { x: number; y: number } }).end.x).toBeCloseTo(0, 12);
    expect((copies[0] as { end: { x: number; y: number } }).end.y).toBeCloseTo(10, 12);
  });

  it("places ARRAYPATH Divide and Measure items using the same path sampler", () => {
    const divided = prepareArrayCommand(arrayDocument(), {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 3, alignItems: true,
    });
    expect(divided).toMatchObject({ itemCount: 3 });
    expect(divided.changes.map((change) => change.type === "put" ? change.entity : null)).toMatchObject([
      { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { start: { x: 50, y: 0 }, end: { x: 60, y: 0 } },
      { start: { x: 100, y: 0 }, end: { x: 110, y: 0 } },
    ]);
    const measured = prepareArrayCommand(arrayDocument(), {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "measure", spacing: 40, startOffset: 20, alignItems: false,
    });
    expect(measured).toMatchObject({ itemCount: 3 });
  });

  it.each([
    { command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 1, columns: 1, rowVector: { x: 0, y: 1 }, columnVector: { x: 1, y: 0 } },
    { command: "ARRAYPOLAR", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, center: { x: 0, y: 0 }, items: 1, fillAngleRad: Math.PI, rotateItems: true },
    { command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20", method: "measure", spacing: 0, alignItems: true },
  ] as const)("rejects a mutated invalid $command before changes", (input) => {
    expect(() => prepareArrayCommand(arrayDocument(), input)).toThrow(ArrayCommandInputError);
  });
});

describe("PEDIT", () => {
  it("joins contiguous sources and applies Close, Width, Reverse and linetype generation", () => {
    const document = createEmptyDocument({ documentId: "pedit" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
      { kind: "line", handle: "12", layerId: "0", start: { x: 10, y: 10 }, end: { x: 0, y: 0 } },
    );
    const result = preparePeditCommand(document, {
      handle: "10",
      actions: [
        { type: "join", handles: ["11", "12"], tolerance: 0 },
        { type: "close" },
        { type: "width", width: 2 },
        { type: "reverse" },
        { type: "linetype-generation", enabled: true },
      ],
    });
    expect(result).toMatchObject({ joinedHandles: ["11", "12"], rejectedJoins: [], resultHandles: ["10"] });
    expect(result.entity).toMatchObject({ kind: "polyline", closed: true, extensionData: { pedit: { linetypeGeneration: true } } });
    expect(result.entity.vertices).toHaveLength(4);
    expect(result.entity.vertices.every((vertex) => vertex.startWidth === 2 && vertex.endWidth === 2)).toBe(true);
    expect(result.changes).toMatchObject([{ type: "put" }, { type: "delete", handle: "11" }, { type: "delete", handle: "12" }]);
  });

  it("edits, inserts, deletes and decurves vertices deterministically", () => {
    const document = createEmptyDocument({ documentId: "pedit-vertices" });
    document.entities.push({ kind: "polyline", handle: "10", layerId: "0", closed: false, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
    const result = preparePeditCommand(document, {
      handle: "10",
      actions: [
        { type: "insert-vertex", index: 2, point: { x: 15, y: 5 } },
        { type: "edit-vertex", index: 1, point: { x: 10, y: 2 } },
        { type: "delete-vertex", index: 3 },
        { type: "decurve" },
      ],
    });
    expect(result.entity.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 15, y: 5 }]);
  });

  it("joins a counter-clockwise ARC as one exact bulged polyline segment", () => {
    const document = createEmptyDocument({ documentId: "pedit-arc" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "arc", handle: "11", layerId: "0", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true },
    );
    const result = preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0 }] });
    expect(result).toMatchObject({ joinedHandles: ["11"], rejectedJoins: [] });
    expect(result.entity.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0, bulge: expect.closeTo(Math.tan(Math.PI / 8), 12) },
      { x: expect.closeTo(20, 12), y: expect.closeTo(10, 12) },
    ]);
    expect(result.changes).toMatchObject([{ type: "put" }, { type: "delete", handle: "11" }]);
  });

  it("reverses ARC direction with the correct signed bulge and honors Join tolerance", () => {
    const document = createEmptyDocument({ documentId: "pedit-arc-reverse" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 30, y: 10 }, end: { x: 20.0005, y: 10 } },
      { kind: "arc", handle: "11", layerId: "0", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true },
    );
    const rejected = preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0.0001 }] });
    expect(rejected.rejectedJoins).toEqual([{ handle: "11", reason: "not-contiguous" }]);
    const joined = preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0.001 }] });
    expect(joined.entity.vertices).toEqual([
      { x: 30, y: 10 },
      { x: 20.0005, y: 10, bulge: expect.closeTo(-Math.tan(Math.PI / 8), 12) },
      { x: expect.closeTo(10, 12), y: expect.closeTo(0, 12) },
    ]);
  });

  it("rejects unsupported and degenerate arc Join targets without mutating the source", () => {
    const document = createEmptyDocument({ documentId: "pedit-arc-reject" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "circle", handle: "11", layerId: "0", center: { x: 10, y: 10 }, radius: 10 },
      { kind: "arc", handle: "12", layerId: "0", center: { x: 10, y: 0 }, radius: 0, startAngleRad: 0, endAngleRad: 1, counterClockwise: true },
    );
    const result = preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11", "12"], tolerance: 0 }] });
    expect(result.rejectedJoins).toEqual([
      { handle: "11", reason: "unsupported-entity" },
      { handle: "12", reason: "degenerate-geometry" },
    ]);
    expect(result.entity.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(result.changes).toEqual([{ type: "put", entity: result.entity }]);
  });

  it("commits Join as one atomic Undo/Redo operation", () => {
    const document = createEmptyDocument({ documentId: "pedit-atomic" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 0 }, end: { x: 20, y: 0 } },
    );
    const session = new CadSession(document);
    const prepared = preparePeditCommand(session.document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0 }] });
    session.commit({ opId: "pedit:1", baseRevision: 0, commandId: "PEDIT", args: {}, targetHandles: prepared.sourceHandles, resultHandles: prepared.resultHandles }, prepared.changes);
    expect(session.document.entities).toHaveLength(1);
    session.undo();
    expect(session.document.entities).toHaveLength(2);
    session.redo();
    expect(session.document.entities).toHaveLength(1);
  });

  it("rejects an invalid vertex mutation before returning changes", () => {
    const document = createEmptyDocument({ documentId: "pedit-invalid" });
    document.entities.push({ kind: "polyline", handle: "10", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(() => preparePeditCommand(document, { handle: "10", actions: [{ type: "delete-vertex", index: 1 }] })).toThrow(PeditInputError);
  });
});

describe("Quick Select and Select Similar", () => {
  it("filters the entire drawing and combines with the current selection", () => {
    const document = arrayDocument();
    document.entities.push({ kind: "circle", handle: "30", layerId: "A", appearance: { color: "#ff0000", lineweightMm: 0.25 }, center: { x: 0, y: 0 }, radius: 5 });
    expect(quickSelect(document, {
      scope: "entire-drawing", currentSelection: ["20"], property: "layerId", operator: "equals", value: "a", resultMode: "append",
    })).toEqual({ handles: ["20", "10", "30"], matchedHandles: ["10", "30"], examinedCount: 3 });
    expect(quickSelect(document, {
      scope: "current-selection", currentSelection: ["10", "20"], property: "lineweightMm", operator: "greater-than", value: 0.3, resultMode: "replace",
    })).toEqual({ handles: ["10"], matchedHandles: ["10"], examinedCount: 2 });
  });

  it("selects similar entities by an explicit property set", () => {
    const document = arrayDocument();
    document.entities.push({ kind: "line", handle: "30", layerId: "A", appearance: { color: "#ff0000", lineweightMm: 0.25 }, start: { x: 0, y: 1 }, end: { x: 1, y: 1 } });
    expect(selectSimilar(document, "10", ["kind", "layerId", "color"])).toEqual({ handles: ["10", "30"], matchedHandles: ["10", "30"], examinedCount: 3 });
  });
});
