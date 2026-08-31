import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createBlockCommandWorkflow, prepareBlockCommand } from "./command-adapter.js";
import { BLOCK_TOOLS, blockPromptPlan } from "./model.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "block-adapter", now: "2026-08-31T12:00:00.000Z" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  return document;
}

describe("F-087..F-091 typed block runtime", () => {
  it("declares prompt/options for every panel intent", () => {
    expect(BLOCK_TOOLS.every((tool) => blockPromptPlan(tool.id).fields.length > 0)).toBe(true);
    expect(blockPromptPlan("INSERT").fields.map((field) => field.id)).toEqual(["blockId", "insertion", "scaleX", "scaleY", "rotationRad", "attributes"]);
    expect(blockPromptPlan("EXPLODE").fields.find((field) => field.id === "nestedMode")?.choices).toEqual(["preserve", "recursive"]);
    expect(blockPromptPlan("ATTRIB").fields.find((field) => field.id === "mode")?.choices).toEqual(["edit", "sync"]);
  });

  it("runs BLOCK, INSERT, BEDIT, ATTRIB and EXPLODE as individual atomic commands", () => {
    const session = new CadSession(fixture());
    const workflow = createBlockCommandWorkflow(session);
    workflow.commit({ commandId: "BLOCK", id: "B", name: "B", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20", attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "B1", position: { x: 50, y: 10 }, height: 5 }] }, "block:1");
    expect(session.document).toMatchObject({ revision: 1, entities: [{ kind: "blockRef", handle: "20" }] });

    workflow.commit({ commandId: "INSERT", handle: "21", layerId: "0", blockId: "B", insertion: { x: 200, y: 0 }, scale: { x: 2, y: 2 }, rotationRad: Math.PI / 2, attributes: { MARK: "B2" } }, "insert:1");
    expect(session.document.revision).toBe(2);
    expect(session.document.entities.find((entity) => entity.handle === "21")).toMatchObject({ scale: { x: 2, y: 2 }, attributes: { MARK: "B2" } });

    const beforeBedit = structuredClone(session.document.entities);
    workflow.commit({ commandId: "BEDIT", insertHandle: "20", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 150, y: 0 } }], attributes: [{ tag: "MARK", prompt: "Mark", defaultValue: "B1", position: { x: 50, y: 10 }, height: 5 }, { tag: "CODE", prompt: "Code", defaultValue: "A", position: { x: 50, y: 20 }, height: 5, constant: true }] }, "bedit:1");
    expect(session.document.revision).toBe(3);
    expect(session.document.entities).toEqual(beforeBedit);
    expect(session.document.blocks[0]?.entities[0]).toMatchObject({ handle: "11", end: { x: 150, y: 0 } });

    workflow.commit({ commandId: "ATTRIB", insertHandle: "21", values: { MARK: "B9" } }, "attrib:1");
    expect(session.document.revision).toBe(4);
    expect(session.document.entities.find((entity) => entity.handle === "21")).toMatchObject({ attributes: { MARK: "B9" } });

    workflow.commit({ commandId: "ATTRIB", mode: "sync", insertHandle: "20" }, "attsync:1");
    expect(session.document.revision).toBe(5);
    expect(session.document.entities.find((entity) => entity.handle === "20")).toMatchObject({ attributes: { MARK: "B1", CODE: "A" } });
    expect(session.document.entities.find((entity) => entity.handle === "21")).toMatchObject({ attributes: { MARK: "B9", CODE: "A" } });

    const explode = prepareBlockCommand(session.document, { commandId: "EXPLODE", insertHandle: "20" });
    expect(explode.changes.length).toBeGreaterThan(1);
    workflow.commit({ commandId: "EXPLODE", insertHandle: "20", nestedMode: "recursive" }, "explode:1");
    expect(session.document.revision).toBe(6);
    expect(session.document.entities.some((entity) => entity.handle === "20")).toBe(false);
    workflow.undo();
    expect(session.document.entities.some((entity) => entity.handle === "20")).toBe(true);
    workflow.redo();
    expect(session.document.entities.some((entity) => entity.handle === "20")).toBe(false);
  });

  it("rejects a BEDIT cycle before any revision is committed", () => {
    const session = new CadSession(fixture());
    const workflow = createBlockCommandWorkflow(session);
    workflow.commit({ commandId: "BLOCK", id: "B", name: "B", basePoint: { x: 0, y: 0 }, selectedHandles: ["10"], insertHandle: "20" }, "block:cycle");
    expect(() => workflow.commit({ commandId: "BEDIT", insertHandle: "20", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "11", layerId: "0", blockId: "B", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] }, "bedit:cycle")).toThrow(/cycle rejected/u);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities).toMatchObject([{ handle: "20", blockId: "B" }]);
  });
});
