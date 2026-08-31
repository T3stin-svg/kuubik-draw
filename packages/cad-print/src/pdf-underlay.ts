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
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*\]/gu)].map((match, index) => {
    const x1 = Number(match[1]); const y1 = Number(match[2]); const x2 = Number(match[3]); const y2 = Number(match[4]);
    return {
      pageNumber: index + 1,
      widthMm: finitePositive(Math.abs(x2 - x1) * PT_TO_MM, `PDF page ${index + 1} width`),
      heightMm: finitePositive(Math.abs(y2 - y1) * PT_TO_MM, `PDF page ${index + 1} height`),
    };
  });
  const pageCount = (text.match(/\/Type\s*\/Page\b/gu) ?? []).length;
  if (pageCount === 0) throw new PdfUnderlayError("PDF contains no readable page dictionaries.");
  if (boxes.length === 1 && pageCount > 1) return Array.from({ length: pageCount }, (_, index) => ({ ...boxes[0]!, pageNumber: index + 1 }));
  if (boxes.length !== pageCount) {
    throw new PdfUnderlayError("PDF page boxes are inherited or compressed; a PDF.js page-inspection adapter is required before import.");
  }
  return boxes;
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
  };
}
