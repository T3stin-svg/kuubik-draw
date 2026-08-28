import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { createEmptyDocument } from "../../cad-core/src/index.js";
import { exportDxf, readDxfSummary } from "../src/index.js";

describe("synthetic DXF gate", () => {
  it("round-trips entity types, handles, units and double extents", () => {
    const document = createEmptyDocument({ documentId: "dxf" });
    document.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0.125, y: -2.5 }, end: { x: 100.75, y: 50.5 } },
      { kind: "circle", handle: "11", layerId: "0", center: { x: 10.5, y: 20.25 }, radius: 5.125 },
      { kind: "polyline", handle: "12", layerId: "0", vertices: [{ x: 2.25, y: 3.5 }, { x: 4.75, y: 8.125, bulge: 0.25 }], closed: false },
    ];
    const exported = exportDxf(document);
    expect(exported.report).toEqual({
      emittedHandles: ["10", "11", "12"],
      handleMap: { "10": "10", "11": "11", "12": "12" },
      skipped: [],
    });
    const readback = readDxfSummary(exported.text);
    expect(readback).toMatchObject({
      acadVersion: "AC1015",
      entityTypes: { LINE: 1, CIRCLE: 1, LWPOLYLINE: 1 },
      handles: ["10", "11", "12"],
      extents: { minX: 0.125, minY: -2.5, maxX: 100.75, maxY: 50.5 },
    });
  });

  it("maps non-hex handles deterministically and passes an independent parser", () => {
    const document = createEmptyDocument({ documentId: "independent" });
    document.units.linear = "m";
    document.entities = [{ kind: "line", handle: "LINE-1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1.5, y: 2.5 } }];
    const exported = exportDxf(document);
    expect(exported.report.handleMap["LINE-1"]).toMatch(/^[1-9A-F][0-9A-F]*$/);
    const parsed = new DxfParser().parseSync(exported.text);
    expect(parsed?.header?.$INSUNITS).toBe(6);
    expect(parsed?.entities).toHaveLength(1);
    expect(parsed?.entities[0]?.type).toBe("LINE");
  });

  it("includes circle radius in independently read extents", () => {
    const document = createEmptyDocument({ documentId: "circle-extents" });
    document.entities = [{ kind: "circle", handle: "20", layerId: "0", center: { x: 10.5, y: 20.25 }, radius: 5.125 }];
    expect(readDxfSummary(exportDxf(document).text).extents).toEqual({
      minX: 5.375,
      minY: 15.125,
      maxX: 15.625,
      maxY: 25.375,
    });
  });

  it("reports unsupported entities instead of silently deleting them", () => {
    const document = createEmptyDocument({ documentId: "proxy" });
    document.entities = [{ kind: "proxy", handle: "AA", layerId: "0", originalType: "VENDOR", raw: { opaque: true } }];
    const exported = exportDxf(document);
    expect(exported.report.skipped).toEqual([
      { handle: "AA", kind: "proxy", reason: "DXF adapter not implemented for this entity kind." },
    ]);
  });
});
