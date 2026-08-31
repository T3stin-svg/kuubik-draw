import {
  applyNamedPageSetup,
  buildLayoutPublishPlan,
  createPaperLayout,
  createPaperViewport,
  deletePaperLayout,
  formatViewportScale,
  metadataWithLayoutPublishSettings,
  panPaperViewportByPixels,
  readPdfUnderlays,
  renamePaperLayout,
  resolveLayoutPublishSettings,
  resolveModelPageSetup,
  resolvePageSetup,
  resolvePageSetupLibrary,
  resolvePaperDefinition,
  saveNamedPageSetup,
  setModelLayoutPageSetup,
  setPaperLayoutPageSetup,
  setPaperViewportDisplayLocked,
  setPaperViewportView,
  viewportScaleDenominator,
  type PdfUnderlayPlacement,
  type ViewportViewState,
} from "@kuubik/cad-core";
import {
  exportLayoutsVectorPdf,
  exportLayoutVectorPdf,
  exportModelVectorPdf,
  readPdfSummary,
  type LayoutPlotOptions,
  type ModelPlotOptions,
} from "@kuubik/cad-print";
import type { CadPageSetup, CadPaperRect, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { StoredPdfUnderlayReadback } from "./pdf-underlay-transaction.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

export type ShellCapabilityStatus = "candidate" | "disabled";

export interface ShellCapability {
  rows: string[];
  status: ShellCapabilityStatus;
  reason: string;
}

export const LAYOUT_PLOT_SHELL_CAPABILITIES: Readonly<Record<string, ShellCapability>> = Object.freeze({
  modelLayoutPlot: Object.freeze({ rows: ["F-096", "F-097", "F-098", "F-099", "F-100", "F-101", "F-102", "F-103", "F-104", "F-105", "F-106", "F-107", "F-114"], status: "candidate", reason: "DOM-independent deterministic contract; AutoCAD live evidence is still required for parity certification." }),
  pdfUnderlay: Object.freeze({ rows: ["F-115"], status: "candidate", reason: "Atomic SHA-bound storage and read-back are enabled; complex PDF.js rendering and AutoCAD PDFATTACH evidence are still required." }),
  nativeDwg: Object.freeze({ rows: ["F-112", "F-113", "F-117", "F-121"], status: "disabled", reason: "NATIVE_SDK_UNAVAILABLE: licensed ODA Drawings SDK or Autodesk RealDWG is not available." }),
  nativePlotProfiles: Object.freeze({ rows: ["F-108"], status: "disabled", reason: "PC3/CTB/STB are vendor-native resources and require a licensed native adapter plus AutoCAD read-back." }),
});

export interface LayoutPlotShellReadback {
  documentId: string;
  revision: number;
  activeLayoutId: string;
  canUndo: boolean;
  canRedo: boolean;
  layouts: Array<{
    id: string;
    name: string;
    kind: "model" | "paper";
    paper: ReturnType<typeof resolvePaperDefinition>;
    pageSetup: CadPageSetup;
    viewports: Array<{
      id: string;
      center: { x: number; y: number };
      width: number;
      height: number;
      viewCenter: { x: number; y: number };
      scaleDenominator: number;
      scaleLabel: string;
      twistAngleRad: number;
      locked: boolean;
      rectangular: boolean;
    }>;
  }>;
  namedPageSetups: ReturnType<typeof resolvePageSetupLibrary>;
  publish: ReturnType<typeof buildLayoutPublishPlan> | null;
  pdfUnderlays: PdfUnderlayPlacement[];
  capabilities: typeof LAYOUT_PLOT_SHELL_CAPABILITIES;
}

export type LayoutPlotTarget =
  | { kind: "model"; options?: ModelPlotOptions }
  | { kind: "layout"; layoutId: string; options?: LayoutPlotOptions }
  | { kind: "publish" };

export interface LayoutPlotPdfReadback {
  bytes: Uint8Array;
  sha256: string;
  summary: ReturnType<typeof readPdfSummary>;
  layoutIds: string[];
  skippedHandles: string[];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function activeLayoutId(live: DocumentLiveOrchestrator, documentId: string): string {
  const session = live.readBack().sessions.documents.find((entry) => entry.documentId === documentId);
  if (!session) throw new RangeError(`Document session ${documentId} is not open.`);
  return session.activeLayoutId;
}

export class DocumentLayoutPlotShell {
  constructor(
    readonly live: DocumentLiveOrchestrator,
    readonly documentId: string,
    readonly operationNamespace: string,
  ) {
    if (!documentId.trim() || !operationNamespace.trim()) throw new TypeError("Layout/plot shell document and operation namespace are required.");
    live.document(documentId);
  }

  document(): KDrawDocumentV1 {
    return this.live.document(this.documentId);
  }

  async createLayout(options: Parameters<typeof createPaperLayout>[1] = {}, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = createPaperLayout(this.document(), options);
    await this.commit("LAYOUT_CREATE", { name: options.name ?? null }, plan.changes, now);
    this.live.setLayout(this.documentId, plan.layoutId);
    return this.readBack();
  }

  async renameLayout(layoutId: string, name: string, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = renamePaperLayout(this.document(), layoutId, name);
    await this.commit("LAYOUT_RENAME", { layoutId, name }, plan.changes, now);
    return this.readBack();
  }

  async deleteLayout(layoutId: string, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = deletePaperLayout(this.document(), layoutId);
    await this.commit("LAYOUT_DELETE", { layoutId }, plan.changes, now);
    this.live.setLayout(this.documentId, plan.layoutId);
    return this.readBack();
  }

  async createRectViewport(
    layoutId: string,
    viewport: Omit<CadViewport, "id" | "clipBoundary">,
    now?: string,
  ): Promise<LayoutPlotShellReadback> {
    const plan = createPaperViewport(this.document(), layoutId, viewport);
    await this.commit("MVIEW_CREATE_RECT", { layoutId, viewport }, plan.changes, now);
    return this.readBack();
  }

  async setViewportView(layoutId: string, viewportId: string, state: ViewportViewState, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = setPaperViewportView(this.document(), layoutId, viewportId, state);
    await this.commit("MVIEW_VIEW", { layoutId, viewportId, state }, plan.changes, now);
    return this.readBack();
  }

  async panViewport(
    layoutId: string,
    viewportId: string,
    deltaPx: { x: number; y: number },
    viewportPx: { width: number; height: number },
    now?: string,
  ): Promise<LayoutPlotShellReadback> {
    const plan = panPaperViewportByPixels(this.document(), layoutId, viewportId, deltaPx, viewportPx);
    await this.commit("MVIEW_PAN", { layoutId, viewportId, deltaPx, viewportPx }, plan.changes, now);
    return this.readBack();
  }

  async setViewportLocked(layoutId: string, viewportId: string, locked: boolean, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = setPaperViewportDisplayLocked(this.document(), layoutId, viewportId, locked);
    if (plan.changes.length > 0) await this.commit("MVIEW_LOCK", { layoutId, viewportId, locked }, plan.changes, now);
    return this.readBack();
  }

  async setPageSetup(layoutId: string, pageSetup: CadPageSetup, now?: string): Promise<LayoutPlotShellReadback> {
    const layout = this.document().layouts.find((candidate) => candidate.id === layoutId);
    if (!layout) throw new RangeError(`Layout not found: ${layoutId}`);
    const plan = layout.kind === "model"
      ? setModelLayoutPageSetup(this.document(), layoutId, pageSetup)
      : setPaperLayoutPageSetup(this.document(), layoutId, pageSetup);
    await this.commit("PAGESETUP", { layoutId, pageSetup }, plan.changes, now);
    return this.readBack();
  }

  async saveNamedPageSetup(layoutId: string, name: string, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = saveNamedPageSetup(this.document(), layoutId, name);
    await this.commit("PAGESETUP_SAVE", { layoutId, name }, plan.changes, now);
    return this.readBack();
  }

  async applyNamedPageSetup(layoutId: string, setupId: string, now?: string): Promise<LayoutPlotShellReadback> {
    const plan = applyNamedPageSetup(this.document(), layoutId, setupId);
    await this.commit("PAGESETUP_APPLY", { layoutId, setupId }, plan.changes, now);
    return this.readBack();
  }

  async setPublishSettings(settings: ReturnType<typeof resolveLayoutPublishSettings>, now?: string): Promise<LayoutPlotShellReadback> {
    const change = metadataWithLayoutPublishSettings(this.document(), settings);
    await this.commit("PUBLISH_SETTINGS", { settings }, [change], now);
    return this.readBack();
  }

  async undo(now?: string): Promise<LayoutPlotShellReadback> {
    await this.live.undo(this.documentId, now);
    return this.readBack();
  }

  async redo(now?: string): Promise<LayoutPlotShellReadback> {
    await this.live.redo(this.documentId, now);
    return this.readBack();
  }

  async exportVectorPdf(target: LayoutPlotTarget): Promise<LayoutPlotPdfReadback> {
    const document = this.document();
    let bytes: Uint8Array;
    let skippedHandles: string[];
    let layoutIds: string[];
    if (target.kind === "model") {
      const output = exportModelVectorPdf(document, target.options ?? {});
      bytes = output.bytes; skippedHandles = output.skippedHandles; layoutIds = [document.layouts[0]!.id];
    } else if (target.kind === "layout") {
      const output = exportLayoutVectorPdf(document, target.layoutId, target.options ?? {});
      bytes = output.bytes; skippedHandles = output.skippedHandles; layoutIds = [target.layoutId];
    } else {
      const plan = buildLayoutPublishPlan(document);
      const settings = resolveLayoutPublishSettings(document);
      const options = Object.fromEntries(settings.sheets.flatMap((sheet) => sheet.displayWindow
        ? [[sheet.layoutId, { displayWindow: sheet.displayWindow }] as const]
        : []));
      const output = exportLayoutsVectorPdf(document, plan.layoutIds, options);
      bytes = output.bytes; skippedHandles = output.skippedHandles; layoutIds = plan.layoutIds;
    }
    return {
      bytes: Uint8Array.from(bytes),
      sha256: await sha256(bytes),
      summary: readPdfSummary(bytes),
      layoutIds: [...layoutIds],
      skippedHandles: [...skippedHandles],
    };
  }

  readPdfUnderlay(placementId: string): Promise<StoredPdfUnderlayReadback> {
    return this.live.readPdf(this.documentId, placementId);
  }

  readBack(): LayoutPlotShellReadback {
    const document = this.document();
    const session = this.live.readBack().sessions.documents.find((entry) => entry.documentId === this.documentId)!;
    const paperLayouts = document.layouts.filter((layout) => layout.kind === "paper");
    return {
      documentId: this.documentId,
      revision: document.revision,
      activeLayoutId: activeLayoutId(this.live, this.documentId),
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      layouts: document.layouts.map((layout) => ({
        id: layout.id,
        name: layout.name,
        kind: layout.kind,
        paper: resolvePaperDefinition(layout),
        pageSetup: (layout.kind === "model" ? resolveModelPageSetup(layout) : resolvePageSetup(layout))!,
        viewports: layout.viewports.map((viewport) => ({
          id: viewport.id,
          center: structuredClone(viewport.center),
          width: viewport.width,
          height: viewport.height,
          viewCenter: structuredClone(viewport.viewCenter),
          scaleDenominator: viewportScaleDenominator(viewport),
          scaleLabel: formatViewportScale(viewport),
          twistAngleRad: viewport.twistAngleRad,
          locked: viewport.locked,
          rectangular: viewport.clipBoundary === undefined,
        })),
      })),
      namedPageSetups: resolvePageSetupLibrary(document),
      publish: paperLayouts.length > 0 ? buildLayoutPublishPlan(document) : null,
      pdfUnderlays: readPdfUnderlays(document),
      capabilities: LAYOUT_PLOT_SHELL_CAPABILITIES,
    };
  }

  private async commit(commandId: string, args: unknown, changes: Parameters<DocumentLiveOrchestrator["commit"]>[2], now?: string): Promise<void> {
    const baseRevision = this.document().revision;
    await this.live.commit(this.documentId, {
      opId: `${this.operationNamespace}:${this.documentId}:${baseRevision + 1}:${commandId}`,
      baseRevision,
      commandId,
      args,
      targetHandles: [],
      resultHandles: [],
    }, changes, now);
  }
}
