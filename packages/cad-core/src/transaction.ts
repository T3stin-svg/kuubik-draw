import {
  assertKDrawDocumentV1,
  type CadEntity,
  type CadOperation,
  type KDrawDocumentV1,
} from "@kuubik/cad-schema";

export type EntityChange =
  | { type: "put"; entity: CadEntity }
  | { type: "delete"; handle: string };

export interface CommittedOperation {
  operation: CadOperation;
  changes: EntityChange[];
  inverseChanges: EntityChange[];
  committedRevision: number;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Revision conflict: operation targets ${expectedRevision}, document is ${actualRevision}.`);
    this.name = "RevisionConflictError";
  }
}

export class NoOpOperationError extends Error {
  constructor(message = "Operation makes no semantic document change.") {
    super(message);
    this.name = "NoOpOperationError";
  }
}

export class DuplicateOperationError extends Error {
  constructor(readonly opId: string) {
    super(`Operation ${opId} has already been applied.`);
    this.name = "DuplicateOperationError";
  }
}

function cloneEntity(entity: CadEntity): CadEntity {
  return structuredClone(entity);
}

export function applyAtomicOperation(
  source: KDrawDocumentV1,
  operation: CadOperation,
  changes: readonly EntityChange[],
  now = new Date().toISOString(),
): { document: KDrawDocumentV1; committed: CommittedOperation } {
  if (operation.baseRevision !== source.revision) {
    throw new RevisionConflictError(operation.baseRevision, source.revision);
  }
  if (operation.opId.length === 0 || operation.commandId.length === 0) {
    throw new TypeError("Operation id and command id are required.");
  }
  if (changes.length === 0) throw new NoOpOperationError();

  const entities = new Map(source.entities.map((entity) => [entity.handle, cloneEntity(entity)]));
  const inverseChanges: EntityChange[] = [];
  for (const change of changes) {
    if (change.type === "put") {
      const before = entities.get(change.entity.handle);
      inverseChanges.unshift(before ? { type: "put", entity: cloneEntity(before) } : { type: "delete", handle: change.entity.handle });
      entities.set(change.entity.handle, cloneEntity(change.entity));
      continue;
    }
    const before = entities.get(change.handle);
    if (!before) throw new RangeError(`Cannot delete missing entity ${change.handle}.`);
    inverseChanges.unshift({ type: "put", entity: cloneEntity(before) });
    entities.delete(change.handle);
  }

  const document: KDrawDocumentV1 = {
    ...structuredClone(source),
    revision: source.revision + 1,
    entities: [...entities.values()],
    metadata: { ...structuredClone(source.metadata), updatedAt: now },
  };
  if (JSON.stringify(document.entities) === JSON.stringify(source.entities)) throw new NoOpOperationError();
  assertKDrawDocumentV1(document);
  return {
    document,
    committed: {
      operation: structuredClone(operation),
      changes: structuredClone([...changes]),
      inverseChanges,
      committedRevision: document.revision,
    },
  };
}

export class CadSession {
  #document: KDrawDocumentV1;
  #undo: CommittedOperation[] = [];
  #redo: CommittedOperation[] = [];
  #sequence = 0;
  readonly #appliedOperationIds: Set<string>;

  constructor(document: KDrawDocumentV1, appliedOperationIds: Iterable<string> = []) {
    assertKDrawDocumentV1(document);
    this.#document = structuredClone(document);
    this.#appliedOperationIds = new Set(appliedOperationIds);
  }

  get document(): KDrawDocumentV1 {
    return structuredClone(this.#document);
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  commit(operation: CadOperation, changes: readonly EntityChange[], now?: string): CommittedOperation {
    if (this.#appliedOperationIds.has(operation.opId)) throw new DuplicateOperationError(operation.opId);
    const result = applyAtomicOperation(this.#document, operation, changes, now);
    this.#document = result.document;
    this.#undo.push(result.committed);
    this.#redo = [];
    this.#appliedOperationIds.add(operation.opId);
    return structuredClone(result.committed);
  }

  undo(now?: string): CommittedOperation | null {
    const prior = this.#undo.pop();
    if (!prior) return null;
    const operation: CadOperation = {
      opId: `${prior.operation.opId}:undo:${++this.#sequence}`,
      baseRevision: this.#document.revision,
      commandId: "UNDO",
      args: { originalOpId: prior.operation.opId },
      targetHandles: [...prior.operation.resultHandles],
      resultHandles: [...prior.operation.targetHandles],
    };
    const result = applyAtomicOperation(this.#document, operation, prior.inverseChanges, now);
    this.#document = result.document;
    this.#redo.push(prior);
    return structuredClone(result.committed);
  }

  redo(now?: string): CommittedOperation | null {
    const prior = this.#redo.pop();
    if (!prior) return null;
    const operation: CadOperation = {
      ...structuredClone(prior.operation),
      opId: `${prior.operation.opId}:redo:${++this.#sequence}`,
      baseRevision: this.#document.revision,
    };
    const result = applyAtomicOperation(this.#document, operation, prior.changes, now);
    this.#document = result.document;
    this.#undo.push(prior);
    return structuredClone(result.committed);
  }
}
