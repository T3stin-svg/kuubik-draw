import { createEmptyDocument } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { DocumentSessionCoordinator } from "./document-session-coordinator.js";

function drawing(documentId: string, handle: string): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId });
  document.entities.push({ kind: "line", handle, layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  document.layouts.push({ id: `${documentId}-layout`, name: "Layout 1", kind: "paper", viewports: [], entities: [] });
  return document;
}

function operation(opId: string, baseRevision: number): CadOperation {
  return { opId, baseRevision, commandId: "LINE", args: {}, targetHandles: [], resultHandles: [opId] };
}

describe("F-128 document session coordinator", () => {
  it("keeps CadSession, selection, viewport and layout context independent per document", () => {
    const coordinator = new DocumentSessionCoordinator();
    const first = drawing("first", "10");
    const second = drawing("second", "20");
    coordinator.open(first, {
      selectedHandles: ["10"],
      activeLayoutId: "first-layout",
      viewport: { world: { minX: 0, minY: 0, maxX: 100, maxY: 80 }, widthPx: 1000, heightPx: 800, devicePixelRatio: 1 },
    });
    coordinator.open(second, {
      selectedHandles: ["20"],
      viewport: { world: { minX: -50, minY: -25, maxX: 50, maxY: 25 }, widthPx: 1200, heightPx: 600, devicePixelRatio: 2, rotationRad: 0.25 },
    });

    coordinator.commit("first", operation("11", 0), [{
      type: "put",
      entity: { kind: "circle", handle: "11", layerId: "0", center: { x: 5, y: 5 }, radius: 2 },
    }]);
    expect(coordinator.document("first").revision).toBe(1);
    expect(coordinator.document("second").revision).toBe(0);
    expect(coordinator.readBack()).toEqual({
      activeDocumentId: "second",
      documentOrder: ["first", "second"],
      documents: [
        expect.objectContaining({
          documentId: "first", revision: 1, activeLayoutId: "first-layout", selectedHandles: ["10"], canUndo: true,
          viewport: expect.objectContaining({ widthPx: 1000 }),
        }),
        expect.objectContaining({
          documentId: "second", revision: 0, activeLayoutId: "model", selectedHandles: ["20"], canUndo: false,
          viewport: expect.objectContaining({ widthPx: 1200, rotationRad: 0.25 }),
        }),
      ],
    });

    coordinator.undo("first");
    expect(coordinator.document("first").entities.map((entity) => entity.handle)).toEqual(["10"]);
    expect(coordinator.document("second").entities.map((entity) => entity.handle)).toEqual(["20"]);
    expect(coordinator.readBack().documents[0]).toEqual(expect.objectContaining({ canRedo: true }));

    coordinator.commit("second", operation("delete-20", 0), [{ type: "delete", handle: "20" }]);
    expect(coordinator.readBack().documents[1]).toEqual(expect.objectContaining({ selectedHandles: [] }));
    expect(coordinator.readBack().documents[0]).toEqual(expect.objectContaining({ selectedHandles: ["10"] }));
  });

  it("accepts a persisted candidate only after durable storage succeeds", async () => {
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(drawing("persisted", "10"));
    const failure = new Error("storage failed");
    await expect(coordinator.commitPersisted(
      "persisted",
      operation("11", 0),
      [{ type: "put", entity: { kind: "circle", handle: "11", layerId: "0", center: { x: 0, y: 0 }, radius: 1 } }],
      async () => { throw failure; },
    )).rejects.toBe(failure);
    expect(coordinator.document("persisted").revision).toBe(0);
    expect(coordinator.document("persisted").entities.map((entity) => entity.handle)).toEqual(["10"]);

    await coordinator.commitPersisted(
      "persisted",
      operation("11-ok", 0),
      [{ type: "put", entity: { kind: "circle", handle: "11", layerId: "0", center: { x: 0, y: 0 }, radius: 1 } }],
      async (document) => { expect(document.revision).toBe(1); },
    );
    expect(coordinator.document("persisted").revision).toBe(1);
  });

  it("keeps persisted undo and redo candidates private until storage succeeds", async () => {
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(drawing("history", "10"));
    await coordinator.commitPersisted(
      "history",
      operation("11", 0),
      [{ type: "put", entity: { kind: "circle", handle: "11", layerId: "0", center: { x: 0, y: 0 }, radius: 1 } }],
      async () => undefined,
    );
    await expect(coordinator.undoPersisted("history", async () => { throw new Error("undo storage failed"); }))
      .rejects.toThrow(/undo storage failed/u);
    expect(coordinator.document("history")).toMatchObject({ revision: 1, entities: [expect.anything(), expect.objectContaining({ handle: "11" })] });
    expect(coordinator.readBack().documents[0]).toEqual(expect.objectContaining({ canUndo: true, canRedo: false }));

    const undone = await coordinator.undoPersisted("history", async (document, undoOperation) => {
      expect(document.revision).toBe(2);
      expect(undoOperation).toMatchObject({ baseRevision: 1, commandId: "UNDO" });
    });
    expect(undone?.committedRevision).toBe(2);
    expect(coordinator.document("history").entities.map((entity) => entity.handle)).toEqual(["10"]);
    expect(coordinator.readBack().documents[0]).toEqual(expect.objectContaining({ canUndo: false, canRedo: true }));

    await expect(coordinator.redoPersisted("history", async () => { throw new Error("redo storage failed"); }))
      .rejects.toThrow(/redo storage failed/u);
    expect(coordinator.document("history").revision).toBe(2);
    expect(coordinator.readBack().documents[0]).toEqual(expect.objectContaining({ canUndo: false, canRedo: true }));
    const redone = await coordinator.redoPersisted("history", async (document, redoOperation) => {
      expect(document.revision).toBe(3);
      expect(redoOperation).toMatchObject({ baseRevision: 2, commandId: "LINE" });
    });
    expect(redone?.committedRevision).toBe(3);
    expect(coordinator.document("history").entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });

  it("closes only the requested session and activates its adjacent neighbour", () => {
    const coordinator = new DocumentSessionCoordinator();
    coordinator.open(drawing("a", "10"));
    coordinator.open(drawing("b", "20"));
    coordinator.open(drawing("c", "30"));
    coordinator.activate("b");
    coordinator.close("b");
    expect(coordinator.readBack()).toEqual(expect.objectContaining({ activeDocumentId: "c", documentOrder: ["a", "c"] }));
    expect(coordinator.document("a").documentId).toBe("a");
    expect(coordinator.document("c").documentId).toBe("c");
  });
});
