import { describe, expect, it } from "vitest";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./annotation.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readHatchAssociation, readTableContract } from "./contracts.js";
import { createHatch, evaluateHatchCapability, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";
import { createTable, createTableStyle, editTable, evaluateTableCapability, readTableStyles, tableCellDisplayText, updateTableStyle, type TableStyle } from "./table.js";

const tableStyle: TableStyle = {
  id: "TABLE-STD", name: "Standard", textStyleId: "TXT", textHeight: 2.5, cellMargin: 1,
  borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle",
};

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "hatch-table-wave6", now: "2026-08-31T20:00:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  const styleChange = createTableStyle(document, tableStyle);
  if (styleChange.type !== "set-metadata") throw new Error("Expected table style metadata change.");
  document.metadata = styleChange.metadata;
  return document;
}

function createGoldenTable(document: KDrawDocumentV1) {
  return createTable(document, {
    handle: "T1", layerId: "0", origin: { x: 10, y: 50 }, styleId: "TABLE-STD",
    rows: [{ id: "R1", height: 8 }, { id: "R2", height: 10 }],
    columns: [{ id: "C1", width: 30 }, { id: "C2", width: 40 }],
    cells: structuredClone(golden.tableContract.cells) as never,
  });
}

describe("F-067 associative HATCH", () => {
  it("keeps solid/line pattern settings and classifies hole plus nested island by even/odd depth", () => {
    const document = fixture();
    document.entities.push(
      hatchBoundaryPolyline("P0", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
      hatchBoundaryPolyline("P1", "0", [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }]),
      hatchBoundaryPolyline("P2", "0", [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]),
    );
    const hatch = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["P0", "P1", "P2"], pattern: "ANSI31", angleRad: Math.PI / 6, scale: 2.5, origin: { x: 3, y: 4 }, associative: true });
    expect(hatch.loops.map((loop) => loop.isHole)).toEqual([false, true, false]);
    expect(readHatchAssociation(hatch)).toEqual({ kind: "hatch", pattern: { type: "line", angleRad: Math.PI / 6, scale: 2.5, origin: { x: 3, y: 4 } }, boundaryHandles: ["P0", "P1", "P2"] });
    expect(createHatch(document, { handle: "H2", layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID", associative: false })).toMatchObject({ pattern: "SOLID", associative: false });
  });

  it("updates boundary geometry in place and reports orphan/locked capability without fallback retargeting", () => {
    const document = fixture();
    document.entities.push(hatchBoundaryPolyline("P0", "0", [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]));
    const hatch = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["P0"], pattern: "ANSI31", angleRad: 0.25, scale: 3, origin: { x: 2, y: 3 } });
    document.entities.push(hatch);
    const staged = structuredClone(document);
    staged.entities[0] = hatchBoundaryPolyline("P0", "0", [{ x: 0, y: 0 }, { x: 75, y: 0 }, { x: 75, y: 50 }, { x: 0, y: 50 }]);
    const update = updateAssociativeHatches(staged, ["P0"]);
    expect(update).toMatchObject({ updatedHandles: ["H1"], broken: [], changes: [{ entity: { handle: "H1", pattern: "ANSI31", associative: true } }] });
    expect(readHatchAssociation(update.changes[0]!.type === "put" ? update.changes[0]!.entity : hatch)).toEqual(readHatchAssociation(hatch));
    const orphan = structuredClone(document);
    orphan.entities = orphan.entities.filter((entity) => entity.handle !== "P0");
    expect(updateAssociativeHatches(orphan, ["P0"])).toMatchObject({ changes: [], updatedHandles: [], broken: [{ hatchHandle: "H1", boundaryHandle: "P0" }] });
    expect(evaluateHatchCapability(orphan, "H1")).toEqual({ executable: false, code: "orphan-boundary", handle: "P0" });
    document.layers[0]!.locked = true;
    expect(evaluateHatchCapability(document, "H1")).toEqual({ executable: false, code: "locked-layer", handle: "0" });
    expect(() => updateAssociativeHatches(document, ["P0"])).toThrow(/locked layer/u);
  });

  it("keeps island parity and pattern origin invariant through a deterministic translation property corpus", () => {
    for (let index = 0; index < 24; index += 1) {
      const document = fixture();
      const dx = index * 13.5;
      const dy = index * -7.25;
      const shifted = (vertices: Array<{ x: number; y: number }>) => vertices.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      document.entities.push(
        hatchBoundaryPolyline("P0", "0", shifted([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])),
        hatchBoundaryPolyline("P1", "0", shifted([{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }])),
        hatchBoundaryPolyline("P2", "0", shifted([{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }])),
      );
      const origin = { x: dx + 3, y: dy + 4 };
      const hatch = createHatch(document, { handle: `H${index}`, layerId: "0", boundaryHandles: ["P0", "P1", "P2"], pattern: "ANSI31", angleRad: Math.PI / 3, scale: 1.75, origin });
      expect(hatch.loops.map((loop) => loop.isHole)).toEqual([false, true, false]);
      expect(readHatchAssociation(hatch)?.pattern).toEqual({ type: "line", angleRad: Math.PI / 3, scale: 1.75, origin });
    }
  });
});

