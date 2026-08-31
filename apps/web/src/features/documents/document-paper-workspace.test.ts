import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_PAGE_SETUP, createEmptyDocument, readPaperWorkspace } from "@kuubik/cad-core";
import type { CadPageSetup } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentPaperWorkspace } from "./document-paper-workspace.js";

async function openPaper(factory: IDBFactory, databaseName: string, documentId: string, sessionId: string) {
  const database = new KDrawIndexedDb(factory, databaseName);
  const live = new DocumentLiveOrchestrator(database, sessionId);
  const opened = await live.open({
    documentId,
    fallbackDocument: createEmptyDocument({ documentId }),
    layoutWorkspace: "migrate",
    paperWorkspace: "migrate",
  });
  return { database, live, opened, paper: new DocumentPaperWorkspace(live, documentId, sessionId) };
}

describe("F-098 live paper workspace", () => {
  it("migrates a fallback before checkpoint and returns deterministic receipts", async () => {
    const factory = new IDBFactory();
    const first = await openPaper(factory, "paper-live-legacy", "legacy", "paper-first");
    expect(first.opened.layoutWorkspace).toMatchObject({ migrated: true, repairs: ["MISSING_PAPER_LAYOUT", "MISSING_WORKSPACE_STATE"] });
    expect(first.opened.paperWorkspace).toEqual(expect.objectContaining({
      migrated: true,
      repairs: ["MISSING_PAPER_WORKSPACE_STATE"],
      migrationOperationId: null,
      receipt: expect.objectContaining({ code: "PAPER_WORKSPACE_MIGRATED" }),
    }));
    expect(first.paper.readBack()).toMatchObject({ revision: 0, activeLayoutId: "model", activeSpace: "model", paperUnits: "mm" });
    first.database.close();

    const database = new KDrawIndexedDb(factory, "paper-live-legacy");
    const live = new DocumentLiveOrchestrator(database, "paper-second");
    const reopened = await live.open({ documentId: "legacy", paperWorkspace: "migrate" });
    expect(reopened.layoutWorkspace).toMatchObject({ migrated: false, repairs: [] });
    expect(reopened.paperWorkspace).toMatchObject({ migrated: false, repairs: [], migrationOperationId: null, receipt: { code: "PAPER_WORKSPACE_CURRENT" } });
    expect(reopened.document.revision).toBe(0);
    database.close();
  });

  it("appends non-undoable layout and paper migrations for a persisted legacy document", async () => {
    const factory = new IDBFactory();
    const seed = new KDrawIndexedDb(factory, "paper-persisted-legacy");
    await seed.saveSnapshot(createEmptyDocument({ documentId: "persisted-paper" }));
    seed.close();
    const database = new KDrawIndexedDb(factory, "paper-persisted-legacy");
    const live = new DocumentLiveOrchestrator(database, "paper-persisted-open");
    const opened = await live.open({ documentId: "persisted-paper", paperWorkspace: "migrate" });
    expect(opened.document.revision).toBe(2);
    expect(opened.paperWorkspace).toMatchObject({
      migrated: true,
      migrationOperationId: "paper-workspace-migrate:persisted-paper:2",
      receipt: { code: "PAPER_WORKSPACE_MIGRATED" },
    });
    expect(live.readBack().sessions.documents[0]).toMatchObject({ canUndo: false, activeLayoutId: "model" });
    expect((await database.operations("persisted-paper")).map((record) => record.operation.commandId)).toEqual([
      "LAYOUT_WORKSPACE_MIGRATE",
      "PAPER_WORKSPACE_MIGRATE",
    ]);
    database.close();
  });

  it("keeps paper setup, Model/Paper switch and Undo/Redo isolated across documents", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory, "paper-live-multi");
    const live = new DocumentLiveOrchestrator(database, "paper-live-multi-session");
    for (const documentId of ["alpha", "beta"]) {
      await live.open({ documentId, fallbackDocument: createEmptyDocument({ documentId }), paperWorkspace: "migrate" });
    }
    const alpha = new DocumentPaperWorkspace(live, "alpha", "paper-alpha");
    const beta = new DocumentPaperWorkspace(live, "beta", "paper-beta");
    const a3: CadPageSetup = { ...structuredClone(DEFAULT_PAGE_SETUP), mediaName: "ISO_A3", orientation: "portrait" };
    await alpha.setPageSetup("layout-1", a3);
    await alpha.switchLayout("layout-1");
    await beta.switchLayout("layout-1");
    expect(alpha.readBack()).toMatchObject({ revision: 2, activeLayoutId: "layout-1", activeSpace: "paper" });
    expect(alpha.readBack().papers[0]).toMatchObject({ boundaryMm: { width: 297, height: 420 }, orientation: "portrait" });
    const betaBefore = structuredClone(beta.readBack());
    const undone = await alpha.undo();
    expect(undone).toMatchObject({ revision: 3, activeLayoutId: "model", activeSpace: "model" });
    expect(undone.papers[0]).toMatchObject({ mediaName: "ISO_A3", orientation: "portrait" });
    const redone = await alpha.redo();
    expect(redone).toMatchObject({ revision: 4, activeLayoutId: "layout-1", activeSpace: "paper" });
    expect(beta.readBack()).toEqual(betaBefore);
    database.close();
  });

  it("repairs a SHA-valid stale viewport reference before exposing the session", async () => {
    const factory = new IDBFactory();
    const first = await openPaper(factory, "paper-live-corrupt", "corrupt-paper", "paper-corrupt-first");
    const metadata = structuredClone(first.live.document("corrupt-paper").metadata);
    const raw = metadata.extensions!["kuubik.paperWorkspace.v1"] as any;
    raw.papers[0].viewportRefs[0] = { layoutId: "layout-1", viewportId: "missing" };
    await first.live.commit("corrupt-paper", {
      opId: "corrupt-paper-ref", baseRevision: 0, commandId: "TEST_CORRUPT_PAPER_REF", args: {}, targetHandles: [], resultHandles: [],
    }, [{ type: "set-metadata", metadata }]);
    first.database.close();

    const database = new KDrawIndexedDb(factory, "paper-live-corrupt");
    const live = new DocumentLiveOrchestrator(database, "paper-corrupt-reloaded");
    const recovered = await live.open({ documentId: "corrupt-paper", paperWorkspace: "migrate" });
    expect(recovered.paperWorkspace).toMatchObject({
      migrated: true,
      repairs: ["INVALID_VIEWPORT_REFERENCE"],
      migrationOperationId: "paper-workspace-migrate:corrupt-paper:2",
      receipt: { code: "PAPER_WORKSPACE_REPAIRED", repairs: ["INVALID_VIEWPORT_REFERENCE"] },
    });
    expect(readPaperWorkspace(recovered.document)).toEqual(recovered.paperWorkspace!.state);
    expect(recovered.paperWorkspace!.state.papers[0]!.viewportRefs).toEqual([{ layoutId: "layout-1", viewportId: "viewport-1" }]);
    database.close();
  });
});
