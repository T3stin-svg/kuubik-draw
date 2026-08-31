import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument, type CadSessionHistoryState } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import {
  KDrawIndexedDb,
  StoragePersistenceError,
  normalizeStorageFailure,
} from "../../indexed-db.js";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function commitRevisions(database: KDrawIndexedDb, documentId: string, count: number): Promise<void> {
  let document = createEmptyDocument({ documentId, now: "2026-08-31T10:00:00Z" });
  const history: CadSessionHistoryState = { sequence: 0, undo: [], redo: [] };
  for (let revision = 1; revision <= count; revision += 1) {
    document = structuredClone(document);
    document.revision = revision;
    await database.commitRevision(document, {
      opId: `${documentId}-op-${revision}`,
      baseRevision: revision - 1,
      commandId: "LINE",
      args: { revision },
      targetHandles: [],
      resultHandles: [],
    }, history);
  }
}

describe("F-133 controlled snapshot compaction", () => {
  it("compacts one document without deleting either document operation log", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "compaction-multi-document");
    await commitRevisions(database, "alpha", 2);
    await commitRevisions(database, "beta", 1);

    const compacted = await database.compactDocument("alpha", { minimumOperations: 2 }, "2026-08-31T10:10:00Z");
    const skipped = await database.compactDocument("beta", { minimumOperations: 2 }, "2026-08-31T10:10:00Z");

    expect(compacted).toEqual(expect.objectContaining({
      status: "compacted",
      documentId: "alpha",
      revision: 2,
      operationCount: 2,
      readBackVerified: true,
    }));
    expect(skipped).toEqual({
      status: "skipped",
      documentId: "beta",
      revision: 1,
      operationCount: 1,
      compactionKey: null,
      snapshotKey: null,
      readBackVerified: false,
    });
    expect(await database.operations("alpha")).toHaveLength(2);
    expect(await database.operations("beta")).toHaveLength(1);
    expect(await database.compactions("beta")).toEqual([]);
    expect(await database.recoverDocument("alpha")).toEqual(expect.objectContaining({
      source: "compaction",
      recoveredRevision: 2,
      sessionHistory: { sequence: 0, undo: [], redo: [] },
      receipt: expect.objectContaining({ code: "RECOVERY_CLEAN", compactionKey: compacted.compactionKey }),
    }));
    database.close();
  });

  it("falls back to the complete SHA operation chain when a compaction snapshot is corrupt", async () => {
    const factory = new IDBFactory();
    const databaseName = "compaction-corrupt-snapshot";
    const database = new KDrawIndexedDb(factory, databaseName);
    await commitRevisions(database, "alpha", 2);
    const compacted = await database.compactDocument("alpha", { minimumOperations: 2 }, "2026-08-31T10:10:00Z");

    const raw = await requestResult(factory.open(databaseName));
    const transaction = raw.transaction("snapshots", "readwrite");
    const store = transaction.objectStore("snapshots");
    const snapshot = await requestResult<any>(store.get(compacted.snapshotKey!));
    snapshot.sha256 = "0".repeat(64);
    store.put(snapshot);
    await transactionDone(transaction);
    raw.close();

    const recovery = await database.recoverDocument("alpha");
    expect(recovery).toEqual(expect.objectContaining({
      source: "operation-log",
      recoveredRevision: 2,
      corruptSnapshotKeys: [compacted.snapshotKey],
      corruptCompactionKeys: [compacted.compactionKey],
      receipt: expect.objectContaining({ code: "RECOVERY_DEGRADED", status: "degraded" }),
    }));
    database.close();
  });

  it("fails closed on an incomplete tail and produces an idempotent golden recovery receipt", async () => {
    const factory = new IDBFactory();
    const databaseName = "compaction-incomplete-tail";
    const database = new KDrawIndexedDb(factory, databaseName);
    await commitRevisions(database, "alpha", 2);
    const compacted = await database.compactDocument("alpha", { minimumOperations: 2 }, "2026-08-31T10:10:00Z");
    const raw = await requestResult(factory.open(databaseName));
    const transaction = raw.transaction("operations", "readwrite");
    transaction.objectStore("operations").add({
      opId: "alpha-incomplete-3",
      documentId: "alpha",
      revision: 3,
      operation: { opId: "alpha-incomplete-3", baseRevision: 2, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] },
      recordedAt: "2026-08-31T10:11:00Z",
    });
    await transactionDone(transaction);
    raw.close();

    const first = await database.recoverDocument("alpha");
    expect(first.receipt).toEqual({
      code: "RECOVERY_DEGRADED",
      status: "degraded",
      documentId: "alpha",
      recoveredRevision: 2,
      source: "compaction",
      ignoredOperationIds: ["alpha-incomplete-3"],
      corruptSnapshotKeys: [],
      corruptCompactionKeys: [],
      uncleanSessionIds: [],
      compactionKey: compacted.compactionKey,
      summaryEt: "Taastati revisjon 2; 1 vigast operatsiooni jäeti rakendamata.",
    });
    await database.acceptRecoveredDocument(first.document!, "recovery-session", first.ignoredOperationIds, "2026-08-31T10:12:00Z");
    await database.acceptRecoveredDocument(first.document!, "recovery-session", first.ignoredOperationIds, "2026-08-31T10:12:01Z");
    const second = await database.recoverDocument("alpha");
    expect(second.document).toEqual(first.document);
    expect(second.receipt).toEqual(first.receipt);
    expect(await database.operations("alpha")).toHaveLength(3);
    database.close();
  });

  it("rejects a mutated compaction record and replays from the immutable operation log", async () => {
    const factory = new IDBFactory();
    const databaseName = "compaction-mutated-record";
    const database = new KDrawIndexedDb(factory, databaseName);
    await commitRevisions(database, "alpha", 2);
    const compacted = await database.compactDocument("alpha", { minimumOperations: 2 });
    const raw = await requestResult(factory.open(databaseName));
    const transaction = raw.transaction("compactions", "readwrite");
    const store = transaction.objectStore("compactions");
    const record = await requestResult<any>(store.get(compacted.compactionKey!));
    record.operationCount = 1;
    store.put(record);
    await transactionDone(transaction);
    raw.close();

    expect(await database.recoverDocument("alpha")).toEqual(expect.objectContaining({
      source: "operation-log",
      recoveredRevision: 2,
      corruptCompactionKeys: [compacted.compactionKey],
    }));
    database.close();
  });
});

