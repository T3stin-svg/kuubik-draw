import { assertKDrawDocumentV1, type CadAttachmentRef, type CadOperation, type KDrawDocumentV1 } from "@kuubik/cad-schema";

const DATABASE_NAME = "kuubik-draw";
const DATABASE_VERSION = 2;

export interface StoredOperation {
  opId: string;
  documentId: string;
  revision: number;
  operation: CadOperation;
  recordedAt: string;
  beforeSha256?: string | null;
  afterSha256?: string;
  afterDocument?: KDrawDocumentV1;
}

interface StoredSnapshot {
  key: string;
  documentId: string;
  revision: number;
  document: KDrawDocumentV1;
  sha256?: string;
  recordedAt?: string;
}

interface RecoveryEvent {
  eventId: string;
  documentId: string;
  sessionId: string;
  kind: "open" | "clean" | "recover";
  revision: number | null;
  recordedAt: string;
  ignoredOperationIds?: string[];
}

export interface DocumentRecoveryResult {
  document: KDrawDocumentV1 | null;
  source: "operation-log" | "snapshot" | "document" | "none";
  recoveredRevision: number | null;
  ignoredOperationIds: string[];
  corruptSnapshotKeys: string[];
  uncleanSessionIds: string[];
}

interface StoredAttachment {
  id: string;
  documentId: string;
  attachment: CadAttachmentRef;
  bytes: Uint8Array;
}

interface PendingAttachmentWrite {
  attachment: CadAttachmentRef;
  bytes: Uint8Array;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function documentSha256(document: KDrawDocumentV1): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(document)));
}

