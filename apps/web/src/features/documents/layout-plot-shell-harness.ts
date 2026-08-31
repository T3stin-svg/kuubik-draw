import { createEmptyDocument } from "@kuubik/cad-core";
import { createPdfUnderlayPlacement, preparePdfUnderlay } from "@kuubik/cad-print";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentLayoutPlotShell, type LayoutPlotShellReadback } from "./layout-plot-shell.js";

const DEFAULT_DATABASE_NAME = "kuubik-draw-layout-plot-shell";

export interface LayoutPlotShellHarnessOptions {
  databaseName?: string;
  resetDatabase?: boolean;
}

export interface LayoutPlotShellHarnessResult {
  ok: true;
  beforeCrash: LayoutPlotShellReadback;
  afterReload: LayoutPlotShellReadback;
  vectorPdf: {
    sha256: string;
    byteLength: number;
    base64: string;
    pages: number;
    vectorStrokeCommands: number;
    xrefOffsetsValid: boolean;
    stableAcrossReload: true;
  };
  underlay: {
    placementId: string;
    sha256: string;
    byteLength: number;
    stableAcrossReload: true;
  };
  recovery: {
    revision: number;
    source: string;
    uncleanSessionIds: string[];
  };
  undoRedo: {
    renamedRevision: number;
    undoRevision: number;
    undoName: string;
    redoRevision: number;
    redoName: string;
  };
}

function underlayPdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function deleteDatabase(factory: IDBFactory, databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked by an open connection."));
  });
}

export function createLayoutPlotShellFixture() {
  const document = createEmptyDocument({ documentId: "layout-plot", now: "2026-08-31T14:00:00.000Z" });
  document.metadata.title = "KUUBIK LAYOUT PLOT";
  document.entities = [
    { kind: "line" as const, handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10_000, y: 5_000 } },
    { kind: "circle" as const, handle: "11", layerId: "0", center: { x: 5_000, y: 2_500 }, radius: 1_000 },
  ];
  return document;
}

export async function configureLayoutPlotShell(shell: DocumentLayoutPlotShell): Promise<void> {
  await shell.createLayout({ name: "SHEET A", viewports: [] }, "2026-08-31T14:00:01.000Z");
  await shell.createRectViewport("layout-1", {
    center: { x: 210, y: 148.5 }, width: 380, height: 257,
    viewCenter: { x: 5_000, y: 2_500 }, viewHeight: 12_850,
    twistAngleRad: 0, locked: false,
  }, "2026-08-31T14:00:02.000Z");
  await shell.setViewportView("layout-1", "viewport-1", {
    viewCenter: { x: 5_000, y: 2_500 }, scaleDenominator: 100, twistAngleRad: Math.PI / 6,
  }, "2026-08-31T14:00:03.000Z");
  await shell.panViewport("layout-1", "viewport-1", { x: 100, y: -50 }, { width: 1_000, height: 500 }, "2026-08-31T14:00:04.000Z");
  await shell.setViewportLocked("layout-1", "viewport-1", true, "2026-08-31T14:00:05.000Z");
  await shell.setPageSetup("layout-1", {
    mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
    plotScale: { mode: "custom", paperUnits: 5, drawingUnits: 7 }, centerPlot: true, plotOriginMm: { x: 4, y: 6 },
    plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true }, displayPlotStyles: true,
  }, "2026-08-31T14:00:06.000Z");
  await shell.saveNamedPageSetup("layout-1", "A3 MONO", "2026-08-31T14:00:07.000Z");
  const publish = shell.readBack().publish!.settings;
  publish.baseFileName = "KUUBIK-LAYOUT-PLOT";
  await shell.setPublishSettings(publish, "2026-08-31T14:00:08.000Z");
}

