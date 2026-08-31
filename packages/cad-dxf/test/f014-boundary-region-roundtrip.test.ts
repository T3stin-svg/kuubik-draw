import { describe, expect, it } from "vitest";
import { createEmptyDocument, prepareBoundaryCommand } from "../../cad-core/src/index.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-014 BOUNDARY/REGION DXF read-back", () => {
  it("roundtrips exact line/ARC BOUNDARY geometry, bulge, handle, layer and appearance", () => {
    const document = createEmptyDocument({ documentId: "F-014-DXF", now: "2026-09-01T02:10:00.000Z" });
    document.layers.push({ id: "REGION", name: "REGION", visible: true, frozen: false, locked: false, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "REGION", start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "arc", handle: "11", layerId: "REGION", center: { x: 0, y: 0 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
    );
    const boundary = prepareBoundaryCommand(document, {
      handle: "20", layerId: "REGION", seedPoint: { x: 0, y: 5 }, sourceHandles: ["10", "11"], output: "polyline",
      appearance: { color: "#4a90e2", colorMethod: "trueColor", lineweightMm: 0.5 },
    }).entity;
    document.entities = [boundary];
    const exported = exportDxf(document);
    expect(exported.report).toMatchObject({ emittedHandles: ["20"], skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-014-DXF-readback", now: "2026-09-01T02:10:01.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["20"], skipped: [] });
    const readback = imported.document.entities[0]!;
    expect(readback).toMatchObject({ kind: "polyline", handle: "20", layerId: "dxf-layer:REGION", closed: true, appearance: { color: "#4a90e2", lineweightMm: 0.5 } });
    if (readback.kind !== "polyline" || boundary.kind !== "polyline") throw new Error("Expected a polyline read-back.");
    expect(readback.vertices).toHaveLength(2);
    expect(readback.vertices[0]).toMatchObject({ x: -10, y: 0 });
    expect(readback.vertices[1]).toMatchObject({ x: 10, y: 0, bulge: expect.closeTo(1, 9) });
  });

  it("roundtrips a circle BOUNDARY as four exact quarter-arc bulges", () => {
    const document = createEmptyDocument({ documentId: "F-014-DXF-circle" });
    document.entities.push({ kind: "circle", handle: "10", layerId: "0", center: { x: 5, y: 5 }, radius: 5 });
    const boundary = prepareBoundaryCommand(document, { handle: "20", layerId: "0", seedPoint: { x: 5, y: 5 }, sourceHandles: ["10"], output: "polyline" }).entity;
    document.entities = [boundary];
    const readback = importDxf(exportDxf(document).bytes, { documentId: "F-014-DXF-circle-readback" }).document.entities[0]!;
    expect(readback.kind).toBe("polyline");
    if (readback.kind !== "polyline") throw new Error("Expected a polyline read-back.");
    expect(readback.vertices).toHaveLength(4);
    expect(readback.vertices.every((vertex) => Math.abs((vertex.bulge ?? 0) - Math.tan(Math.PI / 8)) < 1e-9)).toBe(true);
  });

  it("keeps native REGION DXF fail-closed instead of claiming an ACIS roundtrip", () => {
    const document = createEmptyDocument({ documentId: "F-014-DXF-proxy" });
    document.entities.push({
      kind: "proxy", handle: "20", layerId: "0", originalType: "ACDBREGION",
      raw: { schema: "kuubik-region-v2", sourceKind: "REGION", loops: [] },
    });
    expect(exportDxf(document).report.skipped).toEqual([
      { handle: "20", kind: "proxy", reason: "DXF adapter not implemented for this entity kind." },
    ]);
  });
});
