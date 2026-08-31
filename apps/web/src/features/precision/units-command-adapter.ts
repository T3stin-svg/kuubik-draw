import {
  normalizeCadUnitsContract,
  readCadUnitsContract,
  replaceDrawingContent,
  type CadSessionHistoryState,
  type CadUnitsChangeOptions,
  type CadUnitsContractV1,
  type CadUnitsDocumentReadback,
} from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { DocumentSessionCoordinator } from "../documents/document-session-coordinator.js";
import { PrecisionUnitsFeatureModel } from "./units-contract.js";

export interface PrecisionUnitsRecoveryReadback {
  document: KDrawDocumentV1 | null;
  ignoredOperationIds: string[];
  corruptSnapshotKeys: string[];
  corruptCompactionKeys: string[];
  sessionHistory: CadSessionHistoryState | null;
}

/** Structural port implemented by KDrawIndexedDb; kept injectable for browser and fault tests. */
export interface PrecisionUnitsPersistencePort {
  recoverDocument(documentId: string): Promise<PrecisionUnitsRecoveryReadback>;
  operations(documentId: string): Promise<Array<{ opId: string }>>;
  loadDocument(documentId: string): Promise<KDrawDocumentV1 | null>;
  commitRevision(document: KDrawDocumentV1, operation: CadOperation, history?: CadSessionHistoryState): Promise<void>;
}

export type PrecisionUnitsDialogStatus = "closed" | "editing" | "invalid";

export interface PrecisionUnitsDialogReadback {
  status: PrecisionUnitsDialogStatus;
  draft: CadUnitsContractV1 | null;
  error: string | null;
}

export interface PrecisionUnitsAdapterReadback {
  document: KDrawDocumentV1;
  contract: CadUnitsContractV1;
  dialog: PrecisionUnitsDialogReadback;
  canUndo: boolean;
  canRedo: boolean;
  blocked: boolean;
}

export interface PrecisionUnitsCommitReadback extends CadUnitsDocumentReadback {
  operation: CadOperation;
  persisted: true;
}

export class PrecisionUnitsPersistenceError extends Error {
  constructor(
    readonly code: "RECOVERY_INVALID" | "READBACK_MISSING" | "READBACK_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "PrecisionUnitsPersistenceError";
  }
}

export interface PrecisionUnitsCommandAdapterOptions {
  operationId?: (documentId: string, nextRevision: number) => string;
}

