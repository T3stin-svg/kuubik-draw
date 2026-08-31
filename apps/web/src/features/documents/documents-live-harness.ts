import { createEmptyDocument } from "@kuubik/cad-core";
import { createPdfUnderlayPlacement, preparePdfUnderlay } from "@kuubik/cad-print";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, StorageRevisionConflictError } from "../../indexed-db.js";
import { DocumentLiveOrchestrator, type DocumentLiveReadback } from "./document-live-orchestrator.js";

const DATABASE_NAME = "kuubik-draw";
const DATABASE_VERSION = 2;

export interface DocumentsLiveHarnessResult {
  ok: true;
  atomicPdfReadback: {
    documentRevision: number;
    operationCount: number;
    snapshotRevisions: number[];
    attachmentSha256: string;
    byteLength: number;
  };
  beforeCrash: DocumentLiveReadback;
  afterReload: DocumentLiveReadback;
  recovery: {
    alphaRevision: number;
    betaRevision: number;
    ignoredOperationIds: string[];
    uncleanSessionIds: string[];
  };
  rejected: {
    staleRevision: true;
    corruptTail: true;
  };
}

export interface DocumentsLiveHarnessOptions {
  databaseName?: string;
  resetDatabase?: boolean;
}

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
}

function operation(opId: string, baseRevision: number, commandId: string): CadOperation {
  return { opId, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function deleteHarnessDatabase(factory: IDBFactory, databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked by an open connection."));
  });
}

async function corruptOperationTail(factory: IDBFactory, databaseName: string, opId: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
  const transaction = database.transaction("operations", "readwrite");
  const store = transaction.objectStore("operations");
  const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = store.get(opId);
    request.onsuccess = () => resolve(request.result as Record<string, unknown>);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB operation read failed."));
  });
  record.afterSha256 = "0".repeat(64);
  store.put(record);
  await transactionDone(transaction);
  database.close();
}

function fixtureDocument(documentId: string): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, now: "2026-08-31T12:00:00.000Z" });
  document.metadata.title = `${documentId}.kdraw`;
  return document;
}

export async function runDocumentsLiveHarness(
  factory: IDBFactory = indexedDB,
  options: DocumentsLiveHarnessOptions = {},
): Promise<DocumentsLiveHarnessResult> {
  const databaseName = options.databaseName?.trim() || DATABASE_NAME;
  if (options.resetDatabase ?? true) await deleteHarnessDatabase(factory, databaseName);
  const crashedDatabase = new KDrawIndexedDb(factory, databaseName);
  const crashed = new DocumentLiveOrchestrator(crashedDatabase, "browser-session-crashed");
  await crashed.open({ documentId: "alpha", fallbackDocument: fixtureDocument("alpha"), sourceFileName: "alpha.kdraw", recordedAt: "2026-08-31T12:00:01.000Z" });
  await crashed.open({ documentId: "beta", fallbackDocument: fixtureDocument("beta"), sourceFileName: "beta.kdraw", recordedAt: "2026-08-31T12:00:02.000Z" });

  const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "alpha-pdf", fileName: "alpha-reference.pdf" });
  const placement = createPdfUnderlayPlacement(prepared, {
    id: "alpha-underlay",
    pageNumber: 1,
    position: { x: 125, y: 250 },
    scale: 0.5,
    opacity: 0.75,
  });
  await crashed.attachPdf("alpha", operation("alpha-pdf-op", 0, "PDFATTACH"), prepared, placement, "2026-08-31T12:00:03.000Z");
  await crashed.commit("beta", operation("beta-line-1", 0, "LINE"), [{
    type: "put",
    entity: { kind: "line", handle: "B1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
  }], "2026-08-31T12:00:04.000Z");
  await crashed.commit("beta", operation("beta-line-2", 1, "LINE"), [{
    type: "put",
    entity: { kind: "line", handle: "B2", layerId: "0", start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
  }], "2026-08-31T12:00:05.000Z");

  const beforeCrash = crashed.readBack();
  const storedPdf = await crashed.readPdf("alpha", "alpha-underlay");
  const atomicPdfReadback = {
    documentRevision: (await crashedDatabase.loadDocument("alpha"))!.revision,
    operationCount: (await crashedDatabase.operations("alpha")).length,
    snapshotRevisions: (await crashedDatabase.snapshots("alpha")).map((snapshot) => snapshot.revision),
    attachmentSha256: storedPdf.attachment.sha256,
    byteLength: storedPdf.bytes.byteLength,
  };

  crashedDatabase.close();
  await corruptOperationTail(factory, databaseName, "beta-line-2");

  const reloadedDatabase = new KDrawIndexedDb(factory, databaseName);
  const reloaded = new DocumentLiveOrchestrator(reloadedDatabase, "browser-session-reloaded");
  const alphaRecovery = await reloaded.open({ documentId: "alpha", sourceFileName: "alpha.kdraw", recordedAt: "2026-08-31T12:01:00.000Z" });
  const betaRecovery = await reloaded.open({ documentId: "beta", sourceFileName: "beta.kdraw", recordedAt: "2026-08-31T12:01:01.000Z" });
  const reloadedPdf = await reloaded.readPdf("alpha", "alpha-underlay");
  if (reloadedPdf.attachment.sha256 !== prepared.attachment.sha256 || reloadedPdf.bytes.byteLength !== prepared.bytes.byteLength) {
    throw new TypeError("PDF underlay read-back changed across crash/reload.");
  }

  let staleRevision = false;
  const stale = structuredClone(alphaRecovery.document);
  stale.revision = 2;
  try {
    await reloadedDatabase.commitRevision(stale, operation("alpha-stale", 0, "LINE"));
  } catch (error) {
    staleRevision = error instanceof StorageRevisionConflictError;
  }
  if (!staleRevision) throw new TypeError("Stale storage revision was not rejected.");
  if (!betaRecovery.recovery.ignoredOperationIds.includes("beta-line-2")) throw new TypeError("Corrupt operation tail was not rejected.");

  const afterReload = reloaded.readBack();
  await reloaded.close("alpha", "2026-08-31T12:02:00.000Z");
  await reloaded.close("beta", "2026-08-31T12:02:01.000Z");
  reloadedDatabase.close();

  return {
    ok: true,
    atomicPdfReadback,
    beforeCrash,
    afterReload,
    recovery: {
      alphaRevision: alphaRecovery.document.revision,
      betaRevision: betaRecovery.document.revision,
      ignoredOperationIds: betaRecovery.recovery.ignoredOperationIds,
      uncleanSessionIds: betaRecovery.recovery.uncleanSessionIds,
    },
    rejected: { staleRevision: true, corruptTail: true },
  };
}

declare global {
  interface Window {
    runKuubikDocumentsLiveHarness?: typeof runDocumentsLiveHarness;
  }
}

if (typeof window !== "undefined") window.runKuubikDocumentsLiveHarness = runDocumentsLiveHarness;
