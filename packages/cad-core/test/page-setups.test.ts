import { describe, expect, it } from "vitest";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  CadSession,
  PAGE_SETUP_LIBRARY_EXTENSION_KEY,
  PageSetupLibraryError,
  applyNamedPageSetup,
  clearNamedPageSetupAssignment,
  createEmptyDocument,
  createPageSetupTemplate,
  createPaperLayout,
  deleteNamedPageSetup,
  importPageSetupTemplate,
  parsePageSetupTemplate,
  renameNamedPageSetup,
  resolvePageSetupLibrary,
  saveNamedPageSetup,
  serializePageSetupTemplate,
  setPaperLayoutPageSetup,
} from "../src/index.js";

function fixture(id = "F-107"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: id, now: "2026-08-29T00:00:00.000Z" });
  document.layouts = createPaperLayout(document, { name: "Issue plan" }).layouts;
  document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }];
  document.layouts[1]!.entities = [{ kind: "circle", handle: "11", layerId: "0", center: { x: 20, y: 20 }, radius: 5 }];
  return document;
}

function operation(document: KDrawDocumentV1, commandId: string): CadOperation {
  return { opId: `${commandId}-${document.revision}`, baseRevision: document.revision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

describe("F-107 named page setup library", () => {
  it("saves, applies, renames and deletes referenced setups atomically", () => {
    const session = new CadSession(fixture());
    const saved = saveNamedPageSetup(session.document, "layout-1", "Office A4 issue");
    session.commit(operation(session.document, "PAGESETUP_SAVE"), saved.changes, "2026-08-29T00:01:00.000Z");
    expect(saved.setupId).toBe("page-setup-1");
    expect(resolvePageSetupLibrary(session.document)).toMatchObject({
      setups: [{ id: "page-setup-1", name: "Office A4 issue", pageSetup: { mediaName: "ISO_A4", orientation: "landscape" } }],
      assignments: { "layout-1": "page-setup-1" },
    });
    expect(() => saveNamedPageSetup(session.document, "layout-1", " office a4 ISSUE ")).toThrowError(PageSetupLibraryError);

    const altered = setPaperLayoutPageSetup(session.document, "layout-1", {
      mediaName: "ISO_A3", orientation: "portrait", plotArea: { kind: "extents" }, plotScale: { mode: "fit" }, centerPlot: true,
      plotOriginMm: { x: 0, y: 0 }, plotStyle: { profile: "color", plotLineweights: false, plotTransparency: false }, displayPlotStyles: false,
    });
    session.commit(operation(session.document, "PAGESETUP"), altered.changes, "2026-08-29T00:02:00.000Z");
    const detached = clearNamedPageSetupAssignment(session.document, "layout-1");
    session.commit(operation(session.document, "PAGESETUP_DETACH"), detached, "2026-08-29T00:02:30.000Z");
    expect(resolvePageSetupLibrary(session.document).assignments).toEqual({});
    const applied = applyNamedPageSetup(session.document, "layout-1", saved.setupId);
    expect(applied.changes.map((change) => change.type)).toEqual(["set-layouts", "set-metadata"]);
    session.commit(operation(session.document, "PAGESETUP_APPLY"), applied.changes, "2026-08-29T00:03:00.000Z");
    expect(session.document.layouts[1]).toMatchObject({
      paper: { widthMm: 297, heightMm: 210 },
      pageSetup: { mediaName: "ISO_A4", orientation: "landscape" },
    });

    const renamed = renameNamedPageSetup(session.document, saved.setupId, "Office A4 final");
    session.commit(operation(session.document, "PAGESETUP_RENAME"), renamed.changes);
    expect(resolvePageSetupLibrary(session.document).setups[0]!.name).toBe("Office A4 final");
    const deleted = deleteNamedPageSetup(session.document, saved.setupId);
    session.commit(operation(session.document, "PAGESETUP_DELETE"), deleted.changes);
    expect(resolvePageSetupLibrary(session.document)).toEqual({ schemaVersion: 1, setups: [], assignments: {} });
    expect(session.document.layouts[1]!.pageSetup?.mediaName).toBe("ISO_A4");
    session.undo();
    expect(resolvePageSetupLibrary(session.document)).toMatchObject({ setups: [{ name: "Office A4 final" }], assignments: { "layout-1": saved.setupId } });
  });

  it("rejects dangling or malformed stored extension data", () => {
    const document = fixture();
    document.metadata.extensions = { [PAGE_SETUP_LIBRARY_EXTENSION_KEY]: { schemaVersion: 1, setups: [], assignments: { missing: "also-missing" } } };
    expect(() => resolvePageSetupLibrary(document)).toThrowError(/dangling/u);
  });
});

describe("F-107 geometry-free page setup templates", () => {
  it("round-trips deterministically and imports layouts/setups without touching drawing geometry", () => {
    const sourceSession = new CadSession(fixture("F-107-source"));
    const saved = saveNamedPageSetup(sourceSession.document, "layout-1", "F-107 A4 ISSUE");
    sourceSession.commit(operation(sourceSession.document, "PAGESETUP_SAVE"), saved.changes);
    const template = createPageSetupTemplate(sourceSession.document, "F-107 office template");
    const text = serializePageSetupTemplate(template);
    expect(text).toBe(serializePageSetupTemplate(parsePageSetupTemplate(text)));
    expect(text).not.toContain('"entities"');
    expect(text).not.toContain('"blocks"');
    expect(text).toContain('"F-107 A4 ISSUE"');

    const targetSession = new CadSession(fixture("F-107-target"));
    const beforeEntities = targetSession.document.entities;
    const beforePaperEntities = targetSession.document.layouts[1]!.entities;
    const imported = importPageSetupTemplate(targetSession.document, parsePageSetupTemplate(text));
    expect(imported.changes.map((change) => change.type)).toEqual(["set-layouts", "set-metadata"]);
    expect(imported.importedLayoutIds).toEqual(["layout-2"]);
    expect(imported.importedSetupIds).toEqual(["page-setup-1"]);
    targetSession.commit(operation(targetSession.document, "PAGESETUP_TEMPLATE_IMPORT"), imported.changes);
    expect(targetSession.document.entities).toEqual(beforeEntities);
    expect(targetSession.document.layouts[1]!.entities).toEqual(beforePaperEntities);
    expect(targetSession.document.layouts[2]).toMatchObject({ name: "Issue plan (2)", entities: [] });
    expect(resolvePageSetupLibrary(targetSession.document)).toMatchObject({
      setups: [{ name: "F-107 A4 ISSUE" }],
      assignments: { "layout-2": "page-setup-1" },
    });
    targetSession.undo();
    expect(targetSession.document.layouts).toHaveLength(2);
    expect(resolvePageSetupLibrary(targetSession.document)).toEqual({ schemaVersion: 1, setups: [], assignments: {} });
  });

  it("rejects geometry, dangling references, duplicate ids and oversized input", () => {
    const valid = createPageSetupTemplate(fixture(), "Strict template");
    const withGeometry = { ...valid, entities: [] };
    expect(() => parsePageSetupTemplate(JSON.stringify(withGeometry))).toThrowError(/unsupported fields/u);
    const dangling = structuredClone(valid);
    dangling.layouts[1]!.pageSetupId = "missing";
    expect(() => parsePageSetupTemplate(JSON.stringify(dangling))).toThrowError(/missing page setup/u);
    const duplicate = structuredClone(valid);
    duplicate.layouts.push(structuredClone(duplicate.layouts[1]!));
    expect(() => parsePageSetupTemplate(JSON.stringify(duplicate))).toThrowError(/Duplicate template layout id/u);
    expect(() => parsePageSetupTemplate(`{"padding":"${"x".repeat(1024 * 1024)}"}`)).toThrowError(/exceeds/u);

    const nestedMutations: Array<[string, (template: ReturnType<typeof createPageSetupTemplate>) => void]> = [
      ["units", (template) => { (template.units as unknown as Record<string, unknown>).unexpected = true; }],
      ["named setup", (template) => { (template.pageSetups[0] as unknown as Record<string, unknown>).unexpected = true; }],
      ["margins", (template) => { (template.pageSetups[0]!.paperMarginsMm as unknown as Record<string, unknown>).unexpected = true; }],
      ["page setup", (template) => { (template.layouts[1]!.pageSetup as unknown as Record<string, unknown>).unexpected = true; }],
      ["paper", (template) => { (template.layouts[1]!.paper as unknown as Record<string, unknown>).unexpected = true; }],
      ["viewport", (template) => { (template.layouts[1]!.viewports[0] as unknown as Record<string, unknown>).unexpected = true; }],
    ];
    const namedSource = fixture();
    const named = saveNamedPageSetup(namedSource, "layout-1", "Strict nested");
    namedSource.metadata = (named.changes[0] as Extract<(typeof named.changes)[number], { type: "set-metadata" }>).metadata;
    for (const [label, mutate] of nestedMutations) {
      const candidate = createPageSetupTemplate(namedSource, `Strict ${label}`);
      mutate(candidate);
      expect(() => parsePageSetupTemplate(JSON.stringify(candidate)), label).toThrowError(/unsupported fields/u);
    }

    const staleSetup = createPageSetupTemplate(namedSource, "Stale setup");
    staleSetup.layouts[1]!.pageSetup.orientation = "portrait";
    expect(() => parsePageSetupTemplate(JSON.stringify(staleSetup))).toThrowError(/does not match its named page setup/u);
    const staleMargins = createPageSetupTemplate(namedSource, "Stale margins");
    staleMargins.layouts[1]!.paper!.marginsMm.left += 1;
    expect(() => parsePageSetupTemplate(JSON.stringify(staleMargins))).toThrowError(/does not match its named page setup/u);

    const orphanAci = createPageSetupTemplate(namedSource, "Orphan ACI override");
    orphanAci.layouts[1]!.viewports[0]!.layerOverrides = { "0": { aciIndex: 1 } };
    expect(() => parsePageSetupTemplate(JSON.stringify(orphanAci))).toThrowError(/requires an RGB render color/u);
    const pairedAci = createPageSetupTemplate(namedSource, "Paired ACI override");
    pairedAci.layouts[1]!.viewports[0]!.layerOverrides = { "0": { color: "#00ff00", colorMethod: "aci", aciIndex: 1 } };
    expect(() => parsePageSetupTemplate(JSON.stringify(pairedAci))).not.toThrow();
    const invalidLinetype = createPageSetupTemplate(namedSource, "Invalid linetype override");
    invalidLinetype.layouts[1]!.viewports[0]!.layerOverrides = { "0": { linetypeId: "" } };
    expect(() => parsePageSetupTemplate(JSON.stringify(invalidLinetype))).toThrowError(/linetype ID/u);

    const reordered = createPageSetupTemplate(namedSource, "Reordered fields");
    const setup = reordered.layouts[1]!.pageSetup;
    reordered.layouts[1]!.pageSetup = {
      displayPlotStyles: setup.displayPlotStyles,
      plotStyle: { plotTransparency: setup.plotStyle.plotTransparency, profile: setup.plotStyle.profile, plotLineweights: setup.plotStyle.plotLineweights },
      plotOriginMm: { y: setup.plotOriginMm.y, x: setup.plotOriginMm.x },
      centerPlot: setup.centerPlot,
      plotScale: structuredClone(setup.plotScale),
      plotArea: structuredClone(setup.plotArea),
      orientation: setup.orientation,
      mediaName: setup.mediaName,
    };
    const margins = reordered.layouts[1]!.paper!.marginsMm;
    reordered.layouts[1]!.paper!.marginsMm = { left: margins.left, bottom: margins.bottom, right: margins.right, top: margins.top };
    expect(() => parsePageSetupTemplate(JSON.stringify(reordered))).not.toThrow();
  });

  it("rejects incompatible template units before producing changes", () => {
    const template = createPageSetupTemplate(fixture("F-107-cm"), "Centimetre template");
    template.units.linear = "cm";
    expect(() => importPageSetupTemplate(fixture("F-107-mm"), template)).toThrowError(/do not match/u);

    const reordered = createPageSetupTemplate(fixture("F-107-order"), "Reordered units");
    reordered.units = {
      angularPrecision: reordered.units.angularPrecision,
      linear: reordered.units.linear,
      displayPrecision: reordered.units.displayPrecision,
    };
    expect(() => importPageSetupTemplate(fixture("F-107-order-target"), reordered)).not.toThrow();
  });
});
