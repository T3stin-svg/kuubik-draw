import type { CadOperation } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  CadSession,
  DEFAULT_PAGE_SETUP,
  applyAtomicOperation,
  copyPaperLayoutWorkspace,
  createEmptyDocument,
  deletePaperLayoutWorkspace,
  migrateLayoutWorkspace,
  migratePaperWorkspace,
  readPaperWorkspace,
  resolvePageSetupLibrary,
  saveNamedPageSetup,
  setPaperWorkspacePageSetup,
} from "../src/index.js";

function operation(baseRevision: number, commandId: string): CadOperation {
  return { opId: `${commandId}-${baseRevision + 1}`, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

function layoutDocument(documentId: string) {
  const legacy = createEmptyDocument({ documentId, now: "2026-08-31T21:00:00Z" });
  const layout = migrateLayoutWorkspace(legacy);
  return applyAtomicOperation(legacy, operation(0, "LAYOUT_WORKSPACE_MIGRATE"), layout.changes).document;
}

function paperDocument(documentId: string) {
  const document = layoutDocument(documentId);
  const paper = migratePaperWorkspace(document);
  return applyAtomicOperation(document, operation(document.revision, "PAPER_WORKSPACE_MIGRATE"), paper.changes).document;
}

describe("F-098 paper workspace document model", () => {
  it("migrates the physical A4 sheet, printable area and viewport ownership exactly once", () => {
    const document = layoutDocument("paper-legacy");
    const migration = migratePaperWorkspace(document);
    expect(migration).toEqual(expect.objectContaining({
      migrated: true,
      repairs: ["MISSING_PAPER_WORKSPACE_STATE"],
      receipt: expect.objectContaining({ code: "PAPER_WORKSPACE_MIGRATED" }),
      state: {
        schemaVersion: 1,
        paperUnits: "mm",
        activeLayoutId: "model",
        activeSpace: "model",
        papers: [{
          layoutId: "layout-1",
          boundaryMm: { x: 0, y: 0, width: 297, height: 210 },
          printableAreaMm: { x: 10, y: 10, width: 277, height: 190 },
          mediaName: "ISO_A4",
          orientation: "landscape",
          plotOriginMm: { x: 0, y: 0 },
          pageSetupId: null,
          viewportRefs: [{ layoutId: "layout-1", viewportId: "viewport-1" }],
        }],
      },
    }));
    const persisted = applyAtomicOperation(document, operation(document.revision, "PAPER_WORKSPACE_MIGRATE"), migration.changes).document;
    expect(migratePaperWorkspace(persisted)).toEqual(expect.objectContaining({
      migrated: false,
      repairs: [],
      changes: [],
      receipt: expect.objectContaining({ code: "PAPER_WORKSPACE_CURRENT" }),
    }));
  });

  it("commits paper boundary, orientation and printable area atomically with Undo/Redo", () => {
    const session = new CadSession(paperDocument("paper-page-setup"));
    const pageSetup = structuredClone(DEFAULT_PAGE_SETUP);
    pageSetup.mediaName = "ISO_A3";
    pageSetup.orientation = "portrait";
    const edited = setPaperWorkspacePageSetup(session.document, "layout-1", pageSetup);
    session.commit(operation(session.document.revision, "PAPER_SPACE_PAGE_SETUP"), edited.changes);
    expect(readPaperWorkspace(session.document).papers[0]).toMatchObject({
      layoutId: "layout-1",
      boundaryMm: { x: 0, y: 0, width: 297, height: 420 },
      printableAreaMm: { x: 10, y: 10, width: 277, height: 400 },
      mediaName: "ISO_A3",
      orientation: "portrait",
      viewportRefs: [{ layoutId: "layout-1", viewportId: "viewport-1" }],
    });
    session.undo();
    expect(readPaperWorkspace(session.document).papers[0]).toMatchObject({ mediaName: "ISO_A4", orientation: "landscape" });
    session.redo();
    expect(readPaperWorkspace(session.document).papers[0]).toMatchObject({ mediaName: "ISO_A3", orientation: "portrait" });
  });

  it("preserves named page setup and viewport references when a paper layout is copied", () => {
    let document = layoutDocument("paper-copy");
    const named = saveNamedPageSetup(document, "layout-1", "A4 Office");
    document = applyAtomicOperation(document, operation(document.revision, "PAGE_SETUP_SAVE"), named.changes).document;
    const migrated = migratePaperWorkspace(document);
    document = applyAtomicOperation(document, operation(document.revision, "PAPER_WORKSPACE_MIGRATE"), migrated.changes).document;
    const copied = copyPaperLayoutWorkspace(document, "layout-1");
    const copiedDocument = applyAtomicOperation(document, operation(document.revision, "LAYOUT_COPY"), copied.changes).document;
    expect(resolvePageSetupLibrary(copiedDocument).assignments).toEqual({ "layout-1": named.setupId, "layout-2": named.setupId });
    expect(readPaperWorkspace(copiedDocument).papers).toEqual([
      expect.objectContaining({ layoutId: "layout-2", pageSetupId: named.setupId, viewportRefs: [{ layoutId: "layout-2", viewportId: "viewport-2" }] }),
      expect.objectContaining({ layoutId: "layout-1", pageSetupId: named.setupId, viewportRefs: [{ layoutId: "layout-1", viewportId: "viewport-1" }] }),
    ]);
    const deleted = deletePaperLayoutWorkspace(copiedDocument, "layout-2");
    const deletedDocument = applyAtomicOperation(copiedDocument, operation(copiedDocument.revision, "LAYOUT_DELETE"), deleted.changes).document;
    expect(resolvePageSetupLibrary(deletedDocument).assignments).toEqual({ "layout-1": named.setupId });
    expect(readPaperWorkspace(deletedDocument).papers).toEqual([
      expect.objectContaining({ layoutId: "layout-1", pageSetupId: named.setupId, viewportRefs: [{ layoutId: "layout-1", viewportId: "viewport-1" }] }),
    ]);
  });

  it("fails closed and returns a deterministic repair receipt for stale paper references", () => {
    const document = paperDocument("paper-repair");
    const raw = document.metadata.extensions!["kuubik.paperWorkspace.v1"] as any;
    raw.activeLayoutId = "layout-1";
    raw.activeSpace = "paper";
    raw.papers[0].boundaryMm.width = 999;
    raw.papers[0].printableAreaMm.width = 998;
    raw.papers[0].plotOriginMm.x = 5;
    raw.papers[0].orientation = "portrait";
    raw.papers[0].viewportRefs = [{ layoutId: "layout-2", viewportId: "missing" }];
    expect(() => readPaperWorkspace(document)).toThrow(/paper workspace/u);
    const repaired = migratePaperWorkspace(document);
    expect(repaired.repairs).toEqual([
      "INVALID_ACTIVE_PAPER_CONTEXT",
      "INVALID_PAPER_BOUNDARY",
      "INVALID_PRINTABLE_AREA",
      "INVALID_PAPER_ORIGIN",
      "INVALID_PAPER_ORIENTATION",
      "INVALID_VIEWPORT_REFERENCE",
    ]);
    expect(repaired.receipt).toEqual(expect.objectContaining({ code: "PAPER_WORKSPACE_REPAIRED", repairs: repaired.repairs }));
    expect(repaired.state).toEqual(readPaperWorkspace(repaired.document));
  });
});
