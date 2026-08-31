import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import {
  CommandEngineInputError,
  CommandLineEngine,
  CommandRegistry,
  parseAliasFile,
  type CommandDefinition,
} from "./command-engine.js";

function lineDefinition(): CommandDefinition {
  return {
    id: "LINE",
    aliases: ["L"],
    options: [{ id: "CLOSE", aliases: ["C"] }, { id: "UNDO", aliases: ["U"] }],
    prepare(document, invocation) {
      if (invocation.arguments.length !== 2) throw new CommandEngineInputError("LINE fixture requires two point arguments.");
      const firstHandle = (0x10 + document.revision * 2).toString(16).toUpperCase();
      const secondHandle = (0x11 + document.revision * 2).toString(16).toUpperCase();
      const first = { kind: "line" as const, handle: firstHandle, layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      const second = { kind: "line" as const, handle: secondHandle, layerId: "0", start: { x: 10, y: 0 }, end: { x: 10, y: 10 } };
      return {
        commandId: "LINE",
        changes: [{ type: "put", entity: first }, { type: "put", entity: second }],
        targetHandles: [], resultHandles: [firstHandle, secondHandle],
        operationArgs: { options: invocation.options, arguments: invocation.arguments },
      };
    },
  };
}

describe("F-123/F-129/F-130 common command engine", () => {
  it("parses PGP-style aliases and resolves global/dot command prefixes case-insensitively", () => {
    const registry = new CommandRegistry([lineDefinition()]);
    registry.addAliases(parseAliasFile("; personal aliases\nLN, *LINE\nli, *LINE ; same command"));
    expect(registry.resolve("ln")?.id).toBe("LINE");
    expect(registry.resolve("_.line")?.id).toBe("LINE");
    expect(registry.complete("l")).toEqual(["L", "LI", "LINE", "LN"]);
  });

  it("uses the same preparation for preview and atomic commit with canonical options", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "command-line" }));
    const engine = new CommandLineEngine(session, new CommandRegistry([lineDefinition()]));
    const preview = engine.preview("l /c 0,0 10,0");
    const result = engine.execute("l /c 0,0 10,0", "2026-08-31T12:00:00.000Z");
    expect(result).toMatchObject({ kind: "commit", invocation: { commandId: "LINE", invokedAs: "L", options: ["CLOSE"], arguments: ["0,0", "10,0"] } });
    if (result.kind !== "commit") throw new Error("Expected command commit.");
    expect(result.committed.changes).toEqual(preview.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
    expect(session.nextUndoCommandId).toBe("LINE");
  });

  it("routes Undo and Redo over the whole prior command, including multiple changes", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "undo-redo" }));
    const engine = new CommandLineEngine(session, new CommandRegistry([lineDefinition()]));
    engine.execute("LINE 0,0 10,0");
    expect(session.document.entities).toHaveLength(2);
    expect(engine.execute("U")).toMatchObject({ kind: "undo", committed: { operation: { commandId: "UNDO" } } });
    expect(session.document.entities).toHaveLength(0);
    expect(engine.execute("REDO")).toMatchObject({ kind: "redo", committed: { operation: { commandId: "LINE" } } });
    expect(session.document.entities).toHaveLength(2);
  });

  it("supports keyboard buffer, history, Escape and empty Enter repeat", () => {
    const engine = new CommandLineEngine(new CadSession(createEmptyDocument({ documentId: "keys" })), new CommandRegistry([lineDefinition()]));
    engine.insertText("L 0,0 10,0");
    expect(engine.handleKey("Enter")).toMatchObject({ kind: "commit" });
    expect(engine.buffer).toBe("");
    engine.handleKey("ArrowUp");
    expect(engine.buffer).toBe("L 0,0 10,0");
    expect(engine.handleKey("Escape")).toEqual({ kind: "cancel" });
    expect(engine.buffer).toBe("");
    expect(engine.handleKey("Enter")).toMatchObject({ kind: "commit" });
    expect(engine.session.document.entities).toHaveLength(4);
  });

  it.each([
    () => parseAliasFile("broken alias"),
    () => parseAliasFile("X, *LINE\nX, *CIRCLE"),
    () => new CommandRegistry([lineDefinition(), { ...lineDefinition(), aliases: ["LN"] }]),
    () => new CommandLineEngine(new CadSession(createEmptyDocument({ documentId: "bad-option" })), new CommandRegistry([lineDefinition()])).preview("LINE /BOGUS 0,0 10,0"),
  ])("rejects a mutated registry or command input without a document change", (mutation) => {
    expect(mutation).toThrow();
  });
});
