import type { CadArc, CadEllipse, CadLine, CadPolyline, CadSpline } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  executeLengthen,
  lengthenCadEntity,
  lengthenEntityLength,
  parseLengthenTargetPicks,
  resolveCadCommand,
} from "../src/index.js";

const line: CadLine = {
  kind: "line", handle: "10", layerId: "0",
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
  appearance: { color: "#ff0000", lineweightMm: 0.35 },
  extensionData: { rowId: "F-028" },
};

describe("F-028 LENGTHEN geometry", () => {
  it("applies Delta, Percent, Total and Dynamic to the picked line endpoint", () => {
    expect(lengthenCadEntity(line, { x: 100, y: 0 }, { mode: "delta", value: 50 }).entity).toEqual({
      ...line, end: { x: 150, y: 0 },
    });
    expect(lengthenCadEntity(line, { x: 0, y: 0 }, { mode: "percent", value: 50 }).entity).toEqual({
      ...line, start: { x: 50, y: 0 },
    });
    expect(lengthenCadEntity(line, { x: 100, y: 0 }, { mode: "total", value: 225 }).entity).toEqual({
      ...line, end: { x: 225, y: 0 },
    });
    expect(lengthenCadEntity(line, { x: 100, y: 0 }, { mode: "dynamic", point: { x: 175, y: 40 } }).entity).toEqual({
      ...line, end: { x: 175, y: 0 },
    });
    expect(lengthenCadEntity(line, { x: 100, y: 0 }, { mode: "delta", value: -100 })).toMatchObject({ reason: "invalid-value", entity: null });
  });

  it("changes ARC included angle by length or explicit angle while keeping radius and fixed endpoint", () => {
    const arc: CadArc = {
      kind: "arc", handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 100,
      startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true,
    };
    const angle = lengthenCadEntity(arc, { x: 0, y: 100 }, { mode: "delta", value: 45, measurement: "angle" });
    expect(angle.reason).toBeNull();
    expect(angle.endpoint).toBe("end");
    expect(angle.entity).toMatchObject({ kind: "arc", radius: 100, startAngleRad: 0, endAngleRad: expect.closeTo(Math.PI * 0.75, 11) });
    expect(angle.newIncludedAngleRad).toBeCloseTo(Math.PI * 0.75, 11);
    const total = lengthenCadEntity(arc, { x: 100, y: 0 }, { mode: "total", value: Math.PI * 25 });
    expect(total.entity).toMatchObject({ kind: "arc", startAngleRad: expect.closeTo(Math.PI * 0.25, 11), endAngleRad: Math.PI / 2 });
  });

  it("uses whole open-polyline length and preserves terminal bulge, widths and base properties", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "30", layerId: "0", closed: false,
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, startWidth: 4, endWidth: 6 },
        { x: 100, y: 100, startWidth: 6, endWidth: 8 },
      ],
      appearance: { color: "#00ff00" }, extensionData: { retained: true },
    };
    const result = lengthenCadEntity(polyline, { x: 100, y: 100 }, { mode: "percent", value: 150 });
    expect(result.reason).toBeNull();
    expect(result.oldLength).toBeCloseTo(200, 10);
    expect(result.newLength).toBeCloseTo(300, 8);
    expect(result.entity).toEqual({
      ...polyline,
      vertices: [polyline.vertices[0], { ...polyline.vertices[1], endWidth: 8 }, { ...polyline.vertices[2], y: 200 }],
    });

    const shortenedAtStart = lengthenCadEntity(polyline, { x: 0, y: 0 }, { mode: "percent", value: 75 });
    expect(shortenedAtStart.entity).toEqual({
      ...polyline,
      vertices: [{ ...polyline.vertices[0], x: 50, startWidth: 3 }, polyline.vertices[1], polyline.vertices[2]],
    });
  });

  it("lengthens elliptical arcs by measured arc length and refuses full ellipses", () => {
    const ellipse: CadEllipse = {
      kind: "ellipse", handle: "40", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2,
    };
    const current = lengthenEntityLength(ellipse)!;
    const shortened = lengthenCadEntity(ellipse, { x: 0, y: 50 }, { mode: "percent", value: 50 });
    expect(shortened.reason).toBeNull();
    expect(shortened.entity).toMatchObject({ kind: "ellipse", startParameter: 0 });
    expect(shortened.newLength).toBeCloseTo(current / 2, 5);
    expect((shortened.entity as CadEllipse).endParameter).toBeGreaterThan(0);
    expect((shortened.entity as CadEllipse).endParameter).toBeLessThan(Math.PI / 2);
    expect(lengthenCadEntity({ ...ellipse, endParameter: Math.PI * 2 }, { x: 100, y: 0 }, { mode: "delta", value: 10 })).toMatchObject({ reason: "closed-target" });
  });

  it("moves the picked elliptical-arc start to the Dynamic cursor parameter without reversing the retained arc", () => {
    const ellipse: CadEllipse = {
      kind: "ellipse", handle: "41", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 100, y: 0 },
      ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2,
    };
    const dynamicPoint = { x: 100 * Math.cos(-Math.PI / 4), y: 50 * Math.sin(-Math.PI / 4) };
    const result = lengthenCadEntity(ellipse, { x: 100, y: 0 }, { mode: "dynamic", point: dynamicPoint });
    expect(result.reason).toBeNull();
    expect(result.endpoint).toBe("start");
    expect(result.entity).toMatchObject({
      kind: "ellipse",
      startParameter: expect.closeTo(-Math.PI / 4, 8),
      endParameter: Math.PI / 2,
    });
  });

  it("fails closed for the audited rational control-point spline in every LENGTHEN mode", () => {
    const spline: CadSpline = {
      kind: "spline", handle: "50", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 40, y: 80 }, { x: 80, y: 80 }, { x: 120, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 0.8, 1.2, 1], closed: false, periodic: false,
    };
    const source = structuredClone(spline);
    for (const specification of [
      { mode: "percent", value: 60 } as const,
      { mode: "delta", value: 25 } as const,
      { mode: "total", value: 200 } as const,
      { mode: "dynamic", point: { x: 150, y: -40 } } as const,
    ]) expect(lengthenCadEntity(spline, { x: 120, y: 0 }, specification)).toMatchObject({ entity: null, reason: "unsupported-target" });
    expect(spline).toEqual(source);
  });

  it("rejects closed and unsupported entities without mutation", () => {
    expect(lengthenCadEntity({ kind: "circle", handle: "C", layerId: "0", center: { x: 0, y: 0 }, radius: 10 }, { x: 10, y: 0 }, { mode: "delta", value: 5 })).toMatchObject({ reason: "unsupported-target", entity: null });
    expect(lengthenCadEntity({ kind: "polyline", handle: "P", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }, { x: 0, y: 0 }, { mode: "delta", value: 5 })).toMatchObject({ reason: "closed-target", entity: null });
  });
});

