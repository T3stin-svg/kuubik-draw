import {
  activateLayoutWorkspace,
  readLayoutWorkspace,
  readPaperWorkspace,
  setPaperWorkspacePageSetup,
  type LayoutWorkspaceEditResult,
  type PaperWorkspaceLayoutStateV1,
  type PaperWorkspaceStateV1,
} from "@kuubik/cad-core";
import type { CadPageSetup, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

export interface DocumentPaperWorkspaceReadback {
  documentId: string;
  revision: number;
  paperUnits: "mm";
  activeLayoutId: string;
  activeSpace: "model" | "paper";
  canUndo: boolean;
  canRedo: boolean;
  papers: PaperWorkspaceLayoutStateV1[];
}

/**
 * F-098 document-model boundary for physical paper state.
 *
 * Paper geometry, active Model/Paper context, page setup and viewport
 * ownership are accepted only after one append-only document revision passes
 * storage read-back.
 */
export class DocumentPaperWorkspace {
  constructor(
    readonly live: DocumentLiveOrchestrator,
    readonly documentId: string,
    readonly operationNamespace: string,
  ) {
    if (!documentId.trim() || !operationNamespace.trim()) {
      throw new TypeError("Paper workspace document and operation namespace are required.");
    }
    this.synchronizeActiveLayout();
  }

  document(): KDrawDocumentV1 {
    return this.live.document(this.documentId);
  }

  async switchLayout(layoutId: string, now?: string): Promise<DocumentPaperWorkspaceReadback> {
    return this.commit("PAPER_SPACE_ACTIVATE", { layoutId }, activateLayoutWorkspace(this.document(), layoutId), now);
  }

  async setPageSetup(layoutId: string, pageSetup: CadPageSetup, now?: string): Promise<DocumentPaperWorkspaceReadback> {
    return this.commit(
      "PAPER_SPACE_PAGE_SETUP",
      { layoutId, mediaName: pageSetup.mediaName, orientation: pageSetup.orientation },
      setPaperWorkspacePageSetup(this.document(), layoutId, pageSetup),
      now,
    );
  }

  async undo(now?: string): Promise<DocumentPaperWorkspaceReadback> {
    await this.live.undo(this.documentId, now);
    this.synchronizeActiveLayout();
    return this.readBack();
  }

  async redo(now?: string): Promise<DocumentPaperWorkspaceReadback> {
    await this.live.redo(this.documentId, now);
    this.synchronizeActiveLayout();
    return this.readBack();
  }

  readBack(): DocumentPaperWorkspaceReadback {
    const document = this.document();
    const state = readPaperWorkspace(document);
    const session = this.live.readBack().sessions.documents.find((entry) => entry.documentId === this.documentId);
    if (!session || session.activeLayoutId !== state.activeLayoutId) {
      throw new TypeError(`Paper workspace ${this.documentId} active state differs from the live session.`);
    }
    return {
      documentId: this.documentId,
      revision: document.revision,
      paperUnits: state.paperUnits,
      activeLayoutId: state.activeLayoutId,
      activeSpace: state.activeSpace,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      papers: structuredClone(state.papers),
    };
  }

  private async commit(
    commandId: string,
    args: unknown,
    plan: LayoutWorkspaceEditResult,
    now?: string,
  ): Promise<DocumentPaperWorkspaceReadback> {
    if (plan.changes.length > 0) {
      const document = this.document();
      await this.live.commit(this.documentId, {
        opId: `${this.operationNamespace}:${this.documentId}:${document.revision + 1}:${commandId}`,
        baseRevision: document.revision,
        commandId,
        args,
        targetHandles: [],
        resultHandles: [],
      }, plan.changes, now);
    }
    this.synchronizeActiveLayout();
    return this.readBack();
  }

  private synchronizeActiveLayout(): PaperWorkspaceStateV1 {
    const state = readPaperWorkspace(this.document());
    const layoutState = readLayoutWorkspace(this.document());
    if (state.activeLayoutId !== layoutState.activeLayoutId || state.activeSpace !== layoutState.activeSpace) {
      throw new TypeError(`Paper and layout workspace context differ for ${this.documentId}.`);
    }
    this.live.setLayout(this.documentId, state.activeLayoutId);
    return state;
  }
}
