import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@kuubik/cad-core";
import { KDrawIndexedDb } from "./indexed-db.js";

function rawRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("versioned IndexedDB persistence", () => {
  it("stores snapshots and an append-only operation log without localStorage", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const document = createEmptyDocument({ documentId: "local", now: "2026-08-28T00:00:00Z" });
    document.revision = 1;
    const operation = {
      opId: "op-1",
      baseRevision: 0,
      commandId: "LINE",
      args: {},
      targetHandles: [],
      resultHandles: ["10"],
    };
    await database.commitRevision(document, operation);
    expect(await database.loadDocument("local")).toEqual(document);
    expect(await database.operations("local")).toEqual([
      expect.objectContaining({ documentId: "local", revision: 1, operation }),
    ]);
    database.close();
  });

  it("aborts document and snapshot writes when a duplicate opId violates the append-only log", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const first = createEmptyDocument({ documentId: "local" });
    first.revision = 1;
    const operation = { opId: "same", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10"] };
    await database.commitRevision(first, operation);
    const conflicting = structuredClone(first);
    conflicting.revision = 2;
    await expect(database.commitRevision(conflicting, { ...operation, baseRevision: 1 })).rejects.toThrow();
    expect((await database.loadDocument("local"))?.revision).toBe(1);
    database.close();
  });

  it("allows only one concurrent commit from the same base revision", async () => {
    const factory = new IDBFactory();
    const firstTab = new KDrawIndexedDb(factory);
    const secondTab = new KDrawIndexedDb(factory);
    const first = createEmptyDocument({ documentId: "local" });
    first.revision = 1;
    first.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }];
    const second = structuredClone(first);
    second.entities = [{ kind: "line", handle: "11", layerId: "0", start: { x: 2, y: 2 }, end: { x: 3, y: 3 } }];

    const results = await Promise.allSettled([
      firstTab.commitRevision(first, { opId: "op-a", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10"] }),
      secondTab.commitRevision(second, { opId: "op-b", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["11"] }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await firstTab.loadDocument("local"))?.revision).toBe(1);
    expect(await secondTab.operations("local")).toHaveLength(1);
    firstTab.close();
    secondTab.close();
  });

  it("stores PDF attachment bytes append-only and verifies the hash on read-back", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const attachment = { id: "pdf-1", mediaType: "application/pdf", sha256, fileName: "base.pdf", role: "underlay" as const };
    await database.saveAttachment("local", attachment, bytes);
    expect(await database.loadAttachment("local", "pdf-1")).toEqual({ attachment, bytes });
    await expect(database.saveAttachment("local", attachment, bytes)).rejects.toThrow();
    await expect(database.saveAttachment("local", { ...attachment, id: "pdf-2", sha256: "0".repeat(64) }, bytes)).rejects.toThrow(/checksum mismatch/u);
    database.close();
  });

  it("replays SHA-chained autosave records and reports an unclean crash session", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    await database.recordRecoveryOpen("local", "session-crashed", "2026-08-31T10:00:00Z");
    const first = createEmptyDocument({ documentId: "local" });
    first.revision = 1;
    first.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }];
    await database.commitRevision(first, { opId: "op-1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10"] });
    const second = structuredClone(first);
    second.revision = 2;
    second.entities.push({ kind: "circle", handle: "11", layerId: "0", center: { x: 5, y: 5 }, radius: 2 });
    await database.commitRevision(second, { opId: "op-2", baseRevision: 1, commandId: "CIRCLE", args: {}, targetHandles: [], resultHandles: ["11"] });

    expect(await database.recoverDocument("local")).toEqual({
      document: second,
      source: "operation-log",
      recoveredRevision: 2,
      ignoredOperationIds: [],
      corruptSnapshotKeys: [],
      uncleanSessionIds: ["session-crashed"],
    });
    await database.recordRecoveryClean("local", "session-crashed", 2, "2026-08-31T10:05:00Z");
    expect((await database.recoverDocument("local")).uncleanSessionIds).toEqual([]);
    await database.recordRecoveryOpen("local", "session-crashed", "2026-08-31T10:06:00Z");
    expect((await database.recoverDocument("local")).uncleanSessionIds).toEqual(["session-crashed"]);
    await expect(database.recordRecoveryClean("local", "session-crashed", 1)).rejects.toThrow(/revision conflict/u);
    database.close();
  });

  it("fails closed at the last valid operation when the append-only tail is corrupt", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory);
    const first = createEmptyDocument({ documentId: "local" }); first.revision = 1;
    await database.commitRevision(first, { opId: "op-1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] });
    const second = structuredClone(first); second.revision = 2;
    await database.commitRevision(second, { opId: "op-2", baseRevision: 1, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] });

    const raw = await rawRequest(factory.open("kuubik-draw", 2));
    const transaction = raw.transaction("operations", "readwrite");
    const store = transaction.objectStore("operations");
    const corrupt = await rawRequest(store.get("op-2"));
    corrupt.afterSha256 = "0".repeat(64);
    store.put(corrupt);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    raw.close();

    expect(await database.recoverDocument("local")).toEqual(expect.objectContaining({
      document: first,
      source: "operation-log",
      recoveredRevision: 1,
      ignoredOperationIds: ["op-2"],
    }));

    const rawAgain = await rawRequest(factory.open("kuubik-draw", 2));
    const firstTransaction = rawAgain.transaction("operations", "readwrite");
    const firstStore = firstTransaction.objectStore("operations");
    const corruptFirst = await rawRequest(firstStore.get("op-1"));
    corruptFirst.afterSha256 = "f".repeat(64);
    firstStore.put(corruptFirst);
    await new Promise<void>((resolve, reject) => {
      firstTransaction.oncomplete = () => resolve();
      firstTransaction.onerror = () => reject(firstTransaction.error);
    });
    rawAgain.close();
    expect(await database.recoverDocument("local")).toEqual(expect.objectContaining({
      document: null,
      source: "none",
      recoveredRevision: null,
      ignoredOperationIds: ["op-1", "op-2"],
    }));
    database.close();
  });
});
