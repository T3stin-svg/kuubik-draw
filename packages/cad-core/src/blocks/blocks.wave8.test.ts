import { describe, expect, it } from "vitest";
import type { CadBlockDefinition, CadBlockReference, KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./blocks.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readBlockAttributes, withBlockAttributes } from "./contracts.js";
import {
  assertAcyclicBlocks,
  createBlockInsert,
  defineBlockFromSelection,
  editBlockAttributes,
  explodeBlockReference,
  redefineBlock,
  syncBlockAttributes,
} from "./operations.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "blocks-wave8", now: "2026-08-31T20:00:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 10, y: 20 }, end: { x: 1010, y: 20 } });
  return document;
}

function attributedDefinition(): CadBlockDefinition {
  return withBlockAttributes({ id: "DOOR", name: "Door", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }] }, [
    { tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 50, y: 5 }, height: 2.5, textStyleId: "TXT" },
    { tag: "OLD", prompt: "Old", defaultValue: "legacy", position: { x: 50, y: 10 }, height: 2.5 },
  ]);
}

describe("F-087 BLOCK create/base point/selection", () => {
  it("creates an immutable definition and insert in one atomic operation", () => {
    const document = fixture();
    const prepared = defineBlockFromSelection(document, { id: "DOOR", name: "Door", basePoint: { x: 10, y: 20 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 510, y: 70 }, height: 50 }] });
    expect(prepared.definition).toEqual(golden.definition);
    expect(prepared.insert).toEqual(golden.insert);
    const session = new CadSession(document);
    session.commit({ opId: "block-wave8", baseRevision: 0, commandId: "BLOCK", args: {}, targetHandles: ["10"], resultHandles: ["20"] }, prepared.changes);
    expect(session.document.revision).toBe(1); expect(session.document.entities).toEqual([golden.insert]);
    session.undo(); expect(session.document.entities).toEqual(document.entities);
    session.redo(); expect(session.document.blocks[0]).toEqual(golden.definition);
  });

  it("rejects duplicate names/member handles, locked selections and proxy children", () => {
    const document = fixture();
    document.blocks.push({ id: "A", name: "Existing", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] });
    expect(() => defineBlockFromSelection(document, { id: "B", name: "existing", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20" })).toThrow(/already exists/u);
    expect(() => assertAcyclicBlocks([{ id: "A", name: "A", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "X", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }, { id: "B", name: "a", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "X", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }])).toThrow(/Duplicate/u);
    expect(() => redefineBlock(document, { blockId: "A", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] })).toThrow(/Duplicate/u);
    document.layers[0]!.locked = true;
    expect(() => defineBlockFromSelection(document, { id: "B", name: "B", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20" })).toThrow(/locked/u);
    const unlocked = fixture(); unlocked.entities[0] = { kind: "proxy", handle: "10", layerId: "0", originalType: "ACAD_PROXY_ENTITY", raw: {} };
    expect(() => defineBlockFromSelection(unlocked, { id: "P", name: "Proxy", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20" })).toThrow(/Proxy child/u);
  });
});

describe("F-088 INSERT scale/rotation/layer", () => {
  it("preserves model-space transform, layer and deterministic attribute order", () => {
    const document = fixture(); document.blocks.push(attributedDefinition());
    const insert = createBlockInsert(document, { handle: "20", layerId: "0", blockId: "DOOR", insertion: { x: 250, y: -40 }, scale: { x: -2, y: 0.5 }, rotationRad: Math.PI / 3, attributes: { old: "keep", mark: "D9" } });
    expect(insert).toEqual({ kind: "blockRef", handle: "20", layerId: "0", blockId: "DOOR", insertion: { x: 250, y: -40 }, scale: { x: -2, y: 0.5 }, rotationRad: Math.PI / 3, attributes: { MARK: "D9", OLD: "keep" } });
    expect(() => createBlockInsert(document, { handle: "b1", layerId: "0", blockId: "DOOR", insertion: { x: 0, y: 0 } })).toThrow(/duplicate INSERT handle/u);
  });

  it("fails closed for locked layers, orphan definitions and transitive proxy children", () => {
    const document = fixture();
    expect(() => createBlockInsert(document, { handle: "20", layerId: "0", blockId: "MISSING", insertion: { x: 0, y: 0 } })).toThrow(/Unknown block/u);
    document.blocks.push({ id: "PROXY", name: "Proxy", basePoint: { x: 0, y: 0 }, entities: [{ kind: "proxy", handle: "P1", layerId: "0", originalType: "ACAD_PROXY_ENTITY", raw: {} }] });
    expect(() => createBlockInsert(document, { handle: "20", layerId: "0", blockId: "PROXY", insertion: { x: 0, y: 0 } })).toThrow(/Proxy child/u);
    document.blocks = [attributedDefinition()]; document.layers[0]!.locked = true;
    expect(() => createBlockInsert(document, { handle: "20", layerId: "0", blockId: "DOOR", insertion: { x: 0, y: 0 } })).toThrow(/locked/u);
  });
});

describe("F-089 nested EXPLODE", () => {
  function nestedDocument(): KDrawDocumentV1 {
    const document = createEmptyDocument({ documentId: "nested-explode" });
    const child = withBlockAttributes({ id: "CHILD", name: "Child", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "C1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }] }, [{ tag: "CODE", prompt: "Code", defaultValue: "C1", position: { x: 0, y: 2 }, height: 2 }]);
    const parent: CadBlockDefinition = { id: "PARENT", name: "Parent", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "P1", layerId: "0", blockId: "CHILD", insertion: { x: 10, y: 0 }, scale: { x: 2, y: 2 }, rotationRad: Math.PI / 2, attributes: { CODE: "C9" } }] };
    document.blocks.push(child, parent);
    document.entities.push({ kind: "blockRef", handle: "I1", layerId: "0", blockId: "PARENT", insertion: { x: 100, y: 50 }, scale: { x: 1, y: 1 }, rotationRad: 0 });
    return document;
  }

  it("supports explicit preserve and recursive modes with deterministic fresh handles", () => {
    const document = nestedDocument();
    const preserved = explodeBlockReference(document, "I1", "preserve");
    expect(preserved.changes[1]).toMatchObject({ type: "put", entity: { kind: "blockRef", blockId: "CHILD", insertion: { x: 110, y: 50 }, scale: { x: 2, y: 2 }, rotationRad: Math.PI / 2 } });
    const recursive = explodeBlockReference(document, "I1", "recursive");
    expect(recursive).toEqual(explodeBlockReference(structuredClone(document), "I1", "recursive"));
    const entities = recursive.changes.flatMap((change) => change.type === "put" ? [change.entity] : []);
    expect(entities.map((entity) => entity.kind)).toEqual(["line", "text"]);
    expect(entities.map((entity) => {
      if (entity.kind === "line") return { kind: "line", start: entity.start, end: entity.end };
      if (entity.kind === "text") return { kind: "text", position: entity.position, text: entity.text };
      throw new Error(`Unexpected recursive EXPLODE entity: ${entity.kind}.`);
    })).toEqual(golden.recursiveExplode);
    expect(new Set(recursive.resultHandles).size).toBe(recursive.resultHandles.length);
  });

  it("rejects locked, orphan, cyclic and proxy descendants before changes", () => {
    const document = nestedDocument(); document.layers[0]!.locked = true;
    expect(() => explodeBlockReference(document, "I1", "recursive")).toThrow(/locked/u);
    const orphan = nestedDocument(); orphan.blocks = orphan.blocks.filter((block) => block.id !== "CHILD");
    expect(() => explodeBlockReference(orphan, "I1", "recursive")).toThrow(/Missing nested/u);
    const proxy = nestedDocument(); proxy.blocks[0]!.entities = [{ kind: "proxy", handle: "C1", layerId: "0", originalType: "ACAD_PROXY_ENTITY", raw: {} }];
    expect(() => explodeBlockReference(proxy, "I1", "recursive")).toThrow(/proxy child/iu);
  });
});

describe("F-090 redefine and F-091 deterministic attribute sync", () => {
  function insertedDocument(): KDrawDocumentV1 {
    const document = fixture(); document.entities = []; document.blocks.push(attributedDefinition());
    document.entities.push(
      createBlockInsert(document, { handle: "I1", layerId: "0", blockId: "DOOR", insertion: { x: 0, y: 0 }, attributes: { MARK: "D9", OLD: "one" } }),
      createBlockInsert(document, { handle: "I2", layerId: "0", blockId: "DOOR", insertion: { x: 200, y: 50 }, scale: { x: -2, y: 0.5 }, rotationRad: 0.75, attributes: { MARK: "D8", OLD: "two" } }),
    );
    return document;
  }

  it("redefines immutably while preserving every existing insert handle and transform", () => {
    const document = insertedDocument(); const inserts = structuredClone(document.entities); const blocks = structuredClone(document.blocks);
    const result = redefineBlock(document, { blockId: "DOOR", basePoint: { x: 5, y: 5 }, entities: [{ kind: "line", handle: "B2", layerId: "0", start: { x: 5, y: 5 }, end: { x: 150, y: 5 } }] });
    const session = new CadSession(document);
    session.commit({ opId: "bedit", baseRevision: 0, commandId: "BEDIT", args: {}, targetHandles: ["I1", "I2"], resultHandles: ["I1", "I2"] }, result.changes);
    expect(session.document.entities).toEqual(inserts); expect(result.affectedInsertHandles).toEqual(["I1", "I2"]);
    expect(session.document.blocks[0]).toMatchObject({ id: "DOOR", basePoint: { x: 5, y: 5 }, entities: [{ handle: "B2" }] });
    session.undo(); expect(session.document.entities).toEqual(inserts); expect(session.document.blocks).toEqual(blocks);
    session.redo(); expect(session.document.entities).toEqual(inserts);
  });

  it("syncs removed/new/constant attributes for every insert in the same atomic redefine", () => {
    const document = insertedDocument(); const transforms = document.entities.map((entity) => ({ handle: entity.handle, ...(entity.kind === "blockRef" ? { insertion: entity.insertion, scale: entity.scale, rotationRad: entity.rotationRad } : {}) }));
    const attributes = [
      { tag: "MARK", prompt: "Mark", defaultValue: "D1", position: { x: 0, y: 5 }, height: 2.5 },
      { tag: "CODE", prompt: "Code", defaultValue: "A", position: { x: 0, y: 10 }, height: 2.5, constant: true },
    ];
    const result = redefineBlock(document, { blockId: "DOOR", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B2", layerId: "0", start: { x: 0, y: 0 }, end: { x: 120, y: 0 } }], attributes, syncAttributes: true });
    const session = new CadSession(document);
    session.commit({ opId: "bedit-sync", baseRevision: 0, commandId: "BEDIT", args: {}, targetHandles: ["I1", "I2"], resultHandles: ["I1", "I2"] }, result.changes);
    expect((session.document.entities[0] as CadBlockReference).attributes).toEqual(golden.syncedAttributes);
    expect((session.document.entities[1] as CadBlockReference).attributes).toEqual({ MARK: "D8", CODE: "A" });
    expect(session.document.entities.map((entity) => ({ handle: entity.handle, ...(entity.kind === "blockRef" ? { insertion: entity.insertion, scale: entity.scale, rotationRad: entity.rotationRad } : {}) }))).toEqual(transforms);
    session.undo(); expect((session.document.entities[0] as CadBlockReference).attributes).toEqual({ MARK: "D9", OLD: "one" });
    session.redo(); expect((session.document.entities[0] as CadBlockReference).attributes).toEqual(golden.syncedAttributes);
  });

  it("supports standalone sync and keeps constant attributes immutable", () => {
    const document = insertedDocument();
    const attributes = [...readBlockAttributes(document.blocks[0]!), { tag: "CODE", prompt: "Code", defaultValue: "A", position: { x: 0, y: 10 }, height: 2.5, constant: true }];
    const redefined = redefineBlock(document, { blockId: "DOOR", basePoint: { x: 0, y: 0 }, entities: document.blocks[0]!.entities, attributes });
    const staged = structuredClone(document); const replacement = redefined.changes[0]; if (!replacement || replacement.type !== "replace-drawing-content") throw new Error("Expected drawing replacement."); staged.blocks = replacement.blocks;
    const synced = syncBlockAttributes(staged, "DOOR");
    expect(synced.resultHandles).toEqual(["I1", "I2"]); expect(synced.changes).toHaveLength(2);
    const first = synced.changes[0]; if (!first || first.type !== "put") throw new Error("Expected attribute put.");
    const afterSync = { ...staged, entities: staged.entities.map((entity) => entity.handle === first.entity.handle ? first.entity : entity) };
    expect(editBlockAttributes(afterSync, "I1", { CODE: "MUTANT" })).toMatchObject({ entity: { handle: "I1", attributes: { CODE: "A" } } });
  });

  it("fails closed when a redefine affects a locked insert or removes values without sync", () => {
    const document = insertedDocument();
    expect(() => redefineBlock(document, { blockId: "DOOR", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B2", layerId: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }], attributes: [] })).toThrow(/Use attribute sync/u);
    document.layers[0]!.locked = true;
    expect(() => redefineBlock(document, { blockId: "DOOR", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B2", layerId: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }] })).toThrow(/locked/u);
    expect(() => editBlockAttributes(document, "I1", { MARK: "D7" })).toThrow(/locked/u);
  });
});
