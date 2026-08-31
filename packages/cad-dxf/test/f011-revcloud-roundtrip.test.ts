import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { prepareRevcloudCommand } from "../../cad-core/src/revcloud-command.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-011 REVCLOUD DXF read-back", () => {
  it("roundtrips stable LWPOLYLINE identity, closure, bulges, calligraphy widths and common properties", () => {
    const document = createEmptyDocument({ documentId: "F-011-DXF", now: "2026-08-31T21:30:00.000Z" });
    document.layers.push({ id: "REV", name: "REV", visible: true, frozen: false, locked: false, plottable: true });
    const prepared = prepareRevcloudCommand(document, {
      command: "REVCLOUD", handle: "F11", layerId: "REV", style: "calligraphy", direction: "reversed",
      construction: { mode: "rectangular", firstCorner: { x: 100, y: -50 }, oppositeCorner: { x: 180, y: 10 } },
      arcLengths: { minimum: 8, maximum: 16 },
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25 },
    });
    document.entities = prepared.entities;
    const exported = exportDxf(document);
    expect(exported.report).toMatchObject({ emittedHandles: ["F11"], handleMap: { F11: "F11" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-011-DXF-readback", now: "2026-08-31T21:30:01.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["F11"], skipped: [] });
    const readback = imported.document.entities[0];
    expect(readback).toMatchObject({
      kind: "polyline", handle: "F11", layerId: "dxf-layer:REV", closed: true,
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25 },
    });
    if (readback?.kind !== "polyline") throw new Error("Expected LWPOLYLINE read-back.");
    expect(readback.vertices).toHaveLength(prepared.entity.vertices.length);
    readback.vertices.forEach((vertex, index) => {
      expect(vertex.x).toBeCloseTo(prepared.entity.vertices[index]!.x, 9);
      expect(vertex.y).toBeCloseTo(prepared.entity.vertices[index]!.y, 9);
      expect(vertex.bulge).toBeCloseTo(prepared.entity.vertices[index]!.bulge!, 9);
      expect(vertex.startWidth).toBeCloseTo(prepared.entity.vertices[index]!.startWidth!, 9);
      expect(vertex.endWidth).toBeCloseTo(prepared.entity.vertices[index]!.endWidth!, 9);
    });
  });
});
