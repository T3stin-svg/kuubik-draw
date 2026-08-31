import { describe, expect, it } from "vitest";
import type { CadSpline } from "@kuubik/cad-schema";
import { createEmptyDocument, createFitPointSpline } from "@kuubik/cad-core";
import { DxfImportError, exportDxf, importDxf } from "../src/index.js";

function fitSpline(): CadSpline {
  return {
    kind: "spline",
    handle: "12",
    layerId: "0",
    definitionMethod: "fit-points",
    degree: 3,
    fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
    fitTolerance: 0.125,
    startTangent: { x: 30, y: 45 },
    endTangent: { x: 25, y: -55 },
    knotParameterization: "sqrt-chord",
    controlPoints: [{ x: 0, y: 0 }, { x: 20, y: 55 }, { x: 75, y: 65 }, { x: 100, y: 0 }],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
    closed: false,
    periodic: false,
  };
}

describe("F-012 SPLINE fit-data DXF roundtrip", () => {
  it("preserves fit points, tolerance and endpoint tangents with the evaluated NURBS", () => {
    const document = createEmptyDocument({ documentId: "F-012-fit", now: "2026-08-31T03:00:00.000Z" });
    document.entities = [fitSpline()];
    const exported = exportDxf(document);
    expect(exported.report.skipped).toEqual([]);
    expect(exported.text).toMatch(/\r?\n 74\r?\n3\r?\n/u);
    expect(exported.text).toMatch(/\r?\n 44\r?\n0\.125\r?\n/u);
    const imported = importDxf(exported.bytes, { documentId: "F-012-fit-readback", now: "2026-08-31T03:00:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities[0]).toMatchObject({
      kind: "spline",
      handle: "12",
      definitionMethod: "fit-points",
      degree: 3,
      fitPoints: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }],
      fitTolerance: 0.125,
      startTangent: { x: 30, y: 45 },
      endTangent: { x: 25, y: -55 },
      controlPoints: [{ x: 0, y: 0 }, { x: 20, y: 55 }, { x: 75, y: 65 }, { x: 100, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      closed: false,
      periodic: false,
    });
    expect((imported.document.entities[0] as CadSpline).knotParameterization).toBeUndefined();
  });

  it("fails closed on truncated, non-planar and invalid fit data", () => {
    const document = createEmptyDocument({ documentId: "F-012-invalid" });
    document.entities = [fitSpline()];
    const source = exportDxf(document).text;
    const badCount = source.replace(/(AcDbSpline[\s\S]*?\r?\n 74\r?\n)3(\r?\n)/u, (_match, before: string, after: string) => `${before}4${after}`);
    const badTangent = source.replace(/(AcDbSpline[\s\S]*?\r?\n 32\r?\n)0(\r?\n)/u, (_match, before: string, after: string) => `${before}1${after}`);
    expect(badCount).not.toBe(source);
    expect(badTangent).not.toBe(source);
    expect(() => importDxf(badCount, { documentId: "bad-count" })).toThrow(DxfImportError);
    expect(() => importDxf(badTangent, { documentId: "bad-tangent" })).toThrow(/non-planar/u);
    expect(() => exportDxf({ ...document, entities: [{ ...fitSpline(), fitTolerance: -1 }] })).toThrow(/invalid degree, knots, control points or weights/u);
  });

  it("preserves a closed periodic C2 Fit spline without appending a duplicate fit point", () => {
    const document = createEmptyDocument({ documentId: "F-012-closed" });
    const spline = createFitPointSpline({
      handle: "1C",
      layerId: "0",
      fitPoints: [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: 60, y: 100 }, { x: -20, y: 70 }],
      knotParameterization: "chord",
      closed: true,
    });
    document.entities = [spline];
    const exported = exportDxf(document);
    expect(exported.text).toMatch(/AcDbSpline[\s\S]*?\r?\n 70\r?\n11\r?\n/u);
    const imported = importDxf(exported.bytes, { documentId: "F-012-closed-readback" });
    const readback = imported.document.entities[0] as CadSpline;
    expect(readback).toMatchObject({
      kind: "spline",
      definitionMethod: "fit-points",
      fitPoints: spline.fitPoints,
      closed: true,
      periodic: true,
    });
    expect(readback.fitPoints).toHaveLength(4);
    readback.controlPoints.forEach((point, index) => expect(point).toEqual({
      x: expect.closeTo(spline.controlPoints[index]!.x, 11),
      y: expect.closeTo(spline.controlPoints[index]!.y, 11),
    }));
    readback.knots.forEach((knot, index) => expect(knot).toBeCloseTo(spline.knots[index]!, 12));
  });
});
