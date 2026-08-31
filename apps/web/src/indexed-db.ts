import { assertCadSessionHistoryState, type CadSessionHistoryState } from "@kuubik/cad-core";
import { assertKDrawDocumentV1, type CadAttachmentRef, type CadOperation, type KDrawDocumentV1 } from "@kuubik/cad-schema";

const DATABASE_NAME = "kuubik-draw";
const DATABASE_VERSION = 3;

export interface StoredOperation {
  opId: string;
  documentId: string;
  revision: number;
  operation: CadOperation;
  recordedAt: string;
  beforeSha256?: string | null;
  afterSha256?: string;
  afterDocument?: KDrawDocumentV1;
  sessionHistory?: CadSessionHistoryState;
  sessionHistorySha256?: string;
}

export interface StoredSnapshot {
  key: string;
  documentId: string;
  revision: number;
  document: KDrawDocumentV1;
  sha256?: string;
  recordedAt?: string;
}

export interface StoredCompaction {
  key: string;
  documentId: string;
  revision: number;
  snapshotKey: string;
  documentSha256: string;
  operationCount: number;
  lastOperationId: string | null;
  sessionHistory?: CadSessionHistoryState;
  sessionHistorySha256?: string;
  recordedAt: string;
  recordSha256: string;
}

export interface SnapshotCompactionPolicy {
  minimumOperations: number;
}

export interface SnapshotCompactionResult {
  status: "compacted" | "skipped";
  documentId: string;
  revision: number;
  operationCount: number;
  compactionKey: string | null;
  snapshotKey: string | null;
  readBackVerified: boolean;
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
  source: "operation-log" | "compaction" | "snapshot" | "document" | "none";
  recoveredRevision: number | null;
  ignoredOperationIds: string[];
  corruptSnapshotKeys: string[];
  corruptCompactionKeys: string[];
  uncleanSessionIds: string[];
  sessionHistory: CadSessionHistoryState | null;
  receipt: RecoveryReceipt;
}

export interface RecoveryReceipt {
  code: "RECOVERY_CLEAN" | "RECOVERY_REPLAYED" | "RECOVERY_DEGRADED" | "RECOVERY_EMPTY";
  status: "clean" | "recovered" | "degraded" | "empty";
  documentId: string;
  recoveredRevision: number | null;
  source: DocumentRecoveryResult["source"];
  ignoredOperationIds: string[];
  corruptSnapshotKeys: string[];
  corruptCompactionKeys: string[];
  uncleanSessionIds: string[];
  compactionKey: string | null;
  summaryEt: string;
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

async function sessionHistorySha256(history: CadSessionHistoryState): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(history)));
}

async function compactionSha256(record: Omit<StoredCompaction, "recordSha256">): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(record)));
}

async function validSessionHistory(record: StoredOperation): Promise<boolean> {
  if (record.sessionHistory === undefined && record.sessionHistorySha256 === undefined) return true;
  if (record.sessionHistory === undefined || record.sessionHistorySha256 === undefined) return false;
  try {
    assertCadSessionHistoryState(record.sessionHistory);
    return await sessionHistorySha256(record.sessionHistory) === record.sessionHistorySha256;
  } catch {
    return false;
  }
}

async function validCompactionHistory(record: StoredCompaction): Promise<boolean> {
  if (record.sessionHistory === undefined && record.sessionHistorySha256 === undefined) return true;
  if (record.sessionHistory === undefined || record.sessionHistorySha256 === undefined) return false;
  try {
    assertCadSessionHistoryState(record.sessionHistory);
    return await sessionHistorySha256(record.sessionHistory) === record.sessionHistorySha256;
  } catch {
    return false;
  }
}

function historyReferencesKnownOperations(record: StoredOperation, knownOperationIds: ReadonlySet<string>): boolean {
  return !record.sessionHistory || [...record.sessionHistory.undo, ...record.sessionHistory.redo]
    .every((committed) => knownOperationIds.has(committed.operation.opId));
}

