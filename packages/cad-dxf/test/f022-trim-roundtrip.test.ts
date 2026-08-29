import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import type { CadCircle, CadEllipse, CadLine, CadSpline } from "@kuubik/cad-schema";
import { createEmptyDocument, trimCadEntity } from "@kuubik/cad-core";
import { exportDxf, importDxf, readDxfSummary } from "../src/index.js";

const vertical: CadLine = { kind: "line", handle: "20", layerId: "0", start: { x: 5, y: -20 }, end: { x: 5, y: 20 } };

function appendEntityGroups(text: string, type: string, groups: ReadonlyArray<[number, number]>): string {
  const marker = `  0\r\n${type}\r\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${type} record in test fixture.`);
  const end = text.indexOf("  0\r\n", start + marker.length);
  if (end < 0) throw new Error(`Unterminated ${type} record in test fixture.`);
  const inserted = groups.map(([code, value]) => `${String(code).padStart(3, " ")}\r\n${value}\r\n`).join("");
  return `${text.slice(0, end)}${inserted}${text.slice(end)}`;
}

function replaceEntityGroup(text: string, type: string, code: number, value: number): string {
  const marker = `  0\r\n${type}\r\n`;
  const start = text.indexOf(marker);
  const end = start < 0 ? -1 : text.indexOf("  0\r\n", start + marker.length);
  if (start < 0 || end < 0) throw new Error(`Missing ${type} record in test fixture.`);
  const record = text.slice(start, end);
  const group = `${String(code).padStart(3, " ")}\r\n`;
  const groupStart = record.indexOf(group);
  const valueStart = groupStart < 0 ? -1 : groupStart + group.length;
  const valueEnd = valueStart < 0 ? -1 : record.indexOf("\r\n", valueStart);
  if (groupStart < 0 || valueEnd < 0) throw new Error(`Missing ${type} group ${code} in test fixture.`);
  const replacement = `${record.slice(0, valueStart)}${value}${record.slice(valueEnd)}`;
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

describe("F-022 TRIM ARC/ELLIPSE DXF readback", () => {
  it("includes every cardinal extremum for a full-turn rotated ellipse", () => {
    const document = createEmptyDocument({ documentId: "F-022-full-ellipse-extents" });
    document.entities = [{
      kind: "ellipse", handle: "10", layerId: "0", center: { x: 10, y: 20 },
      majorAxis: { x: 3, y: 4 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2,
    }];
    const xRadius = Math.hypot(3, -2);
    const yRadius = Math.hypot(4, 1.5);

    expect(readDxfSummary(exportDxf(document).text).extents).toEqual({
      minX: 10 - xRadius,
      minY: 20 - yRadius,
      maxX: 10 + xRadius,
      maxY: 20 + yRadius,
    });
  });

  it("fails closed for non-planar, flipped-OCS and conflicting conic singleton groups", () => {
    const arcDocument = createEmptyDocument({ documentId: "F-022-adversarial-arc" });
    arcDocument.entities = [{
      kind: "arc", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10,
      startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true,
    }];
    const ellipseDocument = createEmptyDocument({ documentId: "F-022-adversarial-ellipse" });
    ellipseDocument.entities = [{
      kind: "ellipse", handle: "11", layerId: "0", center: { x: 20, y: 0 }, majorAxis: { x: 10, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2,
    }];
    const arc = exportDxf(arcDocument).text;
    const ellipse = exportDxf(ellipseDocument).text;

    expect(() => importDxf(replaceEntityGroup(arc, "ARC", 30, 2), { documentId: "arc-z" })).toThrow(/non-planar.*group 30/i);
    expect(() => importDxf(appendEntityGroups(arc, "ARC", [[210, 0], [220, 0], [230, -1]]), { documentId: "arc-ocs" })).toThrow(/OCS extrusion.*\+Z planar subset/i);
    expect(() => importDxf(replaceEntityGroup(ellipse, "ELLIPSE", 31, 1), { documentId: "ellipse-z" })).toThrow(/non-planar.*group 31/i);
    expect(() => importDxf(appendEntityGroups(ellipse, "ELLIPSE", [[40, 0.25]]), { documentId: "ellipse-duplicate" })).toThrow(/conflicting duplicate DXF group 40/i);
  });

  it("fails closed for non-planar and conflicting SPLINE normal groups", () => {
    const document = createEmptyDocument({ documentId: "F-022-adversarial-spline-normal" });
    document.entities = [{
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: -10 }, { x: 30, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 1, 1], closed: false, periodic: false,
    }];
    const spline = exportDxf(document).text;

    expect(() => importDxf(replaceEntityGroup(spline, "SPLINE", 210, 1), { documentId: "spline-normal-x" })).toThrow(/normal.*\+Z planar subset/i);
    expect(() => importDxf(replaceEntityGroup(spline, "SPLINE", 230, 0), { documentId: "spline-normal-z" })).toThrow(/normal.*\+Z planar subset/i);
    expect(() => importDxf(appendEntityGroups(spline, "SPLINE", [[210, 1]]), { documentId: "spline-normal-duplicate" })).toThrow(/conflicting duplicate DXF group 210/i);
  });

  it("round-trips the actual closed-curve TRIM outputs through strict and independent readers", () => {
    const circle: CadCircle = { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 };
    const ellipse: CadEllipse = {
      kind: "ellipse", handle: "11", layerId: "0", center: { x: 30, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5,
      startParameter: 0, endParameter: Math.PI * 2,
    };
    const arcResult = trimCadEntity(circle, { x: 10, y: 0 }, [vertical]);
    const ellipseResult = trimCadEntity(ellipse, { x: 40, y: 0 }, [{ ...vertical, handle: "21", start: { x: 30, y: -20 }, end: { x: 30, y: 20 } }]);
    expect(arcResult.reason).toBeNull();
    expect(ellipseResult.reason).toBeNull();
    const document = createEmptyDocument({ documentId: "F-022-dxf" });
    document.entities = [arcResult.entities[0]!, ellipseResult.entities[0]!];

    const exported = exportDxf(document);
    expect(exported.report).toEqual({
      emittedHandles: ["10", "11"],
      handleMap: { "10": "10", "11": "11" },
      skipped: [],
    });
    expect(readDxfSummary(exported.text)).toMatchObject({
      acadVersion: "AC1018",
      entityTypes: { ARC: 1, ELLIPSE: 1 },
      handles: ["10", "11"],
    });

    const strict = importDxf(exported.bytes, { documentId: "F-022-readback" });
    expect(strict.report).toMatchObject({ importedHandles: ["10", "11"], skipped: [], warnings: [] });
    expect(strict.document.entities).toMatchObject([
      { kind: "arc", handle: "10", center: { x: 0, y: 0 }, radius: 10, counterClockwise: true },
      { kind: "ellipse", handle: "11", center: { x: 30, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5 },
    ]);
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => entity.type)).toEqual(["ARC", "ELLIPSE"]);
    expect(independent.entities[0]).toMatchObject({ handle: "10", center: { x: 0, y: 0 }, radius: 10 });
    expect(independent.entities[1]).toMatchObject({ handle: "11", center: { x: 30, y: 0 }, majorAxisEndPoint: { x: 10, y: 0 }, axisRatio: 0.5 });
  });

  it("exports clockwise schema arcs as the same DXF support with swapped CCW limits", () => {
    const document = createEmptyDocument({ documentId: "F-022-clockwise" });
    document.entities = [{
      kind: "arc", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10,
      startAngleRad: Math.PI, endAngleRad: 0, counterClockwise: false,
    }];
    const strict = importDxf(exportDxf(document).bytes, { documentId: "F-022-clockwise-readback" });
    expect(strict.document.entities[0]).toMatchObject({
      kind: "arc", startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true,
    });
  });

  it("round-trips exact rational SPLINE trim pieces without losing knots or weights", () => {
    const spline: CadSpline = {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 100 }, { x: 200 / 3, y: -100 }, { x: 100, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
    };
    const result = trimCadEntity(spline, { x: 50, y: 0 }, [
      { ...vertical, handle: "20", start: { x: 25, y: -100 }, end: { x: 25, y: 100 } },
      { ...vertical, handle: "21", start: { x: 75, y: -100 }, end: { x: 75, y: 100 } },
    ]);
    expect(result.reason).toBeNull();
    const document = createEmptyDocument({ documentId: "F-022-spline-dxf" });
    document.entities = result.entities.map((entity, index) => ({ ...entity, handle: index === 0 ? "10" : "11" }));
    const exported = exportDxf(document);
    expect(exported.report).toEqual({ emittedHandles: ["10", "11"], handleMap: { "10": "10", "11": "11" }, skipped: [] });
    expect(readDxfSummary(exported.text)).toMatchObject({ entityTypes: { SPLINE: 2 }, handles: ["10", "11"] });
    const strict = importDxf(exported.bytes, { documentId: "F-022-spline-readback" });
    expect(strict.report).toMatchObject({ importedHandles: ["10", "11"], skipped: [], warnings: [] });
    expect(strict.document.layers.find((layer) => layer.id === "dxf-layer:0")?.name).toBe("0");
    expect(strict.document.entities.map((entity) => ({ ...entity, layerId: "0" }))).toEqual(document.entities);
    const independent = new DxfParser().parseSync(exported.text)!;
    expect(independent.entities.map((entity) => entity.type)).toEqual(["SPLINE", "SPLINE"]);
    expect(independent.entities.map((entity) => ({ degree: entity.degreeOfSplineCurve, controls: entity.controlPoints?.length, knots: entity.knotValues?.length }))).toEqual([
      { degree: 3, controls: 4, knots: 8 },
      { degree: 3, controls: 4, knots: 8 },
    ]);
  });
});
