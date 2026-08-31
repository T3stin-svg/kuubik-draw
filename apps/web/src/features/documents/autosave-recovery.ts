import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, type DocumentRecoveryResult } from "../../indexed-db.js";

export class DocumentAutosaveRecovery {
  readonly #openDocuments = new Set<string>();

  constructor(
    private readonly database: KDrawIndexedDb,
    readonly sessionId: string,
  ) {
    if (!sessionId.trim()) throw new TypeError("Autosave recovery session id is required.");
  }

  async open(documentId: string, recordedAt?: string): Promise<DocumentRecoveryResult> {
    if (this.#openDocuments.has(documentId)) throw new TypeError(`Document ${documentId} is already open in recovery session ${this.sessionId}.`);
    const recovery = await this.database.recoverDocument(documentId);
    if (recovery.document && recovery.ignoredOperationIds.length > 0) {
      await this.database.acceptRecoveredDocument(recovery.document, this.sessionId, recovery.ignoredOperationIds, recordedAt);
    }
    await this.database.recordRecoveryOpen(documentId, this.sessionId, recordedAt);
    this.#openDocuments.add(documentId);
    return recovery;
  }

  async checkpoint(document: KDrawDocumentV1): Promise<void> {
    this.assertOpen(document.documentId);
    await this.database.saveSnapshot(document);
  }

  async commit(document: KDrawDocumentV1, operation: CadOperation): Promise<void> {
    this.assertOpen(document.documentId);
    await this.database.commitRevision(document, operation);
  }

  async close(documentId: string, revision: number, recordedAt?: string): Promise<void> {
    this.assertOpen(documentId);
    await this.database.recordRecoveryClean(documentId, this.sessionId, revision, recordedAt);
    this.#openDocuments.delete(documentId);
  }

  isOpen(documentId: string): boolean {
    return this.#openDocuments.has(documentId);
  }

  private assertOpen(documentId: string): void {
    if (!this.#openDocuments.has(documentId)) throw new TypeError(`Document ${documentId} is not open in recovery session ${this.sessionId}.`);
  }
}
