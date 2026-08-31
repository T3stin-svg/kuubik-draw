import { describe, expect, it } from "vitest";
import { prepareArrayCommand, readArrayPathAssociation } from "../../cad-core/src/array-commands.js";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-031/F-032 ARRAY DXF read-back", () => {
  it.each(["ARRAYRECT", "ARRAYPATH"] as const)("roundtrips expanded %s geometry, handles, layer and common properties", (command) => {
    const source = createEmptyDocument({ documentId: `DXF-${command}`, now: "2026-08-31T00:00:00.000Z" });
    source.layers.push({ id: "ARRAY", name: "ARRAY", visible: true, frozen: false, locked: false, plottable: true });
    source.entities.push(
      { kind: "line", handle: "10", layerId: "ARRAY", start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, appearance: { color: "#4a90e2", colorMethod: "trueColor", lineweightMm: 0.5 } },
      { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    );
    const prepared = command === "ARRAYRECT"
      ? prepareArrayCommand(source, { command, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 2, columns: 2, rowSpacing: 20, columnSpacing: 30 })
      : prepareArrayCommand(source, { command, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20", method: "divide", items: 3, alignItems: true });
    const expanded = prepared.changes.map((change) => {
      if (change.type !== "put") throw new Error("Expected put.");
      return change.entity;
    });
    const interchange = createEmptyDocument({ documentId: `DXF-${command}-expanded`, now: "2026-08-31T00:00:01.000Z" });
    interchange.layers.push(source.layers[1]!);
    interchange.entities = expanded;
    const exported = exportDxf(interchange);
    expect(exported.report).toMatchObject({ emittedHandles: prepared.resultHandles, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: `DXF-${command}-readback`, now: "2026-08-31T00:00:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: prepared.resultHandles, skipped: [] });
    expect(imported.document.entities).toHaveLength(expanded.length);
    imported.document.entities.forEach((entity, index) => {
      const expected = expanded[index]!;
      expect(entity).toMatchObject({ kind: "line", handle: expected.handle, layerId: "dxf-layer:ARRAY", appearance: { color: "#4a90e2", lineweightMm: 0.5 } });
      if (entity.kind !== "line" || expected.kind !== "line") throw new Error("Expected line read-back.");
      expect(entity.start.x).toBeCloseTo(expected.start.x, 9);
      expect(entity.start.y).toBeCloseTo(expected.start.y, 9);
      expect(entity.end.x).toBeCloseTo(expected.end.x, 9);
      expect(entity.end.y).toBeCloseTo(expected.end.y, 9);
    });
    if (command === "ARRAYPATH") {
      expect(readArrayPathAssociation(expanded[0]!)).not.toBeNull();
      expect(readArrayPathAssociation(imported.document.entities[0]!)).toBeNull();
    }
  });
});
