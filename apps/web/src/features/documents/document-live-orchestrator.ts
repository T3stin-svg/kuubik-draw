import {
  applyAtomicOperation,
  migrateLayoutWorkspace,
  migratePaperWorkspace,
  readLayoutWorkspace,
  readPaperWorkspace,
  type CadChange,
  type LayoutWorkspaceRepairCode,
  type LayoutWorkspaceStateV1,
  type PaperWorkspaceReceiptV1,
  type PaperWorkspaceRepairCode,
  type PaperWorkspaceStateV1,
} from "@kuubik/cad-core";
import type { Viewport2D } from "@kuubik/cad-renderer";
import type { PreparedPdfUnderlay } from "@kuubik/cad-print";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, type DocumentRecoveryResult } from "../../indexed-db.js";
import { DocumentAutosaveRecovery } from "./autosave-recovery.js";
import { DocumentSessionCoordinator, type DocumentSessionReadback } from "./document-session-coordinator.js";
import {
  activateDocumentTab,
  closeDocumentTab,
  createDocumentTabsState,
  markDocumentTabPersisted,
  openDocumentTab,
  readBackDocumentTabs,
  setDocumentTabLayout,
  updateDocumentTab,
  type DocumentTabsReadback,
  type DocumentTabsState,
} from "./document-tabs.js";
import {
  commitPdfUnderlayAttachment,
  readStoredPdfUnderlay,
  type StoredPdfUnderlayReadback,
} from "./pdf-underlay-transaction.js";
import type { PdfUnderlayPlacement } from "@kuubik/cad-core";

export interface OpenLiveDocumentInput {
  documentId: string;
  fallbackDocument?: KDrawDocumentV1;
  sourceFileName?: string | null;
  activeLayoutId?: string;
  selectedHandles?: readonly string[];
  viewport?: Viewport2D;
  recordedAt?: string;
  layoutWorkspace?: "migrate";
  paperWorkspace?: "migrate";
}

export interface OpenLiveDocumentResult {
  document: KDrawDocumentV1;
  recovery: DocumentRecoveryResult;
  layoutWorkspace: {
    migrated: boolean;
    repairs: LayoutWorkspaceRepairCode[];
    state: LayoutWorkspaceStateV1;
    migrationOperationId: string | null;
  } | null;
  paperWorkspace: {
    migrated: boolean;
    repairs: PaperWorkspaceRepairCode[];
    state: PaperWorkspaceStateV1;
    receipt: PaperWorkspaceReceiptV1;
    migrationOperationId: string | null;
  } | null;
}

export interface DocumentLiveReadback {
  sessionId: string;
  tabs: DocumentTabsReadback;
  sessions: DocumentSessionReadback;
  recoveries: Array<{
    documentId: string;
    source: DocumentRecoveryResult["source"];
    recoveredRevision: number | null;
    ignoredOperationIds: string[];
    corruptSnapshotKeys: string[];
    corruptCompactionKeys: string[];
    uncleanSessionIds: string[];
    receipt: DocumentRecoveryResult["receipt"];
  }>;
}

function requireDocumentId(documentId: string): string {
  const normalized = documentId.trim();
  if (!normalized) throw new TypeError("Live document id is required.");
  return normalized;
}

/**
 * Browser-ready composition root for F-115, F-128, F-129 and F-133.
 *
 * A candidate CadSession revision is exposed to tabs only after the append-only
 * IndexedDB transaction and its independent read-back have succeeded.
 */
export class DocumentLiveOrchestrator {
  readonly #coordinator = new DocumentSessionCoordinator();
  readonly #autosave: DocumentAutosaveRecovery;
  readonly #recoveries = new Map<string, DocumentRecoveryResult>();
  #tabs: DocumentTabsState = createDocumentTabsState();

  constructor(
    readonly database: KDrawIndexedDb,
    readonly sessionId: string,
  ) {
    this.#autosave = new DocumentAutosaveRecovery(database, sessionId);
  }

