import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentAutosaveRecovery } from "./autosave-recovery.js";

describe("F-133 autosave recovery coordinator", () => {
  it("records open, commit and clean close boundaries", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const autosave = new DocumentAutosaveRecovery(database, "session-1");
    expect(await autosave.open("local", "2026-08-31T10:00:00Z")).toEqual(expect.objectContaining({ source: "none" }));
    const document = createEmptyDocument({ documentId: "local" }); document.revision = 1;
    await autosave.commit(document, { opId: "op-1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] });
    await autosave.close("local", 1, "2026-08-31T10:01:00Z");
    expect(await database.recoverDocument("local")).toEqual(expect.objectContaining({ recoveredRevision: 1, uncleanSessionIds: [] }));
    await expect(autosave.close("local", 1)).rejects.toThrow(/is not open/u);
    database.close();
  });

  it("automatically accepts a corrupt tail boundary and continues from the last valid revision", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory);
    const crashed = new DocumentAutosaveRecovery(database, "session-crashed");
    await crashed.open("local", "2026-08-31T10:00:00Z");
    const first = createEmptyDocument({ documentId: "local" }); first.revision = 1;
    await crashed.commit(first, { opId: "op-1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] });
    const second = structuredClone(first); second.revision = 2;
    await crashed.commit(second, { opId: "op-2", baseRevision: 1, commandId: "CIRCLE", args: {}, targetHandles: [], resultHandles: [] });

    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("kuubik-draw", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = raw.transaction("operations", "readwrite");
    const store = transaction.objectStore("operations");
    const record = await new Promise<any>((resolve, reject) => {
      const request = store.get("op-2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    record.afterSha256 = "0".repeat(64);
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    raw.close();

    const restarted = new DocumentAutosaveRecovery(database, "session-restarted");
    const recovery = await restarted.open("local", "2026-08-31T10:05:00Z");
    expect(recovery).toEqual(expect.objectContaining({
      recoveredRevision: 1,
      ignoredOperationIds: ["op-2"],
      uncleanSessionIds: ["session-crashed"],
    }));
    expect((await database.loadDocument("local"))?.revision).toBe(1);

    const continued = structuredClone(recovery.document!); continued.revision = 2;
    continued.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 5, y: 5 } });
    await restarted.commit(continued, { opId: "op-continued", baseRevision: 1, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["10"] });
    await restarted.close("local", 2, "2026-08-31T10:06:00Z");

    expect(await database.recoverDocument("local")).toEqual(expect.objectContaining({
      document: continued,
      source: "operation-log",
      recoveredRevision: 2,
      ignoredOperationIds: ["op-2"],
      uncleanSessionIds: ["session-crashed"],
    }));
    expect(restarted.isOpen("local")).toBe(false);
    expect(crashed.isOpen("local")).toBe(true);
    database.close();
  });

  it("does not let an early clean event conceal a later interrupted open", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const document = createEmptyDocument({ documentId: "ordering" }); document.revision = 1;
    await database.commitRevision(document, { opId: "op-1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [] });
    await database.recordRecoveryClean("ordering", "reused-session", 1, "2026-08-31T09:00:00Z");
    await database.recordRecoveryOpen("ordering", "reused-session", "2026-08-31T10:00:00Z");
    expect((await database.recoverDocument("ordering")).uncleanSessionIds).toEqual(["reused-session"]);
    database.close();
  });
});
