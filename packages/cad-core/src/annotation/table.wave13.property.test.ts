import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readTableContract } from "./contracts.js";
import { createTable, createTableStyle, editTable } from "./table.js";

function fixture(seed: number) {
  const document = createEmptyDocument({ documentId: `table-property-${seed}` });
  const style = createTableStyle(document, { id: "TS", name: "TS", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
  if (style.type !== "set-metadata") throw new Error("Expected style metadata.");
  document.metadata = style.metadata;
  return document;
}

describe("F-068 TABLE deterministic property corpus", () => {
  it("keeps surviving ids and canonical row-major order through 128 insert/delete/edit corpora", () => {
    for (let seed = 0; seed < 128; seed += 1) {
      const document = fixture(seed);
      const source = createTable(document, {
        handle: "T", layerId: "0", origin: { x: seed, y: -seed }, rotationRad: seed / 100, styleId: "TS",
        rows: [{ id: "R1", height: 5 + seed / 10 }, { id: "R2", height: 6 + seed / 10 }],
        columns: [{ id: "C1", width: 10 + seed / 20 }, { id: "C2", width: 11 + seed / 20 }],
      });
      document.entities.push(source);
      const change = editTable(document, "t", [
        { type: "set-cell", cellId: "r2:c2", value: { kind: "text", text: `S${seed}` }, horizontalAlignment: seed % 2 ? "right" : "center" },
        { type: "insert-row", index: 1, row: { id: "RX", height: 7 }, cells: [{ id: "X1", columnId: "c1" }, { id: "X2", columnId: "c2" }] },
        { type: "insert-column", index: 1, column: { id: "CX", width: 12 }, cells: [{ id: "Y1", rowId: "r1" }, { id: "Y2", rowId: "rx" }, { id: "Y3", rowId: "r2" }] },
        { type: "delete-row", rowId: "rx" }, { type: "delete-column", columnId: "cx" },
      ]);
      if (change.type !== "put") throw new Error("Expected TABLE replacement.");
      const contract = readTableContract(change.entity)!;
      expect(contract.cells.map((cell) => cell.id)).toEqual(["R1:C1", "R1:C2", "R2:C1", "R2:C2"]);
      expect(contract.cells.find((cell) => cell.id === "R2:C2")?.value).toEqual({ kind: "text", text: `S${seed}` });
      expect(contract.origin).toEqual({ x: seed, y: -seed });
      expect(contract.rotationRad).toBe(seed / 100);
    }
  });
});
