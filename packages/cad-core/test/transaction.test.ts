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

  it("records and consumes an explicit undo marker without changing geometry", () => {
    const source = createEmptyDocument({ documentId: "undo-marker" });
    source.entities.push(line);
    const session = new CadSession(source);
    const markerOperation = { ...operation(), commandId: "SCALE", targetHandles: ["10"], resultHandles: [] };
    session.commit(markerOperation, [{ type: "undo-mark" }]);
    expect(session.document).toMatchObject({ revision: 1, entities: [line] });
    expect(session.canUndo).toBe(true);
    expect(session.undo()?.changes).toEqual([{ type: "undo-mark" }]);
    expect(session.document).toMatchObject({ revision: 2, entities: [line] });
    expect(session.canRedo).toBe(true);
  });

  it("rejects an already-applied opId after session recovery", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "d" }), ["op-1"]);
    expect(() => session.commit(operation(), [{ type: "put", entity: line }])).toThrow(DuplicateOperationError);
    expect(session.document.revision).toBe(0);
  });

  it("commits layer creation/current-layer/lock changes atomically and undoes them", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "layers" }));
    const layer = { id: "layer-1", name: "Layer 1", visible: true, frozen: false, locked: false, plottable: true };
    session.commit(
      { opId: "layer-new", baseRevision: 0, commandId: "LAYER_NEW", args: {}, targetHandles: [], resultHandles: [] },
      [{ type: "put-layer", layer }, { type: "set-current-layer", layerId: layer.id }],
    );
    expect(session.document.currentLayerId).toBe("layer-1");
    expect(session.document.layers).toContainEqual(layer);
    session.commit(
      { opId: "layer-lock", baseRevision: 1, commandId: "LAYER_LOCK", args: {}, targetHandles: [], resultHandles: [] },
      [{ type: "put-layer", layer: { ...layer, locked: true } }],
    );
    expect(session.document.layers.find((candidate) => candidate.id === layer.id)?.locked).toBe(true);
    session.undo();
    expect(session.document.layers.find((candidate) => candidate.id === layer.id)?.locked).toBe(false);
  });
});
