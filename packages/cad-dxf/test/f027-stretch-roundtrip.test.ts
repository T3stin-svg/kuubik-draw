import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { createEmptyDocument, executeStretch } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { exportDxf, importDxf } from "../src/index.js";

function applyStretch(document: KDrawDocumentV1, changes: ReturnType<typeof executeStretch>["changes"]): KDrawDocumentV1 {
  const output = structuredClone(document);
  for (const change of changes) {
    const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
    if (index >= 0) output.entities[index] = change.entity;
    else output.entities.push(change.entity);
  }
  return output;
}

describe("F-027 STRETCH DXF roundtrip", () => {
  it("preserves stable handles, exact crossing geometry, bulges, widths and appearance", () => {
    const source = createEmptyDocument({ documentId: "F-027-DXF", now: "2026-08-30T09:30:00.000Z" });
    source.entities = [
      {
        kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      },
      {
        kind: "polyline", handle: "20", layerId: "0", closed: false,
        vertices: [
          { x: 0, y: 10, bulge: 0.5, startWidth: 2, endWidth: 4 },
          { x: 100, y: 10, bulge: -0.25, startWidth: 4, endWidth: 6 },
          { x: 200, y: 10, startWidth: 6, endWidth: 8 },
        ],
        appearance: { color: "#00ff00", colorMethod: "trueColor", lineweightMm: 0.35 },
      },
      { kind: "circle", handle: "30", layerId: "0", center: { x: 80, y: 5 }, radius: 4 },
    ];
    const result = executeStretch(source, {
      regions: [{ kind: "crossing-window", points: [{ x: 40, y: -10 }, { x: 110, y: 20 }] }],
      individualHandles: [],
      basePoint: { x: 0, y: 0 },
      destinationPoint: { x: 25, y: 5 },
    });
    expect(result).toMatchObject({
      sourceHandles: ["10", "20", "30"],
      resultHandles: ["10", "20", "30"],
      movedHandles: ["30"],
      stretchedHandles: ["10", "20"],
      rejected: [],
    });

    const stretched = applyStretch(source, result.changes);
    const exported = exportDxf(stretched);
    expect(exported.report).toEqual({
      emittedHandles: ["10", "20", "30"],
      handleMap: { "10": "10", "20": "20", "30": "30" },
      skipped: [],
    });
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => `${entity.handle}:${entity.type}`)).toEqual(["10:LINE", "20:LWPOLYLINE", "30:CIRCLE"]);
    expect(independent.entities.find((entity) => entity.handle === "10")?.vertices).toMatchObject([{ x: 0, y: 0 }, { x: 125, y: 5 }]);
    expect(independent.entities.find((entity) => entity.handle === "20")?.vertices).toMatchObject([
      { x: 0, y: 10, bulge: 0.5, startWidth: 2, endWidth: 4 },
      { x: 125, y: 15, bulge: -0.25, startWidth: 4, endWidth: 6 },
      { x: 200, y: 10, startWidth: 6, endWidth: 8 },
    ]);
    expect(independent.entities.find((entity) => entity.handle === "30")).toMatchObject({ center: { x: 105, y: 10 }, radius: 4 });

    const readback = importDxf(exported.bytes, { documentId: "F-027-DXF-readback", now: "2026-08-30T09:30:01.000Z" });
    expect(readback.report).toMatchObject({ importedHandles: ["10", "20", "30"], skipped: [], warnings: [] });
    const entities = new Map(readback.document.entities.map((entity) => [entity.handle, entity]));
    expect(entities.get("10")).toMatchObject({
      kind: "line", start: { x: 0, y: 0 }, end: { x: 125, y: 5 },
      appearance: expect.objectContaining({ color: "#ff0000", aciIndex: 1, lineweightMm: 0.5 }),
    });
    expect(entities.get("20")).toMatchObject({
      kind: "polyline", closed: false,
      vertices: [
        { x: 0, y: 10, bulge: 0.5, startWidth: 2, endWidth: 4 },
        { x: 125, y: 15, bulge: -0.25, startWidth: 4, endWidth: 6 },
        { x: 200, y: 10, startWidth: 6, endWidth: 8 },
      ],
      appearance: expect.objectContaining({ color: "#00ff00", lineweightMm: 0.35 }),
    });
    expect(entities.get("30")).toMatchObject({ kind: "circle", center: { x: 105, y: 10 }, radius: 4 });
  });

  it("preserves AutoCAD-matched quarter-ellipse center, axes, ratio and parameter limits", () => {
    const source = createEmptyDocument({ documentId: "F-027-DXF-ellipse", now: "2026-08-30T09:35:00.000Z" });
    source.entities = [{
      kind: "ellipse", handle: "40", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2, extensionData: { rowId: "F-027" },
    }];
    const result = executeStretch(source, {
      regions: [{ kind: "crossing-window", points: [{ x: 90, y: -10 }, { x: 110, y: 10 }] }],
      individualHandles: [], basePoint: { x: 0, y: 0 }, destinationPoint: { x: 25, y: 5 },
    });
    const stretched = applyStretch(source, result.changes);
    const exported = exportDxf(stretched);
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities[0]).toMatchObject({
      type: "ELLIPSE", handle: "40",
      center: { x: expect.closeTo(9.852004872791, 10), y: expect.closeTo(-1.07776424224631, 10) },
      majorAxisEndPoint: { x: expect.closeTo(115.564843901568, 10), y: expect.closeTo(2.120881991279924, 10) },
      axisRatio: expect.closeTo(0.444723039979619, 10),
      startAngle: expect.closeTo(0.077190120252004, 10),
      endAngle: expect.closeTo(1.647986447046899, 10),
    });
    const readback = importDxf(exported.bytes, { documentId: "F-027-DXF-ellipse-readback" });
    expect(readback.report).toMatchObject({ importedHandles: ["40"], skipped: [], warnings: [] });
    expect(readback.document.entities[0]).toMatchObject({
      kind: "ellipse", handle: "40",
      center: { x: expect.closeTo(9.852004872791, 10), y: expect.closeTo(-1.07776424224631, 10) },
      majorAxis: { x: expect.closeTo(115.564843901568, 10), y: expect.closeTo(2.120881991279924, 10) },
      ratio: expect.closeTo(0.444723039979619, 10),
      startParameter: expect.closeTo(0.077190120252004, 10),
      endParameter: expect.closeTo(1.647986447046899, 10),
    });
  });
});
