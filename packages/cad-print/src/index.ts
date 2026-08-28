import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";

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
