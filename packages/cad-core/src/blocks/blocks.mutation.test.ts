import { describe, expect, it } from "vitest";
import type { CadBlockDefinition } from "@kuubik/cad-schema";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { assertAcyclicBlocks, createBlockInsert, defineBlockFromSelection, explodeBlockReference, redefineBlock, syncBlockAttributes } from "./operations.js";
import { withBlockAttributes } from "./contracts.js";

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

  it("kills shallow-EXPLODE, unstable-handle and proxy-pass mutants", () => {
    const document = createEmptyDocument({ documentId: "nested-explode-mutation" });
    document.blocks.push(
      { id: "C", name: "Child", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "C1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }] },
      { id: "P", name: "Parent", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "P1", layerId: "0", blockId: "C", insertion: { x: 10, y: 0 }, scale: { x: 2, y: 2 }, rotationRad: Math.PI / 2 }] },
    );
    document.entities.push(createBlockInsert(document, { handle: "I1", layerId: "0", blockId: "P", insertion: { x: 100, y: 50 } }));
    const recursive = explodeBlockReference(document, "I1", "recursive");
    expect(recursive.resultHandles).toEqual(["C2"]);
    expect(recursive.changes[1]).toMatchObject({ type: "put", entity: { kind: "line", handle: "C2", start: { x: 110, y: 50 }, end: { x: 110, y: 60 } } });
    document.blocks[0]!.entities = [{ kind: "proxy", handle: "C1", layerId: "0", originalType: "ACAD_PROXY_ENTITY", raw: {} }];
    expect(() => explodeBlockReference(document, "I1", "recursive")).toThrow(/proxy child/iu);
  });

  it("kills ATTSYNC order, constant-value and insert-transform mutants", () => {
    const document = createEmptyDocument({ documentId: "attsync-mutation" });
    document.blocks.push(withBlockAttributes({ id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }] }, [{ tag: "MARK", prompt: "Mark", defaultValue: "M1", position: { x: 0, y: 1 }, height: 2 }]));
    document.entities.push(createBlockInsert(document, { handle: "I1", layerId: "0", blockId: "B", insertion: { x: 20, y: 30 }, scale: { x: -2, y: 0.5 }, rotationRad: 0.75, attributes: { MARK: "M9" } }));
    const redefined = redefineBlock(document, { blockId: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B2", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }], attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "M1", position: { x: 0, y: 1 }, height: 2 }, { tag: "CODE", prompt: "Code", defaultValue: "A", position: { x: 0, y: 2 }, height: 2, constant: true }] });
    const replacement = redefined.changes[0]; if (!replacement || replacement.type !== "replace-drawing-content") throw new Error("Expected replacement.");
    const staged = structuredClone(document); staged.blocks = replacement.blocks;
    const synced = syncBlockAttributes(staged, "B"); const change = synced.changes[0];
    expect(change).toMatchObject({ type: "put", entity: { handle: "I1", insertion: { x: 20, y: 30 }, scale: { x: -2, y: 0.5 }, rotationRad: 0.75, attributes: { MARK: "M9", CODE: "A" } } });
  });
});
