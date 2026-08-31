import { planAddPdfUnderlay, planRemovePdfUnderlay, readPdfUnderlays, type PdfUnderlayPlacement } from "@kuubik/cad-core";
import type { PreparedPdfUnderlay } from "@kuubik/cad-print";
import type { CadAttachmentRef, CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentSessionCoordinator } from "./document-session-coordinator.js";

export interface StoredPdfUnderlayReadback {
  attachment: CadAttachmentRef;
  placement: PdfUnderlayPlacement;
  bytes: Uint8Array;
}

function exactAttachment(first: CadAttachmentRef, second: CadAttachmentRef): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export async function readStoredPdfUnderlay(
  database: KDrawIndexedDb,
  document: KDrawDocumentV1,
  placementId: string,
): Promise<StoredPdfUnderlayReadback> {
  const placement = readPdfUnderlays(document).find((candidate) => candidate.id === placementId);
  if (!placement) throw new RangeError(`PDF underlay placement ${placementId} does not exist.`);
  const attachment = document.attachments.find((candidate) => candidate.id === placement.attachmentId);
  if (!attachment) throw new TypeError(`PDF underlay ${placement.id} references missing attachment ${placement.attachmentId}.`);
  const stored = await database.loadAttachment(document.documentId, attachment.id);
  if (!stored) throw new TypeError(`PDF underlay attachment ${attachment.id} bytes are missing.`);
  if (!exactAttachment(stored.attachment, attachment)) {
    throw new TypeError(`PDF underlay attachment ${attachment.id} metadata does not match the document.`);
  }
  return {
    attachment: structuredClone(attachment),
    placement: structuredClone(placement),
    bytes: Uint8Array.from(stored.bytes),
  };
}

export async function commitPdfUnderlayAttachment(
  database: KDrawIndexedDb,
  coordinator: DocumentSessionCoordinator,
  documentId: string,
  operation: CadOperation,
  prepared: PreparedPdfUnderlay,
  placement: PdfUnderlayPlacement,
  now?: string,
): Promise<StoredPdfUnderlayReadback> {
  const changes = planAddPdfUnderlay(coordinator.document(documentId), {
    attachment: prepared.attachment,
    placement,
  });
  let readback: StoredPdfUnderlayReadback | null = null;
  await coordinator.commitPersisted(documentId, operation, changes, async (document, committedOperation) => {
    await database.commitRevisionWithAttachment(document, committedOperation, prepared.attachment, prepared.bytes);
    readback = await readStoredPdfUnderlay(database, document, placement.id);
  }, now);
  if (!readback) throw new TypeError(`PDF underlay ${placement.id} was not durably read back.`);
  return readback;
}

export async function commitPdfUnderlayDetach(
  database: KDrawIndexedDb,
  coordinator: DocumentSessionCoordinator,
  documentId: string,
  operation: CadOperation,
  placementId: string,
  now?: string,
): Promise<KDrawDocumentV1> {
  const changes = planRemovePdfUnderlay(coordinator.document(documentId), placementId);
  await coordinator.commitPersisted(
    documentId,
    operation,
    changes,
    (document, committedOperation) => database.commitRevision(document, committedOperation),
    now,
  );
  return coordinator.document(documentId);
}
