import { describe, expect, it } from "vitest";
import type { CadLayout, CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  LayoutCommandError,
  allocateEntityHandles,
  copyPaperLayout,
  createPaperViewport,
  createEmptyDocument,
  createPaperLayout,
  deletePaperLayout,
  deletePaperViewport,
  formatViewportScale,
  movePaperLayout,
  panPaperViewportByPixels,
  plotScaleDenominator,
  renamePaperLayout,
  resolvePageSetup,
  resolvePaperDefinition,
  setPaperLayoutPageSetup,
  setPaperViewportDisplayLocked,
  setPaperViewportView,
  viewportModelToNormalized,
  viewportNormalizedToModel,
  viewportScaleDenominator,
  zoomPaperViewportAtModelPoint,
} from "../src/index.js";

function operation(baseRevision: number, commandId: string, args: unknown = {}): CadOperation {
  return { opId: `${commandId}-${baseRevision}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

describe("F-097 layout transactions", () => {
  it("creates and copies a full paper layout before its source with independent viewport/entity ids", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "F-097", now: "2026-08-28T00:00:00Z" }));
    const plan = createPaperLayout(session.document, {
      name: "F097 PLAN",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
      viewports: [{
        id: "f097-source-vp", center: { x: 210, y: 148.5 }, width: 390, height: 267,
        viewCenter: { x: 1250, y: -750 }, viewHeight: 5000, twistAngleRad: Math.PI / 12,
        locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } },
      }],
      entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 50, y: 50 }, radius: 25 }],
    });
    session.commit(operation(0, "LAYOUT_CREATE", { name: "F097 PLAN" }), plan.changes);
    const notes = createPaperLayout(session.document, { name: "F097 NOTES" });
    session.commit(operation(1, "LAYOUT_CREATE", { name: "F097 NOTES" }), notes.changes);

    const copied = copyPaperLayout(session.document, plan.layoutId);
    session.commit(operation(2, "LAYOUT_COPY", { layoutId: plan.layoutId }), copied.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN (2)", "F097 PLAN", "F097 NOTES"]);
    const source = session.document.layouts.find((layout) => layout.id === plan.layoutId)!;
    const copy = session.document.layouts.find((layout) => layout.id === copied.layoutId)!;
    expect(copy).toMatchObject({
      name: "F097 PLAN (2)",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
      viewports: [{ viewCenter: { x: 1250, y: -750 }, locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } } }],
      entities: [{ kind: "circle", center: { x: 50, y: 50 }, radius: 25 }],
    });
    expect(copy.viewports[0]!.id).not.toBe(source.viewports[0]!.id);
    expect(copy.entities![0]!.handle).not.toBe(source.entities![0]!.handle);
    expect(allocateEntityHandles(session.document, 1)).not.toContain(copy.entities![0]!.handle);

    const changedLayouts = structuredClone(session.document.layouts);
    const changedSource = changedLayouts.find((layout) => layout.id === plan.layoutId)!;
    if (changedSource.entities?.[0]?.kind === "circle") changedSource.entities[0].radius = 30;
    session.commit(operation(3, "LAYOUT_EDIT", { layoutId: plan.layoutId }), [{ type: "set-layouts", layouts: changedLayouts }]);
    expect((session.document.layouts.find((layout) => layout.id === copied.layoutId)!.entities![0] as { radius: number }).radius).toBe(25);
    expect((session.document.layouts.find((layout) => layout.id === plan.layoutId)!.entities![0] as { radius: number }).radius).toBe(30);
    session.undo();
    expect((session.document.layouts.find((layout) => layout.id === plan.layoutId)!.entities![0] as { radius: number }).radius).toBe(25);
  });

  it("reorders, deletes and restores each layout action as one atomic undo/redo step", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "F-097-order" }));
    const plan = createPaperLayout(session.document, { name: "F097 PLAN" });
    session.commit(operation(0, "LAYOUT_CREATE"), plan.changes);
    const notes = createPaperLayout(session.document, { name: "F097 NOTES" });
    session.commit(operation(1, "LAYOUT_CREATE"), notes.changes);
    const copy = copyPaperLayout(session.document, plan.layoutId);
    session.commit(operation(2, "LAYOUT_COPY"), copy.changes);

    const firstMove = movePaperLayout(session.document, notes.layoutId, -1);
    session.commit(operation(3, "LAYOUT_REORDER"), firstMove.changes);
    const secondMove = movePaperLayout(session.document, notes.layoutId, -1);
    session.commit(operation(4, "LAYOUT_REORDER"), secondMove.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);

    const deleted = deletePaperLayout(session.document, copy.layoutId);
    expect(deleted.layoutId).toBe(plan.layoutId);
    session.commit(operation(5, "LAYOUT_DELETE"), deleted.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
    session.undo();
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);
    session.redo();
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
  });

  it("enforces AutoCAD-compatible name, model, final-paper and 255-paper boundaries", () => {
    const document = createEmptyDocument({ documentId: "F-097-guards" });
    const first = createPaperLayout(document, { name: "Issue A" });
    const withFirst = { ...document, layouts: first.layouts };
    expect(() => createPaperLayout(withFirst, { name: "issue a" })).toThrowError(LayoutCommandError);
    expect(() => renamePaperLayout(withFirst, first.layoutId, "x".repeat(256))).toThrowError(LayoutCommandError);
    expect(() => copyPaperLayout(withFirst, "model")).toThrowError(LayoutCommandError);
    expect(() => movePaperLayout(withFirst, "model", 1)).toThrowError(LayoutCommandError);
    expect(() => deletePaperLayout(withFirst, first.layoutId)).toThrowError(LayoutCommandError);

    const layouts: CadLayout[] = [document.layouts[0]!, ...Array.from({ length: 255 }, (_, index) => ({
      id: `layout-${index + 1}`, name: `Layout ${index + 1}`, kind: "paper" as const, viewports: [], entities: [],
    }))];
    expect(() => createPaperLayout({ ...document, layouts })).toThrowError(LayoutCommandError);
  });

  it("resolves a positive default paper sheet and rejects collapsed printable geometry", () => {
    const document = createEmptyDocument({ documentId: "F-098-paper" });
    const paper = createPaperLayout(document, { name: "F098 PAPER" }).layouts[1]!;
    expect(resolvePaperDefinition(paper)).toEqual({
      widthMm: 297,
      heightMm: 210,
      marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    expect(resolvePaperDefinition({ ...paper, paper: undefined })).toEqual(resolvePaperDefinition(paper));
    expect(() => resolvePaperDefinition({
      ...paper,
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 210, bottom: 10, left: 210 } },
    })).toThrowError(LayoutCommandError);
  });

  it("creates independent rectangular and polygon-clipped paper viewports and deletes one atomically", () => {
    const document = createEmptyDocument({ documentId: "F-099-viewports", now: "2026-08-28T00:00:00Z" });
    const paper = createPaperLayout(document, { name: "F099 PAPER", viewports: [] });
    const withPaper = { ...document, layouts: paper.layouts };
    const first = createPaperViewport(withPaper, paper.layoutId, {
      center: { x: 110, y: 148.5 }, width: 180, height: 247,
      viewCenter: { x: 0, y: 0 }, viewHeight: 2470, twistAngleRad: 0, locked: false,
    });
    const second = createPaperViewport({ ...withPaper, layouts: first.layouts }, paper.layoutId, {
      center: { x: 310, y: 148.5 }, width: 180, height: 247,
      viewCenter: { x: 2500, y: -750 }, viewHeight: 4940, twistAngleRad: 0, locked: false,
      clipBoundary: [{ x: 220, y: 25 }, { x: 400, y: 25 }, { x: 370, y: 272 }, { x: 250, y: 272 }],
    });
    const viewports = second.layouts.find((layout) => layout.id === paper.layoutId)!.viewports;
    expect(viewports).toHaveLength(2);
    expect(viewports.map((viewport) => viewport.id)).toEqual(["viewport-1", "viewport-2"]);
    expect(viewports[1]).toMatchObject({
      center: { x: 310, y: 148.5 }, viewCenter: { x: 2500, y: -750 },
      clipBoundary: [{ x: 220, y: 25 }, { x: 400, y: 25 }, { x: 370, y: 272 }, { x: 250, y: 272 }],
    });
    const deleted = deletePaperViewport({ ...withPaper, layouts: second.layouts }, paper.layoutId, first.viewportId!);
    expect(deleted.viewportId).toBe(second.viewportId);
    expect(deleted.layouts.find((layout) => layout.id === paper.layoutId)!.viewports.map((viewport) => viewport.id)).toEqual(["viewport-2"]);
    expect(() => createPaperViewport(document, "model", {
      center: { x: 0, y: 0 }, width: 10, height: 10, viewCenter: { x: 0, y: 0 }, viewHeight: 10, twistAngleRad: 0, locked: false,
    })).toThrowError(LayoutCommandError);
  });

  it("rejects degenerate or outside non-rectangular viewport clips", () => {
    const document = createEmptyDocument({ documentId: "F-099-invalid" });
    const paper = createPaperLayout(document, { name: "F099 PAPER", viewports: [] });
    const withPaper = { ...document, layouts: paper.layouts };
    const base = {
      center: { x: 100, y: 100 }, width: 100, height: 100,
      viewCenter: { x: 0, y: 0 }, viewHeight: 100, twistAngleRad: 0, locked: false,
    };
    expect(() => createPaperViewport(withPaper, paper.layoutId, {
      ...base, clipBoundary: [{ x: 50, y: 50 }, { x: 75, y: 75 }, { x: 100, y: 100 }],
    })).toThrowError(LayoutCommandError);
    expect(() => createPaperViewport(withPaper, paper.layoutId, {
      ...base, clipBoundary: [{ x: 50, y: 50 }, { x: 151, y: 50 }, { x: 50, y: 150 }],
    })).toThrowError(LayoutCommandError);
    expect(() => createPaperViewport(withPaper, paper.layoutId, {
      ...base, clipBoundary: [{ x: 50, y: 50 }, { x: 150, y: 125 }, { x: 50, y: 150 }, { x: 150, y: 50 }],
    })).toThrow(/simple/i);
    const invalidStored = structuredClone(withPaper);
    invalidStored.layouts[1]!.viewports = [{
      id: "stored-bow-tie", ...base,
      clipBoundary: [{ x: 50, y: 50 }, { x: 150, y: 125 }, { x: 50, y: 150 }, { x: 150, y: 50 }],
    }];
    expect(() => new CadSession(invalidStored)).toThrow(/simple/i);
    expect(() => createPaperViewport(withPaper, paper.layoutId, {
      center: { x: 1.7e308, y: 0 }, width: 1.7e308, height: 1,
      viewCenter: { x: 0, y: 0 }, viewHeight: 1.7e308, twistAngleRad: 0, locked: false,
    })).toThrow(/derived frame/i);
  });

  it("sets preset/custom viewport scale, center and twist with cursor-anchor zoom and rotated pan", () => {
    const document = createEmptyDocument({ documentId: "F-100-view" });
    const paper = createPaperLayout(document, { name: "F100 PAPER", viewports: [] });
    const source = { ...document, layouts: paper.layouts };
    const created = createPaperViewport(source, paper.layoutId, {
      center: { x: 210, y: 148.5 }, width: 200, height: 100,
      viewCenter: { x: 0, y: 0 }, viewHeight: 5000, twistAngleRad: 0, locked: false,
    });
    const withViewport = { ...source, layouts: created.layouts };
    const preset = setPaperViewportView(withViewport, paper.layoutId, created.viewportId!, {
      viewCenter: { x: 1000, y: -500 }, scaleDenominator: 20, twistAngleRad: Math.PI / 6,
    });
    const presetViewport = preset.layouts[1]!.viewports[0]!;
    expect(viewportScaleDenominator(presetViewport)).toBeCloseTo(20, 12);
    expect(formatViewportScale(presetViewport)).toBe("1:20");
    expect(presetViewport).toMatchObject({ viewCenter: { x: 1000, y: -500 }, viewHeight: 2000, twistAngleRad: Math.PI / 6 });

    const anchorModel = viewportNormalizedToModel(presetViewport, { x: -0.31, y: 0.22 });
    const anchorBefore = viewportModelToNormalized(presetViewport, anchorModel);
    const zoomed = zoomPaperViewportAtModelPoint({ ...source, layouts: preset.layouts }, paper.layoutId, created.viewportId!, anchorModel, 1 / 1.1);
    const zoomedViewport = zoomed.layouts[1]!.viewports[0]!;
    expect(viewportScaleDenominator(zoomedViewport)).toBeCloseTo(18.18181818181818, 12);
    expect(formatViewportScale(zoomedViewport)).toBe("1:18.182 (Custom)");
    expect(viewportModelToNormalized(zoomedViewport, anchorModel)).toEqual({
      x: expect.closeTo(anchorBefore.x, 12),
      y: expect.closeTo(anchorBefore.y, 12),
    });

    const panned = panPaperViewportByPixels({ ...source, layouts: zoomed.layouts }, paper.layoutId, created.viewportId!, { x: 80, y: -50 }, { width: 400, height: 200 });
    const pannedViewport = panned.layouts[1]!.viewports[0]!;
    expect(pannedViewport.viewCenter).not.toEqual(zoomedViewport.viewCenter);
    expect(viewportScaleDenominator(pannedViewport)).toBeCloseTo(viewportScaleDenominator(zoomedViewport), 12);
    expect(pannedViewport.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
    expect(viewportNormalizedToModel(presetViewport, viewportModelToNormalized(presetViewport, anchorModel))).toEqual({
      x: expect.closeTo(anchorModel.x, 12),
      y: expect.closeTo(anchorModel.y, 12),
    });
  });

  it("rejects locked, non-finite and collapsed viewport view changes before mutation", () => {
    const document = createEmptyDocument({ documentId: "F-100-invalid" });
    const paper = createPaperLayout(document, { name: "F100 PAPER", viewports: [] });
    const source = { ...document, layouts: paper.layouts };
    const created = createPaperViewport(source, paper.layoutId, {
      center: { x: 100, y: 100 }, width: 100, height: 100,
      viewCenter: { x: 0, y: 0 }, viewHeight: 1000, twistAngleRad: 0, locked: false,
    });
    const withViewport = { ...source, layouts: created.layouts };
    expect(() => setPaperViewportView(withViewport, paper.layoutId, created.viewportId!, {
      viewCenter: { x: 0, y: 0 }, scaleDenominator: 0, twistAngleRad: 0,
    })).toThrow(/positive/i);
    expect(() => setPaperViewportView(withViewport, paper.layoutId, created.viewportId!, {
      viewCenter: { x: Number.NaN, y: 0 }, scaleDenominator: 20, twistAngleRad: 0,
    })).toThrow(/finite/i);
    expect(() => panPaperViewportByPixels(withViewport, paper.layoutId, created.viewportId!, { x: 1, y: 1 }, { width: 0, height: 100 })).toThrow(/pixel/i);
    const locked = structuredClone(withViewport);
    locked.layouts[1]!.viewports[0]!.locked = true;
    expect(() => zoomPaperViewportAtModelPoint(locked, paper.layoutId, created.viewportId!, { x: 0, y: 0 }, 1.1)).toThrow(/locked/i);
    expect(() => setPaperViewportView(withViewport, paper.layoutId, created.viewportId!, {
      viewCenter: { x: 0, y: 0 }, scaleDenominator: 1.7e308, twistAngleRad: 0,
    })).toThrow(/finite/i);
  });

  it("locks, unlocks and relocks a viewport without changing its camera or blocking model edits", () => {
    const document = createEmptyDocument({ documentId: "F-101-lock" });
    const paper = createPaperLayout(document, { name: "F101 PAPER", viewports: [] });
    const created = createPaperViewport({ ...document, layouts: paper.layouts }, paper.layoutId, {
      center: { x: 210, y: 148.5 }, width: 200, height: 100,
      viewCenter: { x: 400, y: 200 }, viewHeight: 500, twistAngleRad: 0.25, locked: false,
    });
    const session = new CadSession({ ...document, layouts: created.layouts });
    const camera = structuredClone(session.document.layouts[1]!.viewports[0]!);
    const locked = setPaperViewportDisplayLocked(session.document, paper.layoutId, created.viewportId!, true);
    session.commit(operation(0, "VIEWPORT_LOCK", { locked: true }), locked.changes);
    expect(session.document.layouts[1]!.viewports[0]).toEqual({ ...camera, locked: true });
    expect(() => zoomPaperViewportAtModelPoint(session.document, paper.layoutId, created.viewportId!, { x: 400, y: 200 }, 0.5)).toThrow(/locked/i);
    expect(() => panPaperViewportByPixels(session.document, paper.layoutId, created.viewportId!, { x: 50, y: 25 }, { width: 400, height: 200 })).toThrow(/locked/i);
    expect(() => setPaperViewportView(session.document, paper.layoutId, created.viewportId!, {
      viewCenter: { x: 700, y: 350 }, scaleDenominator: 25, twistAngleRad: Math.PI / 12,
    })).toThrow(/locked/i);

    session.commit(operation(1, "LINE", {}), [{
      type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 100, y: 50 }, end: { x: 1100, y: 50 } },
    }]);
    expect(session.document.entities).toHaveLength(1);
    expect(session.document.layouts[1]!.viewports[0]).toEqual({ ...camera, locked: true });
    const unlocked = setPaperViewportDisplayLocked(session.document, paper.layoutId, created.viewportId!, false);
    session.commit(operation(2, "VIEWPORT_LOCK", { locked: false }), unlocked.changes);
    const changed = setPaperViewportView(session.document, paper.layoutId, created.viewportId!, {
      viewCenter: { x: 500, y: 250 }, scaleDenominator: 5, twistAngleRad: 0,
    });
    session.commit(operation(3, "VIEWPORT_VIEW"), changed.changes);
    const relocked = setPaperViewportDisplayLocked(session.document, paper.layoutId, created.viewportId!, true);
    session.commit(operation(4, "VIEWPORT_LOCK", { locked: true }), relocked.changes);
    expect(session.document.layouts[1]!.viewports[0]).toMatchObject({ locked: true, viewCenter: { x: 500, y: 250 }, viewHeight: 500 });
    session.undo();
    expect(session.document.layouts[1]!.viewports[0]!.locked).toBe(false);
    session.redo();
    expect(session.document.layouts[1]!.viewports[0]!.locked).toBe(true);
    expect(setPaperViewportDisplayLocked(session.document, paper.layoutId, created.viewportId!, true).changes).toEqual([]);
    expect(() => setPaperViewportDisplayLocked(session.document, "model", created.viewportId!, false)).toThrow(/Model layout/i);
    expect(() => setPaperViewportDisplayLocked(session.document, paper.layoutId, "missing", false)).toThrow(/not found/i);
    expect(() => setPaperViewportDisplayLocked(session.document, paper.layoutId, created.viewportId!, "yes" as unknown as boolean)).toThrow(/boolean/i);
  });

  it("applies A4 portrait Window 1:2 atomically while preserving AutoCAD paper-space viewport coordinates", () => {
    const document = createEmptyDocument({ documentId: "F-102-page-setup" });
    const paper = createPaperLayout(document, {
      name: "F102 SHEET",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [{
        id: "viewport-f102", center: { x: 210, y: 148.5 }, width: 390, height: 267,
        viewCenter: { x: 1000, y: 500 }, viewHeight: 5340, twistAngleRad: 0, locked: true,
        clipBoundary: [{ x: 15, y: 15 }, { x: 405, y: 15 }, { x: 405, y: 282 }, { x: 15, y: 282 }],
      }],
    });
    const session = new CadSession({ ...document, layouts: paper.layouts });
    const configured = setPaperLayoutPageSetup(session.document, paper.layoutId, {
      mediaName: "ISO_A4",
      orientation: "portrait",
      plotArea: { kind: "window", window: { x: 10, y: 20, width: 180, height: 250 } },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 },
      centerPlot: false,
      plotOriginMm: { x: 0, y: 0 },
    });
    session.commit(operation(0, "PAGESETUP"), configured.changes);
    const changed = session.document.layouts[1]!;
    expect(resolvePaperDefinition(changed)).toEqual({
      widthMm: 210, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    expect(resolvePageSetup(changed)).toMatchObject({
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "window" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 }, centerPlot: false,
    });
    expect(plotScaleDenominator(resolvePageSetup(changed)!)).toBe(2);
    expect(changed.viewports[0]).toMatchObject({ center: { x: 210, y: 148.5 }, width: 390, height: 267, locked: true });
    expect(changed.viewports[0]!.clipBoundary).toEqual([
      { x: 15, y: 15 }, { x: 405, y: 15 }, { x: 405, y: 282 }, { x: 15, y: 282 },
    ]);
    session.undo();
    expect(session.document.layouts[1]).toMatchObject({
      paper: { widthMm: 420, heightMm: 297 },
      pageSetup: { mediaName: "ISO_A3", orientation: "landscape" },
      viewports: [{ center: { x: 210, y: 148.5 }, width: 390, height: 267 }],
    });
    session.redo();
    expect(session.document.layouts[1]).toEqual(changed);
  });

  it("normalizes Layout plots to AutoCAD's 1:1 origin, accepts arbitrary Window coordinates and rejects invalid dimensions/scale", () => {
    const document = createEmptyDocument({ documentId: "F-102-guards" });
    const paper = createPaperLayout(document, { name: "F102 SHEET", viewports: [] });
    const source = { ...document, layouts: paper.layouts };
    const layoutPlot = setPaperLayoutPageSetup(source, paper.layoutId, {
      mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
      plotScale: { mode: "fit" }, centerPlot: true, plotOriginMm: { x: 12, y: 9 },
    }).layouts[1]!;
      expect(resolvePageSetup(layoutPlot)).toEqual({
        mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
        plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
        plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
        displayPlotStyles: false,
      });
    const outsideWindow = setPaperLayoutPageSetup(source, paper.layoutId, {
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "window", window: { x: -25, y: -40, width: 300, height: 400 } },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    }).layouts[1]!;
    expect(resolvePageSetup(outsideWindow).plotArea).toEqual({ kind: "window", window: { x: -25, y: -40, width: 300, height: 400 } });
    expect(() => setPaperLayoutPageSetup(source, paper.layoutId, {
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "window", window: { x: -25, y: -40, width: 0, height: 400 } },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 2 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
    })).toThrow(/positive dimensions/i);
    expect(() => setPaperLayoutPageSetup(source, paper.layoutId, {
      mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "extents" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 0 }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
    })).toThrow(/positive/i);
  });
});
