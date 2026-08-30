import DxfParser from "dxf-parser";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeAlign } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { exportDxf, importDxf } from "../src/index.js";

function apply(document: KDrawDocumentV1, changes: ReturnType<typeof executeAlign>["changes"]): KDrawDocumentV1 {
  const output = structuredClone(document);
  for (const change of changes) {
    if (change.type !== "put") continue;
    const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
    if (index < 0) throw new Error(`F-029 missing source ${change.entity.handle}.`);
    output.entities[index] = change.entity;
  }
  return output;
}

describe("F-029 ALIGN DXF roundtrip", () => {
  it("preserves exact transformed handles, geometry, widths, styles and rational spline data", () => {
    const source = createEmptyDocument({ documentId: "F-029-DXF", now: "2026-08-30T12:00:00.000Z" });
    source.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.35 }, extensionData: { rowId: "F-029" } },
      { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 100 }, radius: 25 },
      { kind: "polyline", handle: "30", layerId: "0", closed: true, vertices: [
        { x: 0, y: 200, startWidth: 2, endWidth: 4 },
        { x: 100, y: 200, bulge: 0.5, startWidth: 4, endWidth: 6 },
      ], appearance: { color: "#00ff00", colorMethod: "trueColor" } },
      { kind: "spline", handle: "40", layerId: "0", degree: 3, controlPoints: [{ x: 0, y: 300 }, { x: 40, y: 380 }, { x: 80, y: 380 }, { x: 120, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false },
      { kind: "text", handle: "50", layerId: "0", position: { x: 0, y: 450 }, height: 10, rotationRad: 0, text: "ALIGN" },
    ];
    const result = executeAlign(source, {
      targetHandles: source.entities.map((entity) => entity.handle),
      pointPairs: [
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 100, y: 200 } },
        { sourcePoint: { x: 100, y: 0 }, destinationPoint: { x: 100, y: 400 } },
      ],
      scaleToFit: true,
    });
    expect(result).toMatchObject({ rejected: [], pointPairCount: 2, scaleToFit: true, scaleFactor: 2, angleRad: expect.closeTo(Math.PI / 2, 12) });
    expect(result.changes).toHaveLength(5);
    const changed = apply(source, result.changes);

    const exported = exportDxf(changed);
    expect(exported.report).toEqual({ emittedHandles: ["10", "20", "30", "40", "50"], handleMap: { "10": "10", "20": "20", "30": "30", "40": "40", "50": "50" }, skipped: [] });
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => `${entity.handle}:${entity.type}`)).toEqual(["10:LINE", "20:CIRCLE", "30:LWPOLYLINE", "40:SPLINE", "50:TEXT"]);
    expect(independent.entities.find((entity) => entity.handle === "10")?.vertices).toMatchObject([{ x: 100, y: 200 }, { x: 100, y: 400 }]);
    expect(independent.entities.find((entity) => entity.handle === "20")).toMatchObject({ center: { x: -100, y: 200 }, radius: 50 });
    expect(independent.entities.find((entity) => entity.handle === "30")).toMatchObject({ shape: true });
    expect(independent.entities.find((entity) => entity.handle === "30")?.vertices).toMatchObject([
      { x: -300, y: 200, startWidth: 4, endWidth: 8 },
      { x: -300, y: 400, bulge: expect.any(Number), startWidth: 8, endWidth: 12 },
    ]);
    expect(independent.entities.find((entity) => entity.handle === "40")).toMatchObject({
      degreeOfSplineCurve: 3,
      controlPoints: [{ x: -500, y: 200 }, { x: -660, y: 280 }, { x: -660, y: 360 }, { x: -500, y: 440 }],
      knotValues: [0, 0, 0, 0, 1, 1, 1, 1],
    });
    expect(independent.entities.find((entity) => entity.handle === "50")).toMatchObject({ textHeight: 20, rotation: 90 });

    const readback = importDxf(exported.bytes, { documentId: "F-029-DXF-readback", now: "2026-08-30T12:00:01.000Z" });
    expect(readback.report).toMatchObject({ importedHandles: ["10", "20", "30", "40", "50"], skipped: [], warnings: [] });
    const entities = new Map(readback.document.entities.map((entity) => [entity.handle, entity]));
    expect(entities.get("10")).toMatchObject({ kind: "line", start: { x: 100, y: 200 }, end: { x: 100, y: 400 }, appearance: expect.objectContaining({ aciIndex: 1, lineweightMm: 0.35 }) });
    expect(entities.get("20")).toMatchObject({ kind: "circle", center: { x: -100, y: 200 }, radius: 50 });
    expect(entities.get("30")).toMatchObject({ kind: "polyline", closed: true, vertices: [{ startWidth: 4, endWidth: 8 }, { startWidth: 8, endWidth: 12 }], appearance: expect.objectContaining({ color: "#00ff00" }) });
    expect(entities.get("40")).toMatchObject({ kind: "spline", degree: 3, controlPoints: [{ x: -500, y: 200 }, { x: -660, y: 280 }, { x: -660, y: 360 }, { x: -500, y: 440 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false });
    expect(entities.get("50")).toMatchObject({ kind: "text", position: { x: -800, y: 200 }, height: 20, rotationRad: expect.closeTo(Math.PI / 2, 12), text: "ALIGN" });
  });
});