function recoveryReceipt(
  documentId: string,
  source: DocumentRecoveryResult["source"],
  recoveredRevision: number | null,
  ignoredOperationIds: string[],
  corruptSnapshotKeys: string[],
  corruptCompactionKeys: string[],
  uncleanSessionIds: string[],
  compactionKey: string | null,
): RecoveryReceipt {
  const degraded = ignoredOperationIds.length > 0 || corruptSnapshotKeys.length > 0 || corruptCompactionKeys.length > 0;
  if (recoveredRevision === null) {
    return {
      code: degraded ? "RECOVERY_DEGRADED" : "RECOVERY_EMPTY",
      status: degraded ? "degraded" : "empty",
      documentId,
      recoveredRevision,
      source,
      ignoredOperationIds: [...ignoredOperationIds],
      corruptSnapshotKeys: [...corruptSnapshotKeys],
      corruptCompactionKeys: [...corruptCompactionKeys],
      uncleanSessionIds: [...uncleanSessionIds],
      compactionKey,
      summaryEt: degraded
        ? "Dokumenti ei taastatud, sest püsisalvestuse kontroll ebaõnnestus. Vigane saba jäeti rakendamata."
        : "Dokumendil puudub taastatav salvestus.",
    };
  }
  const status = degraded ? "degraded" : uncleanSessionIds.length > 0 ? "recovered" : "clean";
  const code = degraded ? "RECOVERY_DEGRADED" : uncleanSessionIds.length > 0 ? "RECOVERY_REPLAYED" : "RECOVERY_CLEAN";
  const summaryEt = degraded
    ? `Taastati revisjon ${recoveredRevision}; ${ignoredOperationIds.length} vigast operatsiooni jäeti rakendamata.`
    : uncleanSessionIds.length > 0
      ? `Pärast katkestust taastati revisjon ${recoveredRevision}.`
      : `Revisjon ${recoveredRevision} kontrolliti ja avati muutmata kujul.`;
  return {
    code,
    status,
    documentId,
    recoveredRevision,
    source,
    ignoredOperationIds: [...ignoredOperationIds],
    corruptSnapshotKeys: [...corruptSnapshotKeys],
    corruptCompactionKeys: [...corruptCompactionKeys],
    uncleanSessionIds: [...uncleanSessionIds],
    compactionKey,
    summaryEt,
  };
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

export class StoragePersistenceError extends Error {
  constructor(
    readonly code: "STORAGE_QUOTA_EXCEEDED" | "STORAGE_TRANSACTION_ABORTED" | "STORAGE_REQUEST_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StoragePersistenceError";
  }
}

export function normalizeStorageFailure(error: unknown, fallbackMessage = "IndexedDB storage request failed."): StoragePersistenceError {
  if (error instanceof StoragePersistenceError) return error;
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  const cause = error instanceof Error ? error : undefined;
  if (name === "QuotaExceededError") {
    return new StoragePersistenceError("STORAGE_QUOTA_EXCEEDED", "IndexedDB storage quota was exceeded; no partial revision was accepted.", { cause });
  }
  if (name === "AbortError" || name === "ConstraintError") {
    return new StoragePersistenceError("STORAGE_TRANSACTION_ABORTED", "IndexedDB transaction was aborted; no partial revision was accepted.", { cause });
  }
  return new StoragePersistenceError("STORAGE_REQUEST_FAILED", cause?.message || fallbackMessage, { cause });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => undefined;
    transaction.onabort = () => reject(normalizeStorageFailure(transaction.error ?? new DOMException("Transaction aborted.", "AbortError")));
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
      if (!database.objectStoreNames.contains("compactions")) {
        const compactionStore = database.createObjectStore("compactions", { keyPath: "key" });
        compactionStore.createIndex("byDocument", "documentId");
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

  async commitRevision(
    document: KDrawDocumentV1,
    operation: CadOperation,
    sessionHistory?: CadSessionHistoryState,
  ): Promise<void> {
    await this.commitRevisionRecord(document, operation, undefined, sessionHistory);
  }

  async commitRevisionWithAttachment(
    document: KDrawDocumentV1,
    operation: CadOperation,
    attachment: CadAttachmentRef,
    bytes: Uint8Array,
    sessionHistory?: CadSessionHistoryState,
  ): Promise<void> {
    const copy = Uint8Array.from(bytes);
    if ((await sha256(copy)) !== attachment.sha256.toLowerCase()) {
      throw new TypeError(`Attachment ${attachment.id} checksum mismatch before atomic commit.`);
    }
    const documentAttachment = document.attachments.find((candidate) => candidate.id === attachment.id);
    if (!documentAttachment || JSON.stringify(documentAttachment) !== JSON.stringify(attachment)) {
      throw new TypeError(`Document ${document.documentId} does not contain the exact attachment ${attachment.id}.`);
    }
    await this.commitRevisionRecord(document, operation, { attachment: structuredClone(attachment), bytes: copy }, sessionHistory);
  }

  private async commitRevisionRecord(
    document: KDrawDocumentV1,
    operation: CadOperation,
    pendingAttachment?: PendingAttachmentWrite,
    sessionHistory?: CadSessionHistoryState,
  ): Promise<void> {
    await this.open();
    assertKDrawDocumentV1(document);
    const expectedCurrent = await this.loadDocument(document.documentId);
    const beforeSha256 = expectedCurrent ? await documentSha256(expectedCurrent) : null;
    const afterSha256 = await documentSha256(document);
    if (sessionHistory) assertCadSessionHistoryState(sessionHistory);
    const historySha256 = sessionHistory ? await sessionHistorySha256(sessionHistory) : undefined;
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
      ...(sessionHistory ? {
        sessionHistory: structuredClone(sessionHistory),
        sessionHistorySha256: historySha256!,
      } : {}),
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

  async compactions(documentId: string): Promise<StoredCompaction[]> {
    await this.open();
    const transaction = this.#database!.transaction("compactions", "readonly");
    const records = await requestResult(transaction.objectStore("compactions").index("byDocument").getAll(documentId));
    await transactionDone(transaction);
    return structuredClone((records as StoredCompaction[]).sort((a, b) => a.revision - b.revision || a.key.localeCompare(b.key)));
  }

  async compactDocument(
    documentId: string,
    policy: SnapshotCompactionPolicy,
    recordedAt = new Date().toISOString(),
  ): Promise<SnapshotCompactionResult> {
    await this.open();
    if (!documentId.trim()) throw new TypeError("Compaction document id is required.");
    if (!Number.isSafeInteger(policy.minimumOperations) || policy.minimumOperations < 1) {
      throw new RangeError("Compaction minimumOperations must be a positive integer.");
    }
    const recovery = await this.recoverDocument(documentId);
    if (!recovery.document) throw new TypeError(`Document ${documentId} has no recoverable revision to compact.`);
    if (recovery.ignoredOperationIds.length > 0 || recovery.corruptSnapshotKeys.length > 0 || recovery.corruptCompactionKeys.length > 0) {
      throw new TypeError(`Document ${documentId} recovery is degraded; compaction is fail-closed.`);
    }
    const operations = (await this.operations(documentId)).filter((record) => record.revision <= recovery.document!.revision);
    if (operations.length < policy.minimumOperations) {
      return {
        status: "skipped",
        documentId,
        revision: recovery.document.revision,
        operationCount: operations.length,
        compactionKey: null,
        snapshotKey: null,
        readBackVerified: false,
      };
    }
    const digest = await documentSha256(recovery.document);
    const uniqueId = crypto.randomUUID();
    const snapshotKey = `${documentId}:${String(recovery.document.revision).padStart(12, "0")}:compaction:${uniqueId}`;
    const compactionKey = `${documentId}:${String(recovery.document.revision).padStart(12, "0")}:${uniqueId}`;
    const history = recovery.sessionHistory ? structuredClone(recovery.sessionHistory) : undefined;
    const recordWithoutSha: Omit<StoredCompaction, "recordSha256"> = {
      key: compactionKey,
      documentId,
      revision: recovery.document.revision,
      snapshotKey,
      documentSha256: digest,
      operationCount: operations.length,
      lastOperationId: operations.at(-1)?.opId ?? null,
      ...(history ? {
        sessionHistory: history,
        sessionHistorySha256: await sessionHistorySha256(history),
      } : {}),
      recordedAt,
    };
    const record: StoredCompaction = { ...recordWithoutSha, recordSha256: await compactionSha256(recordWithoutSha) };
    const transaction = this.#database!.transaction(["snapshots", "compactions"], "readwrite");
    transaction.objectStore("snapshots").add({
      key: snapshotKey,
      documentId,
      revision: recovery.document.revision,
      document: structuredClone(recovery.document),
      sha256: digest,
      recordedAt,
    } satisfies StoredSnapshot);
    transaction.objectStore("compactions").add(record);
    await transactionDone(transaction);

    const [readBackCompaction, readBackSnapshots] = await Promise.all([
      this.compactions(documentId),
      this.snapshots(documentId),
    ]);
    const storedRecord = readBackCompaction.find((candidate) => candidate.key === compactionKey);
    const storedSnapshot = readBackSnapshots.find((candidate) => candidate.key === snapshotKey);
    const storedRecordSha = storedRecord?.recordSha256;
    const storedRecordWithoutSha = storedRecord ? structuredClone(storedRecord) as Partial<StoredCompaction> : null;
    if (storedRecordWithoutSha) delete storedRecordWithoutSha.recordSha256;
    if (!storedRecord || !storedSnapshot
      || await compactionSha256(storedRecordWithoutSha as Omit<StoredCompaction, "recordSha256">) !== storedRecordSha
      || await documentSha256(storedSnapshot.document) !== digest
      || JSON.stringify(storedSnapshot.document) !== JSON.stringify(recovery.document)) {
      throw new StoragePersistenceError("STORAGE_REQUEST_FAILED", `Compaction ${compactionKey} failed independent read-back verification.`);
    }
    return {
      status: "compacted",
      documentId,
      revision: recovery.document.revision,
      operationCount: operations.length,
      compactionKey,
      snapshotKey,
      readBackVerified: true,
    };
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
    const recoveryEvents = await this.loadRecoveryEvents(document.documentId);
    const alreadyQuarantined = new Set(recoveryEvents
      .filter((event) => event.kind === "recover")
      .flatMap((event) => event.ignoredOperationIds ?? []));
    const missingQuarantineIds = ignored.filter((opId) => !alreadyQuarantined.has(opId));
    if (current && JSON.stringify(current) === JSON.stringify(document) && missingQuarantineIds.length === 0) return;
    const recovery = await this.recoverDocument(document.documentId);
    if (!recovery.document || recovery.recoveredRevision !== document.revision || JSON.stringify(recovery.document) !== JSON.stringify(document)) {
      throw new StorageRevisionConflictError(document.documentId, document.revision, recovery.recoveredRevision ?? 0);
    }
    const missingIgnored = missingQuarantineIds.filter((opId) => !recovery.ignoredOperationIds.includes(opId));
    if (missingIgnored.length > 0) throw new TypeError(`Recovery boundary contains unknown ignored operations: ${missingIgnored.join(", ")}.`);
    const transaction = this.#database!.transaction(["documents", "recoveryEvents"], "readwrite");
    const done = transactionDone(transaction);
    const transactionCurrent = await requestResult(transaction.objectStore("documents").get(document.documentId)) as KDrawDocumentV1 | undefined;
    if (JSON.stringify(transactionCurrent ?? null) !== JSON.stringify(current ?? null)) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new StorageRevisionConflictError(document.documentId, current?.revision ?? 0, transactionCurrent?.revision ?? 0);
    }
    if (!transactionCurrent || JSON.stringify(transactionCurrent) !== JSON.stringify(document)) {
      transaction.objectStore("documents").put(structuredClone(document));
    }
    transaction.objectStore("recoveryEvents").add({
      eventId: `${document.documentId}:${sessionId}:recover:${crypto.randomUUID()}`,
      documentId: document.documentId,
      sessionId,
      kind: "recover",
      revision: document.revision,
      recordedAt,
      ignoredOperationIds: missingQuarantineIds,
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
    const [operations, snapshots, compactions, mutableDocument, recoveryEvents] = await Promise.all([
      this.operations(documentId),
      this.snapshots(documentId),
      this.compactions(documentId),
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

    const snapshotsByKey = new Map(validSnapshots.map((snapshot) => [snapshot.key, snapshot]));
    const corruptCompactionKeys: string[] = [];
    const validCompactions: StoredCompaction[] = [];
    for (const compaction of compactions) {
      const { recordSha256, ...recordWithoutSha } = compaction;
      const snapshot = snapshotsByKey.get(compaction.snapshotKey);
      const valid = compaction.documentId === documentId
        && Number.isSafeInteger(compaction.revision) && compaction.revision >= 0
        && Number.isSafeInteger(compaction.operationCount) && compaction.operationCount >= 0
        && Boolean(snapshot)
        && snapshot!.revision === compaction.revision
        && snapshot!.sha256 === compaction.documentSha256
        && await compactionSha256(recordWithoutSha) === recordSha256
        && await validCompactionHistory(compaction);
      if (!valid) { corruptCompactionKeys.push(compaction.key); continue; }
      validCompactions.push(compaction);
    }

    const quarantinedOperationIds = new Set(recoveryEvents
      .filter((event) => event.kind === "recover")
      .flatMap((event) => event.ignoredOperationIds ?? []));
    const activeOperations = operations.filter((record) => !quarantinedOperationIds.has(record.opId));
    let selectedCompaction: StoredCompaction | null = null;
    for (const candidate of [...validCompactions].reverse()) {
      const prefix = operations.filter((record) => record.revision <= candidate.revision);
      const quarantinedPrefix = prefix.some((record) => quarantinedOperationIds.has(record.opId));
      if (!quarantinedPrefix
        && prefix.length === candidate.operationCount
        && (prefix.at(-1)?.opId ?? null) === candidate.lastOperationId) {
        selectedCompaction = candidate;
        break;
      }
    }
    const anchorSnapshot = selectedCompaction ? snapshotsByKey.get(selectedCompaction.snapshotKey)! : null;
    let replayed: KDrawDocumentV1 | null = anchorSnapshot ? structuredClone(anchorSnapshot.document) : null;
    let replayedSessionHistory: CadSessionHistoryState | null = selectedCompaction?.sessionHistory
      ? structuredClone(selectedCompaction.sessionHistory)
      : null;
    const hasEnhancedOperationRecords = activeOperations.some((record) => Boolean(record.afterDocument && record.afterSha256 && record.beforeSha256 !== undefined));
    let previousSha256: string | null = selectedCompaction?.documentSha256
      ?? validSnapshots.find((snapshot) => snapshot.revision === 0)?.sha256
      ?? null;
    let expectedRevision = (selectedCompaction?.revision ?? 0) + 1;
    const replayOperations = activeOperations.filter((record) => record.revision >= expectedRevision);
    let failedIndex = replayOperations.length;
    for (let index = 0; index < replayOperations.length; index += 1) {
      const record = replayOperations[index]!;
      const knownOperationIds = new Set(activeOperations
        .filter((candidate) => candidate.revision <= record.revision)
        .map((candidate) => candidate.opId));
      if (!record.afterDocument || !record.afterSha256 || record.beforeSha256 === undefined) {
        failedIndex = index; break;
      }
      const valid = record.documentId === documentId
        && record.revision === expectedRevision
        && record.operation.baseRevision === expectedRevision - 1
        && record.afterDocument.documentId === documentId
        && record.afterDocument.revision === expectedRevision
        && record.beforeSha256 === previousSha256
        && await documentSha256(record.afterDocument) === record.afterSha256
        && await validSessionHistory(record)
        && historyReferencesKnownOperations(record, knownOperationIds);
      if (!valid) { failedIndex = index; break; }
      replayed = structuredClone(record.afterDocument);
      replayedSessionHistory = record.sessionHistory ? structuredClone(record.sessionHistory) : null;
      previousSha256 = record.afterSha256;
      expectedRevision += 1;
    }
    const newlyIgnoredOperationIds = new Set(replayOperations.slice(failedIndex).map((record) => record.opId));
    const ignoredOperationIds = operations
      .filter((record) => quarantinedOperationIds.has(record.opId) || newlyIgnoredOperationIds.has(record.opId))
      .map((record) => record.opId);
    let document: KDrawDocumentV1 | null = null;
    let source: DocumentRecoveryResult["source"] = "none";
    if (replayed) {
      document = replayed;
      source = selectedCompaction && failedIndex === 0 ? "compaction" : "operation-log";
    } else if (validSnapshots.length > 0) {
      const firstRejectedRevision = replayOperations[failedIndex]?.revision ?? Number.POSITIVE_INFINITY;
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
    const recoveredRevision = document?.revision ?? null;
    const receipt = recoveryReceipt(
      documentId,
      source,
      recoveredRevision,
      ignoredOperationIds,
      corruptSnapshotKeys,
      corruptCompactionKeys,
      uncleanSessionIds,
      selectedCompaction?.key ?? null,
    );
    return {
      document,
      source,
      recoveredRevision,
      ignoredOperationIds,
      corruptSnapshotKeys,
      corruptCompactionKeys,
      uncleanSessionIds,
      sessionHistory: source === "operation-log" || source === "compaction" ? replayedSessionHistory : null,
      receipt,
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
