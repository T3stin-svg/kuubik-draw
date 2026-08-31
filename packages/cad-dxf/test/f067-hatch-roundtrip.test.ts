import { createEmptyDocument, createHatch, evaluateAnnotationBlockDxfCapabilities, hatchBoundaryPolyline, readHatchAssociation } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { exportDxf, importDxf } from "../src/index.js";

function fixture(pattern: "SOLID" | "ANSI31") {
  const document = createEmptyDocument({ documentId: `f067-${pattern.toLowerCase()}`, now: "2026-09-01T00:10:00.000Z" });
  document.entities.push(
    hatchBoundaryPolyline("10", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
    hatchBoundaryPolyline("11", "0", [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }]),
  );
  document.entities.push(createHatch(document, {
    handle: "20", layerId: "0", boundaryHandles: ["10", "11"], pattern,
    angleRad: pattern === "SOLID" ? 0 : 0.75, scale: pattern === "SOLID" ? 1 : 2.5,
    origin: { x: 3, y: 4 }, associative: false, islandDetection: "outer",
  }));
  return document;
}

describe("F-067 DXF HATCH read-back boundary", () => {
  it("round-trips the existing exact non-associative SOLID outer/hole subset with stable handles", () => {
    const source = exportDxf(fixture("SOLID"));
    expect(source.report.skipped).toEqual([]);
    const imported = importDxf(source.text, { documentId: "f067-solid-readback", now: "2026-09-01T00:11:00.000Z" });
    const hatch = imported.document.entities.find((entity) => entity.handle === "20");
    expect(hatch).toMatchObject({ kind: "hatch", handle: "20", pattern: "SOLID", associative: false, loops: [{ isHole: false }, { isHole: true }] });
    expect(imported.report).toMatchObject({ acadVersion: "AC1018", importedHandles: expect.arrayContaining(["10", "11", "20"]), skipped: [], warnings: [] });
    expect(exportDxf(imported.document).text).toBe(source.text);
  });

  it("reads back the adapter's fixed line-pattern subset and exposes lost core semantics instead of claiming parity", () => {
    const document = fixture("ANSI31");
    const output = exportDxf(document);
    expect(output.text).toContain(" 71\r\n0\r\n");
    expect(output.text).toContain(" 75\r\n1\r\n 76\r\n0\r\n 52\r\n0\r\n 41\r\n1\r\n");
    const imported = importDxf(output.text, { documentId: "f067-line-readback" });
    const hatch = imported.document.entities.find((entity) => entity.handle === "20")!;
    expect(hatch).toMatchObject({ kind: "hatch", handle: "20", pattern: "ANSI31", associative: false });
    expect(readHatchAssociation(hatch)).toBeNull();
    expect(readHatchAssociation(document.entities.find((entity) => entity.handle === "20")!)).toMatchObject({ islandDetection: "outer", pattern: { angleRad: 0.75, scale: 2.5, origin: { x: 3, y: 4 } } });
    const evaluation = evaluateAnnotationBlockDxfCapabilities(document, { adapterId: "current-cad-dxf", dxfVersion: "AC1018", capabilities: { "hatch-line-pattern": "lossy", "hatch-islands": "exact" } });
    expect(evaluation.rejected).toContainEqual(expect.objectContaining({ capability: "hatch-line-pattern", declared: "lossy", reason: "capability", handles: ["20"] }));
  });
});
