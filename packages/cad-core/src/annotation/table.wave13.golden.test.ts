import { describe, expect, it } from "vitest";
import golden from "./annotation.golden.json";
import { createEmptyDocument } from "../document.js";
import { readTableContract } from "./contracts.js";
import { createTable, createTableStyle } from "./table.js";

describe("F-068 TABLE golden contract", () => {
  it("materializes the frozen ordered row/column/cell/field contract byte-for-byte", () => {
    const document = createEmptyDocument({ documentId: "table-wave13-golden" });
    document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    const style = createTableStyle(document, { id: "TABLE-STD", name: "Standard", textStyleId: "TXT", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
    if (style.type !== "set-metadata") throw new Error("Expected metadata change.");
    document.metadata = style.metadata;
    const table = createTable(document, {
      handle: "T1", layerId: "0", origin: { x: 10, y: 50 }, rotationRad: 0, styleId: "TABLE-STD",
      rows: structuredClone(golden.tableContract.rows), columns: structuredClone(golden.tableContract.columns),
      cells: structuredClone(golden.tableContract.cells) as never, merges: [],
    });
    expect(JSON.stringify(readTableContract(table))).toBe(JSON.stringify(golden.tableContract));
  });
});
