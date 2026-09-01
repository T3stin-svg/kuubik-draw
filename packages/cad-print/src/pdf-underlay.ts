import type { PdfUnderlayClipPoint, PdfUnderlayReferenceMode } from "@kuubik/cad-core";
import type { CadAttachmentRef } from "@kuubik/cad-schema";

export const MAX_PDF_UNDERLAY_BYTES = 128 * 1024 * 1024;
const PDF_VERSION = /^%PDF-(\d\.\d)/u;
const ACTIVE_PDF_TOKENS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/OpenAction",
  "/AA",
  "/RichMedia",
  "/SubmitForm",
  "/ImportData",
  "/EmbeddedFile",
] as const;
const PT_TO_MM = 25.4 / 72;

export interface PdfUnderlayPage {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface PdfUnderlayInspection {
  version: string;
  byteLength: number;
  pages: PdfUnderlayPage[];
  encrypted: false;
  activeContentTokens: [];
}

export interface PreparedPdfUnderlay {
  attachment: CadAttachmentRef;
  bytes: Uint8Array;
  inspection: PdfUnderlayInspection;
}

export interface PdfUnderlayPlacementCandidate {
  id: string;
  attachmentId: string;
  pageNumber: number;
  position: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  rotationRad: number;
  opacity: number;
  visible: boolean;
  layerId: string;
  fadePercent: number;
  clipBoundary?: PdfUnderlayClipPoint[];
  referencePath: string;
  referenceMode: PdfUnderlayReferenceMode;
}

export class PdfUnderlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnderlayError";
  }
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new PdfUnderlayError(`${label} must be a positive finite number.`);
  return value;
}

function parseMediaBoxes(text: string): PdfUnderlayPage[] {
  const objects = [...text.matchAll(/\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/gu)].map((match) => match[1]!);
  const pageDictionaries = objects.filter((body) => /\/Type\s*\/Page\b/u.test(body));
  if (pageDictionaries.length === 0) throw new PdfUnderlayError("PDF contains no readable page dictionaries.");
  return pageDictionaries.map((body, index) => {
    const box = body.match(/\/(?:CropBox|MediaBox)\s*\[\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*\]/u);
    if (!box) throw new PdfUnderlayError("PDF page boxes are inherited or compressed; a PDF.js page-inspection adapter is required before import.");
    const x1 = Number(box[1]); const y1 = Number(box[2]); const x2 = Number(box[3]); const y2 = Number(box[4]);
    const rawRotation = Number(body.match(/\/Rotate\s+([-+\d]+)/u)?.[1] ?? 0);
    const rotationDeg = ((rawRotation % 360) + 360) % 360;
    if (rotationDeg !== 0 && rotationDeg !== 90 && rotationDeg !== 180 && rotationDeg !== 270) {
      throw new PdfUnderlayError(`PDF page ${index + 1} rotation must be a multiple of 90 degrees.`);
    }
    const rawWidth = finitePositive(Math.abs(x2 - x1) * PT_TO_MM, `PDF page ${index + 1} width`);
    const rawHeight = finitePositive(Math.abs(y2 - y1) * PT_TO_MM, `PDF page ${index + 1} height`);
    return {
      pageNumber: index + 1,
      widthMm: rotationDeg === 90 || rotationDeg === 270 ? rawHeight : rawWidth,
      heightMm: rotationDeg === 90 || rotationDeg === 270 ? rawWidth : rawHeight,
      rotationDeg,
    };
  });
}

function normalizedReferencePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || /[\u0000-\u001f]/u.test(normalized)) throw new PdfUnderlayError("PDF underlay reference path is invalid.");
  return normalized;
}

