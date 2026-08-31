import { describe, expect, it } from "vitest";
import type { CadProxyEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createEmptyDocument } from "../document.js";
import { readTableContract } from "./contracts.js";
import { createTable, createTableStyle, editTable, evaluateTableCapability, readTableStyles, updateTableStyle, type TableStyle } from "./table.js";

const primaryStyle: TableStyle = { id: "TS-1", name: "Standard", textStyleId: "TXT", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" };
const alternateStyle: TableStyle = { ...primaryStyle, id: "TS-2", name: "Compact", textHeight: 2 };

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "table-wave13", now: "2026-09-01T06:00:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  for (const style of [primaryStyle, alternateStyle]) {
    const change = createTableStyle(document, style);
    if (change.type !== "set-metadata") throw new Error("Expected TABLESTYLE metadata change.");
    document.metadata = change.metadata;
  }
  return document;
}

function table(document: KDrawDocumentV1): CadProxyEntity {
  return createTable(document, {
    handle: "A0", layerId: "0", origin: { x: 10, y: 30 }, rotationRad: Math.PI / 6, appearance: { color: "#ff0000", lineweightMm: 0.35 }, styleId: "ts-1",
    rows: [{ id: "R1", height: 8 }, { id: "R2", height: 10 }],
    columns: [{ id: "C1", width: 20 }, { id: "C2", width: 30 }],
    cells: [
      { id: "A1", rowId: "r1", columnId: "c1", value: { kind: "text", text: "Pealkiri" }, horizontalAlignment: "center", format: { textHeight: 3, bold: true, color: "#112233" } },
      { id: "A2", rowId: "R1", columnId: "C2", value: { kind: "text", text: "Väärtus" } },
      { id: "B1", rowId: "R2", columnId: "C1", value: { kind: "text", text: "A-01" } },
      { id: "B2", rowId: "R2", columnId: "C2", value: { kind: "field", code: "%<SheetNumber>%", fallback: "1" } },
    ],
  });
}

describe("F-068 TABLE wave13 hardening", () => {
  it("preserves handle, layer, appearance, raw data and unrelated extensions across a batched edit", () => {
    const document = fixture();
    const source = table(document);
    source.raw = { schemaVersion: 1, opaqueOwner: "keep" };
    source.extensionData = { ...source.extensionData, "kuubik.test": { keep: true } };
    document.entities.push(source);
    const before = structuredClone(document);
    const change = editTable(document, "a0", [
      { type: "set-cell", cellId: "a1", value: { kind: "text", text: "Uus" }, horizontalAlignment: null, format: null },
      { type: "insert-row", index: 1, row: { id: "R1B", height: 7 }, cells: [{ id: "N1", columnId: "c1" }, { id: "N2", columnId: "C2" }] },
      { type: "insert-column", index: 1, column: { id: "C1B", width: 15 }, cells: [{ id: "X1", rowId: "r1" }, { id: "X2", rowId: "r1b" }, { id: "X3", rowId: "R2" }] },
      { type: "merge", merge: { id: "M1", rowIds: ["r1"], columnIds: ["c1", "c1b"] } },
      { type: "apply-style", styleId: "ts-2" },
    ]);
    expect(document).toEqual(before);
    if (change.type !== "put" || change.entity.kind !== "proxy") throw new Error("Expected TABLE entity replacement.");
    expect(change.entity).toMatchObject({ handle: "A0", layerId: "0", appearance: source.appearance, raw: source.raw });
    expect(change.entity.extensionData?.["kuubik.test"]).toEqual({ keep: true });
    const contract = readTableContract(change.entity)!;
    expect(contract.styleId).toBe("TS-2");
    expect(contract.rows.map((row) => row.id)).toEqual(["R1", "R1B", "R2"]);
    expect(contract.columns.map((column) => column.id)).toEqual(["C1", "C1B", "C2"]);
    expect(contract.cells.map((cell) => cell.id)).toEqual(["A1", "X1", "A2", "N1", "X2", "N2", "B1", "X3", "B2"]);
    expect(contract.cells[0]).toEqual({ id: "A1", rowId: "R1", columnId: "C1", value: { kind: "text", text: "Uus" } });
    expect(contract.merges).toEqual([{ id: "M1", rowIds: ["R1"], columnIds: ["C1", "C1B"] }]);
  });

  it("rejects locked, off and frozen target layers before create or edit", () => {
    for (const state of ["locked", "off", "frozen"] as const) {
      const document = fixture();
      document.layers.push({ id: state, name: state, visible: state !== "off", frozen: state === "frozen", locked: state === "locked", plottable: true });
      expect(() => createTable(document, { handle: `N-${state}`, layerId: state, origin: { x: 0, y: 0 }, styleId: "TS-1", rows: [{ id: "R", height: 5 }], columns: [{ id: "C", width: 10 }] })).toThrow(new RegExp(state === "off" ? "off" : state, "u"));
      const source = table(document); source.layerId = state; document.entities.push(source);
      expect(evaluateTableCapability(document, "A0")).toEqual({ executable: false, code: `${state}-layer`, handle: state });
      expect(() => editTable(document, "A0", [{ type: "resize-row", rowId: "R1", height: 9 }])).toThrow(new RegExp(state === "off" ? "off" : state, "u"));
    }
  });

  it("fails closed for malformed runtime contracts and case-insensitive identity collisions", () => {
    const document = fixture();
    const source = table(document); document.entities.push(source);
    expect(() => createTable(document, { handle: "a0", layerId: "0", origin: { x: 0, y: 0 }, styleId: "TS-1", rows: [{ id: "R", height: 5 }], columns: [{ id: "C", width: 10 }] })).toThrow(/Duplicate entity handle/u);
    expect(() => editTable(document, "A0", [{ type: "insert-row", index: 1, row: { id: "r1", height: 5 }, cells: [{ id: "N1", columnId: "C1" }, { id: "N2", columnId: "C2" }] }])).toThrow(/Duplicate table row/u);
    const corrupt = structuredClone(source);
    const contract = corrupt.extensionData!["kuubik.annotation.v1"] as { cells: Array<{ id: string }> };
    contract.cells[1]!.id = "a1";
    document.entities[0] = corrupt;
    expect(readTableContract(corrupt)).toBeNull();
    expect(evaluateTableCapability(document, "A0")).toEqual({ executable: false, code: "malformed-contract", handle: "A0" });
    expect(() => editTable(document, "A0", [{ type: "resize-row", rowId: "R1", height: 9 }])).toThrow(/Malformed TABLE contract/u);
  });

  it("updates a style under its canonical stable id without rewriting existing tables", () => {
    const document = fixture(); const source = table(document); document.entities.push(source);
    const before = structuredClone(source);
    const change = updateTableStyle(document, { ...primaryStyle, id: "ts-1", name: "Updated", textHeight: 4 });
    if (change.type !== "set-metadata") throw new Error("Expected metadata change.");
    const staged = { ...structuredClone(document), metadata: change.metadata };
    expect(readTableStyles(staged).find((style) => style.id === "TS-1")).toMatchObject({ id: "TS-1", name: "Updated", textHeight: 4 });
    expect(staged.entities[0]).toEqual(before);
    expect(readTableContract(staged.entities[0]!)?.styleId).toBe("TS-1");
  });
});
