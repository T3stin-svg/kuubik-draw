import { describe, expect, it } from "vitest";
import {
  CadSession,
  createEmptyDocument,
  createPageSetupTemplate,
  createPaperLayout,
  importPageSetupTemplate,
  resolvePageSetupLibrary,
  saveNamedPageSetup,
  serializePageSetupTemplate,
} from "../src/index.js";

function source() {
  const document = createEmptyDocument({ documentId: "F-107-mutation", now: "2026-08-29T00:00:00.000Z" });
  document.layouts = createPaperLayout(document, { name: "Issue layout" }).layouts;
  const saved = saveNamedPageSetup(document, "layout-1", "A4 issue");
  const session = new CadSession(document);
  session.commit({ opId: "save", baseRevision: 0, commandId: "PAGESETUP_SAVE", args: {}, targetHandles: [], resultHandles: [] }, saved.changes);
  return session.document;
}

describe("F-107 mutation-proven ratchet", () => {
  it("changes deterministic template bytes when named plot semantics mutate", () => {
    const document = source();
    const baseline = serializePageSetupTemplate(createPageSetupTemplate(document, "Office"));
    const mutation = structuredClone(document);
    const extension = resolvePageSetupLibrary(mutation);
    extension.setups[0]!.pageSetup.plotStyle = { profile: "color", plotLineweights: true, plotTransparency: true };
    mutation.metadata.extensions!["kuubikDraw.pageSetupLibrary.v1"] = extension;
    expect(serializePageSetupTemplate(createPageSetupTemplate(mutation, "Office"))).not.toBe(baseline);
  });

  it("proves template import needs both layout and metadata changes in the same undo step", () => {
    const document = source();
    const template = createPageSetupTemplate(document, "Office");
    const target = createEmptyDocument({ documentId: "F-107-target", now: "2026-08-29T00:00:00.000Z" });
    target.layouts = createPaperLayout(target, { name: "Existing" }).layouts;
    const imported = importPageSetupTemplate(target, template);
    const session = new CadSession(target);
    session.commit({ opId: "import", baseRevision: 0, commandId: "PAGESETUP_TEMPLATE_IMPORT", args: {}, targetHandles: [], resultHandles: [] }, imported.changes);
    expect(session.document.layouts).toHaveLength(3);
    expect(resolvePageSetupLibrary(session.document).setups).toHaveLength(1);
    session.undo();
    expect(session.document.layouts).toHaveLength(2);
    expect(resolvePageSetupLibrary(session.document).setups).toHaveLength(0);

    const layoutOnly = new CadSession(target);
    layoutOnly.commit({ opId: "mutant-layout", baseRevision: 0, commandId: "PAGESETUP_TEMPLATE_IMPORT", args: {}, targetHandles: [], resultHandles: [] }, imported.changes.filter((change) => change.type === "set-layouts"));
    expect(layoutOnly.document.layouts).toHaveLength(3);
    expect(resolvePageSetupLibrary(layoutOnly.document).setups).toHaveLength(0);
  });

  it("kills a stale named-assignment mutant before import", () => {
    const document = source();
    const template = createPageSetupTemplate(document, "Office");
    expect(template.layouts[1]!.pageSetupId).toBe("page-setup-1");
    template.layouts[1]!.pageSetup.plotStyle.profile = "color";
    expect(() => importPageSetupTemplate(createEmptyDocument({ documentId: "F-107-stale-target", now: "2026-08-29T00:00:00.000Z" }), template)).toThrowError(/does not match its named page setup/u);
  });
});
