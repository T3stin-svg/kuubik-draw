import { describe, expect, it } from "vitest";
import type { CadBlockDefinition, CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./blocks.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readBlockAttributes } from "./contracts.js";
import { assertAcyclicBlocks, createBlockInsert, defineBlockFromSelection, editBlockAttributes, explodeBlockReference, redefineBlock } from "./operations.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "blocks", now: "2026-08-31T12:00:00.000Z" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 20 }, end: { x: 1010, y: 20 } });
  return document;
}

describe("F-087 BLOCK and F-088 INSERT", () => {
  it("defines an immutable block separately from its insert and commits BLOCK as one Undo/Redo step", () => {
    const document = fixture();
    const prepared = defineBlockFromSelection(document, {
      id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20",
      attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }],
    });
    expect(prepared.definition).toEqual(golden.definition);
    expect(prepared.insert).toEqual(golden.insert);
    expect(document.blocks).toEqual([]);
    expect(document.entities).toHaveLength(1);

    const session = new CadSession(document);
    session.commit({ opId: "block", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities).toEqual([golden.insert]);
    expect(session.document.blocks).toEqual([golden.definition]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    expect(session.document.blocks).toEqual([]);
    session.redo();
    expect(session.document.entities).toEqual([golden.insert]);
  });

  it("inserts with independent placement, rotation, scale and attribute values", () => {
    const document = fixture();
    const definition = defineBlockFromSelection(document, { id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }] }).definition;
    document.blocks.push(definition);
    document.entities = [];
    const insert = createBlockInsert(document, { handle: "30", layerId: "0", blockId: "DOOR", insertion: { x: 5000, y: -250 }, scale: { x: 2, y: 0.5 }, rotationRad: Math.PI / 2, attributes: { mark: "D7" } });
    expect(insert).toMatchObject({ handle: "30", insertion: { x: 5000, y: -250 }, scale: { x: 2, y: 0.5 }, rotationRad: Math.PI / 2, attributes: { MARK: "D7" } });
  });
});

describe("F-089 EXPLODE", () => {
  it("explodes one level with collision-free handles and transformed attribute text", () => {
    const document = fixture();
    const prepared = defineBlockFromSelection(document, { id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }] });
    const session = new CadSession(document);
    session.commit({ opId: "block", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    const exploded = explodeBlockReference(session.document, "20");
    session.commit({ opId: "explode", baseRevision: 1, commandId: "EXPLODE", args: {}, targetHandles: ["20"], resultHandles: exploded.resultHandles }, exploded.changes);
    expect(exploded.resultHandles).toHaveLength(2);
    expect(new Set(exploded.resultHandles).size).toBe(2);
    expect(exploded.resultHandles).not.toContain("10");
    expect(session.document.entities).toEqual([
      expect.objectContaining({ kind: "line", start: { x: 10, y: 20 }, end: { x: 1010, y: 20 } }),
      expect.objectContaining({ kind: "text", text: "D1", position: { x: 510, y: 70 } }),
    ]);
    session.undo();
    expect(session.document.entities).toEqual([golden.insert]);
  });
});

describe("F-090 redefine/edit and F-091 attributes", () => {
  it("redefines a block without changing existing insert identity, transform or attribute values", () => {
    const document = fixture();
    const prepared = defineBlockFromSelection(document, { id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }] });
    const session = new CadSession(document);
    session.commit({ opId: "block", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    const insertBefore = structuredClone(session.document.entities[0]);
    const replacement: CadEntity[] = [{ kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 20 }, end: { x: 1210, y: 20 } }];
    const redefined = redefineBlock(session.document, { blockId: "DOOR", basePoint: { x: 10, y: 20 }, entities: replacement });
    session.commit({ opId: "redefine", baseRevision: 1, commandId: "BEDIT", args: {}, targetHandles: [], resultHandles: [] }, redefined.changes);
    expect(session.document.entities[0]).toEqual(insertBefore);
    expect(session.document.blocks[0]?.entities).toEqual(replacement);
    expect(readBlockAttributes(session.document.blocks[0]!)).toHaveLength(1);
    session.undo();
    expect(session.document.blocks[0]).toEqual(golden.definition);
  });

  it("edits attribute values on the insert only and keeps the definition immutable", () => {
    const document = fixture();
    const prepared = defineBlockFromSelection(document, { id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }] });
    const session = new CadSession(document);
    session.commit({ opId: "block", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    const definitionBefore = structuredClone(session.document.blocks[0]);
    session.commit({ opId: "attedit", baseRevision: 1, commandId: "ATTEDIT", args: {}, targetHandles: ["20"], resultHandles: ["20"] }, [editBlockAttributes(session.document, "20", { MARK: "D9" })]);
    expect(session.document.entities[0]).toMatchObject({ handle: "20", attributes: { MARK: "D9" } });
    expect(session.document.blocks[0]).toEqual(definitionBefore);
  });

  it("rejects direct and nested block cycles before document mutation", () => {
    const direct: CadBlockDefinition = { id: "A", name: "A", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "10", layerId: "0", blockId: "A", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] };
    expect(() => assertAcyclicBlocks([direct])).toThrow(/A -> A/u);
    const a: CadBlockDefinition = { ...direct, entities: [{ kind: "blockRef", handle: "10", layerId: "0", blockId: "B", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] };
    const b: CadBlockDefinition = { id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "11", layerId: "0", blockId: "A", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] };
    expect(() => assertAcyclicBlocks([a, b])).toThrow(/A -> B -> A/u);
  });
});
