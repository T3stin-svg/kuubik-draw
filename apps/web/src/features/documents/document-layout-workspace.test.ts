import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument, readLayoutWorkspace } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLayoutWorkspace } from "./document-layout-workspace.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

async function openWorkspace(factory: IDBFactory, databaseName: string, documentId: string, sessionId: string) {
  const database = new KDrawIndexedDb(factory, databaseName);
  const live = new DocumentLiveOrchestrator(database, sessionId);
  const opened = await live.open({
    documentId,
    fallbackDocument: createEmptyDocument({ documentId }),
    layoutWorkspace: "migrate",
  });
  return { database, live, opened, workspace: new DocumentLayoutWorkspace(live, documentId, `workspace-${sessionId}`) };
}

describe("F-096/F-097 live document layout workspace", () => {
  it("migrates a legacy fallback before its first checkpoint and reads it back idempotently", async () => {
    const factory = new IDBFactory();
    const first = await openWorkspace(factory, "workspace-legacy", "legacy", "legacy-first");
    expect(first.opened.layoutWorkspace).toEqual({
      migrated: true,
      repairs: ["MISSING_PAPER_LAYOUT", "MISSING_WORKSPACE_STATE"],
      state: {
        schemaVersion: 1,
        activeLayoutId: "model",
        activeSpace: "model",
        tabOrder: ["model", "layout-1"],
        nextLayoutSequence: 2,
        nextViewportSequence: 2,
      },
      migrationOperationId: null,
    });
    expect(first.workspace.readBack()).toEqual(expect.objectContaining({ revision: 0, canUndo: false, tabOrder: ["model", "layout-1"] }));
    first.database.close();

    const secondDatabase = new KDrawIndexedDb(factory, "workspace-legacy");
    const secondLive = new DocumentLiveOrchestrator(secondDatabase, "legacy-second");
    const reopened = await secondLive.open({ documentId: "legacy", layoutWorkspace: "migrate" });
    expect(reopened.layoutWorkspace).toEqual(expect.objectContaining({ migrated: false, repairs: [], migrationOperationId: null }));
    expect(reopened.document.revision).toBe(0);
    secondDatabase.close();
  });

  it("appends a non-undoable migration revision for an already persisted legacy document", async () => {
    const factory = new IDBFactory();
    const seed = new KDrawIndexedDb(factory, "workspace-persisted-legacy");
    await seed.saveSnapshot(createEmptyDocument({ documentId: "persisted" }));
    seed.close();
    const database = new KDrawIndexedDb(factory, "workspace-persisted-legacy");
    const live = new DocumentLiveOrchestrator(database, "persisted-open");
    const opened = await live.open({ documentId: "persisted", layoutWorkspace: "migrate" });
    expect(opened.layoutWorkspace).toEqual(expect.objectContaining({
      migrated: true,
      migrationOperationId: "layout-workspace-migrate:persisted:1",
    }));
    expect(opened.document.revision).toBe(1);
    expect(live.readBack().sessions.documents[0]).toEqual(expect.objectContaining({ canUndo: false, activeLayoutId: "model" }));
    expect((await database.operations("persisted")).map((record) => record.operation.commandId)).toEqual(["LAYOUT_WORKSPACE_MIGRATE"]);
    database.close();
  });

  it("keeps active layout, tab order and Undo/Redo isolated across two documents", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory, "workspace-multi");
    const live = new DocumentLiveOrchestrator(database, "workspace-multi-session");
    await live.open({ documentId: "alpha", fallbackDocument: createEmptyDocument({ documentId: "alpha" }), layoutWorkspace: "migrate" });
    await live.open({ documentId: "beta", fallbackDocument: createEmptyDocument({ documentId: "beta" }), layoutWorkspace: "migrate" });
    const alpha = new DocumentLayoutWorkspace(live, "alpha", "alpha-layout");
    const beta = new DocumentLayoutWorkspace(live, "beta", "beta-layout");
    await alpha.switchLayout("layout-1");
    await alpha.createLayout({ name: "Issue A" });
    await alpha.copyLayout("layout-2");
    await alpha.renameLayout("layout-3", "Issue A Copy");
    await alpha.reorderLayout("layout-3", 1);
    await beta.switchLayout("layout-1");

    expect(alpha.readBack()).toEqual(expect.objectContaining({ activeLayoutId: "layout-3", tabOrder: ["model", "layout-3", "layout-1", "layout-2"] }));
    expect(beta.readBack()).toEqual(expect.objectContaining({ revision: 1, activeLayoutId: "layout-1", tabOrder: ["model", "layout-1"] }));
    const beforeBeta = structuredClone(beta.readBack());
    await alpha.undo();
    expect(alpha.readBack().tabOrder).toEqual(["model", "layout-1", "layout-3", "layout-2"]);
    await alpha.redo();
    expect(alpha.readBack().tabOrder).toEqual(["model", "layout-3", "layout-1", "layout-2"]);
    expect(beta.readBack()).toEqual(beforeBeta);
    database.close();
  });

  it("repairs a SHA-valid but semantically corrupt stored workspace before exposure", async () => {
    const factory = new IDBFactory();
    const first = await openWorkspace(factory, "workspace-corrupt", "corrupt", "corrupt-first");
    const metadata = structuredClone(first.live.document("corrupt").metadata);
    (metadata.extensions!["kuubik.layoutWorkspace.v1"] as any).activeLayoutId = "missing";
    (metadata.extensions!["kuubik.layoutWorkspace.v1"] as any).tabOrder = ["layout-1", "layout-1"];
    await first.live.commit("corrupt", {
      opId: "corrupt-workspace",
      baseRevision: 0,
      commandId: "TEST_CORRUPT_WORKSPACE",
      args: {},
      targetHandles: [],
      resultHandles: [],
    }, [{ type: "set-metadata", metadata }]);
    first.database.close();

    const database = new KDrawIndexedDb(factory, "workspace-corrupt");
    const live = new DocumentLiveOrchestrator(database, "corrupt-reloaded");
    const recovered = await live.open({ documentId: "corrupt", layoutWorkspace: "migrate" });
    expect(recovered.layoutWorkspace).toEqual(expect.objectContaining({
      migrated: true,
      repairs: ["INVALID_ACTIVE_LAYOUT", "INVALID_TAB_ORDER"],
      state: expect.objectContaining({ activeLayoutId: "model", activeSpace: "model", tabOrder: ["model", "layout-1"] }),
    }));
    expect(readLayoutWorkspace(recovered.document)).toEqual(recovered.layoutWorkspace!.state);
    expect(live.readBack().sessions.documents[0]!.activeLayoutId).toBe("model");
    database.close();
  });
});
