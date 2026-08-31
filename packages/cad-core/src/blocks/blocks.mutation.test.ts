import { describe, expect, it } from "vitest";
import type { CadBlockDefinition } from "@kuubik/cad-schema";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { assertAcyclicBlocks, defineBlockFromSelection, redefineBlock } from "./operations.js";

describe("block mutation ratchet", () => {
  it("kills mutable-definition, insert-replacement and split-Undo mutants", () => {
    const document = createEmptyDocument({ documentId: "block-mutation" });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const prepared = defineBlockFromSelection(document, { id: "B", name: "B", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20" });
    const session = new CadSession(document);
    session.commit({ opId: "block", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    const insert = structuredClone(session.document.entities[0]);
    const oldDefinition = structuredClone(session.document.blocks[0]);
    const redefined = redefineBlock(session.document, { blockId: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }] });
    expect(session.document.blocks[0]).toEqual(oldDefinition);
    session.commit({ opId: "redefine", baseRevision: 1, commandId: "BEDIT", args: {}, targetHandles: [], resultHandles: [] }, redefined.changes);
    expect(session.document.entities[0]).toEqual(insert);
    expect(session.document.revision).toBe(2);
    session.undo();
    expect(session.document.blocks[0]).toEqual(oldDefinition);
    expect(session.document.entities[0]).toEqual(insert);
  });

  it("kills incomplete-DFS and cycle-acceptance mutants", () => {
    const blocks: CadBlockDefinition[] = [
      { id: "A", name: "A", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "10", layerId: "0", blockId: "B", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
      { id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "11", layerId: "0", blockId: "C", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
      { id: "C", name: "C", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "12", layerId: "0", blockId: "A", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
    ];
    expect(() => assertAcyclicBlocks(blocks)).toThrow(/A -> B -> C -> A/u);
  });
});
