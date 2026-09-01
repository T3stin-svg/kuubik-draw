import { assertKDrawDocumentV1, type CadAttachmentRef, type CadPoint2, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange } from "./transaction.js";

export const PDF_UNDERLAY_EXTENSION_KEY = "kuubik.pdfUnderlays.v1";

export interface PdfUnderlayClipPoint {
  /** Normalized page X coordinate in the inclusive range 0..1. */
  x: number;
  /** Normalized page Y coordinate in the inclusive range 0..1. */
  y: number;
}

export type PdfUnderlayReferenceMode = "embedded" | "linked-copy";

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
  /** Layer 0 is used when opening legacy v1 placements without this field. */
  layerId?: string;
  /** Extra AutoCAD-style fade percentage; 100 is fully faded. */
  fadePercent?: number;
  /** Polygon in normalized page coordinates. Omission means the full page. */
  clipBoundary?: PdfUnderlayClipPoint[];
  /** User-visible source hint. Browser imports retain a safe relative file name. */
  referencePath?: string;
  /** Linked copies keep a reload hint while retaining verified recovery bytes. */
  referenceMode?: PdfUnderlayReferenceMode;
}

export interface PdfUnderlayLayerState {
  layerId: string;
  rendered: boolean;
  selectable: boolean;
  editable: boolean;
  reason: "ok" | "placement-hidden" | "layer-off" | "layer-frozen" | "layer-locked";
}

export type PdfUnderlayPlacementPatch = Partial<Pick<PdfUnderlayPlacement,
  "pageNumber" | "position" | "widthMm" | "heightMm" | "rotationRad" | "opacity" | "visible"
  | "layerId" | "fadePercent" | "referencePath" | "referenceMode"
>> & { clipBoundary?: PdfUnderlayClipPoint[] | null };

export interface PdfUnderlayDocumentInput {
  attachment: CadAttachmentRef;
  placement: PdfUnderlayPlacement;
}

function metadataWithPdfUnderlays(
  document: KDrawDocumentV1,
  placements: readonly PdfUnderlayPlacement[],
): KDrawDocumentV1["metadata"] {
  const metadata = structuredClone(document.metadata);
  const extensions = { ...(metadata.extensions ?? {}) };
  if (placements.length > 0) extensions[PDF_UNDERLAY_EXTENSION_KEY] = structuredClone(placements);
  else delete extensions[PDF_UNDERLAY_EXTENSION_KEY];
  if (Object.keys(extensions).length > 0) metadata.extensions = extensions;
  else delete metadata.extensions;
  return metadata;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function assertClipBoundary(points: readonly PdfUnderlayClipPoint[] | undefined): void {
  if (points === undefined) return;
  if (!Array.isArray(points) || points.length < 3) throw new RangeError("PDF underlay clip boundary requires at least three points.");
  for (const [index, point] of points.entries()) {
    finite(point.x, `PDF underlay clip point ${index + 1} X`);
    finite(point.y, `PDF underlay clip point ${index + 1} Y`);
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      throw new RangeError("PDF underlay clip coordinates must be between zero and one.");
    }
  }
}

export function assertPdfUnderlayPlacement(value: PdfUnderlayPlacement): void {
  if (!value.id.trim() || !value.attachmentId.trim()) throw new TypeError("PDF underlay ids are required.");
  if (!Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1) throw new RangeError("PDF underlay page number must be a positive integer.");
  finite(value.position.x, "PDF underlay X"); finite(value.position.y, "PDF underlay Y");
  if (!(finite(value.widthMm, "PDF underlay width") > 0) || !(finite(value.heightMm, "PDF underlay height") > 0)) throw new RangeError("PDF underlay dimensions must be positive.");
  finite(value.rotationRad, "PDF underlay rotation");
  if (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) throw new RangeError("PDF underlay opacity must be between zero and one.");
  if (value.layerId !== undefined && !value.layerId.trim()) throw new TypeError("PDF underlay layer id must not be empty.");
  if (value.fadePercent !== undefined && (!Number.isFinite(value.fadePercent) || value.fadePercent < 0 || value.fadePercent > 100)) {
    throw new RangeError("PDF underlay fade must be between zero and 100 percent.");
  }
  assertClipBoundary(value.clipBoundary);
  if (value.referencePath !== undefined && (!value.referencePath.trim() || /[\u0000-\u001f]/u.test(value.referencePath))) {
    throw new TypeError("PDF underlay reference path must be non-empty and contain no control characters.");
  }
  if (value.referenceMode !== undefined && value.referenceMode !== "embedded" && value.referenceMode !== "linked-copy") {
    throw new TypeError("PDF underlay reference mode is not supported.");
  }
}

export function effectivePdfUnderlayOpacity(placement: PdfUnderlayPlacement): number {
  assertPdfUnderlayPlacement(placement);
  return placement.opacity * (1 - (placement.fadePercent ?? 0) / 100);
}

