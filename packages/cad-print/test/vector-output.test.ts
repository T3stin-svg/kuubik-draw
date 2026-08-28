import { describe, expect, it } from "vitest";
import { createEmptyDocument, createPaperLayout } from "../../cad-core/src/index.js";
import { createF104Document, F104_LAYOUT_ID, F104_VIEWPORT_IDS } from "../../../parity/fixtures/f104-document.js";
import { exportLayoutSvg, exportLayoutVectorPdf, exportSvg, exportVectorPdf, readPdfSummary, resolveLayoutPlotPlacement } from "../src/index.js";

const page = { widthMm: 297, heightMm: 210, scaleDenominator: 1, origin: { x: 0, y: 0 } };

describe("vector print output", () => {
  it("emits a deterministic F-104 A3 layout with two independently clipped vector viewports", () => {
    const document = createF104Document();
    const firstSvg = exportLayoutSvg(document, F104_LAYOUT_ID);
    const secondSvg = exportLayoutSvg(structuredClone(document), F104_LAYOUT_ID);
    expect(secondSvg.text).toBe(firstSvg.text);
    expect(firstSvg.skippedHandles).toEqual([]);
    expect(firstSvg.placement).toMatchObject({
      paper: { widthMm: 420, heightMm: 297 },
      source: { x: 0, y: 0, width: 420, height: 297 },
      destination: { x: 0, y: 0, width: 420, height: 297 },
      scaleFactor: 1,
    });
    expect(firstSvg.text).toContain('width="420mm" height="297mm"');
    expect(firstSvg.text).toContain(`<g data-viewport-id="${F104_VIEWPORT_IDS[0]}"`);
    expect(firstSvg.text).toContain(`<g data-viewport-id="${F104_VIEWPORT_IDS[1]}"`);
    expect(firstSvg.text).toContain('<clipPath id="viewport-clip-0"><rect x="16.25" y="25" width="185" height="247"/></clipPath>');
    expect(firstSvg.text).toContain('<clipPath id="viewport-clip-1"><polygon points="218.75,25 403.75,25 382,272 240.5,272"/></clipPath>');
    expect(firstSvg.text).toContain(`<g data-viewport-id="${F104_VIEWPORT_IDS[0]}" clip-path="url(#viewport-clip-0)"><g transform="`);
    expect(firstSvg.text).toContain(`<g data-viewport-id="${F104_VIEWPORT_IDS[1]}" clip-path="url(#viewport-clip-1)"><g transform="`);
    expect(firstSvg.text).not.toMatch(/data-viewport-id="[^"]+"[^>]+clip-path="[^"]+"[^>]+transform=/u);
    expect(firstSvg.text).toContain('scale(0.02) rotate(0) translate(0 0)');
    expect(firstSvg.text).toContain('scale(0.01) rotate(0) translate(-20000 0)');
    expect(firstSvg.text).toContain('data-handle="32"');
    expect(firstSvg.text).toContain('KUUBIK F-104 VECTOR LAYOUT');
    expect(firstSvg.text).toContain('data-opacity="0.6"');

    const firstPdf = exportLayoutVectorPdf(document, F104_LAYOUT_ID);
    const secondPdf = exportLayoutVectorPdf(structuredClone(document), F104_LAYOUT_ID);
    expect(secondPdf.bytes).toEqual(firstPdf.bytes);
    expect(firstPdf.skippedHandles).toEqual([]);
    expect(readPdfSummary(firstPdf.bytes)).toMatchObject({ version: "1.4", pages: 1, hasXref: true, xrefOffsetsValid: true });
    const pdfText = new TextDecoder("latin1").decode(firstPdf.bytes);
    expect(pdfText).toContain("/MediaBox [0 0 1190.551181 841.889764]");
    expect(pdfText).toContain("16.25 25 185 247 re W n 0.02 0 0 0.02 108.75 148.5 cm");
    expect(pdfText).toContain("218.75 25 m 403.75 25 l 382 272 l 240.5 272 l h W n 0.01 0 0 0.01 111.25 148.5 cm");
    expect(pdfText).toContain("(KUUBIK F-104 VECTOR LAYOUT) Tj");
    expect(pdfText).toContain("/GS60 gs");
    expect(pdfText).not.toContain("/Subtype /Image");
  });
  it("uses one F-103 resolver for ByLayer colour, physical lineweight and solid-hatch alpha in SVG and PDF", () => {
    const document = createEmptyDocument({ documentId: "F-103" });
    document.layers[0]!.appearance = { color: "#ff0000", lineweightMm: 0.7 };
    document.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: -1000, y: 0 }, end: { x: 1000, y: 0 } },
      {
        kind: "hatch", handle: "11", layerId: "0", pattern: "SOLID", associative: false,
        appearance: { transparency: 40 },
        loops: [{ isHole: false, vertices: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
      },
      {
        kind: "hatch", handle: "12", layerId: "0", pattern: "ANSI31", associative: false,
        loops: [{ isHole: false, vertices: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 0, y: 100 }] }],
      },
    ];
    const paper = createPaperLayout(document, {
      name: "F103 PLOT",
      pageSetup: {
        mediaName: "ISO_A4", orientation: "landscape", plotArea: { kind: "layout" },
        plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
        plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true },
      },
      viewports: [{
        id: "viewport-f103", center: { x: 148.5, y: 105 }, width: 180, height: 100,
        viewCenter: { x: 0, y: 0 }, viewHeight: 5000, twistAngleRad: 0, locked: true,
      }],
    });
    let source = { ...document, layouts: paper.layouts };
    const colorSvgResult = exportLayoutSvg(source, paper.layoutId);
    const colorSvg = colorSvgResult.text;
    expect(colorSvgResult.skippedHandles).toContain("12");
    expect(colorSvg).not.toContain('data-handle="12"');
    expect(colorSvg).toContain('data-plot-profile="color"');
    expect(colorSvg).toContain('data-plot-lineweights="true"');
    expect(colorSvg).toContain('data-plot-transparency="true"');
    expect(colorSvg).toContain('data-handle="10" data-source-color="#ff0000" data-plot-color="#ff0000" data-lineweight-mm="0.7"');
    expect(colorSvg).toContain('data-handle="11" data-source-color="#ff0000" data-plot-color="#ff0000" data-opacity="0.6"');
    expect(colorSvg).toContain('fill-opacity="0.6" fill-rule="evenodd"');
    const colorPdf = exportLayoutVectorPdf(source, paper.layoutId);
    expect(colorPdf.skippedHandles).toContain("12");
    const colorPdfText = new TextDecoder("latin1").decode(colorPdf.bytes);
    expect(colorPdfText).toContain("1 0 0 RG 1 0 0 rg 35 w /GS100 gs");
    expect(colorPdfText).toContain("1 0 0 RG 1 0 0 rg 35 w /GS60 gs");
    expect(colorPdfText).toContain("f*");
    expect(colorPdfText).toContain("/GS60");
    expect(colorPdfText).toContain("/CA 0.6 /ca 0.6");
    expect(readPdfSummary(colorPdf.bytes).xrefOffsetsValid).toBe(true);

    source = structuredClone(source);
    source.layouts[1]!.pageSetup!.plotStyle = { profile: "monochrome", plotLineweights: false, plotTransparency: false };
    const monoSvg = exportLayoutSvg(source, paper.layoutId).text;
    expect(monoSvg).toContain('data-plot-profile="monochrome"');
    expect(monoSvg).toContain('data-lineweight-mm="0"');
    expect(monoSvg).toContain('stroke-width="0.001"');
    expect(monoSvg).toContain('data-plot-color="#000000"');
    expect(monoSvg).toContain('data-opacity="1"');
    const monoPdfText = new TextDecoder("latin1").decode(exportLayoutVectorPdf(source, paper.layoutId).bytes);
    expect(monoPdfText).toContain("0 0 0 RG 0 0 0 rg 0 w /GS100 gs");

    source.layouts[1]!.pageSetup!.plotStyle = { profile: "grayscale", plotLineweights: true, plotTransparency: true };
    const graySvg = exportLayoutSvg(source, paper.layoutId).text;
    expect(graySvg).toContain('data-plot-profile="grayscale"');
    expect(graySvg).toContain('data-plot-color="#4c4c4c"');
  });

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

  it("keeps fractional transparency exact in PDF and filters paper-space layers", () => {
    const document = createEmptyDocument({ documentId: "paper-layer-alpha" });
    document.layers.push({ id: "no-plot", name: "No plot", visible: true, frozen: false, locked: false, plottable: false });
    const paper = createPaperLayout(document, {
      name: "PAPER FILTER",
      pageSetup: {
        mediaName: "ISO_A4", orientation: "landscape", plotArea: { kind: "layout" },
        plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
        plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true },
      },
      entities: [
        { kind: "line", handle: "20", layerId: "0", start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, appearance: { transparency: 40.4 } },
        { kind: "line", handle: "21", layerId: "no-plot", start: { x: 10, y: 20 }, end: { x: 20, y: 20 } },
      ],
    });
    const source = { ...document, layouts: paper.layouts };
    const svg = exportLayoutSvg(source, paper.layoutId);
    expect(svg.skippedHandles).toEqual(["21"]);
    expect(svg.text).toContain('data-handle="20"');
    expect(svg.text).toContain('data-opacity="0.596"');
    expect(svg.text).not.toContain('data-handle="21"');
    const pdf = exportLayoutVectorPdf(source, paper.layoutId);
    const pdfText = new TextDecoder("latin1").decode(pdf.bytes);
    expect(pdf.skippedHandles).toEqual(["21"]);
    expect(pdfText).toContain("/GS59_6 gs");
    expect(pdfText).toContain("/CA 0.596 /ca 0.596");
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