describe("F-133 storage failure and rollback contract", () => {
  it("normalizes quota and abort failures into stable fail-closed codes", () => {
    expect(normalizeStorageFailure(new DOMException("full", "QuotaExceededError"))).toEqual(expect.objectContaining({
      code: "STORAGE_QUOTA_EXCEEDED",
    }));
    expect(normalizeStorageFailure(new DOMException("aborted", "AbortError"))).toEqual(expect.objectContaining({
      code: "STORAGE_TRANSACTION_ABORTED",
    }));
  });

  it("rolls back document, snapshot and operation stores after a transaction abort", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "compaction-atomic-abort");
    await commitRevisions(database, "alpha", 1);
    const beforeDocument = await database.loadDocument("alpha");
    const beforeSnapshots = await database.snapshots("alpha");
    const conflicting = structuredClone(beforeDocument!);
    conflicting.revision = 2;

    await expect(database.commitRevision(conflicting, {
      opId: "alpha-op-1",
      baseRevision: 1,
      commandId: "CIRCLE",
      args: {},
      targetHandles: [],
      resultHandles: [],
    })).rejects.toEqual(expect.objectContaining<Partial<StoragePersistenceError>>({
      code: "STORAGE_TRANSACTION_ABORTED",
    }));
    expect(await database.loadDocument("alpha")).toEqual(beforeDocument);
    expect(await database.snapshots("alpha")).toEqual(beforeSnapshots);
    expect(await database.operations("alpha")).toHaveLength(1);
    database.close();
  });
});
