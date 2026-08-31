import { createEmptyDocument } from "@kuubik/cad-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentWorkspaceShell, PgpAliasMapping } from "./document-workspace-shell.js";

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
  });
}

describe("F-129/F-130 mutation ratchets", () => {
  it("quarantines a history-only mutation even when document bytes and revision remain valid", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory, "history-mutation");
    const workspace = new DocumentWorkspaceShell(
      new DocumentLiveOrchestrator(database, "crashed"),
      new PgpAliasMapping([{ id: "LINE", aliases: ["L"] }]),
    );
    await workspace.open({ documentId: "mutated", fallbackDocument: createEmptyDocument({ documentId: "mutated" }) });
    await workspace.commit("mutated", 0, "L", [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } }]);
    database.close();

    const raw = await requestResult(factory.open("history-mutation", 2));
    const transaction = raw.transaction("operations", "readwrite");
    const store = transaction.objectStore("operations");
    const record = await requestResult<any>(store.get("workspace:mutated:1:LINE"));
    record.sessionHistory.sequence = 999;
    store.put(record);
    await transactionDone(transaction);
    raw.close();

    const restarted = new KDrawIndexedDb(factory, "history-mutation");
    expect(await restarted.recoverDocument("mutated")).toEqual(expect.objectContaining({
      document: expect.objectContaining({ revision: 0, entities: [] }),
      recoveredRevision: 0,
      source: "snapshot",
      ignoredOperationIds: ["workspace:mutated:1:LINE"],
      sessionHistory: null,
    }));
    restarted.close();
  });

  it.each([
    "broken alias",
    "LINE, *CIRCLE",
    "X, *UNKNOWN",
    `${"A".repeat(33)}, *LINE`,
  ])("rejects malformed, canonical-conflicting, unknown or oversized aliases: %s", async (input) => {
    const aliases = new PgpAliasMapping([{ id: "LINE", aliases: ["L"] }, { id: "CIRCLE", aliases: ["C"] }]);
    await expect(aliases.importPgp(input)).rejects.toThrow();
    expect(aliases.exportPgp()).toEqual(new Uint8Array());
  });
});
