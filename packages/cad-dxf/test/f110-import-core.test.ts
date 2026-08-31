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
    const directionVector = source.replace(
      " 50\r\n11.4591559026165\r\n",
      " 11\r\n0.980066577841242\r\n 21\r\n0.198669330795061\r\n 31\r\n0\r\n",
    );
    const directionMtext = importDxf(directionVector, { documentId: "mtext-direction" }).document.entities.find((entity) => entity.handle === "80");
    expect(directionMtext).toMatchObject({ kind: "mtext" });
    expect(directionMtext?.rotationRad).toBeCloseTo(0.2, 12);
    expect(() => importDxf(source.replace("  0\r\nMTEXT\r\n", "  0\r\nMTEXT\r\n 11\r\n1\r\n 21\r\n0\r\n"), { documentId: "mtext-ambiguous-direction" })).toThrow(/cannot combine group-50 and direction-vector/u);
    expect(() => importDxf(directionVector.replace(" 21\r\n0.198669330795061\r\n", ""), { documentId: "mtext-missing-direction-y" })).toThrow(/requires both group 11 and group 21/u);
    expect(() => importDxf(directionVector.replace(" 11\r\n0.980066577841242\r\n 21\r\n0.198669330795061", " 11\r\n0\r\n 21\r\n0"), { documentId: "mtext-zero-direction" })).toThrow(/must be non-zero/u);
    expect(() => importDxf(directionVector.replace(" 21\r\n0.198669330795061\r\n 31\r\n0\r\n", " 21\r\n0.198669330795061\r\n 31\r\n1\r\n"), { documentId: "mtext-nonplanar-direction" })).toThrow(/audited planar subset/u);
    const autoCadNoGradientHatch = source.replace(
      " 98\r\n0\r\n  0\r\nDIMENSION",
      " 98\r\n0\r\n450\r\n0\r\n451\r\n0\r\n460\r\n0\r\n461\r\n0\r\n452\r\n0\r\n462\r\n0\r\n453\r\n0\r\n470\r\n\r\n  0\r\nDIMENSION",
    );
    expect(importDxf(autoCadNoGradientHatch, { documentId: "autocad-no-gradient" }).document.entities.find((entity) => entity.handle === "90"))
      .toMatchObject({ kind: "hatch", pattern: "SOLID" });
    expect(() => importDxf(autoCadNoGradientHatch.replace("450\r\n0\r\n451", "450\r\n1\r\n451"), { documentId: "autocad-gradient-enabled" })).toThrow(/disabled-gradient subset/u);
    expect(() => importDxf(autoCadNoGradientHatch.replace("470\r\n\r\n", "470\r\nLINEAR\r\n"), { documentId: "autocad-gradient-name" })).toThrow(/disabled-gradient subset/u);
    expect(() => importDxf(source.replace(" 41\r\n2\r\n 42\r\n0.5", " 41\r\n0\r\n 42\r\n0.5"), { documentId: "zero-insert-scale" })).toThrow(/scale/u);
  });

  it("decodes AutoCAD R2007+ byte streams as UTF-8 while retaining the legacy ANSI path", () => {
    const source = exportDxf(createF110Document()).text;
    const utf8Source = source
      .replace("AC1018", "AC1032")
      .replace("T\\U+00D5END \\U+0160\\U+017D\\U+20AC", "TÕEND ŠŽ€");
    const imported = importDxf(new TextEncoder().encode(utf8Source), { documentId: "autocad-utf8" });
    expect(imported.document.entities.find((entity) => entity.handle === "70")).toMatchObject({ kind: "text", text: "TÕEND ŠŽ€" });
    const invalid = new TextEncoder().encode(utf8Source);
    const textOffset = utf8Source.indexOf("TÕEND");
    invalid[textOffset + 1] = 0xff;
    expect(() => importDxf(invalid, { documentId: "autocad-invalid-utf8" })).toThrow(/not valid UTF-8/u);
  });
});