describe("F-028 LENGTHEN command", () => {
  it("resolves aliases and parses standard or Dynamic target entries", () => {
    expect(resolveCadCommand("len")?.id).toBe("LENGTHEN");
    expect(resolveCadCommand("LENGTHEN")?.id).toBe("LENGTHEN");
    expect(parseLengthenTargetPicks("10@100,0; 20@0,50", "delta")).toEqual([
      { handle: "10", pickPoint: { x: 100, y: 0 } },
      { handle: "20", pickPoint: { x: 0, y: 50 } },
    ]);
    expect(parseLengthenTargetPicks("10@100,0>175,40", "dynamic")).toEqual([
      { handle: "10", pickPoint: { x: 100, y: 0 }, dynamicPoint: { x: 175, y: 40 } },
    ]);
    expect(() => parseLengthenTargetPicks("10@100,0", "dynamic")).toThrow(/Dynamic LENGTHEN/);
  });

  it("applies repeated endpoint picks against an immutable working map as one final change", () => {
    const document = createEmptyDocument({ documentId: "lengthen" });
    document.entities.push(line);
    const result = executeLengthen(document, {
      mode: "delta", value: 50, measurement: "length",
      targets: [
        { handle: "10", pickPoint: { x: 100, y: 0 } },
        { handle: "10", pickPoint: { x: 150, y: 0 } },
      ],
    });
    expect(result.changes).toEqual([{ type: "put", entity: { ...line, end: { x: 200, y: 0 } } }]);
    expect(result.steps.map(({ oldLength, newLength }) => [oldLength, newLength])).toEqual([[100, 150], [150, 200]]);
    expect(result.sourceHandles).toEqual(["10"]);
    expect(result.multiple).toBe(true);
    expect(document.entities).toEqual([line]);
  });

  it("truthfully rejects missing, locked and closed targets while committing editable results", () => {
    const document = createEmptyDocument({ documentId: "lengthen-reject" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      line,
      { ...line, handle: "11", layerId: "locked" },
      { kind: "circle", handle: "12", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
    );
    const result = executeLengthen(document, {
      mode: "delta", value: 25,
      targets: [
        { handle: "10", pickPoint: { x: 100, y: 0 } },
        { handle: "11", pickPoint: { x: 100, y: 0 } },
        { handle: "12", pickPoint: { x: 10, y: 0 } },
        { handle: "missing", pickPoint: { x: 0, y: 0 } },
      ],
    });
    expect(result.changes).toHaveLength(1);
    expect(result.rejected).toEqual([
      { handle: "11", targetIndex: 1, reason: "locked-layer" },
      { handle: "12", targetIndex: 2, reason: "unsupported-target" },
      { handle: "missing", targetIndex: 3, reason: "missing" },
    ]);
  });
});
