import { CadSession, type CadChange, type CommittedOperation } from "@kuubik/cad-core";
import type { Viewport2D } from "@kuubik/cad-renderer";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface OpenDocumentSessionOptions {
  activeLayoutId?: string;
  selectedHandles?: readonly string[];
  viewport?: Viewport2D;
  appliedOperationIds?: Iterable<string>;
}

export interface DocumentSessionReadback {
  activeDocumentId: string | null;
  documentOrder: string[];
  documents: Array<{
    documentId: string;
    revision: number;
    activeLayoutId: string;
    selectedHandles: string[];
    viewport: Viewport2D;
    canUndo: boolean;
    canRedo: boolean;
  }>;
}

interface DocumentSessionEntry {
  session: CadSession;
  activeLayoutId: string;
  selectedHandles: string[];
  viewport: Viewport2D;
}

const DEFAULT_VIEWPORT: Viewport2D = Object.freeze({
  world: Object.freeze({ minX: -500, minY: -500, maxX: 2500, maxY: 2500 }),
  widthPx: 1200,
  heightPx: 800,
  devicePixelRatio: 1,
});

function assertViewport(viewport: Viewport2D): void {
  const values = [
    viewport.world.minX, viewport.world.minY, viewport.world.maxX, viewport.world.maxY,
    viewport.widthPx, viewport.heightPx, viewport.devicePixelRatio,
    viewport.worldUnitsPerPixel ?? 1, viewport.rotationRad ?? 0,
  ];
  if (values.some((value) => !Number.isFinite(value))) throw new TypeError("Document viewport values must be finite.");
  if (viewport.world.maxX <= viewport.world.minX || viewport.world.maxY <= viewport.world.minY) {
    throw new RangeError("Document viewport world bounds must have positive width and height.");
  }
  if (viewport.widthPx <= 0 || viewport.heightPx <= 0 || viewport.devicePixelRatio <= 0 || (viewport.worldUnitsPerPixel ?? 1) <= 0) {
    throw new RangeError("Document viewport pixel dimensions and scale must be positive.");
  }
}

function assertLayout(document: KDrawDocumentV1, layoutId: string): void {
  if (!document.layouts.some((layout) => layout.id === layoutId)) {
    throw new RangeError(`Document ${document.documentId} has no layout ${layoutId}.`);
  }
}

function normalizedSelection(document: KDrawDocumentV1, handles: readonly string[]): string[] {
  const known = new Set([
    ...document.entities.map((entity) => entity.handle),
    ...document.layouts.flatMap((layout) => (layout.entities ?? []).map((entity) => entity.handle)),
  ]);
  const selected = [...new Set(handles)];
  const missing = selected.filter((handle) => !known.has(handle));
  if (missing.length > 0) throw new RangeError(`Document ${document.documentId} has no selectable handles: ${missing.join(", ")}.`);
  return selected;
}

export class DocumentSessionCoordinator {
  readonly #entries = new Map<string, DocumentSessionEntry>();
  #activeDocumentId: string | null = null;

  open(document: KDrawDocumentV1, options: OpenDocumentSessionOptions = {}): void {
    const existing = this.#entries.get(document.documentId);
    if (existing) {
      this.#activeDocumentId = document.documentId;
      return;
    }
    const activeLayoutId = options.activeLayoutId ?? "model";
    assertLayout(document, activeLayoutId);
    const viewport = structuredClone(options.viewport ?? DEFAULT_VIEWPORT);
    assertViewport(viewport);
    const session = new CadSession(document, options.appliedOperationIds);
    this.#entries.set(document.documentId, {
      session,
      activeLayoutId,
      selectedHandles: normalizedSelection(document, options.selectedHandles ?? []),
      viewport,
    });
    this.#activeDocumentId = document.documentId;
  }

  activate(documentId: string): void {
    this.requireEntry(documentId);
    this.#activeDocumentId = documentId;
  }

  close(documentId: string): void {
    this.requireEntry(documentId);
    const order = [...this.#entries.keys()];
    const index = order.indexOf(documentId);
    this.#entries.delete(documentId);
    if (this.#activeDocumentId === documentId) {
      const remaining = [...this.#entries.keys()];
      this.#activeDocumentId = remaining[index] ?? remaining[index - 1] ?? null;
    }
  }

  document(documentId: string): KDrawDocumentV1 {
    return this.requireEntry(documentId).session.document;
  }

  session(documentId: string): CadSession {
    return this.requireEntry(documentId).session.fork();
  }

  setSelection(documentId: string, handles: readonly string[]): void {
    const entry = this.requireEntry(documentId);
    entry.selectedHandles = normalizedSelection(entry.session.document, handles);
  }

  setViewport(documentId: string, viewport: Viewport2D): void {
    assertViewport(viewport);
    this.requireEntry(documentId).viewport = structuredClone(viewport);
  }

  setLayout(documentId: string, layoutId: string): void {
    const entry = this.requireEntry(documentId);
    assertLayout(entry.session.document, layoutId);
    entry.activeLayoutId = layoutId;
  }

  commit(documentId: string, operation: CadOperation, changes: readonly CadChange[], now?: string): CommittedOperation {
    const entry = this.requireEntry(documentId);
    const candidate = entry.session.fork();
    const committed = candidate.commit(operation, changes, now);
    this.acceptCandidate(entry, candidate);
    return committed;
  }

  async commitPersisted(
    documentId: string,
    operation: CadOperation,
    changes: readonly CadChange[],
    persist: (document: KDrawDocumentV1, operation: CadOperation) => Promise<void>,
    now?: string,
  ): Promise<CommittedOperation> {
    const entry = this.requireEntry(documentId);
    const candidate = entry.session.fork();
    const committed = candidate.commit(operation, changes, now);
    await persist(candidate.document, operation);
    this.acceptCandidate(entry, candidate);
    return committed;
  }

  undo(documentId: string, now?: string): CommittedOperation | null {
    const entry = this.requireEntry(documentId);
    const candidate = entry.session.fork();
    const committed = candidate.undo(now);
    if (committed) this.acceptCandidate(entry, candidate);
    return committed;
  }

  redo(documentId: string, now?: string): CommittedOperation | null {
    const entry = this.requireEntry(documentId);
    const candidate = entry.session.fork();
    const committed = candidate.redo(now);
    if (committed) this.acceptCandidate(entry, candidate);
    return committed;
  }

  readBack(): DocumentSessionReadback {
    return {
      activeDocumentId: this.#activeDocumentId,
      documentOrder: [...this.#entries.keys()],
      documents: [...this.#entries.entries()].map(([documentId, entry]) => ({
        documentId,
        revision: entry.session.document.revision,
        activeLayoutId: entry.activeLayoutId,
        selectedHandles: [...entry.selectedHandles],
        viewport: structuredClone(entry.viewport),
        canUndo: entry.session.canUndo,
        canRedo: entry.session.canRedo,
      })),
    };
  }

  private requireEntry(documentId: string): DocumentSessionEntry {
    const entry = this.#entries.get(documentId);
    if (!entry) throw new RangeError(`Document session ${documentId} is not open.`);
    return entry;
  }

  private acceptCandidate(entry: DocumentSessionEntry, candidate: CadSession): void {
    const document = candidate.document;
    entry.session = candidate;
    entry.selectedHandles = normalizedSelection(document, entry.selectedHandles.filter((handle) => (
      document.entities.some((entity) => entity.handle === handle)
      || document.layouts.some((layout) => (layout.entities ?? []).some((entity) => entity.handle === handle))
    )));
  }
}
