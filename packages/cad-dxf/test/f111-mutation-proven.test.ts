import { describe, expect, it } from "vitest";
import { createF109Document } from "../../../parity/fixtures/f109-document.js";
import { MAX_DXF_RECORD_PAIRS, exportDxf, importDxf } from "../src/index.js";

function roundtrip(document = createF109Document()) {
  return importDxf(exportDxf(document).bytes, { documentId: "F-111-mutation" }).document;
}

function semanticProbe(document: ReturnType<typeof roundtrip>): unknown {
  const wall = document.layers.find((layer) => layer.name === "SEINAD");
  const bulged = document.entities.find((entity) => entity.handle === "1100");
  const hatch = document.entities.find((entity) => entity.handle === "1300");
  const dimension = document.entities.find((entity) => entity.handle === "1500");
  return { wall, bulged, hatch, dimension };
}

describe("F-111 mutation-proven roundtrip ratchet", () => {
  it("detects independent layer-style, bulge, HATCH-topology and DIMENSION-point mutants", () => {
    const baseline = semanticProbe(roundtrip());
    const mutations = [
      (document: ReturnType<typeof createF109Document>) => { document.layers.find((layer) => layer.name === "SEINAD")!.appearance!.lineweightMm = 0.7; },
      (document: ReturnType<typeof createF109Document>) => {
        const polyline = document.entities.find((entity) => entity.handle === "1100");
        if (!polyline || polyline.kind !== "polyline") throw new Error("F-111 bulge fixture is missing.");
        polyline.vertices[0]!.bulge = -0.25;
      },
      (document: ReturnType<typeof createF109Document>) => {
        const hatch = document.entities.find((entity) => entity.handle === "1300");
        if (!hatch || hatch.kind !== "hatch") throw new Error("F-111 HATCH fixture is missing.");
        hatch.loops[0]!.vertices[1]!.x += 25;
      },
      (document: ReturnType<typeof createF109Document>) => {
        const dimension = document.entities.find((entity) => entity.handle === "1500");
        if (!dimension || dimension.kind !== "dimension") throw new Error("F-111 DIMENSION fixture is missing.");
        dimension.definitionPoints[2]!.y += 300;
      },
    ];
    for (const mutate of mutations) {
      const document = createF109Document();
      mutate(document);
      expect(semanticProbe(roundtrip(document))).not.toEqual(baseline);
    }
  });

  it("kills the partial-import mutant by requiring a clean report before commit", () => {
    const source = exportDxf(createF109Document()).text;
    const unsupported = source.replace("  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS", "  0\r\n3DSOLID\r\n  5\r\nABC\r\n  8\r\nJOONED\r\n  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nOBJECTS");
    const result = importDxf(unsupported, { documentId: "F-111-partial" });
    expect(result.report.skipped).toHaveLength(1);
    expect(result.report.skipped[0]).toMatchObject({ type: "3DSOLID", handle: "ABC" });
  });

  it("kills fail-open HATCH, global-handle and parser-budget mutants", () => {
    const source = exportDxf(createF109Document()).text;
    expect(() => importDxf(source.replace(" 72\r\n0\r\n", " 72\r\n1\r\n"), { documentId: "F-111-hatch-mutant" })).toThrow(/bulged polyline boundaries/i);
    expect(() => importDxf(source.replace(" 91\r\n1\r\n", "999\r\nlossy\r\n 91\r\n1\r\n"), { documentId: "F-111-hatch-preamble-mutant" })).toThrow(/preamble/i);
    expect(() => importDxf(source.replace("  5\r\n401\r\n", "  5\r\n400\r\n"), { documentId: "F-111-handle-mutant" })).toThrow(/duplicate global handle/i);
    expect(() => importDxf(source.replace("  5\r\nF00\r\n", "  5\r\n1000\r\n"), { documentId: "F-111-object-handle-mutant" })).toThrow(/duplicate global handle/i);
    const oversized = source.replace("100\r\nAcDbLine\r\n", `100\r\nAcDbLine\r\n${"999\r\nx\r\n".repeat(MAX_DXF_RECORD_PAIRS + 1)}`);
    expect(() => importDxf(oversized, { documentId: "F-111-budget-mutant" })).toThrow(/record exceeds/i);
  });
});
