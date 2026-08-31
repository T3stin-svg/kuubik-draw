import { expect, type Page } from "@playwright/test";
import { migrateLayoutWorkspace } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

interface SeedDocument {
  documentId: string;
  revision: number;
}

interface SeedOptions {
  clearLocalStorageKeys?: readonly string[];
}

/** Seeds the schema created by the running product without pinning or recreating its DB version. */
export function currentKDrawDocument(document: KDrawDocumentV1): KDrawDocumentV1 {
  return migrateLayoutWorkspace(document).document;
}

export async function seedKDrawDocument<TDocument extends SeedDocument>(
  page: Page,
  document: TDocument,
  options: SeedOptions = {},
): Promise<void> {
  const currentDocument = currentKDrawDocument(document as KDrawDocumentV1);
  await page.goto("/d/local");
  await expect(page.locator("main")).toBeVisible();
  await page.goto("/scope.html");
  await page.evaluate(async ({ value, clearLocalStorageKeys }) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const requestedStores = ["attachments", "compactions", "documents", "operations", "recoveryEvents", "snapshots"];
    const stores = requestedStores.filter((name) => database.objectStoreNames.contains(name));
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const transaction = database.transaction(stores, "readwrite");
      for (const name of stores) transaction.objectStore(name).clear();
      transaction.objectStore("documents").put(value);
      transaction.objectStore("snapshots").add({
        key: `${value.documentId}:${String(value.revision).padStart(12, "0")}:snapshot:${crypto.randomUUID()}`,
        documentId: value.documentId,
        revision: value.revision,
        document: value,
        sha256,
        recordedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => rejectWrite(transaction.error);
      transaction.onabort = () => rejectWrite(transaction.error);
    });
    database.close();
    for (const key of clearLocalStorageKeys) localStorage.removeItem(key);
  }, { value: structuredClone(currentDocument), clearLocalStorageKeys: [...(options.clearLocalStorageKeys ?? [])] });

  await page.goto("/d/local");
  await expect(page.locator("main")).toBeVisible();
  await expect.poll(async () => page.evaluate(async (documentId) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const value = await new Promise<SeedDocument | undefined>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get(documentId);
      request.onsuccess = () => resolveRead(request.result as SeedDocument | undefined);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return value ? { documentId: value.documentId, revision: value.revision } : null;
  }, document.documentId)).toEqual({ documentId: document.documentId, revision: document.revision });
}

/** Creates an explicit recovery checkpoint for the latest durable document revision. */
export async function checkpointKDrawDocument(
  page: Page,
  options: { documentId?: string; normalizeLayoutWorkspace?: boolean; suspendApp?: boolean } = {},
): Promise<{ revision: number; layoutRepairs: string[] }> {
  if (options.suspendApp) await page.goto("/scope.html");
  const documentId = options.documentId ?? "local";
  const storedDocument = await page.evaluate(async (requestedDocumentId) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const document = await new Promise<KDrawDocumentV1>((resolveRead, rejectRead) => {
      const request = database.transaction("documents", "readonly").objectStore("documents").get(requestedDocumentId);
      request.onsuccess = () => resolveRead(request.result as KDrawDocumentV1);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();
    return document;
  }, documentId);
  const migration = migrateLayoutWorkspace(storedDocument);
  const checkpointDocument = options.normalizeLayoutWorkspace && migration.migrated
    ? {
        ...migration.document,
        revision: storedDocument.revision + 1,
        metadata: { ...migration.document.metadata, updatedAt: new Date().toISOString() },
      }
    : storedDocument;
  await page.evaluate(async ({ beforeDocument, document, layoutRepairs, recordsMigration }) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const beforeDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(beforeDocument)));
    const beforeSha256 = [...new Uint8Array(beforeDigest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(document)));
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const opId = `e2e-layout-workspace-migrate:${document.documentId}:${document.revision}`;
    const operation = {
      opId,
      baseRevision: beforeDocument.revision,
      commandId: "LAYOUT_WORKSPACE_MIGRATE",
      args: { repairs: layoutRepairs },
      targetHandles: [],
      resultHandles: [],
    };
    await new Promise<void>((resolveWrite, rejectWrite) => {
      const transaction = database.transaction(recordsMigration ? ["documents", "snapshots", "operations"] : ["documents", "snapshots"], "readwrite");
      transaction.objectStore("documents").put(document);
      transaction.objectStore("snapshots").add({
        key: recordsMigration
          ? `${document.documentId}:${String(document.revision).padStart(12, "0")}:operation:${opId}`
          : `${document.documentId}:${String(document.revision).padStart(12, "0")}:snapshot:${crypto.randomUUID()}`,
        documentId: document.documentId,
        revision: document.revision,
        document,
        sha256,
        recordedAt: new Date().toISOString(),
      });
      if (recordsMigration) transaction.objectStore("operations").add({
        opId,
        documentId: document.documentId,
        revision: document.revision,
        operation,
        recordedAt: new Date().toISOString(),
        beforeSha256,
        afterSha256: sha256,
        afterDocument: document,
      });
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => rejectWrite(transaction.error);
      transaction.onabort = () => rejectWrite(transaction.error);
    });
    database.close();
  }, {
    beforeDocument: storedDocument,
    document: checkpointDocument,
    layoutRepairs: migration.repairs,
    recordsMigration: options.normalizeLayoutWorkspace === true && migration.migrated,
  });
  return { revision: checkpointDocument.revision, layoutRepairs: migration.repairs };
}
