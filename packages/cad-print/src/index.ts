import type { CadEntity, CadLayout, CadPageSetup, CadPaperRect, CadPlotStyle, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { resolveEntityPlotAppearance, resolvePlotStyle } from "@kuubik/cad-core";

export interface PrintPage {
  widthMm: number;
  heightMm: number;
  scaleDenominator: number;
  origin: { x: number; y: number };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function svgHatchPath(entity: Extract<CadEntity, { kind: "hatch" }>): string | null {
  if (entity.loops.some((loop) => loop.vertices.length < 3)) return null;
  return entity.loops.map((loop) => {
    const first = loop.vertices[0]!;
    return `M ${first.x} ${first.y} ${loop.vertices.slice(1).map((point) => `L ${point.x} ${point.y}`).join(" ")} Z`;
  }).join(" ");
}

function svgEntity(entity: CadEntity, document: KDrawDocumentV1, plotStyle?: CadPlotStyle): string | null {
  const style = resolveEntityPlotAppearance(entity, document.layers, plotStyle);
  const svgStrokeWidth = style.lineweightMm === 0 ? 0.001 : style.lineweightMm;
  const ink = `data-handle="${xml(entity.handle)}" data-source-color="${style.sourceColor}" data-plot-color="${style.color}" data-lineweight-mm="${style.lineweightMm}" data-opacity="${style.opacity}" vector-effect="non-scaling-stroke" stroke="${style.color}" stroke-width="${svgStrokeWidth}" stroke-opacity="${style.opacity}"`;
  const common = `${ink} fill="none"`;
  switch (entity.kind) {
    case "line": return `<line ${common} x1="${entity.start.x}" y1="${entity.start.y}" x2="${entity.end.x}" y2="${entity.end.y}"/>`;
    case "circle": return `<circle ${common} cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}"/>`;
    case "polyline":
      if (entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-12)) return null;
      return `<${entity.closed ? "polygon" : "polyline"} ${common} points="${entity.vertices.map((point) => `${point.x},${point.y}`).join(" ")}"/>`;
    case "text":
    case "mtext":
      if (Math.abs(entity.rotationRad) > 1e-12) return null;
      return `<text data-handle="${xml(entity.handle)}" data-source-color="${style.sourceColor}" data-plot-color="${style.color}" data-opacity="${style.opacity}" transform="translate(${entity.position.x} ${entity.position.y}) scale(1 -1)" x="0" y="0" font-size="${entity.height}" fill="${style.color}" fill-opacity="${style.opacity}">${xml(entity.text)}</text>`;
    case "hatch": {
      if (entity.pattern.trim().toUpperCase() !== "SOLID") return null;
      const path = svgHatchPath(entity);
      return path ? `<path data-handle="${xml(entity.handle)}" data-source-color="${style.sourceColor}" data-plot-color="${style.color}" data-opacity="${style.opacity}" d="${path}" fill="${style.color}" fill-opacity="${style.opacity}" fill-rule="evenodd" stroke="none"/>` : null;
    }
    default: return null;
  }
}

const UNIT_TO_MM: Record<KDrawDocumentV1["units"]["linear"], number> = {
  unitless: 1,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

function printableEntities(document: KDrawDocumentV1, entities: readonly CadEntity[] = document.entities): { entities: CadEntity[]; omitted: string[] } {
  const printableLayers = new Set(
    document.layers
      .filter((layer) => layer.visible && !layer.frozen && layer.plottable)
      .map((layer) => layer.id),
  );
  return {
    entities: entities.filter((entity) => printableLayers.has(entity.layerId)),
    omitted: entities.filter((entity) => !printableLayers.has(entity.layerId)).map((entity) => entity.handle),
  };
}

export function exportSvg(document: KDrawDocumentV1, page: PrintPage): { text: string; skippedHandles: string[] } {
  const printable = printableEntities(document);
  const skippedHandles: string[] = [...printable.omitted];
  const body = printable.entities
    .map((entity) => {
      const result = svgEntity(entity, document);
      if (!result) skippedHandles.push(entity.handle);
      return result ?? "";
    })
    .join("");
  const unitToMm = UNIT_TO_MM[document.units.linear];
  const viewWidth = (page.widthMm * page.scaleDenominator) / unitToMm;
  const viewHeight = (page.heightMm * page.scaleDenominator) / unitToMm;
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="${page.widthMm}mm" height="${page.heightMm}mm" viewBox="${page.origin.x} ${page.origin.y} ${viewWidth} ${viewHeight}"><g transform="translate(0 ${page.origin.y * 2 + viewHeight}) scale(1 -1)">${body}</g></svg>`,
    skippedHandles,
  };
}

const MM_TO_PT = 72 / 25.4;

function pdfNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function pdfText(value: string): string {
  if (/[^\x20-\x7e]/.test(value)) {
    throw new TypeError("Vector PDF core-font path cannot encode Unicode; an embedded font is required.");
  }
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfColor(color: string): string {
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)]
    .map((channel) => pdfNumber(Number.parseInt(channel, 16) / 255));
  return `${channels.join(" ")} RG ${channels.join(" ")} rg`;
}

function pdfAlphaName(opacity: number): string {
  return `GS${pdfNumber(opacity * 100).replace(".", "_")}`;
}

function pdfEntity(entity: CadEntity, document: KDrawDocumentV1, plotStyle: CadPlotStyle | undefined, lineweightUnits: number): string | null {
  const style = resolveEntityPlotAppearance(entity, document.layers, plotStyle);
  const prefix = `q ${pdfColor(style.color)} ${pdfNumber(lineweightUnits)} w /${pdfAlphaName(style.opacity)} gs`;
  const suffix = "Q";
  switch (entity.kind) {
    case "line": return `${prefix} ${pdfNumber(entity.start.x)} ${pdfNumber(entity.start.y)} m ${pdfNumber(entity.end.x)} ${pdfNumber(entity.end.y)} l S ${suffix}`;
    case "polyline": {
      if (entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-12)) return null;
      const first = entity.vertices[0];
      if (!first) return null;
      const segments = entity.vertices.slice(1).map((point) => `${pdfNumber(point.x)} ${pdfNumber(point.y)} l`).join(" ");
      return `${prefix} ${pdfNumber(first.x)} ${pdfNumber(first.y)} m ${segments}${entity.closed ? " h" : ""} S ${suffix}`;
    }
    case "circle": {
      const c = entity.center;
      const r = entity.radius;
      const k = r * 0.5522847498307936;
      return `${prefix} ${[
        `${pdfNumber(c.x + r)} ${pdfNumber(c.y)} m`,
        `${pdfNumber(c.x + r)} ${pdfNumber(c.y + k)} ${pdfNumber(c.x + k)} ${pdfNumber(c.y + r)} ${pdfNumber(c.x)} ${pdfNumber(c.y + r)} c`,
        `${pdfNumber(c.x - k)} ${pdfNumber(c.y + r)} ${pdfNumber(c.x - r)} ${pdfNumber(c.y + k)} ${pdfNumber(c.x - r)} ${pdfNumber(c.y)} c`,
        `${pdfNumber(c.x - r)} ${pdfNumber(c.y - k)} ${pdfNumber(c.x - k)} ${pdfNumber(c.y - r)} ${pdfNumber(c.x)} ${pdfNumber(c.y - r)} c`,
        `${pdfNumber(c.x + k)} ${pdfNumber(c.y - r)} ${pdfNumber(c.x + r)} ${pdfNumber(c.y - k)} ${pdfNumber(c.x + r)} ${pdfNumber(c.y)} c S`,
      ].join(" ")} ${suffix}`;
    }
    case "text":
    case "mtext":
      if (Math.abs(entity.rotationRad) > 1e-12) return null;
      return `${prefix} BT /F1 ${pdfNumber(entity.height)} Tf ${pdfNumber(entity.position.x)} ${pdfNumber(entity.position.y)} Td (${pdfText(entity.text)}) Tj ET ${suffix}`;
    case "hatch": {
      if (entity.pattern.trim().toUpperCase() !== "SOLID") return null;
      if (entity.loops.some((loop) => loop.vertices.length < 3)) return null;
      const paths = entity.loops.map((loop) => {
        const first = loop.vertices[0]!;
        return `${pdfNumber(first.x)} ${pdfNumber(first.y)} m ${loop.vertices.slice(1).map((point) => `${pdfNumber(point.x)} ${pdfNumber(point.y)} l`).join(" ")} h`;
      }).join(" ");
      return `${prefix} ${paths} f* ${suffix}`;
    }
    default: return null;
  }
}

export function exportVectorPdf(document: KDrawDocumentV1, page: PrintPage): { bytes: Uint8Array; skippedHandles: string[] } {
  const printable = printableEntities(document);
  const skippedHandles: string[] = [...printable.omitted];
  const commands = printable.entities.flatMap((entity) => {
    const style = resolveEntityPlotAppearance(entity, document.layers);
    const output = pdfEntity(entity, document, undefined, (style.lineweightMm * page.scaleDenominator) / UNIT_TO_MM[document.units.linear]);
    if (!output) {
      skippedHandles.push(entity.handle);
      return [];
    }
    return [output];
  });
  const scale = (MM_TO_PT * UNIT_TO_MM[document.units.linear]) / page.scaleDenominator;
  const content = `q ${pdfNumber(scale)} 0 0 ${pdfNumber(scale)} ${pdfNumber(-page.origin.x * scale)} ${pdfNumber(-page.origin.y * scale)} cm\n${commands.join("\n")}\nQ`;
  return { bytes: buildPdfBytes([{ widthMm: page.widthMm, heightMm: page.heightMm, content }]), skippedHandles };
}

export interface LayoutPlotPlacement {
  paper: NonNullable<CadLayout["paper"]>;
  setup: CadPageSetup;
  source: CadPaperRect;
  destination: CadPaperRect;
  scaleFactor: number;
}

export interface LayoutPlotOptions {
  /** Current paper-space display in layout coordinates. Required for Display plots. */
  displayWindow?: CadPaperRect;
}

export interface PublishedLayoutPage {
  layoutId: string;
  placement: LayoutPlotPlacement;
  skippedHandles: string[];
}

export interface LayoutBatchPdfResult {
  bytes: Uint8Array;
  pages: PublishedLayoutPage[];
  skippedHandles: string[];
}

function layoutPaper(layout: CadLayout): NonNullable<CadLayout["paper"]> | null {
  if (layout.kind !== "paper" || !layout.paper) return null;
  const { widthMm, heightMm, marginsMm } = layout.paper;
  if ([widthMm, heightMm, marginsMm.top, marginsMm.right, marginsMm.bottom, marginsMm.left].some((value) => !Number.isFinite(value)) ||
    widthMm <= 0 || heightMm <= 0 || marginsMm.left + marginsMm.right >= widthMm || marginsMm.top + marginsMm.bottom >= heightMm) {
    throw new TypeError("A finite paper with a positive printable area is required.");
  }
  return structuredClone(layout.paper);
}

function layoutPageSetup(layout: CadLayout): CadPageSetup | null {
  if (layout.kind !== "paper" || !layout.pageSetup) return null;
  return structuredClone(layout.pageSetup);
}

function pageScaleDenominator(setup: CadPageSetup): number | null {
  if (setup.plotScale.mode === "fit") return null;
  const value = setup.plotScale.drawingUnits / setup.plotScale.paperUnits;
  if (!Number.isFinite(value) || value <= 0) throw new TypeError("Plot scale denominator must be finite and positive.");
  return value;
}

function entityBounds(entity: CadEntity): CadPaperRect | null {
  switch (entity.kind) {
    case "line": {
      const x = Math.min(entity.start.x, entity.end.x); const y = Math.min(entity.start.y, entity.end.y);
      return { x, y, width: Math.max(Math.abs(entity.end.x - entity.start.x), 1e-9), height: Math.max(Math.abs(entity.end.y - entity.start.y), 1e-9) };
    }
    case "circle": return { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius, width: entity.radius * 2, height: entity.radius * 2 };
    case "polyline": {
      if (entity.vertices.length === 0) return null;
      const xs = entity.vertices.map((point) => point.x); const ys = entity.vertices.map((point) => point.y);
      const x = Math.min(...xs); const y = Math.min(...ys);
      return { x, y, width: Math.max(Math.max(...xs) - x, 1e-9), height: Math.max(Math.max(...ys) - y, 1e-9) };
    }
    case "text":
    case "mtext":
      return { x: entity.position.x, y: entity.position.y, width: Math.max(entity.height * entity.text.length * 0.6, 1e-9), height: entity.height };
    default: return null;
  }
}

function unionBounds(bounds: readonly CadPaperRect[]): CadPaperRect | null {
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((bound) => bound.x)); const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width)); const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1e-9), height: Math.max(maxY - minY, 1e-9) };
}

function layoutExtents(layout: CadLayout): CadPaperRect | null {
  const viewportBounds = layout.viewports.map((viewport) => ({
    x: viewport.center.x - viewport.width / 2,
    y: viewport.center.y - viewport.height / 2,
    width: viewport.width,
    height: viewport.height,
  }));
  return unionBounds([...viewportBounds, ...(layout.entities ?? []).flatMap((entity) => {
    const bounds = entityBounds(entity); return bounds ? [bounds] : [];
  })]);
}

export function resolveLayoutPlotPlacement(layout: CadLayout, options: LayoutPlotOptions = {}): LayoutPlotPlacement {
  const paper = layoutPaper(layout);
  const setup = layoutPageSetup(layout);
  if (!paper || !setup) throw new TypeError("A paper layout with a valid page setup is required.");
  if (setup.plotArea.kind === "layout") {
    const fullPaper = { x: 0, y: 0, width: paper.widthMm, height: paper.heightMm };
    return { paper, setup, source: fullPaper, destination: fullPaper, scaleFactor: 1 };
  }
  const source = setup.plotArea.kind === "window"
    ? structuredClone(setup.plotArea.window)
    : setup.plotArea.kind === "extents"
      ? layoutExtents(layout)
      : options.displayWindow ? structuredClone(options.displayWindow) : null;
  if (!source) throw new TypeError(setup.plotArea.kind === "display"
    ? "Display plot area requires the current paper-space display window."
    : "Extents plot area has no paper-space geometry or viewport frame.");
  if ([source.x, source.y, source.width, source.height].some((value) => !Number.isFinite(value)) || source.width <= 0 || source.height <= 0) {
    throw new TypeError("Plot source must be a finite rectangle with positive dimensions.");
  }
  const printable = {
    x: paper.marginsMm.left,
    y: paper.marginsMm.bottom,
    width: paper.widthMm - paper.marginsMm.left - paper.marginsMm.right,
    height: paper.heightMm - paper.marginsMm.top - paper.marginsMm.bottom,
  };
  const scaleFactor = setup.plotScale.mode === "fit"
    ? Math.min(printable.width / source.width, printable.height / source.height)
    : 1 / pageScaleDenominator(setup)!;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) throw new TypeError("Plot placement scale must be finite and positive.");
  const width = source.width * scaleFactor; const height = source.height * scaleFactor;
  const destination = setup.centerPlot
    ? { x: printable.x + (printable.width - width) / 2, y: printable.y + (printable.height - height) / 2, width, height }
    : { x: printable.x + setup.plotOriginMm.x, y: printable.y + setup.plotOriginMm.y, width, height };
  return { paper, setup, source, destination, scaleFactor };
}

function viewportClip(viewport: CadViewport, id: string): { definition: string; reference: string } {
  if (viewport.clipBoundary) {
    return {
      definition: `<clipPath id="${id}"><polygon points="${viewport.clipBoundary.map((point) => `${point.x},${point.y}`).join(" ")}"/></clipPath>`,
      reference: `url(#${id})`,
    };
  }
  const x = viewport.center.x - viewport.width / 2; const y = viewport.center.y - viewport.height / 2;
  return { definition: `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${viewport.width}" height="${viewport.height}"/></clipPath>`, reference: `url(#${id})` };
}

function svgViewport(document: KDrawDocumentV1, viewport: CadViewport, index: number, skippedHandles: string[], plotStyle?: CadPlotStyle): { definition: string; body: string } {
  const id = `viewport-clip-${index}`;
  const clip = viewportClip(viewport, id);
  const frozen = new Set(Object.entries(viewport.layerOverrides ?? {}).filter(([, value]) => value.frozen).map(([layerId]) => layerId));
  const printable = printableEntities(document).entities.filter((entity) => !frozen.has(entity.layerId));
  const body = printable.map((entity) => {
    const output = svgEntity(entity, document, plotStyle); if (!output) skippedHandles.push(entity.handle); return output ?? "";
  }).join("");
  const scale = viewport.height / viewport.viewHeight;
  const angle = viewport.twistAngleRad * 180 / Math.PI;
  return {
    definition: clip.definition,
    body: `<g data-viewport-id="${xml(viewport.id)}" clip-path="${clip.reference}"><g transform="translate(${viewport.center.x} ${viewport.center.y}) scale(${scale}) rotate(${angle}) translate(${-viewport.viewCenter.x} ${-viewport.viewCenter.y})">${body}</g></g>`,
  };
}

export function exportLayoutSvg(document: KDrawDocumentV1, layoutId: string, options: LayoutPlotOptions = {}): { text: string; skippedHandles: string[]; placement: LayoutPlotPlacement } {
  const layout = document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new RangeError(`Layout not found: ${layoutId}`);
  const placement = resolveLayoutPlotPlacement(layout, options);
  const paperPrintable = printableEntities(document, layout.entities ?? []);
  const skippedHandles: string[] = [...paperPrintable.omitted];
  const plotStyle = resolvePlotStyle(placement.setup.plotStyle);
  const viewports = layout.viewports.map((viewport, index) => svgViewport(document, viewport, index, skippedHandles, plotStyle));
  const paperBody = paperPrintable.entities.map((entity) => {
    const output = svgEntity(entity, document, plotStyle); if (!output) skippedHandles.push(entity.handle); return output ?? "";
  }).join("");
  const { paper, source, destination, scaleFactor, setup } = placement;
  const transform = `translate(${destination.x} ${paper.heightMm - destination.y}) scale(${scaleFactor} ${-scaleFactor}) translate(${-source.x} ${-source.y})`;
  const plotClip = `<clipPath id="plot-source-clip"><rect x="${destination.x}" y="${paper.heightMm - destination.y - destination.height}" width="${destination.width}" height="${destination.height}"/></clipPath>`;
  const metadata = `data-layout-id="${xml(layout.id)}" data-plot-area="${setup.plotArea.kind}" data-plot-scale="${setup.plotScale.mode}" data-plot-profile="${plotStyle.profile}" data-plot-lineweights="${plotStyle.plotLineweights}" data-plot-transparency="${plotStyle.plotTransparency}" data-source="${source.x},${source.y},${source.width},${source.height}" data-destination="${destination.x},${destination.y},${destination.width},${destination.height}"`;
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.widthMm}mm" height="${paper.heightMm}mm" viewBox="0 0 ${paper.widthMm} ${paper.heightMm}" ${metadata}><defs>${plotClip}${viewports.map((viewport) => viewport.definition).join("")}</defs><g clip-path="url(#plot-source-clip)"><g transform="${transform}">${viewports.map((viewport) => viewport.body).join("")}${paperBody}</g></g></svg>`,
    skippedHandles: [...new Set(skippedHandles)],
    placement,
  };
}