export async function runLayoutPlotShellHarness(
  factory: IDBFactory = indexedDB,
  options: LayoutPlotShellHarnessOptions = {},
): Promise<LayoutPlotShellHarnessResult> {
  const databaseName = options.databaseName?.trim() || DEFAULT_DATABASE_NAME;
  if (options.resetDatabase ?? true) await deleteDatabase(factory, databaseName);
  const database = new KDrawIndexedDb(factory, databaseName);
  const live = new DocumentLiveOrchestrator(database, "layout-plot-crashed");
  await live.open({ documentId: "layout-plot", fallbackDocument: createLayoutPlotShellFixture(), recordedAt: "2026-08-31T14:00:00.000Z" });
  const shell = new DocumentLayoutPlotShell(live, "layout-plot", "wave4-crashed");
  await configureLayoutPlotShell(shell);
  const renamed = await shell.renameLayout("layout-1", "SHEET A - ISSUE 1", "2026-08-31T14:00:09.000Z");
  const undone = await shell.undo("2026-08-31T14:00:10.000Z");
  const redone = await shell.redo("2026-08-31T14:00:11.000Z");

  const prepared = await preparePdfUnderlay(underlayPdfBytes(), { attachmentId: "reference-pdf", fileName: "reference.pdf" });
  const placement = createPdfUnderlayPlacement(prepared, {
    id: "reference-underlay", pageNumber: 1, position: { x: 100, y: 200 }, scale: 0.5, rotationRad: Math.PI / 12, opacity: 0.65,
  });
  await live.attachPdf("layout-plot", {
    opId: "wave4-crashed:layout-plot:12:PDFATTACH", baseRevision: redone.revision, commandId: "PDFATTACH",
    args: { placementId: placement.id }, targetHandles: [], resultHandles: [],
  }, prepared, placement, "2026-08-31T14:00:12.000Z");
  const underlay = await shell.readPdfUnderlay(placement.id);
  const pdf = await shell.exportVectorPdf({ kind: "publish" });
  const beforeCrash = shell.readBack();
  database.close();

  const reloadedDatabase = new KDrawIndexedDb(factory, databaseName);
  const reloadedLive = new DocumentLiveOrchestrator(reloadedDatabase, "layout-plot-reloaded");
  const recovery = await reloadedLive.open({ documentId: "layout-plot", recordedAt: "2026-08-31T14:01:00.000Z" });
  const reloadedShell = new DocumentLayoutPlotShell(reloadedLive, "layout-plot", "wave4-reloaded");
  reloadedLive.setLayout("layout-plot", "layout-1");
  const afterReload = reloadedShell.readBack();
  const reloadedPdf = await reloadedShell.exportVectorPdf({ kind: "publish" });
  const reloadedUnderlay = await reloadedShell.readPdfUnderlay(placement.id);
  if (reloadedPdf.sha256 !== pdf.sha256 || reloadedPdf.bytes.byteLength !== pdf.bytes.byteLength) throw new TypeError("Vector PDF changed across recovery.");
  if (reloadedUnderlay.attachment.sha256 !== underlay.attachment.sha256 || reloadedUnderlay.bytes.byteLength !== underlay.bytes.byteLength) throw new TypeError("PDF underlay changed across recovery.");
  await reloadedLive.close("layout-plot", "2026-08-31T14:02:00.000Z");
  reloadedDatabase.close();

  return {
    ok: true,
    beforeCrash,
    afterReload,
    vectorPdf: {
      sha256: pdf.sha256,
      byteLength: pdf.bytes.byteLength,
      base64: base64(pdf.bytes),
      pages: pdf.summary.pages,
      vectorStrokeCommands: pdf.summary.vectorStrokeCommands,
      xrefOffsetsValid: pdf.summary.xrefOffsetsValid,
      stableAcrossReload: true,
    },
    underlay: {
      placementId: placement.id,
      sha256: underlay.attachment.sha256,
      byteLength: underlay.bytes.byteLength,
      stableAcrossReload: true,
    },
    recovery: {
      revision: recovery.document.revision,
      source: recovery.recovery.source,
      uncleanSessionIds: recovery.recovery.uncleanSessionIds,
    },
    undoRedo: {
      renamedRevision: renamed.revision,
      undoRevision: undone.revision,
      undoName: undone.layouts.find((layout) => layout.id === "layout-1")!.name,
      redoRevision: redone.revision,
      redoName: redone.layouts.find((layout) => layout.id === "layout-1")!.name,
    },
  };
}

declare global {
  interface Window {
    runKuubikLayoutPlotShellHarness?: typeof runLayoutPlotShellHarness;
  }
}

if (typeof window !== "undefined") window.runKuubikLayoutPlotShellHarness = runLayoutPlotShellHarness;
