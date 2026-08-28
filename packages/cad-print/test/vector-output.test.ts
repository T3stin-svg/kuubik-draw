import { describe, expect, it } from "vitest";
import { createEmptyDocument, createPaperLayout } from "../../cad-core/src/index.js";
import { exportLayoutSvg, exportLayoutVectorPdf, exportSvg, exportVectorPdf, readPdfSummary, resolveLayoutPlotPlacement } from "../src/index.js";

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

  it("places an A4 portrait Window plot at fixed 1:2 scale in physical SVG and PDF coordinates", () => {
    const document = createEmptyDocument({ documentId: "F-102-window" });
    const paper = createPaperLayout(document, {
      name: "F102 WINDOW",
      pageSetup: {
        mediaName: "ISO_A4", orientation: "portrait",
        plotArea: { kind: "window", window: { x: 10, y: 20, width: 180, height: 250 } },
        plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 },
        centerPlot: false, plotOriginMm: { x: 0, y: 0 },
      },
      viewports: [],
      entities: [{ kind: "line", handle: "20", layerId: "0", start: { x: 10, y: 20 }, end: { x: 190, y: 270 } }],
    });
    const source = { ...document, layouts: paper.layouts };
    const placement = resolveLayoutPlotPlacement(source.layouts[1]!);
    expect(placement).toMatchObject({
      paper: { widthMm: 210, heightMm: 297 },
      source: { x: 10, y: 20, width: 180, height: 250 },
      destination: { x: 10, y: 10, width: 90, height: 125 },
      scaleFactor: 0.5,
    });
    const svg = exportLayoutSvg(source, paper.layoutId);
    expect(svg.skippedHandles).toEqual([]);
    expect(svg.text).toContain('width="210mm" height="297mm"');
    expect(svg.text).toContain('data-source="10,20,180,250"');
    expect(svg.text).toContain('data-destination="10,10,90,125"');
    expect(svg.text).toContain('transform="translate(10 287) scale(0.5 -0.5) translate(-10 -20)"');
    const pdf = exportLayoutVectorPdf(source, paper.layoutId);
    expect(pdf.skippedHandles).toEqual([]);
    expect(pdf.placement.destination).toEqual({ x: 10, y: 10, width: 90, height: 125 });
    expect(readPdfSummary(pdf.bytes)).toEqual({
      version: "1.4", pages: 1, vectorStrokeCommands: 1, hasXref: true, xrefOffsetsValid: true,
    });
    expect(new TextDecoder("latin1").decode(pdf.bytes)).toContain("/MediaBox [0 0 595.275591 841.889764]");
  });

  it("fits and centers paper-space extents and emits clipped viewport model vectors", () => {
    const document = createEmptyDocument({ documentId: "F-102-fit" });
    document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: 100, y: 0 } }];
    const paper = createPaperLayout(document, {
      name: "F102 EXTENTS",
      pageSetup: {
        mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "extents" },
        plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
      },
      viewports: [{
        id: "viewport-f102", center: { x: 105, y: 148.5 }, width: 180, height: 250,
        viewCenter: { x: 0, y: 0 }, viewHeight: 250, twistAngleRad: 0, locked: true,
      }],
    });
    const source = { ...document, layouts: paper.layouts };
    const placement = resolveLayoutPlotPlacement(source.layouts[1]!);
    expect(placement.source).toEqual({ x: 15, y: 23.5, width: 180, height: 250 });
    expect(placement.scaleFactor).toBeCloseTo(190 / 180, 12);
    expect(placement.destination.x).toBeCloseTo(10, 12);
    expect(placement.destination.y).toBeCloseTo((297 - (250 * 190 / 180)) / 2, 12);
    const svg = exportLayoutSvg(source, paper.layoutId);
    expect(svg.text).toContain('data-viewport-id="viewport-f102"');
    expect(svg.text).toContain('clip-path="url(#viewport-clip-0)"');
    expect(svg.text).toContain('data-handle="10"');
    const pdf = exportLayoutVectorPdf(source, paper.layoutId);
    expect(readPdfSummary(pdf.bytes).vectorStrokeCommands).toBe(1);
  });

  it("requires and plots the current paper-space view for Display instead of silently using the full sheet", () => {
    const document = createEmptyDocument({ documentId: "F-102-display" });
    const paper = createPaperLayout(document, {
      name: "F102 DISPLAY",
      pageSetup: {
        mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "display" },
        plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
      },
      viewports: [],
      entities: [{ kind: "line", handle: "20", layerId: "0", start: { x: -25, y: -40 }, end: { x: 275, y: 360 } }],
    });
    const source = { ...document, layouts: paper.layouts };
    expect(() => resolveLayoutPlotPlacement(source.layouts[1]!)).toThrow(/current paper-space display window/i);
    const displayWindow = { x: -25, y: -40, width: 300, height: 400 };
    const placement = resolveLayoutPlotPlacement(source.layouts[1]!, { displayWindow });
    expect(placement.source).toEqual(displayWindow);
    expect(placement.scaleFactor).toBeCloseTo(190 / 300, 12);
    expect(placement.destination.x).toBe(10);
    expect(placement.destination.width).toBe(190);
    expect(placement.destination.height).toBeCloseTo(400 * 190 / 300, 12);
    const svg = exportLayoutSvg(source, paper.layoutId, { displayWindow });
    expect(svg.text).toContain('data-plot-area="display"');
    expect(svg.text).toContain('data-source="-25,-40,300,400"');
    const pdf = exportLayoutVectorPdf(source, paper.layoutId, { displayWindow });
    expect(pdf.placement.source).toEqual(displayWindow);
    expect(readPdfSummary(pdf.bytes).vectorStrokeCommands).toBe(1);
  });
});
