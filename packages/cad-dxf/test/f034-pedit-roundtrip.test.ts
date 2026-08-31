import { describe, expect, it } from "vitest";
import { createEmptyDocument, preparePeditCommand, readPeditCurveDefinition } from "../../cad-core/src/index.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-034 PEDIT DXF read-back", () => {
  it("roundtrips the expanded polyline geometry, handle, layer, properties, bulges and widths", () => {
    const document = createEmptyDocument({ documentId: "F-034-DXF", now: "2026-09-01T00:10:00.000Z" });
    document.layers.push({ id: "PEDIT", name: "PEDIT", visible: true, frozen: false, locked: false, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "PEDIT", appearance: { color: "#4a90e2", colorMethod: "trueColor", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "arc", handle: "11", layerId: "PEDIT", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true },
    );
    const prepared = preparePeditCommand(document, { handle: "10", actions: [
      { type: "join", handles: ["11"], tolerance: 0 }, { type: "vertex-width", index: 1, startWidth: 1, endWidth: 3 }, { type: "close" },
    ] });
    const interchange = createEmptyDocument({ documentId: "F-034-DXF-expanded", now: "2026-09-01T00:10:01.000Z" });
    interchange.layers.push(document.layers[1]!);
    interchange.entities = [prepared.entity];
    const exported = exportDxf(interchange);
    expect(exported.report).toMatchObject({ emittedHandles: ["10"], skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-034-DXF-readback", now: "2026-09-01T00:10:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["10"], skipped: [] });
    const readback = imported.document.entities[0]!;
    expect(readback).toMatchObject({ kind: "polyline", handle: "10", layerId: "dxf-layer:PEDIT", closed: true, appearance: { color: "#4a90e2", lineweightMm: 0.5 } });
    if (readback.kind !== "polyline") throw new Error("Expected a polyline DXF read-back.");
    expect(readback.vertices).toHaveLength(prepared.entity.vertices.length);
    readback.vertices.forEach((vertex, index) => {
      const expected = prepared.entity.vertices[index]!;
      expect(vertex.x).toBeCloseTo(expected.x, 9);
      expect(vertex.y).toBeCloseTo(expected.y, 9);
      expect(vertex.bulge ?? 0).toBeCloseTo(expected.bulge ?? 0, 9);
      expect(vertex.startWidth ?? 0).toBeCloseTo(expected.startWidth ?? 0, 9);
      expect(vertex.endWidth ?? 0).toBeCloseTo(expected.endWidth ?? 0, 9);
    });
  });

  it("exports sampled Fit geometry while correctly treating Kuubik curve metadata as non-DXF state", () => {
    const document = createEmptyDocument({ documentId: "F-034-DXF-fit" });
    document.entities.push({ kind: "polyline", handle: "20", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: -5 }, { x: 30, y: 0 }] });
    const fitted = preparePeditCommand(document, { handle: "20", actions: [{ type: "fit", samplesPerSpan: 2 }] }).entity;
    document.entities = [fitted];
    const readback = importDxf(exportDxf(document).bytes, { documentId: "F-034-DXF-fit-readback" }).document.entities[0]!;
    expect(readback.kind).toBe("polyline");
    if (readback.kind !== "polyline") throw new Error("Expected a polyline DXF read-back.");
    expect(readback.vertices).toHaveLength(fitted.vertices.length);
    expect(readPeditCurveDefinition(readback)).toBeNull();
  });
});
