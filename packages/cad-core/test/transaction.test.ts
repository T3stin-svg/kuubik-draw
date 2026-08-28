import { describe, expect, it } from "vitest";
import type { CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  DuplicateOperationError,
  NoOpOperationError,
  RevisionConflictError,
  applyAtomicOperation,
  createEmptyDocument,
} from "../src/index.js";

const line = {
  kind: "line" as const,
  handle: "10",
  layerId: "0",
  start: { x: 0.125, y: 0 },
  end: { x: 100.5, y: 0 },
};

function operation(baseRevision = 0): CadOperation {
  return {
    opId: "op-1",
    baseRevision,
    commandId: "LINE",
    args: { start: line.start, end: line.end },
    targetHandles: [],
    resultHandles: [line.handle],
  };
}

describe("atomic document transaction", () => {
  it("commits all changes in one revision and leaves its input untouched", () => {
    const source = createEmptyDocument({ documentId: "d", now: "2026-08-28T00:00:00Z" });
    const snapshot = structuredClone(source);
    const result = applyAtomicOperation(source, operation(), [{ type: "put", entity: line }], "2026-08-28T00:01:00Z");
    expect(source).toEqual(snapshot);
    expect(result.document.revision).toBe(1);
    expect(result.document.entities).toEqual([line]);
    expect(result.committed.inverseChanges).toEqual([{ type: "delete", handle: "10" }]);
  });

  it("rejects stale revisions before changing geometry", () => {
    const source = createEmptyDocument({ documentId: "d" });
    expect(() => applyAtomicOperation(source, operation(4), [{ type: "put", entity: line }])).toThrow(
      RevisionConflictError,
    );
    expect(source.entities).toEqual([]);
  });

  it("makes a multi-entity command one undo/redo step", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "d" }));
    const second = { ...line, handle: "11", start: { x: 0, y: 10 }, end: { x: 100, y: 10 } };
    session.commit(
      { ...operation(), resultHandles: ["10", "11"] },
      [
        { type: "put", entity: line },
        { type: "put", entity: second },
      ],
    );
    expect(session.document.entities).toHaveLength(2);
    session.undo();
    expect(session.document.entities).toHaveLength(0);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });

  it("rejects semantic no-ops without incrementing revision", () => {
    const source = createEmptyDocument({ documentId: "d" });
    expect(() => applyAtomicOperation(source, operation(), [])).toThrow(NoOpOperationError);
    expect(source.revision).toBe(0);
  });

  it("rejects an already-applied opId after session recovery", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "d" }), ["op-1"]);
    expect(() => session.commit(operation(), [{ type: "put", entity: line }])).toThrow(DuplicateOperationError);
    expect(session.document.revision).toBe(0);
  });
});
