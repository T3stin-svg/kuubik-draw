import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { prepareAnnotationCommand } from "../annotation/command-adapter.js";
import { createAnnotationBlockShellAdapter } from "../annotation/shell-adapter.js";
import { prepareBlockCommand } from "./command-adapter.js";

describe("BLOCK command-line runtime wiring", () => {
  it("commits BLOCK as one operation and preserves the whole change set through Undo/Redo", () => {
    const document = createEmptyDocument({ documentId: "block-shell" });
    document.entities.push({ kind: "line", handle: "L1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const session = new CadSession(document);
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    const input = { commandId: "BLOCK" as const, id: "B1", name: "Door", basePoint: { x: 0, y: 0 }, selectedHandles: ["L1"], insertHandle: "I1" };
    expect(shell.execute(input)).toMatchObject({ kind: "commit", committed: { operation: { commandId: "BLOCK", targetHandles: ["L1"], resultHandles: ["I1"] } } });
    expect(session.document).toMatchObject({ revision: 1, blocks: [{ id: "B1" }], entities: [{ kind: "blockRef", handle: "I1" }] });
    shell.undo();
    expect(session.document).toMatchObject({ blocks: [], entities: [{ kind: "line", handle: "L1" }] });
    shell.redo();
    expect(session.document).toMatchObject({ blocks: [{ id: "B1" }], entities: [{ kind: "blockRef", handle: "I1" }] });
  });

  it.each(["BLOCK", "INSERT", "BEDIT", "EXPLODE", "ATTRIB"] as const)("rejects a corrupt %s payload without document mutation", (commandId) => {
    const session = new CadSession(createEmptyDocument({ documentId: `mutant-${commandId}` }));
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    const definition = shell.commandDefinitions.find((candidate) => candidate.id === commandId)!;
    const before = structuredClone(session.document);
    expect(() => definition.prepare(session.document, { commandId, invokedAs: commandId, options: [], arguments: ["%not-json"], raw: commandId })).toThrow(/invalid/u);
    expect(session.document).toEqual(before);
  });
});
