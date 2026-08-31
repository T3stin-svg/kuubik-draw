import { applyAtomicOperation, createEmptyDocument, migrateLayoutWorkspace, migratePaperWorkspace, readPaperWorkspace } from "../src/index.js";
import { describe, expect, it } from "vitest";

function fixture() {
  const legacy = createEmptyDocument({ documentId: "paper-mutation" });
  const layout = migrateLayoutWorkspace(legacy);
  const withLayout = applyAtomicOperation(legacy, {
    opId: "layout-migration", baseRevision: 0, commandId: "LAYOUT_WORKSPACE_MIGRATE", args: {}, targetHandles: [], resultHandles: [],
  }, layout.changes).document;
  const paper = migratePaperWorkspace(withLayout);
  return applyAtomicOperation(withLayout, {
    opId: "paper-migration", baseRevision: 1, commandId: "PAPER_WORKSPACE_MIGRATE", args: {}, targetHandles: [], resultHandles: [],
  }, paper.changes).document;
}

describe("F-098 paper workspace mutation ratchet", () => {
  it.each([
    ["units", "INVALID_PAPER_UNITS", (state: any) => { state.paperUnits = "in"; }],
    ["active context", "INVALID_ACTIVE_PAPER_CONTEXT", (state: any) => { state.activeLayoutId = "layout-1"; state.activeSpace = "paper"; }],
    ["layout ref", "INVALID_PAPER_LAYOUT_REFERENCE", (state: any) => { state.papers[0].layoutId = "missing"; }],
    ["boundary", "INVALID_PAPER_BOUNDARY", (state: any) => { state.papers[0].boundaryMm.height = 0; }],
    ["printable", "INVALID_PRINTABLE_AREA", (state: any) => { state.papers[0].printableAreaMm.width = 0; }],
    ["origin", "INVALID_PAPER_ORIGIN", (state: any) => { state.papers[0].plotOriginMm.x = 10; }],
    ["orientation", "INVALID_PAPER_ORIENTATION", (state: any) => { state.papers[0].orientation = "portrait"; }],
    ["page setup ref", "INVALID_PAGE_SETUP_REFERENCE", (state: any) => { state.papers[0].pageSetupId = "missing"; }],
    ["viewport ref", "INVALID_VIEWPORT_REFERENCE", (state: any) => { state.papers[0].viewportRefs[0].viewportId = "missing"; }],
  ])("kills and repairs a %s mutation", (_name, repairCode, mutate) => {
    const document = fixture();
    mutate(document.metadata.extensions!["kuubik.paperWorkspace.v1"]);
    expect(() => readPaperWorkspace(document)).toThrow(/paper workspace/u);
    const repaired = migratePaperWorkspace(document);
    expect(repaired.repairs).toContain(repairCode);
    expect(repaired.receipt.code).toBe("PAPER_WORKSPACE_REPAIRED");
    expect(readPaperWorkspace(repaired.document)).toEqual(repaired.state);
  });
});
