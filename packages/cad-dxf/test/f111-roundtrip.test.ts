import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { createF109Document } from "../../../parity/fixtures/f109-document.js";
import { MAX_DXF_IMPORT_PAIRS, MAX_DXF_RECORD_PAIRS, exportDxf, importDxf, readDxfSummary } from "../src/index.js";

describe("F-111 DXF roundtrip fidelity", () => {
  it("preserves the exact production fixture through an editable document and second-generation DXF", () => {
    const source = exportDxf(createF109Document()).text;
    const imported = importDxf(source, { documentId: "F-111", now: "2026-08-29T08:00:00.000Z" });
    expect(imported.report).toMatchObject({
      acadVersion: "AC1018",
      codePage: "ANSI_1252",
      importedHandles: expect.arrayContaining(["1000", "1100", "1209", "1300", "1400", "1500"]),
      skipped: [],
      warnings: [],
    });
    expect(imported.document).toMatchObject({
      units: { linear: "mm" },
      currentLayerId: imported.document.layers.find((layer) => layer.name === "JOONED")?.id,
    });
    expect(imported.document.entities).toHaveLength(40);
    expect(imported.document.layers.map((layer) => layer.name)).toEqual(["0", "JOONED", "TELJED", "SEINAD", "VIIRUTUS"]);
    expect(imported.document.linetypes.map((item) => item.name)).toEqual(["DASHED", "DASHDOT"]);
    expect(imported.document.textStyles.map((item) => item.name)).toEqual(["NORMAL", "Standard"]);
    expect(imported.document.dimensionStyles.map((item) => item.name)).toEqual(["Standard"]);
    expect(imported.document.entities.filter((entity) => entity.kind === "hatch")).toHaveLength(7);
    expect(imported.document.entities.filter((entity) => entity.kind === "polyline" && entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-12))).toHaveLength(2);
    expect(imported.document.entities.find((entity) => entity.handle === "1000")?.appearance).toMatchObject({
      colorMethod: "aci",
      aciIndex: 30,
      lineweightMm: 0.7,
      transparency: 40,
    });
    expect(imported.document.entities.find((entity) => entity.handle === "1001")?.appearance).toMatchObject({
      color: "#0a64dc",
      colorMethod: "trueColor",
      aciIndex: 152,
      lineweightMm: 0.35,
      transparency: 14.901960784314,
    });
    expect(imported.document.entities.find((entity) => entity.handle === "1209")).toMatchObject({ kind: "text", text: "MÕÕT ŠŽ€ 10" });
    expect(imported.document.entities.find((entity) => entity.handle === "1500")).toMatchObject({
      kind: "dimension",
      dimensionKind: "aligned",
      definitionPoints: [{ x: 0, y: 4000 }, { x: 5000, y: 4000 }, { x: 0, y: 4400 }, { x: 2500, y: 4400 }],
    });

    const second = exportDxf(imported.document);
    expect(second.report.skipped).toEqual([]);
    expect(second.text).toBe(source);
    expect(readDxfSummary(second.text).entityTypes).toEqual({ LINE: 12, LWPOLYLINE: 9, TEXT: 10, HATCH: 7, CIRCLE: 1, DIMENSION: 1 });
    const independent = new DxfParser().parseSync(second.text)!;
    expect(independent.header?.$INSUNITS).toBe(4);
    // dxf-parser 1.1.2 deliberately omits HATCH records; the strict Python/AutoCAD
    // read-backs own the seven HATCH entities in the certification gate.
    expect(independent.entities).toHaveLength(33);
    expect(independent.entities.filter((entity) => entity.type === "LINE")).toHaveLength(12);
  });

  it("reports unsupported entities so callers can refuse partial document mutation", () => {
    const source = exportDxf(createF109Document()).text;
    const unsupported = source.replace("  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS", "  0\r\nSPLINE\r\n  5\r\nABC\r\n  8\r\nJOONED\r\n  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS");
    const result = importDxf(unsupported, { documentId: "unsupported" });
    expect(result.report.skipped).toEqual([{ type: "SPLINE", handle: "ABC", reason: "DXF entity type is outside the F-111 audited import subset." }]);
    expect(result.document.entities).toHaveLength(40);
  });

  it("fails closed for malformed pairs, duplicate handles and unsupported units", () => {
    const source = exportDxf(createF109Document()).text;
    expect(() => importDxf(source.replace("  5\r\n1001\r\n", "  5\r\n1000\r\n"), { documentId: "duplicate" })).toThrow(/duplicate global handle 1000/i);
    expect(() => importDxf(source.replace("  5\r\n401\r\n", "  5\r\n400\r\n"), { documentId: "duplicate-table" })).toThrow(/duplicate global handle 400/i);
    expect(() => importDxf(source.replace("  5\r\nF00\r\n", "  5\r\n1000\r\n"), { documentId: "duplicate-object" })).toThrow(/duplicate global handle 1000/i);
    expect(() => importDxf(source.replace("$INSUNITS\r\n 70\r\n4", "$INSUNITS\r\n 70\r\n99"), { documentId: "units" })).toThrow(/INSUNITS 99 is unsupported/i);
    expect(() => importDxf(`${source}BROKEN`, { documentId: "broken" })).toThrow(/unpaired group-code line/i);
  });

  it("accepts exact closed straight outer/hole loops and rejects every lossy HATCH variant", () => {
    const source = exportDxf(createF109Document()).text;
    const start = source.indexOf("  0\r\nHATCH\r\n");
    const end = source.indexOf("  0\r\nHATCH\r\n", start + 1);
    const prefix = source.slice(0, start);
    const record = source.slice(start, end);
    const suffix = source.slice(end);
    const hole = " 92\r\n2\r\n 72\r\n0\r\n 73\r\n1\r\n 93\r\n4\r\n 10\r\n5240\r\n 20\r\n3040\r\n 10\r\n5340\r\n 20\r\n3040\r\n 10\r\n5340\r\n 20\r\n3200\r\n 10\r\n5240\r\n 20\r\n3200\r\n 97\r\n0\r\n";
    const withHole = `${prefix}${record.replace(" 91\r\n1\r\n", " 91\r\n2\r\n").replace(" 75\r\n1\r\n", `${hole} 75\r\n1\r\n`)}${suffix}`;
    const parsed = importDxf(withHole, { documentId: "hole" });
    expect(parsed.document.entities.find((entity) => entity.handle === "1300")).toMatchObject({
      kind: "hatch",
      loops: [{ isHole: false }, { isHole: true }],
    });
    const mutateFirst = (from: string, to: string): string => `${prefix}${record.replace(from, to)}${suffix}`;
    expect(() => importDxf(mutateFirst(" 72\r\n0\r\n", " 72\r\n1\r\n"), { documentId: "bulge" })).toThrow(/bulged polyline boundaries/i);
    expect(() => importDxf(mutateFirst(" 92\r\n3\r\n", " 92\r\n1\r\n"), { documentId: "edge" })).toThrow(/straight closed polyline subset/i);
    expect(() => importDxf(mutateFirst(" 71\r\n0\r\n", " 71\r\n1\r\n"), { documentId: "associative" })).toThrow(/associative boundary references/i);
    expect(() => importDxf(mutateFirst(" 97\r\n0\r\n", " 97\r\n1\r\n"), { documentId: "boundary-ref" })).toThrow(/associative source handles/i);
    expect(() => importDxf(mutateFirst(" 75\r\n1\r\n", `${hole} 75\r\n1\r\n`), { documentId: "extra-loop" })).toThrow(/pattern definition|unconsumed/i);
    expect(() => importDxf(source.replace(" 46\r\n3.175\r\n", " 46\r\n4\r\n"), { documentId: "custom-pattern" })).toThrow(/pattern definition/i);
    expect(() => importDxf(mutateFirst(" 91\r\n1\r\n", "999\r\nunexpected\r\n 91\r\n1\r\n"), { documentId: "hatch-prefix-extra" })).toThrow(/preamble/i);
    expect(() => importDxf(mutateFirst(" 10\r\n0\r\n 20\r\n0\r\n 30\r\n0\r\n210\r\n0\r\n220\r\n0\r\n230\r\n1\r\n", " 10\r\n1\r\n 20\r\n0\r\n 30\r\n0\r\n210\r\n0\r\n220\r\n0\r\n230\r\n2\r\n"), { documentId: "hatch-origin-extrusion" })).toThrow(/preamble/i);
  });

  it("rejects pair-heavy and oversized-record inputs before unbounded object materialization", () => {
    const started = performance.now();
    expect(() => importDxf(`999\nx\n`.repeat(MAX_DXF_IMPORT_PAIRS + 1), { documentId: "pair-budget" })).toThrow(/group-pair limit/i);
    expect(performance.now() - started).toBeLessThan(2_000);
    const source = exportDxf(createF109Document()).text;
    const oversizedRecord = source.replace("100\r\nAcDbLine\r\n", `100\r\nAcDbLine\r\n${"999\r\nx\r\n".repeat(MAX_DXF_RECORD_PAIRS + 1)}`);
    expect(() => importDxf(oversizedRecord, { documentId: "record-budget" })).toThrow(/record exceeds/i);
  });
});