function pdfClip(viewport: CadViewport): string {
  if (viewport.clipBoundary) {
    const first = viewport.clipBoundary[0]!;
    return `${pdfNumber(first.x)} ${pdfNumber(first.y)} m ${viewport.clipBoundary.slice(1).map((point) => `${pdfNumber(point.x)} ${pdfNumber(point.y)} l`).join(" ")} h W n`;
  }
  return `${pdfNumber(viewport.center.x - viewport.width / 2)} ${pdfNumber(viewport.center.y - viewport.height / 2)} ${pdfNumber(viewport.width)} ${pdfNumber(viewport.height)} re W n`;
}

interface PdfPageDefinition { widthMm: number; heightMm: number; content: string }

function buildPdfBytes(pages: readonly PdfPageDefinition[]): Uint8Array {
  if (pages.length === 0) throw new RangeError("At least one PDF page is required.");
  const alphaNames = [...new Set(pages.flatMap((page) => [...page.content.matchAll(/\/(GS\d+(?:_\d+)?) gs/gu)].map((match) => match[1]!)))].sort();
  const fontObject = 3 + pages.length * 2;
  const alphaStartObject = fontObject + 1;
  const alphaResources = alphaNames.map((name, index) => `/${name} ${alphaStartObject + index} 0 R`).join(" ");
  const pageObjects = pages.flatMap((page, index) => {
    const pageObject = 3 + index * 2; const contentObject = pageObject + 1;
    return [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.widthMm * MM_TO_PT)} ${pdfNumber(page.heightMm * MM_TO_PT)}] /Resources << /Font << /F1 ${fontObject} 0 R >> /ExtGState << ${alphaResources} >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${new TextEncoder().encode(page.content).byteLength} >>\nstream\n${page.content}\nendstream`,
    ];
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pageObjects,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...alphaNames.map((name) => {
      const opacity = Number(name.slice(2).replace("_", ".")) / 100;
      return `<< /Type /ExtGState /CA ${pdfNumber(opacity)} /ca ${pdfNumber(opacity)} >>`;
    }),
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(pdf).byteLength); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function layoutPdfPage(document: KDrawDocumentV1, layoutId: string, options: LayoutPlotOptions = {}): PdfPageDefinition & PublishedLayoutPage {
  const layout = document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new RangeError(`Layout not found: ${layoutId}`);
  const placement = resolveLayoutPlotPlacement(layout, options);
  const paperPrintable = printableEntities(document, layout.entities ?? []);
  const skippedHandles: string[] = [...paperPrintable.omitted];
  const plotStyle = resolvePlotStyle(placement.setup.plotStyle);
  const paperCommands = paperPrintable.entities.flatMap((entity) => {
    const style = resolveEntityPlotAppearance(entity, document.layers, plotStyle);
    const output = pdfEntity(entity, document, plotStyle, style.lineweightMm / placement.scaleFactor); if (!output) { skippedHandles.push(entity.handle); return []; } return [output];
  });
  const viewportCommands = layout.viewports.map((viewport) => {
    const frozen = new Set(Object.entries(viewport.layerOverrides ?? {}).filter(([, value]) => value.frozen).map(([layerId]) => layerId));
    const viewportScale = viewport.height / viewport.viewHeight;
    const commands = printableEntities(document).entities.filter((entity) => !frozen.has(entity.layerId)).flatMap((entity) => {
      const style = resolveEntityPlotAppearance(entity, document.layers, plotStyle);
      const output = pdfEntity(entity, document, plotStyle, style.lineweightMm / (placement.scaleFactor * viewportScale)); if (!output) { skippedHandles.push(entity.handle); return []; } return [output];
    });
    const scale = viewport.height / viewport.viewHeight; const cosine = Math.cos(viewport.twistAngleRad); const sine = Math.sin(viewport.twistAngleRad);
    const a = scale * cosine; const b = scale * sine; const c = -scale * sine; const d = scale * cosine;
    const tx = viewport.center.x - a * viewport.viewCenter.x - c * viewport.viewCenter.y;
    const ty = viewport.center.y - b * viewport.viewCenter.x - d * viewport.viewCenter.y;
    return `q ${pdfClip(viewport)} ${pdfNumber(a)} ${pdfNumber(b)} ${pdfNumber(c)} ${pdfNumber(d)} ${pdfNumber(tx)} ${pdfNumber(ty)} cm\n${commands.join("\n")}\nQ`;
  });
  const { source, destination, scaleFactor, paper } = placement;
  const outerScale = MM_TO_PT * scaleFactor;
  const tx = MM_TO_PT * (destination.x - source.x * scaleFactor); const ty = MM_TO_PT * (destination.y - source.y * scaleFactor);
  const destinationClip = `${pdfNumber(destination.x * MM_TO_PT)} ${pdfNumber(destination.y * MM_TO_PT)} ${pdfNumber(destination.width * MM_TO_PT)} ${pdfNumber(destination.height * MM_TO_PT)} re W n`;
  const content = `q ${destinationClip} ${pdfNumber(outerScale)} 0 0 ${pdfNumber(outerScale)} ${pdfNumber(tx)} ${pdfNumber(ty)} cm\n${viewportCommands.join("\n")}\n${paperCommands.join("\n")}\nQ`;
  return { widthMm: paper.widthMm, heightMm: paper.heightMm, content, layoutId, skippedHandles: [...new Set(skippedHandles)], placement };
}

export function exportLayoutVectorPdf(document: KDrawDocumentV1, layoutId: string, options: LayoutPlotOptions = {}): { bytes: Uint8Array; skippedHandles: string[]; placement: LayoutPlotPlacement } {
  const page = layoutPdfPage(document, layoutId, options);
  return { bytes: buildPdfBytes([page]), skippedHandles: page.skippedHandles, placement: page.placement };
}

export function exportLayoutsVectorPdf(
  document: KDrawDocumentV1,
  layoutIds: readonly string[],
  options: Readonly<Record<string, LayoutPlotOptions>> = {},
): LayoutBatchPdfResult {
  if (layoutIds.length === 0) throw new RangeError("At least one layout must be selected for batch publish.");
  if (new Set(layoutIds).size !== layoutIds.length) throw new RangeError("Batch publish layout ids must be unique.");
  const pages = layoutIds.map((layoutId) => layoutPdfPage(document, layoutId, options[layoutId] ?? {}));
  return {
    bytes: buildPdfBytes(pages),
    pages: pages.map(({ layoutId, placement, skippedHandles }) => ({ layoutId, placement, skippedHandles })),
    skippedHandles: [...new Set(pages.flatMap((page) => page.skippedHandles))],
  };
}

export function readPdfSummary(bytes: Uint8Array): { version: string | null; pages: number; vectorStrokeCommands: number; hasXref: boolean; xrefOffsetsValid: boolean } {
  const text = new TextDecoder("latin1").decode(bytes);
  const xref = text.match(/\nxref\n0 (\d+)\n([\s\S]*?)trailer\n/);
  const xrefOffsetsValid = xref
    ? xref[2]!
        .trim()
        .split("\n")
        .slice(1)
        .every((line, index) => text.slice(Number.parseInt(line.slice(0, 10), 10)).startsWith(`${index + 1} 0 obj`))
    : false;
  return {
    version: text.match(/^%PDF-([0-9.]+)/)?.[1] ?? null,
    pages: (text.match(/\/Type \/Page\b/g) ?? []).length,
    vectorStrokeCommands: (text.match(/\bS\b/g) ?? []).length,
    hasXref: /\nxref\n/.test(text) && /\nstartxref\n\d+\n%%EOF/.test(text),
    xrefOffsetsValid,
  };
}
