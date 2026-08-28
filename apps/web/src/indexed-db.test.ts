import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@kuubik/cad-core";
import { KDrawIndexedDb } from "./indexed-db.js";

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
});
