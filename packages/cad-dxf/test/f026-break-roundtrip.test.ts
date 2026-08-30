import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { createEmptyDocument, executeBreak } from "@kuubik/cad-core";
import type { CadSpline, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { exportDxf, importDxf } from "../src/index.js";

function applyBreak(document: KDrawDocumentV1, changes: ReturnType<typeof executeBreak>["changes"]): KDrawDocumentV1 {
  const output = structuredClone(document);
  for (const change of changes) {
    if (change.type === "delete") {
      output.entities = output.entities.filter((entity) => entity.handle !== change.handle);
      continue;
    }
    const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
    if (index >= 0) output.entities[index] = change.entity;
    else output.entities.push(change.entity);
  }
  return output;
}

const rationalSpline: CadSpline = {
  kind: "spline", handle: "50", layerId: "0", degree: 3,
  controlPoints: [{ x: 0, y: 300 }, { x: 100 / 3, y: 300 }, { x: 200 / 3, y: 300 }, { x: 100, y: 300 }],
  knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
  appearance: { color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
};

describe("F-026 BREAK DXF roundtrip", () => {
  it("preserves handles and exact line/circle/ellipse/polyline/rational-spline BREAK outputs", () => {
    const source = createEmptyDocument({ documentId: "F-026-DXF", now: "2026-08-30T06:30:00.000Z" });
    source.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 } },
      { kind: "circle", handle: "20", layerId: "0", center: { x: 200, y: 0 }, radius: 50 },
      { kind: "ellipse", handle: "30", layerId: "0", center: { x: 350, y: 0 }, majorAxis: { x: 50, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
      { kind: "polyline", handle: "40", layerId: "0", closed: false, vertices: [{ x: 0, y: 100, startWidth: 2, endWidth: 4 }, { x: 100, y: 100, startWidth: 4, endWidth: 6 }, { x: 200, y: 100 }] },
      rationalSpline,
    ];
    const result = executeBreak(source, { targets: [
      { handle: "10", firstPoint: { x: 25, y: 5 }, secondPoint: { x: 75, y: -5 } },
      { handle: "20", firstPoint: { x: 250, y: 0 }, secondPoint: { x: 200, y: 50 } },
      { handle: "30", firstPoint: { x: 400, y: 0 }, secondPoint: { x: 350, y: 25 } },
      { handle: "40", firstPoint: { x: 25, y: 100 }, secondPoint: { x: 175, y: 100 } },
      { handle: "50", firstPoint: { x: 25, y: 300 }, secondPoint: { x: 75, y: 300 } },
    ] });
    expect(result).toMatchObject({
      rejected: [], sourceHandles: ["10", "20", "30", "40", "50"],
      resultHandles: ["10", "51", "20", "30", "40", "52", "50", "53"], createdHandles: ["51", "52", "53"], multiple: true,
    });

    const broken = applyBreak(source, result.changes);
    const exported = exportDxf(broken);
    expect(exported.report).toEqual({
      emittedHandles: ["10", "20", "30", "40", "50", "51", "52", "53"],
      handleMap: { "10": "10", "20": "20", "30": "30", "40": "40", "50": "50", "51": "51", "52": "52", "53": "53" },
      skipped: [],
    });
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => `${entity.handle}:${entity.type}`)).toEqual([
      "10:LINE", "20:ARC", "30:ELLIPSE", "40:LWPOLYLINE", "50:SPLINE", "51:LINE", "52:LWPOLYLINE", "53:SPLINE",
    ]);

    const readback = importDxf(exported.bytes, { documentId: "F-026-DXF-readback", now: "2026-08-30T06:30:01.000Z" });
    expect(readback.report).toMatchObject({ importedHandles: ["10", "20", "30", "40", "50", "51", "52", "53"], skipped: [], warnings: [] });
    const entities = new Map(readback.document.entities.map((entity) => [entity.handle, entity]));
    expect(entities.get("10")).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 25, y: 0 }, appearance: expect.objectContaining({ color: "#ff0000", aciIndex: 1, lineweightMm: 0.5 }) });
    expect(entities.get("51")).toMatchObject({ kind: "line", start: { x: 75, y: 0 }, end: { x: 100, y: 0 }, appearance: expect.objectContaining({ color: "#ff0000", aciIndex: 1, lineweightMm: 0.5 }) });
    expect(entities.get("20")).toMatchObject({ kind: "arc", center: { x: 200, y: 0 }, radius: 50, counterClockwise: true });
    expect(entities.get("30")).toMatchObject({ kind: "ellipse", center: { x: 350, y: 0 }, majorAxis: { x: 50, y: 0 }, ratio: 0.5 });
    expect(entities.get("40")).toMatchObject({ kind: "polyline", closed: false, vertices: [{ x: 0, y: 100, startWidth: 2, endWidth: 2.5 }, { x: 25, y: 100 }] });
    expect(entities.get("52")).toMatchObject({ kind: "polyline", closed: false, vertices: [{ x: 175, y: 100, startWidth: 5.5, endWidth: 6 }, { x: 200, y: 100 }] });
    for (const handle of ["50", "53"]) {
      expect(entities.get(handle)).toMatchObject({ kind: "spline", degree: 3, closed: false, periodic: false, weights: [2, 2, 2, 2] });
      const entity = entities.get(handle);
      if (entity?.kind !== "spline") throw new Error(`Expected ${handle} to roundtrip as SPLINE.`);
      expect(entity.knots).toHaveLength(entity.controlPoints.length + entity.degree + 1);
    }
  });
});