function exact(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultOperationId(documentId: string, nextRevision: number): string {
  return `units:${documentId}:${nextRevision}:${crypto.randomUUID()}`;
}

/**
 * Browser-ready F-053 UNITS boundary. Preview, commit and durable read-back all
 * consume the same normalized core contract; no display precision touches geometry.
 */
export class PrecisionUnitsCommandAdapter {
  readonly #model = new PrecisionUnitsFeatureModel();
  readonly #coordinator = new DocumentSessionCoordinator();
  readonly #operationId: (documentId: string, nextRevision: number) => string;
  #dialog: PrecisionUnitsDialogReadback = { status: "closed", draft: null, error: null };
  #blocked = false;

  private constructor(
    private readonly persistence: PrecisionUnitsPersistencePort,
    document: KDrawDocumentV1,
    appliedOperationIds: Iterable<string>,
    history: CadSessionHistoryState | null,
    options: PrecisionUnitsCommandAdapterOptions,
  ) {
    readCadUnitsContract(document);
    this.#operationId = options.operationId ?? defaultOperationId;
    this.#coordinator.open(document, { appliedOperationIds, sessionHistory: history });
  }

  static async open(
    persistence: PrecisionUnitsPersistencePort,
    documentId: string,
    options: PrecisionUnitsCommandAdapterOptions = {},
  ): Promise<PrecisionUnitsCommandAdapter> {
    if (!documentId.trim()) throw new TypeError("UNITS document id is required.");
    const recovery = await persistence.recoverDocument(documentId);
    if (!recovery.document) {
      throw new PrecisionUnitsPersistenceError("READBACK_MISSING", `Document ${documentId} has no durable UNITS read-back.`);
    }
    if (recovery.document.documentId !== documentId
      || recovery.ignoredOperationIds.length > 0
      || recovery.corruptSnapshotKeys.length > 0
      || recovery.corruptCompactionKeys.length > 0) {
      throw new PrecisionUnitsPersistenceError("RECOVERY_INVALID", `Document ${documentId} recovery is degraded; UNITS remains closed.`);
    }
    try {
      readCadUnitsContract(recovery.document);
    } catch (error) {
      throw new PrecisionUnitsPersistenceError("RECOVERY_INVALID", `Document ${documentId} has an invalid durable UNITS contract: ${errorMessage(error)}`);
    }
    const operations = await persistence.operations(documentId);
    return new PrecisionUnitsCommandAdapter(
      persistence,
      recovery.document,
      operations.map((record) => record.opId),
      recovery.sessionHistory,
      options,
    );
  }

  openDialog(): PrecisionUnitsDialogReadback {
    this.assertAvailable();
    this.#dialog = { status: "editing", draft: this.#model.read(this.document), error: null };
    return this.dialogReadback();
  }

  updateDraft(patch: Partial<CadUnitsContractV1>): PrecisionUnitsDialogReadback {
    this.assertAvailable();
    if (!this.#dialog.draft) throw new TypeError("UNITS dialog is not open.");
    try {
      const draft = normalizeCadUnitsContract({ ...this.#dialog.draft, ...patch });
      this.#dialog = { status: "editing", draft, error: null };
    } catch (error) {
      this.#dialog = { ...this.#dialog, status: "invalid", error: errorMessage(error) };
    }
    return this.dialogReadback();
  }

  cancelDialog(): PrecisionUnitsDialogReadback {
    this.#dialog = { status: "closed", draft: null, error: null };
    return this.dialogReadback();
  }

  preview(options: CadUnitsChangeOptions = {}): CadUnitsDocumentReadback {
    this.assertDraftValid();
    return this.#model.plan(this.document, this.#dialog.draft!, options);
  }

  async commit(options: CadUnitsChangeOptions = {}, now?: string): Promise<PrecisionUnitsCommitReadback> {
    this.assertDraftValid();
    const before = this.document;
    const planned = this.#model.plan(before, this.#dialog.draft!, options);
    const operation: CadOperation = {
      opId: this.#operationId(before.documentId, before.revision + 1),
      baseRevision: before.revision,
      commandId: "UNITS",
      args: {
        contract: structuredClone(planned.current),
        existingGeometryPolicy: options.existingGeometryPolicy ?? null,
      },
      targetHandles: [],
      resultHandles: [],
    };
    await this.persistCandidate(operation, [
      replaceDrawingContent(planned.document),
      { type: "set-metadata", metadata: structuredClone(planned.document.metadata) },
    ], now);
    const document = this.document;
    this.#dialog = { status: "closed", draft: null, error: null };
    return {
      document,
      previous: planned.previous,
      current: this.#model.read(document),
      coordinatesPreserved: true,
      coordinateScale: 1,
      operation,
      persisted: true,
    };
  }

  async undo(now?: string): Promise<PrecisionUnitsAdapterReadback | null> {
    this.assertAvailable();
    const committed = await this.persistHistory("undo", now);
    if (!committed) return null;
    this.cancelDialog();
    return this.readBack();
  }

  async redo(now?: string): Promise<PrecisionUnitsAdapterReadback | null> {
    this.assertAvailable();
    const committed = await this.persistHistory("redo", now);
    if (!committed) return null;
    this.cancelDialog();
    return this.readBack();
  }

  get document(): KDrawDocumentV1 {
    return this.#coordinator.document(this.documentId);
  }

  get documentId(): string {
    const active = this.#coordinator.readBack().activeDocumentId;
    if (!active) throw new TypeError("UNITS document session is not open.");
    return active;
  }

  readBack(): PrecisionUnitsAdapterReadback {
    const session = this.#coordinator.readBack().documents[0]!;
    const document = this.document;
    return {
      document,
      contract: this.#model.read(document),
      dialog: this.dialogReadback(),
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      blocked: this.#blocked,
    };
  }

  private async persistCandidate(
    operation: CadOperation,
    changes: Parameters<DocumentSessionCoordinator["commitPersisted"]>[2],
    now?: string,
  ): Promise<void> {
    this.assertAvailable();
    try {
      await this.#coordinator.commitPersisted(
        this.documentId,
        operation,
        changes,
        (document, committedOperation, history) => this.persistAndVerify(document, committedOperation, history),
        now,
      );
    } catch (error) {
      if (error instanceof PrecisionUnitsPersistenceError
        && (error.code === "READBACK_MISSING" || error.code === "READBACK_MISMATCH")) this.#blocked = true;
      throw error;
    }
  }

  private async persistHistory(kind: "undo" | "redo", now?: string): Promise<unknown | null> {
    try {
      const persist = (document: KDrawDocumentV1, operation: CadOperation, history: CadSessionHistoryState) => (
        this.persistAndVerify(document, operation, history)
      );
      return kind === "undo"
        ? await this.#coordinator.undoPersisted(this.documentId, persist, now)
        : await this.#coordinator.redoPersisted(this.documentId, persist, now);
    } catch (error) {
      if (error instanceof PrecisionUnitsPersistenceError
        && (error.code === "READBACK_MISSING" || error.code === "READBACK_MISMATCH")) this.#blocked = true;
      throw error;
    }
  }

  private async persistAndVerify(
    document: KDrawDocumentV1,
    operation: CadOperation,
    history: CadSessionHistoryState,
  ): Promise<void> {
    await this.persistence.commitRevision(document, operation, history);
    const stored = await this.persistence.loadDocument(document.documentId);
    if (!stored) {
      throw new PrecisionUnitsPersistenceError("READBACK_MISSING", `Document ${document.documentId} vanished after UNITS revision ${document.revision}.`);
    }
    try {
      readCadUnitsContract(stored);
    } catch (error) {
      throw new PrecisionUnitsPersistenceError("READBACK_MISMATCH", `Document ${document.documentId} has an invalid UNITS revision ${document.revision} read-back: ${errorMessage(error)}`);
    }
    if (!exact(stored, document)) {
      throw new PrecisionUnitsPersistenceError("READBACK_MISMATCH", `Document ${document.documentId} failed exact UNITS revision ${document.revision} read-back.`);
    }
  }

  private dialogReadback(): PrecisionUnitsDialogReadback {
    return structuredClone(this.#dialog);
  }

  private assertDraftValid(): void {
    this.assertAvailable();
    if (!this.#dialog.draft || this.#dialog.status === "closed") throw new TypeError("UNITS dialog is not open.");
    if (this.#dialog.status === "invalid") throw new TypeError(`UNITS draft is invalid: ${this.#dialog.error ?? "unknown error"}`);
  }

  private assertAvailable(): void {
    if (this.#blocked) throw new PrecisionUnitsPersistenceError("READBACK_MISMATCH", "UNITS adapter is blocked after a durable read-back mismatch; reopen the document.");
  }
}