  async open(input: OpenLiveDocumentInput): Promise<OpenLiveDocumentResult> {
    const documentId = requireDocumentId(input.documentId);
    if (input.fallbackDocument && input.fallbackDocument.documentId !== documentId) {
      throw new TypeError(`Fallback document ${input.fallbackDocument.documentId} does not match ${documentId}.`);
    }
    if (!input.fallbackDocument && !(await this.database.recoverDocument(documentId)).document) {
      throw new RangeError(`No persisted or fallback document exists for ${documentId}.`);
    }
    let recovery = await this.#autosave.open(documentId, input.recordedAt);
    let document = recovery.document ?? input.fallbackDocument;
    if (!document) throw new RangeError(`No persisted or fallback document exists for ${documentId}.`);
    let layoutWorkspace: OpenLiveDocumentResult["layoutWorkspace"] = null;
    if (input.layoutWorkspace === "migrate" || input.paperWorkspace === "migrate") {
      const migration = migrateLayoutWorkspace(document);
      let migrationOperationId: string | null = null;
      if (migration.migrated && recovery.document) {
        migrationOperationId = `layout-workspace-migrate:${documentId}:${document.revision + 1}`;
        const operation: CadOperation = {
          opId: migrationOperationId,
          baseRevision: document.revision,
          commandId: "LAYOUT_WORKSPACE_MIGRATE",
          args: { repairs: migration.repairs },
          targetHandles: [],
          resultHandles: [],
        };
        const migrated = applyAtomicOperation(document, operation, migration.changes, input.recordedAt);
        await this.#autosave.commit(migrated.document, operation, recovery.sessionHistory ?? undefined);
        recovery = await this.database.recoverDocument(documentId);
        document = recovery.document!;
      } else if (migration.migrated) {
        document = migration.document;
      }
      layoutWorkspace = {
        migrated: migration.migrated,
        repairs: [...migration.repairs],
        state: readLayoutWorkspace(document),
        migrationOperationId,
      };
    }
    let paperWorkspace: OpenLiveDocumentResult["paperWorkspace"] = null;
    if (input.paperWorkspace === "migrate") {
      const migration = migratePaperWorkspace(document);
      let migrationOperationId: string | null = null;
      if (migration.migrated && recovery.document) {
        migrationOperationId = `paper-workspace-migrate:${documentId}:${document.revision + 1}`;
        const operation: CadOperation = {
          opId: migrationOperationId,
          baseRevision: document.revision,
          commandId: "PAPER_WORKSPACE_MIGRATE",
          args: { repairs: migration.repairs, receiptCode: migration.receipt.code },
          targetHandles: [],
          resultHandles: [],
        };
        const migrated = applyAtomicOperation(document, operation, migration.changes, input.recordedAt);
        await this.#autosave.commit(migrated.document, operation, recovery.sessionHistory ?? undefined);
        recovery = await this.database.recoverDocument(documentId);
        document = recovery.document!;
      } else if (migration.migrated) {
        document = migration.document;
      }
      paperWorkspace = {
        migrated: migration.migrated,
        repairs: [...migration.repairs],
        state: readPaperWorkspace(document),
        receipt: structuredClone(migration.receipt),
        migrationOperationId,
      };
    }
    if (!recovery.document) await this.#autosave.checkpoint(document);

    const ignored = new Set(recovery.ignoredOperationIds);
    const operations = await this.database.operations(documentId);
    const persistedLayoutId = layoutWorkspace?.state.activeLayoutId;
    const openedLayoutId = input.activeLayoutId ?? persistedLayoutId;
    this.#coordinator.open(document, {
      ...(openedLayoutId === undefined ? {} : { activeLayoutId: openedLayoutId }),
      ...(input.selectedHandles === undefined ? {} : { selectedHandles: input.selectedHandles }),
      ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
      appliedOperationIds: operations.filter((record) => !ignored.has(record.opId)).map((record) => record.opId),
      sessionHistory: recovery.sessionHistory,
    });
    this.#tabs = openDocumentTab(this.#tabs, {
      document,
      ...(input.sourceFileName === undefined ? {} : { sourceFileName: input.sourceFileName }),
      ...(openedLayoutId === undefined ? {} : { activeLayoutId: openedLayoutId }),
      persistedRevision: document.revision,
    });
    this.#recoveries.set(documentId, structuredClone(recovery));
    return {
      document: structuredClone(document),
      recovery: structuredClone(recovery),
      layoutWorkspace: structuredClone(layoutWorkspace),
      paperWorkspace: structuredClone(paperWorkspace),
    };
  }

  activate(documentId: string): void {
    const id = requireDocumentId(documentId);
    this.#coordinator.activate(id);
    this.#tabs = activateDocumentTab(this.#tabs, id);
  }

  setSelection(documentId: string, handles: readonly string[]): void {
    this.#coordinator.setSelection(requireDocumentId(documentId), handles);
  }

  setViewport(documentId: string, viewport: Viewport2D): void {
    this.#coordinator.setViewport(requireDocumentId(documentId), viewport);
  }

  setLayout(documentId: string, layoutId: string): void {
    const id = requireDocumentId(documentId);
    this.#coordinator.setLayout(id, layoutId);
    this.#tabs = setDocumentTabLayout(this.#tabs, id, layoutId);
  }

  recordCommand(documentId: string, command: string): void {
    this.#coordinator.recordCommand(requireDocumentId(documentId), command);
  }

  document(documentId: string): KDrawDocumentV1 {
    return this.#coordinator.document(requireDocumentId(documentId));
  }

  async commit(
    documentId: string,
    operation: CadOperation,
    changes: readonly CadChange[],
    now?: string,
  ): Promise<KDrawDocumentV1> {
    const id = requireDocumentId(documentId);
    await this.#coordinator.commitPersisted(
      id,
      operation,
      changes,
      (document, committedOperation, history) => this.#autosave.commit(document, committedOperation, history),
      now,
    );
    return this.acceptPersistedDocument(id);
  }

  async undo(documentId: string, now?: string): Promise<KDrawDocumentV1 | null> {
    const id = requireDocumentId(documentId);
    const committed = await this.#coordinator.undoPersisted(
      id,
      (document, operation, history) => this.#autosave.commit(document, operation, history),
      now,
    );
    return committed ? this.acceptPersistedDocument(id) : null;
  }

  async redo(documentId: string, now?: string): Promise<KDrawDocumentV1 | null> {
    const id = requireDocumentId(documentId);
    const committed = await this.#coordinator.redoPersisted(
      id,
      (document, operation, history) => this.#autosave.commit(document, operation, history),
      now,
    );
    return committed ? this.acceptPersistedDocument(id) : null;
  }

  async attachPdf(
    documentId: string,
    operation: CadOperation,
    prepared: PreparedPdfUnderlay,
    placement: PdfUnderlayPlacement,
    now?: string,
  ): Promise<StoredPdfUnderlayReadback> {
    const id = requireDocumentId(documentId);
    if (!this.#autosave.isOpen(id)) throw new TypeError(`Document ${id} is not open in live session ${this.sessionId}.`);
    const readback = await commitPdfUnderlayAttachment(
      this.database,
      this.#coordinator,
      id,
      operation,
      prepared,
      placement,
      now,
    );
    this.acceptPersistedDocument(id);
    return readback;
  }

  async readPdf(documentId: string, placementId: string): Promise<StoredPdfUnderlayReadback> {
    const id = requireDocumentId(documentId);
    return readStoredPdfUnderlay(this.database, this.#coordinator.document(id), placementId);
  }

  async close(documentId: string, recordedAt?: string): Promise<void> {
    const id = requireDocumentId(documentId);
    const document = this.#coordinator.document(id);
    await this.#autosave.close(id, document.revision, recordedAt);
    const result = closeDocumentTab(this.#tabs, id);
    if (!result.closed) throw new TypeError(`Persisted document ${id} unexpectedly requires discard confirmation.`);
    this.#tabs = result.state;
    this.#coordinator.close(id);
    this.#recoveries.delete(id);
  }

  readBack(): DocumentLiveReadback {
    return {
      sessionId: this.sessionId,
      tabs: readBackDocumentTabs(this.#tabs),
      sessions: this.#coordinator.readBack(),
      recoveries: [...this.#recoveries.entries()].map(([documentId, recovery]) => ({
        documentId,
        source: recovery.source,
        recoveredRevision: recovery.recoveredRevision,
        ignoredOperationIds: [...recovery.ignoredOperationIds],
        corruptSnapshotKeys: [...recovery.corruptSnapshotKeys],
        corruptCompactionKeys: [...recovery.corruptCompactionKeys],
        uncleanSessionIds: [...recovery.uncleanSessionIds],
        receipt: structuredClone(recovery.receipt),
      })),
    };
  }

  private acceptPersistedDocument(documentId: string): KDrawDocumentV1 {
    const document = this.#coordinator.document(documentId);
    const activeLayoutId = this.#coordinator.readBack().documents.find((entry) => entry.documentId === documentId)!.activeLayoutId;
    this.#tabs = updateDocumentTab(this.#tabs, { document, activeLayoutId });
    this.#tabs = markDocumentTabPersisted(this.#tabs, documentId, document.revision);
    return structuredClone(document);
  }
}