function validDocument(candidate: unknown): candidate is KDrawDocumentV1 {
  try {
    assertKDrawDocumentV1(candidate);
    return true;
  } catch {
    return false;
  }
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

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = DATABASE_NAME,
  ) {
    if (!databaseName.trim()) throw new TypeError("IndexedDB database name is required.");
  }

  async open(): Promise<void> {
    if (this.#database) return;
    const request = this.factory.open(this.databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents", { keyPath: "documentId" });
      let operationStore: IDBObjectStore;
      if (!database.objectStoreNames.contains("operations")) {
        operationStore = database.createObjectStore("operations", { keyPath: "opId" });
      } else operationStore = request.transaction!.objectStore("operations");
      if (!operationStore.indexNames.contains("byDocument")) operationStore.createIndex("byDocument", "documentId");
      let snapshotStore: IDBObjectStore;
      if (!database.objectStoreNames.contains("snapshots")) snapshotStore = database.createObjectStore("snapshots", { keyPath: "key" });
      else snapshotStore = request.transaction!.objectStore("snapshots");
      if (!snapshotStore.indexNames.contains("byDocument")) snapshotStore.createIndex("byDocument", "documentId");
      if (!database.objectStoreNames.contains("attachments")) database.createObjectStore("attachments", { keyPath: "id" });
      if (!database.objectStoreNames.contains("recoveryEvents")) {
        const recoveryStore = database.createObjectStore("recoveryEvents", { keyPath: "eventId" });
        recoveryStore.createIndex("byDocument", "documentId");
      }
    };
    this.#database = await requestResult(request);
  }

  async saveSnapshot(document: KDrawDocumentV1): Promise<void> {
    await this.open();
    assertKDrawDocumentV1(document);
    const digest = await documentSha256(document);
    const transaction = this.#database!.transaction(["documents", "snapshots"], "readwrite");
    transaction.objectStore("documents").put(structuredClone(document));
    transaction.objectStore("snapshots").add({
      key: `${document.documentId}:${String(document.revision).padStart(12, "0")}:snapshot:${crypto.randomUUID()}`,
      documentId: document.documentId,
      revision: document.revision,
      document: structuredClone(document),
      sha256: digest,
      recordedAt: new Date().toISOString(),
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
    await this.commitRevisionRecord(document, operation);
  }

  async commitRevisionWithAttachment(
    document: KDrawDocumentV1,
    operation: CadOperation,
    attachment: CadAttachmentRef,
    bytes: Uint8Array,
  ): Promise<void> {
    const copy = Uint8Array.from(bytes);
    if ((await sha256(copy)) !== attachment.sha256.toLowerCase()) {
      throw new TypeError(`Attachment ${attachment.id} checksum mismatch before atomic commit.`);
    }
    const documentAttachment = document.attachments.find((candidate) => candidate.id === attachment.id);
    if (!documentAttachment || JSON.stringify(documentAttachment) !== JSON.stringify(attachment)) {
      throw new TypeError(`Document ${document.documentId} does not contain the exact attachment ${attachment.id}.`);
    }
    await this.commitRevisionRecord(document, operation, { attachment: structuredClone(attachment), bytes: copy });
  }

  private async commitRevisionRecord(
    document: KDrawDocumentV1,
    operation: CadOperation,
    pendingAttachment?: PendingAttachmentWrite,
  ): Promise<void> {
    await this.open();
    assertKDrawDocumentV1(document);
    const expectedCurrent = await this.loadDocument(document.documentId);
    const beforeSha256 = expectedCurrent ? await documentSha256(expectedCurrent) : null;
    const afterSha256 = await documentSha256(document);
    const transaction = this.#database!.transaction(
      pendingAttachment ? ["documents", "snapshots", "operations", "attachments"] : ["documents", "snapshots", "operations"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    const current = await requestResult(transaction.objectStore("documents").get(document.documentId)) as KDrawDocumentV1 | undefined;
    const actualRevision = current?.revision ?? 0;
    if (actualRevision !== operation.baseRevision || document.revision !== operation.baseRevision + 1) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new StorageRevisionConflictError(document.documentId, operation.baseRevision, actualRevision);
    }
    if (JSON.stringify(current ?? null) !== JSON.stringify(expectedCurrent)) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new StorageRevisionConflictError(document.documentId, operation.baseRevision, actualRevision);
    }
    transaction.objectStore("documents").put(structuredClone(document));
    transaction.objectStore("snapshots").add({
      key: `${document.documentId}:${String(document.revision).padStart(12, "0")}:operation:${operation.opId}`,
      documentId: document.documentId,
      revision: document.revision,
      document: structuredClone(document),
      sha256: afterSha256,
      recordedAt: new Date().toISOString(),
    });
    const record: StoredOperation = {
      opId: operation.opId,
      documentId: document.documentId,
      revision: document.revision,
      operation: structuredClone(operation),
      recordedAt: new Date().toISOString(),
      beforeSha256,
      afterSha256,
      afterDocument: structuredClone(document),
    };
    transaction.objectStore("operations").add(record);
    if (pendingAttachment) {
      transaction.objectStore("attachments").add({
        id: `${document.documentId}:${pendingAttachment.attachment.id}`,
        documentId: document.documentId,
        attachment: structuredClone(pendingAttachment.attachment),
        bytes: Uint8Array.from(pendingAttachment.bytes),
      } satisfies StoredAttachment);
    }
    await done;
  }

  async operations(documentId: string): Promise<StoredOperation[]> {
    await this.open();
    const transaction = this.#database!.transaction("operations", "readonly");
    const records = await requestResult(transaction.objectStore("operations").index("byDocument").getAll(documentId));
    await transactionDone(transaction);
    return structuredClone((records as StoredOperation[]).sort((a, b) => (
      a.revision - b.revision || a.recordedAt.localeCompare(b.recordedAt) || a.opId.localeCompare(b.opId)
    )));
  }

  async snapshots(documentId: string): Promise<StoredSnapshot[]> {
    await this.open();
    const transaction = this.#database!.transaction("snapshots", "readonly");
    const records = await requestResult(transaction.objectStore("snapshots").index("byDocument").getAll(documentId));
    await transactionDone(transaction);
    return structuredClone((records as StoredSnapshot[]).sort((a, b) => a.revision - b.revision || a.key.localeCompare(b.key)));
  }

  async recordRecoveryOpen(documentId: string, sessionId: string, recordedAt = new Date().toISOString()): Promise<void> {
    await this.recordRecoveryEvent({ documentId, sessionId, kind: "open", revision: null, recordedAt });
  }

  async recordRecoveryClean(documentId: string, sessionId: string, revision: number, recordedAt = new Date().toISOString()): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError("Clean recovery revision must be a non-negative integer.");
    const current = await this.loadDocument(documentId);
    if (!current || current.revision !== revision) throw new StorageRevisionConflictError(documentId, revision, current?.revision ?? 0);
    await this.assertDocumentAttachmentsReadable(current);
    await this.recordRecoveryEvent({ documentId, sessionId, kind: "clean", revision, recordedAt });
  }

  async acceptRecoveredDocument(
    document: KDrawDocumentV1,
    sessionId: string,
    ignoredOperationIds: readonly string[],
    recordedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.open();
    assertKDrawDocumentV1(document);
    const ignored = [...new Set(ignoredOperationIds)];
    if (ignored.length === 0) return;
    const current = await this.loadDocument(document.documentId);
    if (current && JSON.stringify(current) === JSON.stringify(document)) return;
    const recovery = await this.recoverDocument(document.documentId);
    if (!recovery.document || recovery.recoveredRevision !== document.revision || JSON.stringify(recovery.document) !== JSON.stringify(document)) {
      throw new StorageRevisionConflictError(document.documentId, document.revision, recovery.recoveredRevision ?? 0);
    }
    const missingIgnored = ignored.filter((opId) => !recovery.ignoredOperationIds.includes(opId));
    if (missingIgnored.length > 0) throw new TypeError(`Recovery boundary contains unknown ignored operations: ${missingIgnored.join(", ")}.`);
    const transaction = this.#database!.transaction(["documents", "recoveryEvents"], "readwrite");
    const done = transactionDone(transaction);
    const transactionCurrent = await requestResult(transaction.objectStore("documents").get(document.documentId)) as KDrawDocumentV1 | undefined;
    if (JSON.stringify(transactionCurrent ?? null) !== JSON.stringify(current ?? null)) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new StorageRevisionConflictError(document.documentId, current?.revision ?? 0, transactionCurrent?.revision ?? 0);
    }
    transaction.objectStore("documents").put(structuredClone(document));
    transaction.objectStore("recoveryEvents").add({
      eventId: `${document.documentId}:${sessionId}:recover:${crypto.randomUUID()}`,
      documentId: document.documentId,
      sessionId,
      kind: "recover",
      revision: document.revision,
      recordedAt,
      ignoredOperationIds: ignored,
    } satisfies RecoveryEvent);
    await done;
  }

  private async recordRecoveryEvent(input: Omit<RecoveryEvent, "eventId">): Promise<void> {
    await this.open();
    if (!input.documentId.trim() || !input.sessionId.trim()) throw new TypeError("Recovery document and session ids are required.");
    const transaction = this.#database!.transaction("recoveryEvents", "readwrite");
    transaction.objectStore("recoveryEvents").add({
      ...input,
      eventId: `${input.documentId}:${input.sessionId}:${input.kind}:${crypto.randomUUID()}`,
    } satisfies RecoveryEvent);
    await transactionDone(transaction);
  }

  async recoverDocument(documentId: string): Promise<DocumentRecoveryResult> {
    await this.open();
    const [operations, snapshots, mutableDocument, recoveryEvents] = await Promise.all([
      this.operations(documentId),
      this.snapshots(documentId),
      this.loadDocument(documentId),
      this.loadRecoveryEvents(documentId),
    ]);
    const corruptSnapshotKeys: string[] = [];
    const validSnapshots: StoredSnapshot[] = [];
    for (const snapshot of snapshots) {
      if (!validDocument(snapshot.document) || snapshot.document.documentId !== documentId || snapshot.document.revision !== snapshot.revision) {
        corruptSnapshotKeys.push(snapshot.key); continue;
      }
      if (snapshot.sha256 && await documentSha256(snapshot.document) !== snapshot.sha256) {
        corruptSnapshotKeys.push(snapshot.key); continue;
      }
      validSnapshots.push(snapshot);
    }

    const quarantinedOperationIds = new Set(recoveryEvents
      .filter((event) => event.kind === "recover")
      .flatMap((event) => event.ignoredOperationIds ?? []));
    const activeOperations = operations.filter((record) => !quarantinedOperationIds.has(record.opId));
    let replayed: KDrawDocumentV1 | null = null;
    const hasEnhancedOperationRecords = activeOperations.some((record) => Boolean(record.afterDocument && record.afterSha256 && record.beforeSha256 !== undefined));
    let previousSha256: string | null = validSnapshots.find((snapshot) => snapshot.revision === 0)?.sha256 ?? null;
    let expectedRevision = 1;
    let failedIndex = activeOperations.length;
    for (let index = 0; index < activeOperations.length; index += 1) {
      const record = activeOperations[index]!;
      if (!record.afterDocument || !record.afterSha256 || record.beforeSha256 === undefined) {
        failedIndex = index; break;
      }
      const valid = record.documentId === documentId
        && record.revision === expectedRevision
        && record.operation.baseRevision === expectedRevision - 1
        && record.afterDocument.documentId === documentId
        && record.afterDocument.revision === expectedRevision
        && record.beforeSha256 === previousSha256
        && await documentSha256(record.afterDocument) === record.afterSha256;
      if (!valid) { failedIndex = index; break; }
      replayed = structuredClone(record.afterDocument);
      previousSha256 = record.afterSha256;
      expectedRevision += 1;
    }
    const newlyIgnoredOperationIds = new Set(activeOperations.slice(failedIndex).map((record) => record.opId));
    const ignoredOperationIds = operations
      .filter((record) => quarantinedOperationIds.has(record.opId) || newlyIgnoredOperationIds.has(record.opId))
      .map((record) => record.opId);
    let document: KDrawDocumentV1 | null = null;
    let source: DocumentRecoveryResult["source"] = "none";
    if (replayed) {
      document = replayed; source = "operation-log";
    } else if (validSnapshots.length > 0) {
      const firstRejectedRevision = activeOperations[failedIndex]?.revision ?? Number.POSITIVE_INFINITY;
      const eligibleSnapshots = hasEnhancedOperationRecords
        ? validSnapshots.filter((snapshot) => snapshot.revision < firstRejectedRevision)
        : validSnapshots;
      if (eligibleSnapshots.length > 0) {
        document = structuredClone(eligibleSnapshots.at(-1)!.document); source = "snapshot";
      }
    } else if (activeOperations.length === 0 && mutableDocument && validDocument(mutableDocument)) {
      document = structuredClone(mutableDocument); source = "document";
    }
    const sessions = new Map<string, number>();
    for (const event of recoveryEvents.sort((first, second) => (
      first.recordedAt.localeCompare(second.recordedAt) || first.eventId.localeCompare(second.eventId)
    ))) {
      if (event.kind === "recover") continue;
      const openDepth = sessions.get(event.sessionId) ?? 0;
      sessions.set(event.sessionId, event.kind === "open" ? openDepth + 1 : Math.max(0, openDepth - 1));
    }
    const uncleanSessionIds = [...sessions.entries()].filter(([, openDepth]) => openDepth > 0).map(([sessionId]) => sessionId).sort();
    return {
      document,
      source,
      recoveredRevision: document?.revision ?? null,
      ignoredOperationIds,
      corruptSnapshotKeys,
      uncleanSessionIds,
    };
  }

  private async loadRecoveryEvents(documentId: string): Promise<RecoveryEvent[]> {
    await this.open();
    const transaction = this.#database!.transaction("recoveryEvents", "readonly");
    const records = await requestResult(transaction.objectStore("recoveryEvents").index("byDocument").getAll(documentId));
    await transactionDone(transaction);
    return structuredClone(records as RecoveryEvent[]);
  }

  async saveAttachment(documentId: string, attachment: CadAttachmentRef, bytes: Uint8Array): Promise<void> {
    await this.open();
    if (!documentId.trim() || !attachment.id.trim()) throw new TypeError("Attachment document and attachment ids are required.");
    const copy = Uint8Array.from(bytes);
    if ((await sha256(copy)) !== attachment.sha256.toLowerCase()) throw new TypeError(`Attachment ${attachment.id} checksum mismatch before storage.`);
    const transaction = this.#database!.transaction("attachments", "readwrite");
    const record: StoredAttachment = {
      id: `${documentId}:${attachment.id}`,
      documentId,
      attachment: structuredClone(attachment),
      bytes: copy,
    };
    transaction.objectStore("attachments").add(record);
    await transactionDone(transaction);
  }

  async loadAttachment(documentId: string, attachmentId: string): Promise<{ attachment: CadAttachmentRef; bytes: Uint8Array } | null> {
    await this.open();
    const transaction = this.#database!.transaction("attachments", "readonly");
    const result = await requestResult(transaction.objectStore("attachments").get(`${documentId}:${attachmentId}`)) as StoredAttachment | undefined;
    await transactionDone(transaction);
    if (!result) return null;
    const bytes = Uint8Array.from(result.bytes);
    if ((await sha256(bytes)) !== result.attachment.sha256.toLowerCase()) throw new TypeError(`Stored attachment ${attachmentId} checksum mismatch.`);
    return { attachment: structuredClone(result.attachment), bytes };
  }

  async assertDocumentAttachmentsReadable(document: KDrawDocumentV1): Promise<void> {
    assertKDrawDocumentV1(document);
    for (const attachment of document.attachments) {
      const stored = await this.loadAttachment(document.documentId, attachment.id);
      if (!stored) throw new TypeError(`Stored attachment ${attachment.id} is missing for document ${document.documentId}.`);
      if (JSON.stringify(stored.attachment) !== JSON.stringify(attachment)) {
        throw new TypeError(`Stored attachment ${attachment.id} metadata does not match document ${document.documentId}.`);
      }
    }
  }

  close(): void {
    this.#database?.close();
    this.#database = null;
  }
}
