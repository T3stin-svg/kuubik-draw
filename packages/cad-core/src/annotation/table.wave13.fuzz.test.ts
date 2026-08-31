import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readTableContract } from "./contracts.js";
import { requiredAnnotationBlockDxfCapabilities } from "./dxf-capability.js";
import { createTable, createTableStyle, evaluateTableCapability } from "./table.js";

describe("F-068 TABLE malformed-contract fuzz corpus", () => {
  it("rejects 160 deterministic schema/identity/grid mutants without throwing in the reader", () => {
    for (let seed = 0; seed < 160; seed += 1) {
      const document = createEmptyDocument({ documentId: `table-fuzz-${seed}` });
      const style = createTableStyle(document, { id: "TS", name: "TS", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
      if (style.type !== "set-metadata") throw new Error("Expected style metadata.");
      document.metadata = style.metadata;
      const entity = createTable(document, { handle: "T", layerId: "0", origin: { x: 0, y: 0 }, styleId: "TS", rows: [{ id: "R1", height: 5 }, { id: "R2", height: 5 }], columns: [{ id: "C1", width: 10 }, { id: "C2", width: 10 }] });
      const value = entity.extensionData!["kuubik.annotation.v1"] as Record<string, unknown>;
      switch (seed % 8) {
        case 0: value.rows = [{ id: "R1", height: 5 }, { id: "r1", height: 5 }]; break;
        case 1: (value.cells as Array<Record<string, unknown>>)[1]!.id = "r1:c1"; break;
        case 2: (value.cells as Array<Record<string, unknown>>)[0]!.rowId = "MISSING"; break;
        case 3: (value.cells as Array<Record<string, unknown>>).pop(); break;
        case 4: value.merges = [{ id: "M", rowIds: ["R1", "R2"], columnIds: ["C1"] }, { id: "m", rowIds: ["R1"], columnIds: ["C1", "C2"] }]; break;
        case 5: (value.rows as Array<Record<string, unknown>>)[0]!.height = seed % 16 ? -1 : Number.NaN; break;
        case 6: (value.cells as Array<Record<string, unknown>>)[0]!.format = { textHeight: 0, color: "red" }; break;
        case 7: (value.cells as Array<Record<string, unknown>>)[0]!.value = { kind: "field", code: "", fallback: "x" }; break;
      }
      document.entities.push(entity);
      expect(readTableContract(entity)).toBeNull();
      expect(evaluateTableCapability(document, "T")).toEqual({ executable: false, code: "malformed-contract", handle: "T" });
      expect(() => requiredAnnotationBlockDxfCapabilities(document)).toThrow(/Malformed TABLE extension/u);
    }
  });
});
