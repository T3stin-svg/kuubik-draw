import DxfParser from "dxf-parser";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeLengthen, lengthenEntityLength } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { exportDxf, importDxf } from "../src/index.js";

function apply(document: KDrawDocumentV1, changes: ReturnType<typeof executeLengthen>["changes"]): KDrawDocumentV1 {
  const output = structuredClone(document);
  for (const change of changes) {
    const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
    if (index < 0) throw new Error(`F-028 missing source ${change.entity.handle}.`);
    output.entities[index] = change.entity;
  }
  return output;
}

describe("F-028 LENGTHEN DXF roundtrip", () => {
  it("preserves changed endpoints and an honestly refused control-point spline", () => {
    const source = createEmptyDocument({ documentId: "F-028-DXF", now: "2026-08-30T12:00:00.000Z" });
    source.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.35 }, extensionData: { rowId: "F-028" } },
      { kind: "arc", handle: "20", layerId: "0", center: { x: 0, y: 300 }, radius: 100, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true },
      { kind: "polyline", handle: "30", layerId: "0", closed: false, vertices: [
        { x: 0, y: 500, startWidth: 2, endWidth: 4 },
        { x: 100, y: 500, bulge: 0.5, startWidth: 4, endWidth: 6 },
        { x: 200, y: 500, startWidth: 6, endWidth: 8 },
      ], appearance: { color: "#00ff00", colorMethod: "trueColor" } },
      { kind: "ellipse", handle: "40", layerId: "0", center: { x: 400, y: 300 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2 },
      { kind: "spline", handle: "50", layerId: "0", degree: 3, controlPoints: [{ x: 400, y: 500 }, { x: 440, y: 580 }, { x: 480, y: 580 }, { x: 520, y: 500 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false },
    ];
    const beforeLengths = Object.fromEntries(source.entities.map((entity) => [entity.handle, lengthenEntityLength(entity)]));
    const result = executeLengthen(source, {
      mode: "delta", value: 25, measurement: "length",
      targets: [
        { handle: "10", pickPoint: { x: 100, y: 0 } },
        { handle: "20", pickPoint: { x: 0, y: 400 } },
        { handle: "30", pickPoint: { x: 200, y: 500 } },
        { handle: "40", pickPoint: { x: 400, y: 350 } },
        { handle: "50", pickPoint: { x: 520, y: 500 } },
      ],
    });
    expect(result.rejected).toEqual([{ handle: "50", targetIndex: 4, reason: "unsupported-target" }]);
    expect(result.steps).toHaveLength(4);
    const changed = apply(source, result.changes);
    for (const entity of changed.entities.filter(({ handle }) => handle !== "50")) expect(lengthenEntityLength(entity)).toBeCloseTo(beforeLengths[entity.handle]! + 25, 4);
    expect(changed.entities.find(({ handle }) => handle === "50")).toEqual(source.entities.find(({ handle }) => handle === "50"));

    const exported = exportDxf(changed);
    expect(exported.report).toEqual({ emittedHandles: ["10", "20", "30", "40", "50"], handleMap: { "10": "10", "20": "20", "30": "30", "40": "40", "50": "50" }, skipped: [] });
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => `${entity.handle}:${entity.type}`)).toEqual(["10:LINE", "20:ARC", "30:LWPOLYLINE", "40:ELLIPSE", "50:SPLINE"]);
    expect(independent.entities.find((entity) => entity.handle === "10")?.vertices).toMatchObject([{ x: 0, y: 0 }, { x: 125, y: 0 }]);
    expect(independent.entities.find((entity) => entity.handle === "30")?.vertices).toMatchObject([
      { x: 0, y: 500, startWidth: 2, endWidth: 4 },
      { x: 100, y: 500, bulge: expect.any(Number), startWidth: 4, endWidth: expect.closeTo(6.431362086458, 11) },
      { x: expect.any(Number), y: expect.any(Number), startWidth: 6, endWidth: 8 },
    ]);
    expect(independent.entities.find((entity) => entity.handle === "50")).toMatchObject({ type: "SPLINE", degreeOfSplineCurve: 3 });

    const readback = importDxf(exported.bytes, { documentId: "F-028-DXF-readback", now: "2026-08-30T12:00:01.000Z" });
    expect(readback.report).toMatchObject({ importedHandles: ["10", "20", "30", "40", "50"], skipped: [], warnings: [] });
    const entities = new Map(readback.document.entities.map((entity) => [entity.handle, entity]));
    expect(entities.get("10")).toMatchObject({ kind: "line", end: { x: 125, y: 0 }, appearance: expect.objectContaining({ aciIndex: 1, lineweightMm: 0.35 }) });
    expect(entities.get("20")).toMatchObject({ kind: "arc", radius: 100 });
    expect(entities.get("30")).toMatchObject({ kind: "polyline", closed: false, appearance: expect.objectContaining({ color: "#00ff00" }) });
    expect(entities.get("40")).toMatchObject({ kind: "ellipse", center: { x: 400, y: 300 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5 });
    expect(entities.get("50")).toMatchObject({ kind: "spline", degree: 3, closed: false, periodic: false });
    for (const entity of readback.document.entities.filter(({ handle }) => handle !== "50")) expect(lengthenEntityLength(entity)).toBeCloseTo(beforeLengths[entity.handle]! + 25, 3);
    expect(entities.get("50")).toMatchObject({ ...source.entities.find(({ handle }) => handle === "50")!, layerId: "dxf-layer:0" });
  });
});
