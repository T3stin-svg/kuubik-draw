import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument, type CadSessionHistoryState } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("F-133 compaction mutation gate", () => {
  it("kills compact-history trust when only the stored history digest is changed", async () => {
    const factory = new IDBFactory();
    const databaseName = "compaction-history-mutation";
    const database = new KDrawIndexedDb(factory, databaseName);
    const document = createEmptyDocument({ documentId: "alpha" });
    document.revision = 1;
    const history: CadSessionHistoryState = { sequence: 0, undo: [], redo: [] };
    await database.commitRevision(document, {
      opId: "alpha-op-1",
      baseRevision: 0,
      commandId: "LINE",
      args: {},
      targetHandles: [],
      resultHandles: [],
    }, history);
    const compacted = await database.compactDocument("alpha", { minimumOperations: 1 });

    const raw = await requestResult(factory.open(databaseName));
    const transaction = raw.transaction("compactions", "readwrite");
    const store = transaction.objectStore("compactions");
    const record = await requestResult<any>(store.get(compacted.compactionKey!));
    record.sessionHistorySha256 = "f".repeat(64);
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    raw.close();

    const recovery = await database.recoverDocument("alpha");
    expect(recovery).toEqual(expect.objectContaining({
      source: "operation-log",
      recoveredRevision: 1,
      corruptCompactionKeys: [compacted.compactionKey],
      sessionHistory: history,
      receipt: expect.objectContaining({ code: "RECOVERY_DEGRADED" }),
    }));
    database.close();
  });
});
