import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/index.js";
import { exportSvg, exportVectorPdf, readPdfSummary } from "../src/index.js";

const page = { widthMm: 297, heightMm: 210, scaleDenominator: 1, origin: { x: 0, y: 0 } };

describe("vector print output", () => {
  it("emits deterministic SVG with stable handles", () => {
    const document = createEmptyDocument({ documentId: "svg" });
    document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0.25, y: 1.5 }, end: { x: 100.75, y: 1.5 } }];
    const result = exportSvg(document, page);
    expect(result.skippedHandles).toEqual([]);
    expect(result.text).toContain('data-handle="10"');
    expect(result.text).toContain('x1="0.25"');
  });

  it("writes a one-page vector PDF with a valid cross-reference section", () => {
    const document = createEmptyDocument({ documentId: "pdf" });
    document.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 100 } },
      { kind: "circle", handle: "11", layerId: "0", center: { x: 20, y: 20 }, radius: 10 },
    ];
    const result = exportVectorPdf(document, page);
    expect(result.skippedHandles).toEqual([]);
    expect(readPdfSummary(result.bytes)).toEqual({
      version: "1.4",
      pages: 1,
      vectorStrokeCommands: 2,
      hasXref: true,
      xrefOffsetsValid: true,
    });
  });

  it("omits non-plottable layers and keeps SVG text upright", () => {
    const document = createEmptyDocument({ documentId: "layers" });
    document.layers.push({ id: "construction", name: "Construction", visible: true, frozen: false, locked: false, plottable: false });
    document.entities = [
      { kind: "line", handle: "10", layerId: "construction", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
      { kind: "text", handle: "11", layerId: "0", position: { x: 10, y: 20 }, text: "A", height: 2.5, rotationRad: 0 },
    ];
    const svg = exportSvg(document, page);
    expect(svg.skippedHandles).toEqual(["10"]);
    expect(svg.text).not.toContain('data-handle="10"');
    expect(svg.text).toContain('transform="translate(10 20) scale(1 -1)"');
  });

  it("rejects non-ASCII PDF text until a Unicode font is embedded", () => {
    const document = createEmptyDocument({ documentId: "unicode" });
    document.entities = [{ kind: "text", handle: "10", layerId: "0", position: { x: 0, y: 0 }, text: "Mõõt", height: 2.5, rotationRad: 0 }];
    expect(() => exportVectorPdf(document, page)).toThrow(/embedded font/);
  });

  it("reports bulged polylines and rotated text as skipped instead of printing false geometry", () => {
    const document = createEmptyDocument({ documentId: "unsupported-variants" });
    document.entities = [
      {
        kind: "polyline",
        handle: "10",
        layerId: "0",
        closed: false,
        vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0 }],
      },
      {
        kind: "text",
        handle: "11",
        layerId: "0",
        position: { x: 2, y: 3 },
        text: "ROTATED",
        height: 2.5,
        rotationRad: Math.PI / 4,
      },
    ];

    const svg = exportSvg(document, page);
    const pdf = exportVectorPdf(document, page);
    expect(svg.skippedHandles).toEqual(["10", "11"]);
    expect(svg.text).not.toContain('data-handle="10"');
    expect(svg.text).not.toContain('data-handle="11"');
    expect(pdf.skippedHandles).toEqual(["10", "11"]);
    expect(readPdfSummary(pdf.bytes).vectorStrokeCommands).toBe(0);
  });
});
