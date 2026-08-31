import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { prepareCompletePolygonCommand } from "../../cad-core/src/polygon-command.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-006 POLYGON DXF read-back", () => {
  it("roundtrips a rotated clockwise polygon with exact order, identity and common properties", () => {
    const prepared = prepareCompletePolygonCommand({
      command: "POLYGON", handle: "F6", layerId: "POLYGON_TEST", sides: 17,
      construction: { mode: "center-circumscribed", center: { x: 125.25, y: -200.5 }, apothem: 80, rotationRad: Math.PI / 7, orientation: "clockwise" },
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    });
    const document = createEmptyDocument({ documentId: "F-006-DXF", now: "2026-08-31T20:30:00.000Z" });
    document.layers.push({ id: "POLYGON_TEST", name: "POLYGON_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-006:DXF:1", baseRevision: 0, commandId: "POLYGON", args: { variant: "Circumscribed", sides: 17 },
      targetHandles: [], resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T20:30:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["F6"], handleMap: { F6: "F6" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-006-DXF-readback", now: "2026-08-31T20:30:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["F6"], skipped: [] });
    const readback = imported.document.entities[0];
    expect(readback).toMatchObject({
      kind: "polyline", handle: "F6", layerId: "dxf-layer:POLYGON_TEST", closed: true,
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    });
    if (readback?.kind !== "polyline") throw new Error("Expected POLYGON LWPOLYLINE read-back.");
    expect(readback.vertices).toHaveLength(17);
    for (let index = 0; index < readback.vertices.length; index += 1) {
      expect(readback.vertices[index]!.x).toBeCloseTo(prepared.entity.vertices[index]!.x, 9);
      expect(readback.vertices[index]!.y).toBeCloseTo(prepared.entity.vertices[index]!.y, 9);
    }
    const signedArea = readback.vertices.reduce((sum, vertex, index, vertices) => {
      const next = vertices[(index + 1) % vertices.length]!;
      return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0) / 2;
    expect(signedArea).toBeLessThan(0);

    session.undo("2026-08-31T20:30:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:30:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
