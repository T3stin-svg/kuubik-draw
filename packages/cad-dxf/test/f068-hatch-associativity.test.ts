import { createEmptyDocument, createHatch, hatchBoundaryPolyline } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { exportDxf, importDxf } from "../src/index.js";

function bulgedFixture(associative = false) {
  const document = createEmptyDocument({ documentId: "f068-dxf-bulge", now: "2026-09-01T00:00:00.000Z" });
  document.entities.push(
    hatchBoundaryPolyline("10", "0", [
      { x: 0, y: 0, bulge: 0.41421356237309503 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100, bulge: -0.25 },
    ]),
    hatchBoundaryPolyline("11", "0", [
      { x: 25, y: 25 }, { x: 75, y: 25, bulge: 0.125 }, { x: 75, y: 75 }, { x: 25, y: 75 },
    ]),
  );
  document.entities.push(createHatch(document, { handle: "20", layerId: "0", boundaryHandles: ["10", "11"], pattern: "SOLID", associative, islandDetection: "normal" }));
  return document;
}

describe("F-068 native DXF HATCH boundary contract", () => {
  it("round-trips straight and signed-bulge outer/hole polyline loops exactly", () => {
    const first = exportDxf(bulgedFixture());
    expect(first.report.skipped).toEqual([]);
    expect(first.text).toContain(" 72\r\n1\r\n");
    expect(first.text).toContain(" 42\r\n0.414213562373095\r\n");
    expect(first.text).toContain(" 42\r\n-0.25\r\n");
    const imported = importDxf(first.text, { documentId: "f068-readback" });
    const hatch = imported.document.entities.find((entity) => entity.handle === "20");
    expect(hatch).toMatchObject({ kind: "hatch", associative: false, loops: [{ isHole: false }, { isHole: true }] });
    if (!hatch || hatch.kind !== "hatch") throw new Error("Expected HATCH read-back.");
    const loops = hatch.loops as Array<{ vertices: Array<{ bulge?: number }> }>;
    expect(loops[0]!.vertices.map((vertex) => vertex.bulge ?? 0)).toEqual([0.414213562373095, 0, 0, -0.25]);
    expect(loops[1]!.vertices.map((vertex) => vertex.bulge ?? 0)).toEqual([0, 0.125, 0, 0]);
    expect(exportDxf(imported.document).text).toBe(first.text);
  });

  it("rejects unsupported native association semantics instead of silently degrading them", () => {
    expect(() => exportDxf(bulgedFixture(true))).toThrow(/associative source references are outside the audited roundtrip subset/u);
    const output = exportDxf(bulgedFixture()).text;
    const start = output.indexOf("  0\r\nHATCH\r\n");
    const end = output.indexOf("  0\r\n", start + 5);
    const source = `${output.slice(0, start)}${output.slice(start, end).replace(" 71\r\n0\r\n", " 71\r\n1\r\n")}${output.slice(end)}`;
    expect(() => importDxf(source, { documentId: "f068-native-association" })).toThrow(/associative boundary references/u);
  });

  it("rejects edge/spline loops and malformed bulge data fail-closed", () => {
    const source = exportDxf(bulgedFixture()).text;
    expect(() => importDxf(source.replace(" 92\r\n3\r\n", " 92\r\n1\r\n"), { documentId: "f068-edge-loop" })).toThrow(/closed polyline subset/u);
    const start = source.indexOf("  0\r\nHATCH\r\n");
    const end = source.indexOf("  0\r\n", start + 5);
    const malformed = `${source.slice(0, start)}${source.slice(start, end).replace(" 42\r\n0.414213562373095\r\n", " 42\r\nNaN\r\n")}${source.slice(end)}`;
    expect(() => importDxf(malformed, { documentId: "f068-nan-bulge" })).toThrow(/non-finite bulge/u);
  });
});
