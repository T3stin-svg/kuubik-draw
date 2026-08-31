import { createEmptyDocument, LayoutCommandError } from "@kuubik/cad-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentLayoutPlotShell, LAYOUT_PLOT_SHELL_CAPABILITIES } from "./layout-plot-shell.js";

async function openedShell(documentId: string) {
  const database = new KDrawIndexedDb(new IDBFactory(), `shell-${documentId}`);
  const live = new DocumentLiveOrchestrator(database, `session-${documentId}`);
  const document = createEmptyDocument({ documentId });
  document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10_000, y: 5_000 } }];
  await live.open({ documentId, fallbackDocument: document });
  return { database, live, shell: new DocumentLayoutPlotShell(live, documentId, `ops-${documentId}`) };
}

describe("F-096...F-107/F-114 DOM-independent layout/plot shell", () => {
  it("creates, renames and deletes layouts as durable atomic revisions", async () => {
    const { database, shell } = await openedShell("layout-lifecycle");
    await shell.createLayout({ name: "SHEET ONE", viewports: [] });
    await shell.createLayout({ name: "SHEET TWO", viewports: [] });
    await shell.renameLayout("layout-2", "SHEET TWO - ISSUE A");
    const deleted = await shell.deleteLayout("layout-2");
    expect(deleted).toMatchObject({ revision: 4, activeLayoutId: "layout-1" });
    expect(deleted.layouts.map((layout) => layout.name)).toEqual(["Model", "SHEET ONE"]);
    expect(await database.loadDocument("layout-lifecycle")).toEqual(shell.document());
    expect((await database.operations("layout-lifecycle")).map((record) => record.operation.commandId)).toEqual([
      "LAYOUT_CREATE", "LAYOUT_CREATE", "LAYOUT_RENAME", "LAYOUT_DELETE",
    ]);
    database.close();
  });

  it("keeps viewport scale, rotated pan, twist and lock in one read-back contract", async () => {
    const { database, shell } = await openedShell("viewport-contract");
    await shell.createLayout({ name: "VIEWPORT", viewports: [] });
    await shell.createRectViewport("layout-1", {
      center: { x: 148.5, y: 105 }, width: 277, height: 190,
      viewCenter: { x: 1_000, y: 2_000 }, viewHeight: 9_500, twistAngleRad: 0, locked: false,
    });
    await shell.setViewportView("layout-1", "viewport-1", {
      viewCenter: { x: 1_000, y: 2_000 }, scaleDenominator: 50, twistAngleRad: Math.PI / 4,
    });
    const panned = await shell.panViewport("layout-1", "viewport-1", { x: 80, y: -40 }, { width: 1_108, height: 760 });
    expect(panned.layouts[1]!.viewports[0]).toEqual(expect.objectContaining({
      scaleDenominator: 50,
      scaleLabel: "1:50",
      twistAngleRad: Math.PI / 4,
      rectangular: true,
    }));
    expect(panned.layouts[1]!.viewports[0]!.viewCenter).not.toEqual({ x: 1_000, y: 2_000 });
    const locked = await shell.setViewportLocked("layout-1", "viewport-1", true);
    expect(locked.layouts[1]!.viewports[0]!.locked).toBe(true);
    const before = structuredClone(shell.document());
    await expect(shell.setViewportView("layout-1", "viewport-1", {
      viewCenter: { x: 0, y: 0 }, scaleDenominator: 1, twistAngleRad: 0,
    })).rejects.toMatchObject({ code: "VIEWPORT_LOCKED" });
    expect(shell.document()).toEqual(before);
    expect(await database.loadDocument("viewport-contract")).toEqual(before);
    database.close();
  });

  it("roundtrips every standard viewport scale through a deterministic property matrix", async () => {
    const { database, shell } = await openedShell("viewport-property");
    await shell.createLayout({ name: "PROPERTY", viewports: [] });
    await shell.createRectViewport("layout-1", {
      center: { x: 148.5, y: 105 }, width: 277, height: 190,
      viewCenter: { x: 0, y: 0 }, viewHeight: 190, twistAngleRad: 0, locked: false,
    });
    const scales = [1, 2, 4, 5, 8, 10, 16, 20, 25, 30, 40, 50, 100];
    for (const [index, scaleDenominator] of scales.entries()) {
      const angle = index * Math.PI / 12;
      const readback = await shell.setViewportView("layout-1", "viewport-1", {
        viewCenter: { x: (index + 1) * 10, y: -(index + 1) * 5 }, scaleDenominator, twistAngleRad: angle,
      });
      expect(readback.layouts[1]!.viewports[0]).toEqual(expect.objectContaining({
        scaleDenominator,
        scaleLabel: `1:${scaleDenominator}`,
        twistAngleRad: angle,
      }));
    }
    expect(shell.document().revision).toBe(15);
    database.close();
  });

  it("normalizes Layout plotting to 1:1 and rejects invalid Model/Layout page setup mutants", async () => {
    const { database, shell } = await openedShell("page-setup");
    await shell.createLayout({ name: "A3", viewports: [] });
    const readback = await shell.setPageSetup("layout-1", {
      mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 5, drawingUnits: 7 }, centerPlot: true, plotOriginMm: { x: 5, y: 6 },
      plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true }, displayPlotStyles: true,
    });
    expect(readback.layouts[1]).toMatchObject({
      paper: { widthMm: 420, heightMm: 297 },
      pageSetup: {
        mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
        plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
      },
    });
    const before = structuredClone(shell.document());
    await expect(shell.setPageSetup("model", {
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    })).rejects.toBeInstanceOf(LayoutCommandError);
    expect(shell.document()).toEqual(before);
    expect(await database.loadDocument("page-setup")).toEqual(before);
    database.close();
  });

  it("applies named page setups and exports a Model Window/Fit PDF through the same shell", async () => {
    const { database, shell } = await openedShell("named-model-plot");
    await shell.createLayout({ name: "NAMED", viewports: [] });
    await shell.setPageSetup("layout-1", {
      mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
      plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
    });
    await shell.saveNamedPageSetup("layout-1", "A3 NAMED");
    await shell.setPageSetup("layout-1", {
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    });
    const applied = await shell.applyNamedPageSetup("layout-1", "page-setup-1");
    expect(applied.layouts[1]).toMatchObject({ paper: { widthMm: 420, heightMm: 297 }, pageSetup: { mediaName: "ISO_A3", orientation: "landscape" } });

    const model = await shell.setPageSetup("model", {
      mediaName: "ISO_A4", orientation: "landscape", plotArea: { kind: "window", window: { x: 0, y: 0, width: 10_000, height: 5_000 } },
      plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
      plotStyle: { profile: "grayscale", plotLineweights: false, plotTransparency: false },
    });
    expect(model.layouts[0]!.pageSetup).toMatchObject({ orientation: "landscape", plotArea: { kind: "window" }, plotScale: { mode: "fit" } });
    const pdf = await shell.exportVectorPdf({ kind: "model" });
    expect(pdf).toMatchObject({ summary: { pages: 1, xrefOffsetsValid: true }, layoutIds: ["model"], skippedHandles: [] });
    expect(pdf.bytes.byteLength).toBeGreaterThan(500);
    database.close();
  });

  it("reports native and vendor-specific capabilities honestly disabled", async () => {
    const { database, shell } = await openedShell("capabilities");
    expect(shell.readBack().capabilities).toBe(LAYOUT_PLOT_SHELL_CAPABILITIES);
    expect(shell.readBack().capabilities.nativeDwg).toEqual(expect.objectContaining({
      status: "disabled",
      rows: ["F-112", "F-113", "F-117", "F-121"],
      reason: expect.stringContaining("NATIVE_SDK_UNAVAILABLE"),
    }));
    expect(shell.readBack().capabilities.nativePlotProfiles).toEqual(expect.objectContaining({ status: "disabled", rows: ["F-108"] }));
    database.close();
  });
});
