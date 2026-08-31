import DxfParser from "dxf-parser";
import { describe, expect, it } from "vitest";
import golden from "./f110-core.golden.json";
import { createF110Document } from "./f110-fixture.js";
import { exportDxf, importDxf, openDxfDocument, readDxfSummary } from "../src/index.js";

function kindCounts(entities: readonly { kind: string }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entity of entities) result[entity.kind] = (result[entity.kind] ?? 0) + 1;
  return result;
}

function appendUnsupportedEntity(source: string): string {
  const marker = "  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS";
  return source.replace(marker, "  0\r\n3DSOLID\r\n  5\r\nD0\r\n  8\r\nGEOMETRY\r\n100\r\nAcDbEntity\r\n  1\r\nopaque-payload\r\n" + marker);
}

describe("F-110 DXF import core entities and units", () => {
  it("round-trips every selected core entity, native table and named block deterministically", () => {
    const first = exportDxf(createF110Document());
    expect(first.report.skipped).toEqual([]);
    const imported = importDxf(first.bytes, { documentId: "F-110-imported", now: "2026-08-31T20:01:00.000Z" });
    expect(imported.report).toMatchObject({
      sourceUnits: golden.units,
      targetUnits: golden.units,
      insertionScale: golden.insertionScale,
      skipped: [],
      preservedProxyHandles: [],
    });
    expect(kindCounts(imported.document.entities)).toEqual(golden.modelEntityKinds);
    expect(imported.document.entities.map((entity) => entity.handle)).toEqual(golden.modelHandles);
    expect(imported.document.blocks.map((block) => block.name)).toEqual(golden.blockNames);
    expect(imported.document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle))).toEqual(golden.blockEntityHandles);
    expect(imported.document.layers.map((item) => item.name)).toEqual(golden.layers);
    expect(imported.document.linetypes.map((item) => item.name)).toEqual(golden.linetypes);
    expect(imported.document.textStyles.map((item) => item.name)).toEqual(golden.textStyles);
    expect(imported.document.dimensionStyles.map((item) => item.name)).toEqual(golden.dimensionStyles);
    const polyline = imported.document.entities.find((entity) => entity.handle === "20");
    expect(polyline).toMatchObject({ kind: "polyline" });
    if (!polyline || polyline.kind !== "polyline") throw new Error("F-110 polyline missing.");
    expect(polyline.vertices[0]).toMatchObject({ startWidth: 1, endWidth: 2 });
    expect(polyline.vertices[1]).toMatchObject({ bulge: 0.5 });
    expect(imported.document.entities.find((entity) => entity.handle === "80")).toMatchObject({ kind: "mtext", text: "Rida 1\nRida 2", extensionData: { "kuubik.dxf.mtext.v1": { width: 60, attachment: 5 } } });
    expect(imported.document.entities.find((entity) => entity.handle === "B0")).toMatchObject({ kind: "blockRef", blockId: "dxf-block:SYMBOL", scale: { x: 2, y: 0.5 }, rotationRad: Math.PI / 6 });

    const second = exportDxf(imported.document);
    expect(second.report.skipped).toEqual([]);
    expect(second.bytes).toEqual(first.bytes);
    expect(readDxfSummary(second.text).entityTypes).toEqual({ LINE: 1, LWPOLYLINE: 1, CIRCLE: 1, ARC: 1, ELLIPSE: 1, SPLINE: 1, TEXT: 1, MTEXT: 1, HATCH: 1, DIMENSION: 1, INSERT: 1 });

    const independent = new DxfParser().parseSync(second.text)! as unknown as {
      header?: Record<string, unknown>;
      entities: Array<{ type: string; handle?: string }>;
      blocks?: Record<string, { entities?: Array<{ type: string; handle?: string }> }>;
    };
    expect(independent.header?.$INSUNITS).toBe(4);
    expect(independent.entities.some((entity) => entity.type === "INSERT" && entity.handle === "B0")).toBe(true);
    expect(Object.keys(independent.blocks ?? {})).toContain("SYMBOL");
  });

  it("applies deterministic insertion scaling to geometry, blocks and unit-sensitive resources", () => {
    const source = exportDxf(createF110Document()).bytes;
    const imported = importDxf(source, { documentId: "scaled", targetUnits: "m" });
    expect(imported.report).toMatchObject({ sourceUnits: "mm", targetUnits: "m", insertionScale: 0.001 });
    expect(imported.document.units.linear).toBe("m");
    expect(imported.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", end: { x: 0.1, y: 0.025 } });
    expect(imported.document.entities.find((entity) => entity.handle === "30")).toMatchObject({ kind: "circle", radius: 0.008 });
    expect(imported.document.entities.find((entity) => entity.handle === "80")).toMatchObject({ kind: "mtext", height: 0.0035, extensionData: { "kuubik.dxf.mtext.v1": { width: 0.06 } } });
    expect(imported.document.blocks[0]?.basePoint).toEqual({ x: 0.005, y: 0.005 });
    expect(imported.document.blocks[0]?.entities[0]).toMatchObject({ kind: "line", end: { x: 0.01, y: 0 } });
    expect(imported.document.linetypes[0]?.pattern).toEqual([0.012, -0.006]);
    expect(imported.document.dimensionStyles.find((style) => style.name === "DIM-ISO")).toMatchObject({ textHeight: 0.0025, arrowSize: 0.0025, extensionOffset: 0.000625 });
    expect(() => importDxf(source, { documentId: "ambiguous", targetUnits: "unitless" })).toThrow(/requires an explicit unit interpretation/u);
  });

  it("preserves an unknown record only as an inert proxy and still refuses partial open", () => {
    const source = appendUnsupportedEntity(exportDxf(createF110Document()).text);
    const imported = importDxf(source, { documentId: "proxy", preserveUnsupported: true });
    expect(imported.report.preservedProxyHandles).toEqual(["D0"]);
    expect(imported.report.skipped).toEqual([{ type: "3DSOLID", handle: "D0", reason: "DXF entity type is outside the F-111 audited import subset." }]);
    expect(imported.document.entities.at(-1)).toMatchObject({ kind: "proxy", handle: "D0", originalType: "3DSOLID", raw: { pairs: expect.any(Array) } });
    expect(() => exportDxf(imported.document)).not.toThrow();
    expect(exportDxf(imported.document).report.skipped).toEqual([{ handle: "D0", kind: "proxy", reason: "DXF adapter not implemented for this entity kind." }]);
    expect(() => openDxfDocument(source, { documentId: "refused", fileName: "proxy.dxf", preserveUnsupported: true })).toThrow(/refused a partial import/u);
    expect(() => importDxf(source, { documentId: "scaled-proxy", preserveUnsupported: true, targetUnits: "m" })).toThrow(/proxy D0 cannot be insertion-scaled/u);
  });

  it("keeps source handles stable across repeated imports and refuses malformed block or MTEXT state", () => {
    const source = exportDxf(createF110Document()).text;
    const first = importDxf(source, { documentId: "stable-1" });
    const second = importDxf(source, { documentId: "stable-2" });
    expect(second.report.importedHandles).toEqual(first.report.importedHandles);
    expect(() => importDxf(source.replace("  2\r\nSYMBOL\r\n 10\r\n150", "  2\r\nMISSING\r\n 10\r\n150"), { documentId: "missing-block" })).toThrow(/references missing block MISSING/u);
    expect(() => importDxf(source.replace("  5\r\nC1\r\n", "  5\r\nC0\r\n"), { documentId: "duplicate-block-handle" })).toThrow(/duplicate global handle C0/u);
    expect(() => importDxf(source.replace("  0\r\nMTEXT\r\n", "  0\r\nMTEXT\r\n 11\r\n1\r\n 21\r\n0\r\n"), { documentId: "mtext-direction" })).toThrow(/direction-vector rotation/u);
    expect(() => importDxf(source.replace(" 41\r\n2\r\n 42\r\n0.5", " 41\r\n0\r\n 42\r\n0.5"), { documentId: "zero-insert-scale" })).toThrow(/scale/u);
  });
});
