import { describe, expect, it } from "vitest";
import type { CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  activateLayoutWorkspace,
  applyAtomicOperation,
  copyPaperLayoutWorkspace,
  createEmptyDocument,
  createPaperLayoutWorkspace,
  deletePaperLayoutWorkspace,
  migrateLayoutWorkspace,
  readLayoutWorkspace,
  renamePaperLayoutWorkspace,
  reorderPaperLayoutWorkspace,
  resolvePageSetupLibrary,
  saveNamedPageSetup,
} from "../src/index.js";

function operation(baseRevision: number, commandId: string): CadOperation {
  return { opId: `${commandId}-${baseRevision + 1}`, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

function migratedDocument(documentId: string) {
  const legacy = createEmptyDocument({ documentId, now: "2026-08-31T20:00:00Z" });
  const migration = migrateLayoutWorkspace(legacy);
  return applyAtomicOperation(legacy, operation(0, "LAYOUT_WORKSPACE_MIGRATE"), migration.changes, "2026-08-31T20:00:01Z").document;
}

describe("F-096/F-097 document layout workspace", () => {
  it("migrates a model-only legacy document once with deterministic active/tab state", () => {
    const legacy = createEmptyDocument({ documentId: "legacy" });
    const first = migrateLayoutWorkspace(legacy);
    expect(first).toEqual(expect.objectContaining({
      migrated: true,
      repairs: ["MISSING_PAPER_LAYOUT", "MISSING_WORKSPACE_STATE"],
      workspace: {
        schemaVersion: 1,
        activeLayoutId: "model",
        activeSpace: "model",
        tabOrder: ["model", "layout-1"],
        nextLayoutSequence: 2,
        nextViewportSequence: 2,
      },
    }));
    expect(first.layouts.map((layout) => [layout.id, layout.name, layout.kind])).toEqual([
      ["model", "Model", "model"],
      ["layout-1", "Layout 1", "paper"],
    ]);
    const persisted = applyAtomicOperation(legacy, operation(0, "LAYOUT_WORKSPACE_MIGRATE"), first.changes).document;
    expect(migrateLayoutWorkspace(persisted)).toEqual(expect.objectContaining({ migrated: false, changes: [], repairs: [] }));
  });

  it("repairs invalid active layout, space and tab order to one deterministic safe state", () => {
    const document = migratedDocument("repair");
    document.metadata.extensions!["kuubik.layoutWorkspace.v1"] = {
      schemaVersion: 1,
      activeLayoutId: "missing-layout",
      activeSpace: "paper",
      tabOrder: ["layout-1", "layout-1"],
      nextLayoutSequence: 1,
      nextViewportSequence: 1,
    };
    const repaired = migrateLayoutWorkspace(document);
    expect(repaired.repairs).toEqual(["INVALID_ACTIVE_LAYOUT", "INVALID_TAB_ORDER", "INVALID_SEQUENCE"]);
    expect(repaired.workspace).toEqual({
      schemaVersion: 1,
      activeLayoutId: "model",
      activeSpace: "model",
      tabOrder: ["model", "layout-1"],
      nextLayoutSequence: 2,
      nextViewportSequence: 2,
    });
    expect(() => readLayoutWorkspace(document)).toThrow(/workspace/u);
  });

  it("keeps stable non-reused layout/viewport ids and exact copied page references", () => {
    let document = migratedDocument("ids");
    document.layouts[1]!.viewports[0]!.locked = true;
    const named = saveNamedPageSetup(document, "layout-1", "Office A3");
    document = applyAtomicOperation(document, operation(1, "PAGE_SETUP_SAVE"), named.changes).document;
    const copied = copyPaperLayoutWorkspace(document, "layout-1");
    const copy = copied.layouts.find((layout) => layout.id === copied.layoutId)!;
    expect(copy).toMatchObject({ id: "layout-2", pageSetup: { mediaName: "ISO_A4" }, viewports: [{ id: "viewport-2", locked: true }] });
    const copiedDocument = applyAtomicOperation(document, operation(2, "LAYOUT_COPY"), copied.changes).document;
    expect(resolvePageSetupLibrary(copiedDocument).assignments).toEqual({ "layout-1": named.setupId, "layout-2": named.setupId });
    const deleted = deletePaperLayoutWorkspace(copiedDocument, "layout-2");
    const deletedDocument = applyAtomicOperation(copiedDocument, operation(3, "LAYOUT_DELETE"), deleted.changes).document;
    expect(resolvePageSetupLibrary(deletedDocument).assignments).toEqual({ "layout-1": named.setupId });
    const created = createPaperLayoutWorkspace(deletedDocument, { name: "Issue" });
    expect(created.layoutId).toBe("layout-3");
    expect(created.layouts.find((layout) => layout.id === "layout-3")!.viewports[0]!.id).toBe("viewport-3");
  });

  it("commits active space, rename, reorder and delete as exact atomic Undo/Redo state", () => {
    const session = new CadSession(migratedDocument("atomic"));
    const created = createPaperLayoutWorkspace(session.document, { name: "Issue" });
    session.commit(operation(1, "LAYOUT_CREATE"), created.changes);
    const renamed = renamePaperLayoutWorkspace(session.document, created.layoutId, "Issue A");
    session.commit(operation(2, "LAYOUT_RENAME"), renamed.changes);
    const modelActive = activateLayoutWorkspace(session.document, "model");
    session.commit(operation(3, "LAYOUT_ACTIVATE_MODEL"), modelActive.changes);
    const activated = activateLayoutWorkspace(session.document, created.layoutId);
    session.commit(operation(4, "LAYOUT_ACTIVATE_PAPER"), activated.changes);
    const reordered = reorderPaperLayoutWorkspace(session.document, created.layoutId, 1);
    session.commit(operation(5, "LAYOUT_REORDER"), reordered.changes);
    expect(readLayoutWorkspace(session.document)).toMatchObject({ activeLayoutId: "layout-2", activeSpace: "paper", tabOrder: ["model", "layout-2", "layout-1"] });
    session.undo();
    expect(readLayoutWorkspace(session.document)).toMatchObject({ activeLayoutId: "layout-2", tabOrder: ["model", "layout-1", "layout-2"] });
    session.redo();
    expect(readLayoutWorkspace(session.document).tabOrder).toEqual(["model", "layout-2", "layout-1"]);
    const deleted = deletePaperLayoutWorkspace(session.document, "layout-2");
    session.commit(operation(session.document.revision, "LAYOUT_DELETE"), deleted.changes);
    expect(readLayoutWorkspace(session.document)).toMatchObject({ activeLayoutId: "layout-1", activeSpace: "paper" });
    session.undo();
    expect(readLayoutWorkspace(session.document)).toMatchObject({ activeLayoutId: "layout-2", activeSpace: "paper" });
  });

  it("never deletes the final paper layout or moves the Model tab", () => {
    const document = migratedDocument("guards");
    expect(() => deletePaperLayoutWorkspace(document, "layout-1")).toThrow(/At least one paper layout/u);
    expect(() => reorderPaperLayoutWorkspace(document, "model", 1)).toThrow(/Model layout/u);
    expect(() => reorderPaperLayoutWorkspace(document, "layout-1", 0)).toThrow(/outside/u);
  });
});