export function inspectPdfUnderlay(bytes: Uint8Array): PdfUnderlayInspection {
  if (bytes.byteLength === 0) throw new PdfUnderlayError("PDF file is empty.");
  if (bytes.byteLength > MAX_PDF_UNDERLAY_BYTES) throw new PdfUnderlayError(`PDF file exceeds the ${MAX_PDF_UNDERLAY_BYTES} byte underlay limit.`);
  const text = new TextDecoder("latin1").decode(bytes);
  const version = text.match(PDF_VERSION)?.[1];
  if (!version) throw new PdfUnderlayError("File does not begin with a supported PDF header.");
  if (!/%%EOF\s*$/u.test(text)) throw new PdfUnderlayError("PDF end-of-file marker is missing or trailing data is present.");
  if (/\/Encrypt\b/u.test(text)) throw new PdfUnderlayError("Encrypted PDFs cannot be imported as underlays.");
  const activeContentTokens = ACTIVE_PDF_TOKENS.filter((token) => text.includes(token));
  if (activeContentTokens.length > 0) throw new PdfUnderlayError(`PDF active content is not allowed: ${activeContentTokens.join(", ")}.`);
  return {
    version,
    byteLength: bytes.byteLength,
    pages: parseMediaBoxes(text),
    encrypted: false,
    activeContentTokens: [],
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function preparePdfUnderlay(bytes: Uint8Array, options: {
  attachmentId: string;
  fileName: string;
}): Promise<PreparedPdfUnderlay> {
  const attachmentId = options.attachmentId.trim();
  const fileName = options.fileName.trim().replaceAll("\\", "/").split("/").at(-1) ?? "";
  if (!attachmentId) throw new PdfUnderlayError("PDF underlay attachment id is required.");
  if (!/\.pdf$/iu.test(fileName)) throw new PdfUnderlayError("PDF underlay requires a .pdf file name.");
  const copy = Uint8Array.from(bytes);
  const inspection = inspectPdfUnderlay(copy);
  return {
    attachment: {
      id: attachmentId,
      mediaType: "application/pdf",
      sha256: await sha256(copy),
      fileName,
      role: "underlay",
    },
    bytes: copy,
    inspection,
  };
}

export function createPdfUnderlayPlacement(prepared: PreparedPdfUnderlay, options: {
  id: string;
  pageNumber: number;
  position?: { x: number; y: number };
  scale?: number;
  rotationRad?: number;
  opacity?: number;
  visible?: boolean;
  layerId?: string;
  fadePercent?: number;
  clipBoundary?: readonly PdfUnderlayClipPoint[];
  referencePath?: string;
  referenceMode?: PdfUnderlayReferenceMode;
}): PdfUnderlayPlacementCandidate {
  const page = prepared.inspection.pages.find((candidate) => candidate.pageNumber === options.pageNumber);
  if (!page) throw new PdfUnderlayError(`PDF page ${options.pageNumber} is outside 1..${prepared.inspection.pages.length}.`);
  const scale = finitePositive(options.scale ?? 1, "PDF underlay scale");
  const opacity = options.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new PdfUnderlayError("PDF underlay opacity must be between zero and one.");
  const position = options.position ?? { x: 0, y: 0 };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new PdfUnderlayError("PDF underlay position must be finite.");
  const rotationRad = options.rotationRad ?? 0;
  if (!Number.isFinite(rotationRad)) throw new PdfUnderlayError("PDF underlay rotation must be finite.");
  if (!options.id.trim()) throw new PdfUnderlayError("PDF underlay placement id is required.");
  const layerId = options.layerId?.trim() || "0";
  const fadePercent = options.fadePercent ?? 0;
  if (!Number.isFinite(fadePercent) || fadePercent < 0 || fadePercent > 100) throw new PdfUnderlayError("PDF underlay fade must be between zero and 100 percent.");
  const clipBoundary = options.clipBoundary === undefined ? undefined : options.clipBoundary.map((point) => ({ ...point }));
  if (clipBoundary !== undefined) {
    if (clipBoundary.length < 3 || clipBoundary.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
      throw new PdfUnderlayError("PDF underlay clip boundary requires at least three normalized points.");
    }
  }
  const referenceMode = options.referenceMode ?? "embedded";
  if (referenceMode !== "embedded" && referenceMode !== "linked-copy") throw new PdfUnderlayError("PDF underlay reference mode is not supported.");
  return {
    id: options.id.trim(),
    attachmentId: prepared.attachment.id,
    pageNumber: page.pageNumber,
    position: structuredClone(position),
    widthMm: page.widthMm * scale,
    heightMm: page.heightMm * scale,
    rotationRad,
    opacity,
    visible: options.visible ?? true,
    layerId,
    fadePercent,
    ...(clipBoundary === undefined ? {} : { clipBoundary }),
    referencePath: normalizedReferencePath(options.referencePath ?? prepared.attachment.fileName),
    referenceMode,
  };
}

export interface PdfUnderlaySvgReadback {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  operatorCount: number;
  svg: string;
}

interface PdfGraphicsState {
  stroke: string;
  fill: string;
  lineWidth: number;
  matrix: [number, number, number, number, number, number];
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pdfString(value: string): string {
  return value.slice(1, -1).replace(/\\([nrtbf()\\])/gu, (_, escaped: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[escaped] ?? escaped));
}

function color(values: readonly number[]): string {
  return `rgb(${values.map((value) => Math.max(0, Math.min(255, Math.round(value * 255)))).join(" ")})`;
}

function matrixText(matrix: PdfGraphicsState["matrix"]): string {
  return `matrix(${matrix.join(" ")})`;
}

/**
 * Safe built-in renderer for traditional uncompressed PDF underlays. It emits
 * inert SVG from a deliberately small graphics/text operator allowlist. PDFs
 * with compressed content streams fail closed until the PDF.js adapter is wired.
 */
export function renderPdfUnderlayPageSvg(bytes: Uint8Array, pageNumber: number): PdfUnderlaySvgReadback {
  const inspection = inspectPdfUnderlay(bytes);
  const page = inspection.pages.find((candidate) => candidate.pageNumber === pageNumber);
  if (!page) throw new PdfUnderlayError(`PDF page ${pageNumber} is outside 1..${inspection.pages.length}.`);
  const text = new TextDecoder("latin1").decode(bytes);
  const objects = new Map<number, string>();
  for (const match of text.matchAll(/\b(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/gu)) objects.set(Number(match[1]), match[2]!);
  const pages = [...objects.entries()].filter(([, body]) => /\/Type\s*\/Page\b/u.test(body));
  const pageBody = pages[pageNumber - 1]?.[1];
  if (!pageBody) throw new PdfUnderlayError(`PDF page ${pageNumber} dictionary is unavailable.`);
  const contents = pageBody.match(/\/Contents\s*(?:\[([^\]]+)\]|(\d+)\s+\d+\s+R)/u);
  const references = contents?.[1]
    ? [...contents[1].matchAll(/(\d+)\s+\d+\s+R/gu)].map((match) => Number(match[1]))
    : contents?.[2] ? [Number(contents[2])] : [];
  if (references.length === 0) throw new PdfUnderlayError(`PDF page ${pageNumber} has no readable content stream.`);
  const streams = references.map((reference) => {
    const object = objects.get(reference);
    if (!object) throw new PdfUnderlayError(`PDF page ${pageNumber} content object ${reference} is missing.`);
    if (/\/Filter\b/u.test(object)) throw new PdfUnderlayError("Compressed PDF content requires the PDF.js renderer adapter.");
    const stream = object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/u)?.[1];
    if (stream === undefined) throw new PdfUnderlayError(`PDF page ${pageNumber} content stream ${reference} is malformed.`);
    return stream;
  }).join("\n");

  const tokens = streams.match(/\((?:\\.|[^\\)])*\)|\/[A-Za-z0-9_.+-]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*]+/gu) ?? [];
  const operands: string[] = [];
  let state: PdfGraphicsState = { stroke: "rgb(0 0 0)", fill: "rgb(0 0 0)", lineWidth: 1, matrix: [1, 0, 0, 1, 0, 0] };
  const stack: PdfGraphicsState[] = [];
  let path = "";
  let textX = 0; let textY = 0; let fontSize = 12; let leading = 12;
  let operatorCount = 0;
  const output: string[] = [];
  const numbers = (count: number): number[] => operands.splice(-count).map(Number);
  const strokePath = (fill = false, evenOdd = false): void => {
    if (!path.trim()) return;
    output.push(`<path d="${xml(path.trim())}" transform="${matrixText(state.matrix)}" ${fill ? `fill="${state.fill}" fill-rule="${evenOdd ? "evenodd" : "nonzero"}" stroke="none"` : `fill="none" stroke="${state.stroke}" stroke-width="${state.lineWidth}" vector-effect="non-scaling-stroke"`}/>`);
    path = "";
  };

  for (const token of tokens) {
    if (/^(?:\(|\/|[-+\d.])/u.test(token)) { operands.push(token); continue; }
    operatorCount += 1;
    switch (token) {
      case "q": stack.push(structuredClone(state)); break;
      case "Q": state = stack.pop() ?? state; break;
      case "cm": state.matrix = numbers(6) as PdfGraphicsState["matrix"]; break;
      case "RG": state.stroke = color(numbers(3)); break;
      case "rg": state.fill = color(numbers(3)); break;
      case "G": { const [gray] = numbers(1); state.stroke = color([gray!, gray!, gray!]); break; }
      case "g": { const [gray] = numbers(1); state.fill = color([gray!, gray!, gray!]); break; }
      case "w": state.lineWidth = numbers(1)[0] ?? 1; break;
      case "m": { const [x, y] = numbers(2); path += `M ${x} ${y} `; break; }
      case "l": { const [x, y] = numbers(2); path += `L ${x} ${y} `; break; }
      case "c": { const [x1, y1, x2, y2, x3, y3] = numbers(6); path += `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `; break; }
      case "re": { const [x, y, width, height] = numbers(4); path += `M ${x} ${y} h ${width} v ${height} h ${-width!} Z `; break; }
      case "h": path += "Z "; break;
      case "S": strokePath(); break;
      case "s": path += "Z "; strokePath(); break;
      case "f": strokePath(true, false); break;
      case "f*": strokePath(true, true); break;
      case "n": path = ""; break;
      case "BT": textX = 0; textY = 0; break;
      case "Tf": { const size = Number(operands.pop()); operands.pop(); fontSize = Number.isFinite(size) ? size : 12; break; }
      case "TL": leading = numbers(1)[0] ?? fontSize; break;
      case "Td": { const [x, y] = numbers(2); textX += x ?? 0; textY += y ?? 0; break; }
      case "Tm": { const values = numbers(6); textX = values[4] ?? 0; textY = values[5] ?? 0; break; }
      case "T*": textY -= leading; break;
      case "Tj": {
        const value = operands.pop();
        if (value?.startsWith("(")) output.push(`<text transform="${matrixText(state.matrix)} translate(${textX} ${textY}) scale(1 -1)" x="0" y="0" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${state.fill}">${xml(pdfString(value))}</text>`);
        break;
      }
      default: operands.length = 0; break;
    }
    if (!["Tf", "Tj"].includes(token)) operands.length = 0;
  }
  const widthPt = page.widthMm / PT_TO_MM;
  const heightPt = page.heightMm / PT_TO_MM;
  return {
    pageNumber,
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    operatorCount,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${page.widthMm}mm" height="${page.heightMm}mm" viewBox="0 0 ${widthPt} ${heightPt}" role="img" aria-label="Rendered PDF page ${pageNumber}"><rect width="100%" height="100%" fill="white"/><g transform="translate(0 ${heightPt}) scale(1 -1)">${output.join("")}</g></svg>`,
  };
}
