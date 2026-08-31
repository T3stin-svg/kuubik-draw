import { createEmptyDocument, planAddPdfUnderlay } from "@kuubik/cad-core";
import { createPdfUnderlayPlacement, preparePdfUnderlay } from "@kuubik/cad-print";
import type { CadOperation } from "@kuubik/cad-schema";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentSessionCoordinator } from "./document-session-coordinator.js";
import { commitPdfUnderlayAttachment, readStoredPdfUnderlay } from "./pdf-underlay-transaction.js";

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
}

function operation(opId = "attach", baseRevision = 0): CadOperation {
  return { opId, baseRevision, commandId: "PDFATTACH", args: {}, targetHandles: [], resultHandles: [] };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe("F-115 durable PDF underlay transaction", () => {
  it("commits bytes, SHA reference and placement in one storage revision", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(createEmptyDocument({ documentId: "pdf-document" }));
    const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "pdf-1", fileName: "reference.pdf" });
    const placement = createPdfUnderlayPlacement(prepared, { id: "underlay-1", pageNumber: 1, position: { x: 10, y: 20 }, opacity: 0.6 });

    const readback = await commitPdfUnderlayAttachment(database, coordinator, "pdf-document", operation(), prepared, placement);
    expect(readback).toEqual({ attachment: prepared.attachment, placement, bytes: prepared.bytes });
    expect(coordinator.document("pdf-document")).toEqual(await database.loadDocument("pdf-document"));
    expect(coordinator.document("pdf-document")).toMatchObject({ revision: 1, attachments: [prepared.attachment] });
    expect(await database.operations("pdf-document")).toEqual([expect.objectContaining({ opId: "attach", revision: 1 })]);
    database.close();
  });

  it("aborts document, operation and attachment writes when bytes do not match the SHA", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(createEmptyDocument({ documentId: "pdf-corrupt-input" }));
    const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "pdf-1", fileName: "reference.pdf" });
    const placement = createPdfUnderlayPlacement(prepared, { id: "underlay-1", pageNumber: 1 });
    const corrupt = { ...prepared, bytes: Uint8Array.from([1, 2, 3]) };

    await expect(commitPdfUnderlayAttachment(database, coordinator, "pdf-corrupt-input", operation(), corrupt, placement))
      .rejects.toThrow(/checksum mismatch/u);
    expect(coordinator.document("pdf-corrupt-input").revision).toBe(0);
    expect(await database.loadDocument("pdf-corrupt-input")).toBeNull();
    expect(await database.operations("pdf-corrupt-input")).toEqual([]);
    expect(await database.loadAttachment("pdf-corrupt-input", "pdf-1")).toBeNull();
    database.close();
  });

  it("fails closed for missing or corrupt stored attachment bytes", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory);
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(createEmptyDocument({ documentId: "pdf-readback" }));
    const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "pdf-1", fileName: "reference.pdf" });
    const placement = createPdfUnderlayPlacement(prepared, { id: "underlay-1", pageNumber: 1 });
    await commitPdfUnderlayAttachment(database, coordinator, "pdf-readback", operation(), prepared, placement);

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("kuubik-draw");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const corruptTransaction = raw.transaction("attachments", "readwrite");
    const store = corruptTransaction.objectStore("attachments");
    const record = await new Promise<any>((resolve, reject) => {
      const request = store.get("pdf-readback:pdf-1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    record.bytes = Uint8Array.from([9, 9, 9]);
    store.put(record);
    await transactionDone(corruptTransaction);
    raw.close();
    await expect(readStoredPdfUnderlay(database, coordinator.document("pdf-readback"), "underlay-1"))
      .rejects.toThrow(/checksum mismatch/u);

    const missingDatabase = new KDrawIndexedDb(new IDBFactory());
    const missingCoordinator = new DocumentSessionCoordinator();
    missingCoordinator.open(createEmptyDocument({ documentId: "pdf-missing" }));
    await missingCoordinator.commitPersisted(
      "pdf-missing",
      operation("missing", 0),
      planAddPdfUnderlay(missingCoordinator.document("pdf-missing"), { attachment: prepared.attachment, placement }),
      (document, committedOperation) => missingDatabase.commitRevision(document, committedOperation),
    );
    await expect(readStoredPdfUnderlay(missingDatabase, missingCoordinator.document("pdf-missing"), "underlay-1"))
      .rejects.toThrow(/bytes are missing/u);
    await expect(missingDatabase.recordRecoveryClean("pdf-missing", "session", 1)).rejects.toThrow(/is missing/u);
    database.close();
    missingDatabase.close();
  });
});
