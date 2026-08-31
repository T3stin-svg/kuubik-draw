import {
  activateLayoutWorkspace,
  copyPaperLayoutWorkspace,
  createPaperLayout,
  createPaperLayoutWorkspace,
  deletePaperLayoutWorkspace,
  readLayoutWorkspace,
  renamePaperLayoutWorkspace,
  reorderPaperLayoutWorkspace,
  resolvePageSetupLibrary,
  type LayoutWorkspaceEditResult,
  type LayoutWorkspaceStateV1,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

export interface DocumentLayoutWorkspaceReadback {
  documentId: string;
  revision: number;
  activeLayoutId: string;
  activeSpace: "model" | "paper";
  tabOrder: string[];
  nextLayoutSequence: number;
  nextViewportSequence: number;
  canUndo: boolean;
  canRedo: boolean;
  layouts: Array<{
    id: string;
    name: string;
    kind: "model" | "paper";
    pageSetupId: string | null;
    viewportIds: string[];
  }>;
}

/**
 * F-096/F-097 document-model boundary.
 *
 * Layout collection and active/tab state are committed in one CadSession
 * operation. The live session changes only after append-only storage accepts
 * the candidate revision.
 */
export class DocumentLayoutWorkspace {
  constructor(
    readonly live: DocumentLiveOrchestrator,
    readonly documentId: string,
    readonly operationNamespace: string,
  ) {
    if (!documentId.trim() || !operationNamespace.trim()) {
      throw new TypeError("Layout workspace document and operation namespace are required.");
    }
    this.synchronizeActiveLayout();
  }

  document(): KDrawDocumentV1 {
    return this.live.document(this.documentId);
  }

  async switchLayout(layoutId: string, now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_ACTIVATE", { layoutId }, activateLayoutWorkspace(this.document(), layoutId), now);
  }

  async createLayout(
    options: Parameters<typeof createPaperLayout>[1] = {},
    now?: string,
  ): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_CREATE", { name: options.name ?? null }, createPaperLayoutWorkspace(this.document(), options), now);
  }

  async copyLayout(layoutId: string, now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_COPY", { layoutId }, copyPaperLayoutWorkspace(this.document(), layoutId), now);
  }

  async renameLayout(layoutId: string, name: string, now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_RENAME", { layoutId, name }, renamePaperLayoutWorkspace(this.document(), layoutId, name), now);
  }

  async deleteLayout(layoutId: string, now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_DELETE", { layoutId }, deletePaperLayoutWorkspace(this.document(), layoutId), now);
  }

  async reorderLayout(layoutId: string, targetTabIndex: number, now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    return this.commit("LAYOUT_REORDER", { layoutId, targetTabIndex }, reorderPaperLayoutWorkspace(this.document(), layoutId, targetTabIndex), now);
  }

  async undo(now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    await this.live.undo(this.documentId, now);
    this.synchronizeActiveLayout();
    return this.readBack();
  }

  async redo(now?: string): Promise<DocumentLayoutWorkspaceReadback> {
    await this.live.redo(this.documentId, now);
    this.synchronizeActiveLayout();
    return this.readBack();
  }

  readBack(): DocumentLayoutWorkspaceReadback {
    const document = this.document();
    const workspace = readLayoutWorkspace(document);
    const pageSetupLibrary = resolvePageSetupLibrary(document);
    const session = this.live.readBack().sessions.documents.find((entry) => entry.documentId === this.documentId);
    if (!session || session.activeLayoutId !== workspace.activeLayoutId) {
      throw new TypeError(`Layout workspace ${this.documentId} active state differs from the live session.`);
    }
    return {
      documentId: this.documentId,
      revision: document.revision,
      activeLayoutId: workspace.activeLayoutId,
      activeSpace: workspace.activeSpace,
      tabOrder: [...workspace.tabOrder],
      nextLayoutSequence: workspace.nextLayoutSequence,
      nextViewportSequence: workspace.nextViewportSequence,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      layouts: workspace.tabOrder.map((layoutId) => {
        const layout = document.layouts.find((candidate) => candidate.id === layoutId)!;
        return {
          id: layout.id,
          name: layout.name,
          kind: layout.kind,
          pageSetupId: pageSetupLibrary.assignments[layout.id] ?? null,
          viewportIds: layout.viewports.map((viewport) => viewport.id),
        };
      }),
    };
  }

  private async commit(
    commandId: string,
    args: unknown,
    plan: LayoutWorkspaceEditResult,
    now?: string,
  ): Promise<DocumentLayoutWorkspaceReadback> {
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

  private synchronizeActiveLayout(): LayoutWorkspaceStateV1 {
    const workspace = readLayoutWorkspace(this.document());
    this.live.setLayout(this.documentId, workspace.activeLayoutId);
    return workspace;
  }
}
