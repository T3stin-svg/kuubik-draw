import { createEmptyDocument } from "@kuubik/cad-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentTabs } from "./DocumentTabs.js";
import {
  activateDocumentTab,
  closeDocumentTab,
  createDocumentTabsState,
  markDocumentTabPersisted,
  openDocumentTab,
  readBackDocumentTabs,
  reorderDocumentTab,
  setDocumentTabLayout,
  updateDocumentTab,
} from "./document-tabs.js";

function drawing(documentId: string, title: string) {
  const document = createEmptyDocument({ documentId, now: "2026-08-31T00:00:00Z" });
  document.metadata.title = title;
  return document;
}

describe("F-128 multi-document tabs", () => {
  it("opens, activates and closes independent document sessions in deterministic order", () => {
    let state = createDocumentTabsState();
    state = openDocumentTab(state, { document: drawing("a", "Plan"), sourceFileName: "plan.dxf" });
    state = openDocumentTab(state, { document: drawing("b", "Plan"), sourceFileName: "plan.dxf" });
    state = openDocumentTab(state, { document: drawing("c", "Section"), sourceFileName: "section.kdraw" });
    expect(readBackDocumentTabs(state)).toEqual({
      activeDocumentId: "c",
      tabOrder: ["a", "b", "c"],
      tabs: [
        expect.objectContaining({ documentId: "a", label: "plan.dxf", dirty: false }),
        expect.objectContaining({ documentId: "b", label: "plan.dxf (2)", dirty: false }),
        expect.objectContaining({ documentId: "c", label: "section.kdraw", dirty: false }),
      ],
    });
    state = activateDocumentTab(state, "b");
    state = reorderDocumentTab(state, "b", 0);
    expect(readBackDocumentTabs(state).tabOrder).toEqual(["b", "a", "c"]);
    const closed = closeDocumentTab(state, "b");
    expect(closed.closed).toBe(true);
    expect(readBackDocumentTabs(closed.state).activeDocumentId).toBe("a");
  });

  it("keeps per-document layout context and refuses unsaved close without confirmation", () => {
    const first = drawing("a", "Plan");
    first.layouts.push({ id: "layout-1", name: "Layout 1", kind: "paper", viewports: [], entities: [] });
    let state = openDocumentTab(createDocumentTabsState(), { document: first });
    state = setDocumentTabLayout(state, "a", "layout-1");
    const edited = structuredClone(first);
    edited.revision = 1;
    edited.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    state = updateDocumentTab(state, { document: edited });
    expect(readBackDocumentTabs(state).tabs[0]).toEqual(expect.objectContaining({ dirty: true, activeLayoutId: "layout-1" }));
    const blocked = closeDocumentTab(state, "a");
    expect(blocked).toEqual(expect.objectContaining({ closed: false, requiresDiscardConfirmation: true }));
    state = markDocumentTabPersisted(state, "a", 1);
    expect(closeDocumentTab(state, "a")).toEqual({ state: createDocumentTabsState(), closed: true, requiresDiscardConfirmation: false });
  });

  it("activates an already-open identity without duplicating its tab", () => {
    const document = drawing("same", "Same");
    let state = openDocumentTab(createDocumentTabsState(), { document });
    state = openDocumentTab(state, { document: drawing("other", "Other") });
    state = openDocumentTab(state, { document });
    expect(readBackDocumentTabs(state).tabOrder).toEqual(["same", "other"]);
    expect(readBackDocumentTabs(state).activeDocumentId).toBe("same");
  });

  it("renders active and dirty tab semantics for App integration", () => {
    const document = drawing("a", "Plan");
    let state = openDocumentTab(createDocumentTabsState(), { document });
    const edited = structuredClone(document); edited.revision = 1;
    state = updateDocumentTab(state, { document: edited });
    const markup = renderToStaticMarkup(createElement(DocumentTabs, {
      state: readBackDocumentTabs(state),
      onActivate: () => undefined,
      onClose: () => undefined,
      onNew: () => undefined,
    }));
    expect(markup).toContain("aria-current=\"page\"");
    expect(markup).toContain("data-dirty=\"true\"");
    expect(markup).toContain("Plan *");
    expect(markup).toContain("aria-label=\"Sulge Plan\"");
  });
});
