import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";

const DATABASE_NAME = "kuubik-draw";
const DATABASE_VERSION = 1;

interface StoredOperation {
  opId: string;
  documentId: string;
  revision: number;
  operation: CadOperation;
  recordedAt: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export class StorageRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly documentId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Document ${documentId} revision conflict: expected ${expectedRevision}, found ${actualRevision}.`);
    this.name = "StorageRevisionConflictError";
  }
}

export class KDrawIndexedDb {
  #database: IDBDatabase | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async open(): Promise<void> {
    if (this.#database) return;
    const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents", { keyPath: "documentId" });
      if (!database.objectStoreNames.contains("operations")) {
        const store = database.createObjectStore("operations", { keyPath: "opId" });
        store.createIndex("byDocument", "documentId");
      }
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots", { keyPath: "key" });
      if (!database.objectStoreNames.contains("attachments")) database.createObjectStore("attachments", { keyPath: "id" });
    };
    this.#database = await requestResult(request);
  }

  async saveSnapshot(document: KDrawDocumentV1): Promise<void> {
    await this.open();
    const transaction = this.#database!.transaction(["documents", "snapshots"], "readwrite");
    transaction.objectStore("documents").put(structuredClone(document));
    transaction.objectStore("snapshots").put({
      key: `${document.documentId}:${String(document.revision).padStart(12, "0")}`,
      documentId: document.documentId,
      revision: document.revision,
      document: structuredClone(document),
    });
    await transactionDone(transaction);
  }

  async loadDocument(documentId: string): Promise<KDrawDocumentV1 | null> {
    await this.open();
    const transaction = this.#database!.transaction("documents", "readonly");
    const result = await requestResult(transaction.objectStore("documents").get(documentId));
    await transactionDone(transaction);
    return result ? (structuredClone(result) as KDrawDocumentV1) : null;
  }

  async appendOperation(documentId: string, revision: number, operation: CadOperation): Promise<void> {
    await this.open();
    const transaction = this.#database!.transaction("operations", "readwrite");
    const record: StoredOperation = {
      opId: operation.opId,
      documentId,
      revision,
      operation: structuredClone(operation),
      recordedAt: new Date().toISOString(),
    };
    transaction.objectStore("operations").add(record);
    await transactionDone(transaction);
  }

  async commitRevision(document: KDrawDocumentV1, operation: CadOperation): Promise<void> {
    await this.open();
    const transaction = this.#database!.transaction(["documents", "snapshots", "operations"], "readwrite");
    const done = transactionDone(transaction);
    const current = await requestResult(transaction.objectStore("documents").get(document.documentId)) as KDrawDocumentV1 | undefined;
    const actualRevision = current?.revision ?? 0;
    if (actualRevision !== operation.baseRevision || document.revision !== operation.baseRevision + 1) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new StorageRevisionConflictError(document.documentId, operation.baseRevision, actualRevision);
    }
    transaction.objectStore("documents").put(structuredClone(document));
    transaction.objectStore("snapshots").put({
      key: `${document.documentId}:${String(document.revision).padStart(12, "0")}`,
      documentId: document.documentId,
      revision: document.revision,
      document: structuredClone(document),
    });
    const record: StoredOperation = {
      opId: operation.opId,
      documentId: document.documentId,
      revision: document.revision,
      operation: structuredClone(operation),
      recordedAt: new Date().toISOString(),
    };
    transaction.objectStore("operations").add(record);
    await done;
  }

  async operations(documentId: string): Promise<StoredOperation[]> {
    await this.open();
    const transaction = this.#database!.transaction("operations", "readonly");
    const records = await requestResult(transaction.objectStore("operations").index("byDocument").getAll(documentId));
    await transactionDone(transaction);
    return (records as StoredOperation[]).sort((a, b) => a.revision - b.revision);
  }

  close(): void {
    this.#database?.close();
    this.#database = null;
  }
}