export function resolvePdfUnderlayLayerState(document: KDrawDocumentV1, placement: PdfUnderlayPlacement): PdfUnderlayLayerState {
  assertKDrawDocumentV1(document);
  assertPdfUnderlayPlacement(placement);
  const layerId = placement.layerId ?? "0";
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`PDF underlay ${placement.id} references missing layer ${layerId}.`);
  if (!layer.visible) return { layerId, rendered: false, selectable: false, editable: false, reason: "layer-off" };
  if (layer.frozen) return { layerId, rendered: false, selectable: false, editable: false, reason: "layer-frozen" };
  if (layer.locked) return { layerId, rendered: placement.visible, selectable: placement.visible, editable: false, reason: "layer-locked" };
  if (!placement.visible) return { layerId, rendered: false, selectable: false, editable: true, reason: "placement-hidden" };
  return { layerId, rendered: true, selectable: true, editable: true, reason: "ok" };
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
    resolvePdfUnderlayLayerState(document, placement);
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

/**
 * Plan attachment reference and placement metadata as one CadSession revision.
 * The referenced bytes remain external and must be durably SHA-verified before
 * the candidate session is accepted by the caller.
 */
export function planAddPdfUnderlay(document: KDrawDocumentV1, input: PdfUnderlayDocumentInput): CadChange[] {
  const next = addPdfUnderlay(document, input);
  return [
    { type: "put-attachment", attachment: structuredClone(input.attachment) },
    { type: "set-metadata", metadata: structuredClone(next.metadata) },
  ];
}

export function planRemovePdfUnderlay(document: KDrawDocumentV1, placementId: string): CadChange[] {
  const id = placementId.trim();
  if (!id) throw new TypeError("PDF underlay placement id is required.");
  const placements = readPdfUnderlays(document);
  const placement = placements.find((candidate) => candidate.id === id);
  if (!placement) throw new RangeError(`PDF underlay placement ${id} does not exist.`);
  const layerState = resolvePdfUnderlayLayerState(document, placement);
  if (!layerState.editable) throw new TypeError(`PDF underlay ${id} cannot be edited because ${layerState.reason}.`);
  const retained = placements.filter((candidate) => candidate.id !== id);
  const changes: CadChange[] = [{ type: "set-metadata", metadata: metadataWithPdfUnderlays(document, retained) }];
  if (!retained.some((candidate) => candidate.attachmentId === placement.attachmentId)) {
    changes.push({ type: "delete-attachment", attachmentId: placement.attachmentId });
  }
  return changes;
}

export function planUpdatePdfUnderlay(
  document: KDrawDocumentV1,
  placementId: string,
  patch: PdfUnderlayPlacementPatch,
): CadChange[] {
  const id = placementId.trim();
  const placements = readPdfUnderlays(document);
  const placement = placements.find((candidate) => candidate.id === id);
  if (!placement) throw new RangeError(`PDF underlay placement ${id} does not exist.`);
  const state = resolvePdfUnderlayLayerState(document, placement);
  if (!state.editable) throw new TypeError(`PDF underlay ${id} cannot be edited because ${state.reason}.`);
  const next = { ...structuredClone(placement), ...structuredClone(patch) } as PdfUnderlayPlacement & { clipBoundary?: PdfUnderlayClipPoint[] | null };
  if (next.clipBoundary === null) delete next.clipBoundary;
  assertPdfUnderlayPlacement(next);
  resolvePdfUnderlayLayerState(document, next);
  const updated = placements.map((candidate) => candidate.id === id ? next : candidate);
  return [{ type: "set-metadata", metadata: metadataWithPdfUnderlays(document, updated) }];
}

export function planReloadPdfUnderlay(
  document: KDrawDocumentV1,
  placementId: string,
  replacement: PdfUnderlayDocumentInput,
): CadChange[] {
  const id = placementId.trim();
  const placements = readPdfUnderlays(document);
  const current = placements.find((candidate) => candidate.id === id);
  if (!current) throw new RangeError(`PDF underlay placement ${id} does not exist.`);
  const state = resolvePdfUnderlayLayerState(document, current);
  if (!state.editable) throw new TypeError(`PDF underlay ${id} cannot be reloaded because ${state.reason}.`);
  if (replacement.placement.id !== id || replacement.placement.attachmentId !== replacement.attachment.id) {
    throw new TypeError("Reloaded PDF placement must retain its placement id and reference the replacement attachment.");
  }
  if (replacement.attachment.mediaType !== "application/pdf" || replacement.attachment.role !== "underlay") {
    throw new TypeError("Reloaded attachment must be a PDF underlay.");
  }
  if (replacement.attachment.id === current.attachmentId || document.attachments.some((item) => item.id === replacement.attachment.id)) {
    throw new TypeError("PDF reload requires a new immutable attachment id.");
  }
  assertPdfUnderlayPlacement(replacement.placement);
  resolvePdfUnderlayLayerState(document, replacement.placement);
  const updated = placements.map((candidate) => candidate.id === id ? structuredClone(replacement.placement) : candidate);
  const nextDocument = structuredClone(document);
  nextDocument.attachments.push(structuredClone(replacement.attachment));
  const keepOld = updated.some((candidate) => candidate.attachmentId === current.attachmentId);
  if (!keepOld) nextDocument.attachments = nextDocument.attachments.filter((item) => item.id !== current.attachmentId);
  nextDocument.metadata = metadataWithPdfUnderlays(nextDocument, updated);
  assertKDrawDocumentV1(nextDocument);
  readPdfUnderlays(nextDocument);
  const changes: CadChange[] = [
    { type: "put-attachment", attachment: structuredClone(replacement.attachment) },
    { type: "set-metadata", metadata: structuredClone(nextDocument.metadata) },
  ];
  if (!keepOld) changes.push({ type: "delete-attachment", attachmentId: current.attachmentId });
  return changes;
}
