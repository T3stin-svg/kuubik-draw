import { assertKDrawDocumentV1, type CadAttachmentRef, type CadPoint2, type KDrawDocumentV1 } from "@kuubik/cad-schema";

export const PDF_UNDERLAY_EXTENSION_KEY = "kuubik.pdfUnderlays.v1";

export interface PdfUnderlayPlacement {
  id: string;
  attachmentId: string;
  pageNumber: number;
  position: CadPoint2;
  widthMm: number;
  heightMm: number;
  rotationRad: number;
  opacity: number;
  visible: boolean;
}

export interface PdfUnderlayDocumentInput {
  attachment: CadAttachmentRef;
  placement: PdfUnderlayPlacement;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

export function assertPdfUnderlayPlacement(value: PdfUnderlayPlacement): void {
  if (!value.id.trim() || !value.attachmentId.trim()) throw new TypeError("PDF underlay ids are required.");
  if (!Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1) throw new RangeError("PDF underlay page number must be a positive integer.");
  finite(value.position.x, "PDF underlay X"); finite(value.position.y, "PDF underlay Y");
  if (!(finite(value.widthMm, "PDF underlay width") > 0) || !(finite(value.heightMm, "PDF underlay height") > 0)) throw new RangeError("PDF underlay dimensions must be positive.");
  finite(value.rotationRad, "PDF underlay rotation");
  if (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) throw new RangeError("PDF underlay opacity must be between zero and one.");
}

export function readPdfUnderlays(document: KDrawDocumentV1): PdfUnderlayPlacement[] {
  assertKDrawDocumentV1(document);
  const candidate = document.metadata.extensions?.[PDF_UNDERLAY_EXTENSION_KEY];
  if (candidate === undefined) return [];
  if (!Array.isArray(candidate)) throw new TypeError("PDF underlay document extension must be an array.");
  const placements = structuredClone(candidate) as PdfUnderlayPlacement[];
  const ids = new Set<string>();
  for (const placement of placements) {
    assertPdfUnderlayPlacement(placement);
    if (ids.has(placement.id)) throw new TypeError(`Duplicate PDF underlay placement id ${placement.id}.`);
    ids.add(placement.id);
    const attachment = document.attachments.find((value) => value.id === placement.attachmentId);
    if (!attachment || attachment.mediaType !== "application/pdf" || attachment.role !== "underlay") {
      throw new TypeError(`PDF underlay ${placement.id} references a missing PDF attachment ${placement.attachmentId}.`);
    }
  }
  return placements;
}

export function addPdfUnderlay(document: KDrawDocumentV1, input: PdfUnderlayDocumentInput): KDrawDocumentV1 {
  assertKDrawDocumentV1(document);
  assertPdfUnderlayPlacement(input.placement);
  if (input.attachment.id !== input.placement.attachmentId || input.attachment.mediaType !== "application/pdf" || input.attachment.role !== "underlay") {
    throw new TypeError("PDF attachment and placement do not describe the same underlay.");
  }
  if (document.attachments.some((attachment) => attachment.id === input.attachment.id)) throw new TypeError(`Attachment id ${input.attachment.id} already exists.`);
  const existing = readPdfUnderlays(document);
  if (existing.some((placement) => placement.id === input.placement.id)) throw new TypeError(`PDF underlay id ${input.placement.id} already exists.`);
  const next = structuredClone(document);
  next.attachments.push(structuredClone(input.attachment));
  next.metadata.extensions = {
    ...(next.metadata.extensions ?? {}),
    [PDF_UNDERLAY_EXTENSION_KEY]: [...existing, structuredClone(input.placement)],
  };
  assertKDrawDocumentV1(next);
  readPdfUnderlays(next);
  return next;
}
