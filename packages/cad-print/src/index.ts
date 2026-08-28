import type { CadEntity, CadLayout, CadPageSetup, CadPaperRect, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface PrintPage {
  widthMm: number;
  heightMm: number;
  scaleDenominator: number;
  origin: { x: number; y: number };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function svgEntity(entity: CadEntity): string | null {
  const common = `data-handle="${xml(entity.handle)}" vector-effect="non-scaling-stroke" fill="none" stroke="${xml(entity.appearance?.color ?? "#000000")}"`;
  switch (entity.kind) {
    case "line": return `<line ${common} x1="${entity.start.x}" y1="${entity.start.y}" x2="${entity.end.x}" y2="${entity.end.y}"/>`;
    case "circle": return `<circle ${common} cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}"/>`;
    case "polyline":
      if (entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-12)) return null;
      return `<${entity.closed ? "polygon" : "polyline"} ${common} points="${entity.vertices.map((point) => `${point.x},${point.y}`).join(" ")}"/>`;
    case "text":
    case "mtext":
      if (Math.abs(entity.rotationRad) > 1e-12) return null;
      return `<text data-handle="${xml(entity.handle)}" transform="translate(${entity.position.x} ${entity.position.y}) scale(1 -1)" x="0" y="0" font-size="${entity.height}" fill="${xml(entity.appearance?.color ?? "#000000")}">${xml(entity.text)}</text>`;
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

function printableEntities(document: KDrawDocumentV1): { entities: CadEntity[]; omitted: string[] } {
  const printableLayers = new Set(
    document.layers
      .filter((layer) => layer.visible && !layer.frozen && layer.plottable)
      .map((layer) => layer.id),
  );
  return {
    entities: document.entities.filter((entity) => printableLayers.has(entity.layerId)),
    omitted: document.entities.filter((entity) => !printableLayers.has(entity.layerId)).map((entity) => entity.handle),
  };
}

export function exportSvg(document: KDrawDocumentV1, page: PrintPage): { text: string; skippedHandles: string[] } {
  const printable = printableEntities(document);
  const skippedHandles: string[] = [...printable.omitted];
  const body = printable.entities
    .map((entity) => {
      const result = svgEntity(entity);
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

function pdfEntity(entity: CadEntity): string | null {
  switch (entity.kind) {
    case "line": return `${pdfNumber(entity.start.x)} ${pdfNumber(entity.start.y)} m ${pdfNumber(entity.end.x)} ${pdfNumber(entity.end.y)} l S`;
    case "polyline": {
      if (entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > 1e-12)) return null;
      const first = entity.vertices[0];
      if (!first) return null;
      const segments = entity.vertices.slice(1).map((point) => `${pdfNumber(point.x)} ${pdfNumber(point.y)} l`).join(" ");
      return `${pdfNumber(first.x)} ${pdfNumber(first.y)} m ${segments}${entity.closed ? " h" : ""} S`;
    }
    case "circle": {
      const c = entity.center;
      const r = entity.radius;
      const k = r * 0.5522847498307936;
      return [
        `${pdfNumber(c.x + r)} ${pdfNumber(c.y)} m`,
        `${pdfNumber(c.x + r)} ${pdfNumber(c.y + k)} ${pdfNumber(c.x + k)} ${pdfNumber(c.y + r)} ${pdfNumber(c.x)} ${pdfNumber(c.y + r)} c`,
        `${pdfNumber(c.x - k)} ${pdfNumber(c.y + r)} ${pdfNumber(c.x - r)} ${pdfNumber(c.y + k)} ${pdfNumber(c.x - r)} ${pdfNumber(c.y)} c`,
        `${pdfNumber(c.x - r)} ${pdfNumber(c.y - k)} ${pdfNumber(c.x - k)} ${pdfNumber(c.y - r)} ${pdfNumber(c.x)} ${pdfNumber(c.y - r)} c`,
        `${pdfNumber(c.x + k)} ${pdfNumber(c.y - r)} ${pdfNumber(c.x + r)} ${pdfNumber(c.y - k)} ${pdfNumber(c.x + r)} ${pdfNumber(c.y)} c S`,
      ].join(" ");
    }
    case "text":
    case "mtext":
      if (Math.abs(entity.rotationRad) > 1e-12) return null;
      return `BT /F1 ${pdfNumber(entity.height)} Tf ${pdfNumber(entity.position.x)} ${pdfNumber(entity.position.y)} Td (${pdfText(entity.text)}) Tj ET`;
    default: return null;
  }
}

export function exportVectorPdf(document: KDrawDocumentV1, page: PrintPage): { bytes: Uint8Array; skippedHandles: string[] } {
  const printable = printableEntities(document);
  const skippedHandles: string[] = [...printable.omitted];
  const commands = printable.entities.flatMap((entity) => {
    const output = pdfEntity(entity);
    if (!output) {
      skippedHandles.push(entity.handle);
      return [];
    }
    return [output];
  });
  const scale = (MM_TO_PT * UNIT_TO_MM[document.units.linear]) / page.scaleDenominator;
  const content = `q ${pdfNumber(scale)} 0 0 ${pdfNumber(scale)} ${pdfNumber(-page.origin.x * scale)} ${pdfNumber(-page.origin.y * scale)} cm 0.25 w\n${commands.join("\n")}\nQ`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.widthMm * MM_TO_PT)} ${pdfNumber(page.heightMm * MM_TO_PT)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).byteLength);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { bytes: new TextEncoder().encode(pdf), skippedHandles };
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

function svgViewport(document: KDrawDocumentV1, viewport: CadViewport, index: number, skippedHandles: string[]): { definition: string; body: string } {
  const id = `viewport-clip-${index}`;
  const clip = viewportClip(viewport, id);
  const frozen = new Set(Object.entries(viewport.layerOverrides ?? {}).filter(([, value]) => value.frozen).map(([layerId]) => layerId));
  const printable = printableEntities(document).entities.filter((entity) => !frozen.has(entity.layerId));
  const body = printable.map((entity) => {
    const output = svgEntity(entity); if (!output) skippedHandles.push(entity.handle); return output ?? "";
  }).join("");
  const scale = viewport.height / viewport.viewHeight;
  const angle = viewport.twistAngleRad * 180 / Math.PI;
  return {
    definition: clip.definition,
    body: `<g data-viewport-id="${xml(viewport.id)}" clip-path="${clip.reference}" transform="translate(${viewport.center.x} ${viewport.center.y}) scale(${scale}) rotate(${angle}) translate(${-viewport.viewCenter.x} ${-viewport.viewCenter.y})">${body}</g>`,
  };
}

export function exportLayoutSvg(document: KDrawDocumentV1, layoutId: string, options: LayoutPlotOptions = {}): { text: string; skippedHandles: string[]; placement: LayoutPlotPlacement } {
  const layout = document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new RangeError(`Layout not found: ${layoutId}`);
  const placement = resolveLayoutPlotPlacement(layout, options);
  const skippedHandles: string[] = [];
  const viewports = layout.viewports.map((viewport, index) => svgViewport(document, viewport, index, skippedHandles));
  const paperBody = (layout.entities ?? []).map((entity) => {
    const output = svgEntity(entity); if (!output) skippedHandles.push(entity.handle); return output ?? "";
  }).join("");
  const { paper, source, destination, scaleFactor, setup } = placement;
  const transform = `translate(${destination.x} ${paper.heightMm - destination.y}) scale(${scaleFactor} ${-scaleFactor}) translate(${-source.x} ${-source.y})`;
  const metadata = `data-layout-id="${xml(layout.id)}" data-plot-area="${setup.plotArea.kind}" data-plot-scale="${setup.plotScale.mode}" data-source="${source.x},${source.y},${source.width},${source.height}" data-destination="${destination.x},${destination.y},${destination.width},${destination.height}"`;
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.widthMm}mm" height="${paper.heightMm}mm" viewBox="0 0 ${paper.widthMm} ${paper.heightMm}" ${metadata}><defs>${viewports.map((viewport) => viewport.definition).join("")}</defs><g transform="${transform}">${viewports.map((viewport) => viewport.body).join("")}${paperBody}</g></svg>`,
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

function buildPdfBytes(widthMm: number, heightMm: number, content: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(widthMm * MM_TO_PT)} ${pdfNumber(heightMm * MM_TO_PT)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(new TextEncoder().encode(pdf).byteLength); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function exportLayoutVectorPdf(document: KDrawDocumentV1, layoutId: string, options: LayoutPlotOptions = {}): { bytes: Uint8Array; skippedHandles: string[]; placement: LayoutPlotPlacement } {
  const layout = document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new RangeError(`Layout not found: ${layoutId}`);
  const placement = resolveLayoutPlotPlacement(layout, options); const skippedHandles: string[] = [];
  const paperCommands = (layout.entities ?? []).flatMap((entity) => {
    const output = pdfEntity(entity); if (!output) { skippedHandles.push(entity.handle); return []; } return [output];
  });
  const viewportCommands = layout.viewports.map((viewport) => {
    const frozen = new Set(Object.entries(viewport.layerOverrides ?? {}).filter(([, value]) => value.frozen).map(([layerId]) => layerId));
    const commands = printableEntities(document).entities.filter((entity) => !frozen.has(entity.layerId)).flatMap((entity) => {
      const output = pdfEntity(entity); if (!output) { skippedHandles.push(entity.handle); return []; } return [output];
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
  const content = `q ${pdfNumber(outerScale)} 0 0 ${pdfNumber(outerScale)} ${pdfNumber(tx)} ${pdfNumber(ty)} cm 0.25 w\n${viewportCommands.join("\n")}\n${paperCommands.join("\n")}\nQ`;
  return { bytes: buildPdfBytes(paper.widthMm, paper.heightMm, content), skippedHandles: [...new Set(skippedHandles)], placement };
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