describe("F-068 TABLE typed contract", () => {
  it("matches the golden row/column/cell/style contract and keeps fields inert with an explicit fallback", () => {
    const document = fixture();
    const table = createGoldenTable(document);
    expect(readTableContract(table)).toEqual(golden.tableContract);
    expect(table).toMatchObject({ kind: "proxy", handle: "T1", originalType: "TABLE", bounds: { min: { x: 10, y: 32 }, max: { x: 80, y: 50 } } });
    const field = readTableContract(table)!.cells.find((cell) => cell.id === "B2")!.value;
    expect(field).toEqual({ kind: "field", code: "%<SheetNumber>%", fallback: "1" });
    expect(tableCellDisplayText(field)).toBe("1");
  });

  it("edits values, alignment, format, merges, row/column insertion and resize as one immutable entity", () => {
    const document = fixture();
    const table = createGoldenTable(document);
    document.entities.push(table);
    const change = editTable(document, "T1", [
      { type: "set-cell", cellId: "B1", value: { kind: "text", text: "A-02" }, horizontalAlignment: "right", verticalAlignment: "bottom", format: { textStyleId: "TXT", textHeight: 3, bold: true, color: "#112233" } },
      { type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } },
      { type: "resize-row", rowId: "R2", height: 12 },
      { type: "insert-row", index: 2, row: { id: "R3", height: 9 }, cells: [{ id: "C31", columnId: "C1" }, { id: "C32", columnId: "C2", value: { kind: "text", text: "uus" } }] },
      { type: "insert-column", index: 2, column: { id: "C3", width: 20 }, cells: [{ id: "A3", rowId: "R1" }, { id: "B3", rowId: "R2" }, { id: "C33", rowId: "R3" }] },
      { type: "resize-column", columnId: "C3", width: 25 },
    ]);
    expect(change).toMatchObject({ type: "put", entity: { handle: "T1", originalType: "TABLE" } });
    if (change.type !== "put") throw new Error("Expected TABLE put change.");
    if (change.entity.kind !== "proxy") throw new Error("Expected TABLE proxy entity.");
    const contract = readTableContract(change.entity)!;
    expect(contract).toMatchObject({
      rows: [{ id: "R1", height: 8 }, { id: "R2", height: 12 }, { id: "R3", height: 9 }],
      columns: [{ id: "C1", width: 30 }, { id: "C2", width: 40 }, { id: "C3", width: 25 }],
      merges: [{ id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] }],
    });
    expect(contract.cells.find((cell) => cell.id === "B1")).toMatchObject({ value: { kind: "text", text: "A-02" }, horizontalAlignment: "right", verticalAlignment: "bottom", format: { textStyleId: "TXT", textHeight: 3, bold: true, color: "#112233" } });
    expect(contract.cells).toHaveLength(9);
    expect(change.entity.bounds).toEqual({ min: { x: 10, y: 21 }, max: { x: 105, y: 50 } });

    const staged = structuredClone(document);
    staged.entities[0] = change.entity;
    const deleted = editTable(staged, "T1", [{ type: "unmerge", mergeId: "M1" }, { type: "delete-row", rowId: "R3" }, { type: "delete-column", columnId: "C3" }]);
    if (deleted.type !== "put") throw new Error("Expected TABLE put change.");
    const reduced = readTableContract(deleted.entity)!;
    expect(reduced.rows.map((row) => row.id)).toEqual(["R1", "R2"]);
    expect(reduced.columns.map((column) => column.id)).toEqual(["C1", "C2"]);
    expect(reduced.cells.map((cell) => cell.id)).toEqual(["A1", "A2", "B1", "B2"]);
    expect(reduced.merges).toEqual([]);
  });

  it("commits a multi-operation TABLE edit as one Undo/Redo step with the same table and cell handles", () => {
    const document = fixture();
    const table = createGoldenTable(document);
    document.entities.push(table);
    const session = new CadSession(document);
    const change = editTable(document, "T1", [{ type: "set-cell", cellId: "B2", value: { kind: "field", code: "%<ProjectNumber>%", fallback: "P-001" } }, { type: "resize-column", columnId: "C2", width: 55 }]);
    session.commit({ opId: "table-edit", baseRevision: 0, commandId: "TABLE", args: {}, targetHandles: ["T1"], resultHandles: ["T1"] }, [change]);
    expect(readTableContract(session.document.entities.find((entity) => entity.handle === "T1")!)?.cells.find((cell) => cell.id === "B2")).toMatchObject({ id: "B2", value: { fallback: "P-001" } });
    session.undo();
    expect(session.document.entities.find((entity) => entity.handle === "T1")).toEqual(table);
    session.redo();
    expect(session.document.entities.find((entity) => entity.handle === "T1")?.handle).toBe("T1");
  });

  it("preserves bounds under a deterministic row/column property corpus", () => {
    for (let index = 1; index <= 32; index += 1) {
      const document = fixture();
      const width = index * 1.25;
      const height = index * 0.75;
      const table = createTable(document, { handle: `T${index}`, layerId: "0", origin: { x: index, y: -index }, styleId: "TABLE-STD", rows: [{ id: "R", height }], columns: [{ id: "C", width }] });
      expect(table.bounds).toEqual({ min: { x: index, y: -index - height }, max: { x: index + width, y: -index } });
      expect(readTableContract(table)?.cells.map((cell) => cell.id)).toEqual(["R:C"]);
    }
  });

  it("fails closed for malformed fields, overlapping merges, unknown styles and locked layers", () => {
    const document = fixture();
    const table = createGoldenTable(document);
    document.entities.push(table);
    expect(() => editTable(document, "T1", [{ type: "set-cell", cellId: "B2", value: { kind: "field", code: "", fallback: "x" } }])).toThrow(/field code/u);
    expect(() => editTable(document, "T1", [{ type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } }, { type: "merge", merge: { id: "M2", rowIds: ["R1", "R2"], columnIds: ["C1"] } }])).toThrow(/overlaps/u);
    expect(() => editTable(document, "T1", [{ type: "apply-style", styleId: "MISSING" }])).toThrow(/Unknown table style/u);
    expect(() => editTable(document, "T1", [{ type: "execute-field" } as never])).toThrow(/Unsupported TABLE edit operation/u);
    document.layers[0]!.locked = true;
    expect(evaluateTableCapability(document, "T1")).toEqual({ executable: false, code: "locked-layer", handle: "0" });
    expect(() => editTable(document, "T1", [{ type: "resize-row", rowId: "R1", height: 12 }])).toThrow(/locked/u);
  });

  it("updates the referenced TABLE style without rewriting existing table values", () => {
    const document = fixture();
    const table = createGoldenTable(document);
    document.entities.push(table);
    const change = updateTableStyle(document, { ...tableStyle, textHeight: 3.5, horizontalAlignment: "center" });
    if (change.type !== "set-metadata") throw new Error("Expected TABLE style metadata change.");
    const staged = { ...structuredClone(document), metadata: change.metadata };
    expect(readTableStyles(staged)).toEqual([{ ...tableStyle, textHeight: 3.5, horizontalAlignment: "center" }]);
    expect(staged.entities[0]).toEqual(table);
    expect(readTableContract(staged.entities[0]!)?.styleId).toBe("TABLE-STD");
  });
});
