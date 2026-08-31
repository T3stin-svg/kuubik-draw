import { createEmptyDocument, createTable, createTableStyle, evaluateAnnotationBlockDxfCapabilities } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { exportDxf, importDxf } from "../src/index.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "f068-table-boundary" });
  const style = createTableStyle(document, { id: "TS", name: "Standard", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
  if (style.type !== "set-metadata") throw new Error("Expected TABLESTYLE metadata change.");
  document.metadata = style.metadata;
  document.entities.push(createTable(document, { handle: "AB", layerId: "0", origin: { x: 10, y: 20 }, styleId: "TS", rows: [{ id: "R", height: 6 }], columns: [{ id: "C", width: 20 }] }));
  return document;
}

describe("F-068 DXF TABLE capability boundary", () => {
  it("reports the Kuubik TABLE proxy as unsupported instead of emitting a false native TABLE", () => {
    const document = fixture();
    const output = exportDxf(document);
    expect(output.report.emittedHandles).not.toContain("AB");
    expect(output.report.skipped).toEqual([{ handle: "AB", kind: "proxy", reason: "DXF adapter not implemented for this entity kind." }]);
    expect(output.text).not.toContain("ACAD_TABLE");
    const evaluation = evaluateAnnotationBlockDxfCapabilities(document, { adapterId: "current-cad-dxf", dxfVersion: "AC1018", capabilities: { table: "unsupported" } });
    expect(evaluation.rejected).toContainEqual(expect.objectContaining({ capability: "table", declared: "unsupported", reason: "capability", handles: ["$TABLESTYLE", "AB"] }));
  });

  it("preserves an imported native ACAD_TABLE only as an inert forensic proxy and still refuses re-export", () => {
    const base = exportDxf(createEmptyDocument({ documentId: "f068-native-proxy" })).text;
    const marker = "  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS";
    const record = "  0\r\nACAD_TABLE\r\n  5\r\nAB\r\n330\r\n1F\r\n100\r\nAcDbEntity\r\n  8\r\n0\r\n100\r\nAcDbBlockReference\r\n 10\r\n10\r\n 20\r\n20\r\n 30\r\n0\r\n100\r\nAcDbTable\r\n 91\r\n1\r\n 92\r\n1\r\n";
    expect(base).toContain(marker);
    const imported = importDxf(base.replace(marker, record + marker), { documentId: "f068-native-readback", preserveUnsupported: true });
    expect(imported.report.preservedProxyHandles).toContain("AB");
    expect(imported.document.entities.find((entity) => entity.handle === "AB")).toMatchObject({ kind: "proxy", originalType: "ACAD_TABLE" });
    expect(exportDxf(imported.document).report.skipped).toContainEqual({ handle: "AB", kind: "proxy", reason: "DXF adapter not implemented for this entity kind." });
  });
});
