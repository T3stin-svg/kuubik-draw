import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readTableContract } from "./contracts.js";
import { createTable, createTableStyle, editTable } from "./table.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "table-wave13-mutation" });
  const style = createTableStyle(document, { id: "TS", name: "TS", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
  if (style.type !== "set-metadata") throw new Error("Expected metadata change.");
  document.metadata = style.metadata;
  const entity = createTable(document, { handle: "T", layerId: "0", origin: { x: 0, y: 0 }, styleId: "TS", rows: [{ id: "R1", height: 5 }, { id: "R2", height: 5 }], columns: [{ id: "C1", width: 10 }, { id: "C2", width: 10 }] });
  entity.appearance = { color: "#00ff00" }; entity.extensionData = { ...entity.extensionData, retained: true };
  document.entities.push(entity);
  return document;
}

describe("F-068 TABLE mutation ratchet", () => {
  it("kills handle/layer/appearance/style-reset and case-sensitive lookup mutants", () => {
    const document = fixture(); const source = structuredClone(document.entities[0]!);
    const change = editTable(document, "t", [{ type: "set-cell", cellId: "r2:c2", value: { kind: "text", text: "X" } }]);
    if (change.type !== "put") throw new Error("Expected TABLE replacement.");
    expect(change.entity).toMatchObject({ handle: "T", layerId: "0", appearance: { color: "#00ff00" }, extensionData: { retained: true } });
    expect(readTableContract(change.entity)).toMatchObject({ styleId: "TS", cells: expect.arrayContaining([expect.objectContaining({ id: "R2:C2", value: { kind: "text", text: "X" } })]) });
    expect(document.entities[0]).toEqual(source);
  });

  it("kills partial-commit mutants when a later operation is invalid", () => {
    const document = fixture(); const before = structuredClone(document);
    expect(() => editTable(document, "T", [
      { type: "set-cell", cellId: "R1:C1", value: { kind: "text", text: "would-change" } },
      { type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } },
      { type: "delete-column", columnId: "C1" },
    ])).toThrow(/Unmerge column/u);
    expect(document).toEqual(before);
  });
});
