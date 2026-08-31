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
});
