import { createEmptyDocument } from "@kuubik/cad-core";
import { KDrawIndexedDb, type RecoveryReceipt, type SnapshotCompactionResult } from "../../indexed-db.js";

const DEFAULT_DATABASE_NAME = "kuubik-draw-recovery-compaction-harness";

export interface RecoveryCompactionSeedResult {
  phase: "seed";
  ok: true;
  compaction: SnapshotCompactionResult;
  alphaOperationCount: number;
  betaOperationCount: number;
}

export interface RecoveryCompactionReadbackResult {
  phase: "recover";
  ok: true;
  alphaReceipt: RecoveryReceipt;
  betaReceipt: RecoveryReceipt;
  alphaRevision: number;
  betaRevision: number;
  operationCounts: { alpha: number; beta: number };
  replayIdempotent: true;
}

async function deleteDatabase(factory: IDBFactory, databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked by an open connection."));
  });
}

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

async function commitRevision(database: KDrawIndexedDb, documentId: string, revision: number): Promise<void> {
  const prior = await database.loadDocument(documentId);
  const document = prior ?? createEmptyDocument({ documentId, now: "2026-08-31T18:00:00.000Z" });
  document.revision = revision;
  document.metadata.title = `${documentId}.kdraw`;
  await database.commitRevision(document, {
    opId: `${documentId}-op-${revision}`,
    baseRevision: revision - 1,
    commandId: "LINE",
    args: { revision },
    targetHandles: [],
    resultHandles: [],
  });
}

export async function seedRecoveryCompactionHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<RecoveryCompactionSeedResult> {
  await deleteDatabase(factory, databaseName);
  const database = new KDrawIndexedDb(factory, databaseName);
  await database.recordRecoveryOpen("alpha", "browser-crashed", "2026-08-31T18:00:00.000Z");
  await database.recordRecoveryOpen("beta", "browser-crashed", "2026-08-31T18:00:01.000Z");
  await commitRevision(database, "alpha", 1);
  await commitRevision(database, "alpha", 2);
  await commitRevision(database, "beta", 1);
  const compaction = await database.compactDocument("alpha", { minimumOperations: 2 }, "2026-08-31T18:01:00.000Z");

  const raw = await requestResult(factory.open(databaseName));
  const transaction = raw.transaction("operations", "readwrite");
  transaction.objectStore("operations").add({
    opId: "alpha-incomplete-browser-tail",
    documentId: "alpha",
    revision: 3,
    operation: {
      opId: "alpha-incomplete-browser-tail",
      baseRevision: 2,
      commandId: "LINE",
      args: {},
      targetHandles: [],
      resultHandles: [],
    },
    recordedAt: "2026-08-31T18:02:00.000Z",
  });
  await transactionDone(transaction);
  raw.close();
  const alphaOperationCount = (await database.operations("alpha")).length;
  const betaOperationCount = (await database.operations("beta")).length;
  database.close();
  return { phase: "seed", ok: true, compaction, alphaOperationCount, betaOperationCount };
}

export async function readBackRecoveryCompactionHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<RecoveryCompactionReadbackResult> {
  const database = new KDrawIndexedDb(factory, databaseName);
  const alpha = await database.recoverDocument("alpha");
  const beta = await database.recoverDocument("beta");
  if (!alpha.document || !beta.document) throw new TypeError("Browser reload did not recover both documents.");
  const secondAlphaRead = await database.recoverDocument("alpha");
  if (JSON.stringify(secondAlphaRead.document) !== JSON.stringify(alpha.document)
    || JSON.stringify(secondAlphaRead.receipt) !== JSON.stringify(alpha.receipt)) {
    throw new TypeError("Repeated browser replay changed the recovered document or receipt.");
  }
  const operationCounts = {
    alpha: (await database.operations("alpha")).length,
    beta: (await database.operations("beta")).length,
  };
  database.close();
  return {
    phase: "recover",
    ok: true,
    alphaReceipt: alpha.receipt,
    betaReceipt: beta.receipt,
    alphaRevision: alpha.document.revision,
    betaRevision: beta.document.revision,
    operationCounts,
    replayIdempotent: true,
  };
}

declare global {
  interface Window {
    __KUUBIK_RECOVERY_COMPACTION_RESULT__?: RecoveryCompactionSeedResult | RecoveryCompactionReadbackResult;
  }
}
