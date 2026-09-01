import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { CommandLineEngine, CommandRegistry, type CommandInvocation } from "./command-engine.js";
import {
  GEOMETRY_MODIFY_DOCUMENT_COMMAND_IDS,
  createGeometryModifyCommandDefinitions,
  prepareGeometryModifyDocumentCommand,
  prepareGeometryModifySelectionCommand,
  type GeometryModifyInvocationParsers,
} from "./geometry-modify-adapters.js";

function jsonArgument<T>(invocation: CommandInvocation): T {
  const value = invocation.arguments[0];
  if (!value) throw new TypeError(`${invocation.commandId} requires one JSON adapter argument.`);
  return JSON.parse(value) as T;
}

function parsers(): GeometryModifyInvocationParsers {
  return {
    LINE: jsonArgument,
    PLINE: jsonArgument,
    CIRCLE: jsonArgument,
    ARC: jsonArgument,
    POLYGON: jsonArgument,
    ELLIPSE: jsonArgument,
    REVCLOUD: jsonArgument,
    ARRAYRECT: jsonArgument,
    ARRAYPOLAR: jsonArgument,
    ARRAYPATH: jsonArgument,
    PEDIT: jsonArgument,
    SPLINE: jsonArgument,
    BOUNDARY: jsonArgument,
    REGION: jsonArgument,
    TRIM: jsonArgument,
    EXTEND: jsonArgument,
    FILLET: jsonArgument,
    STRETCH: jsonArgument,
  };
}

function crossingDocument(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "adapter-crossing" });
  document.entities.push(
    { kind: "line", handle: "30", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "40", layerId: "0", start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
  );
  return document;
}

describe("typed geometry/modify command adapters", () => {
  it("registers every document command with stable AutoCAD-style aliases", () => {
    const definitions = createGeometryModifyCommandDefinitions(parsers());
    expect(definitions.map((definition) => definition.id)).toEqual(GEOMETRY_MODIFY_DOCUMENT_COMMAND_IDS);
    const registry = new CommandRegistry(definitions);
    expect(registry.resolve("L")?.id).toBe("LINE");
    const circle = registry.resolve("C");
    expect(circle?.id).toBe("CIRCLE");
    expect(circle?.options?.map((candidate) => candidate.id)).toEqual(["2P", "3P", "TTR", "TTT", "DIAMETER"]);
    const arc = registry.resolve("A");
    expect(arc?.id).toBe("ARC");
    expect(arc?.options?.map((candidate) => candidate.id)).toEqual(["CENTER", "END", "ANGLE", "DIRECTION", "RADIUS", "LENGTH"]);
    expect(registry.resolve("ARRAY")?.id).toBe("ARRAYRECT");
    expect(registry.resolve("PE")?.id).toBe("PEDIT");
    expect(registry.resolve("SPL")?.id).toBe("SPLINE");
    expect(registry.resolve("BO")?.id).toBe("BOUNDARY");
    expect(registry.resolve("TR")?.id).toBe("TRIM");
  });

  it("routes the complete ARC contract through document guards and atomic history", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "adapter-arc" }));
    const engine = new CommandLineEngine(session, new CommandRegistry(createGeometryModifyCommandDefinitions(parsers())));
    const input = {
      command: "ARC" as const, handle: "A5", layerId: "0",
      construction: {
        mode: "start-center-length" as const,
        start: { x: 10, y: 0 }, center: { x: 0, y: 0 }, chordLength: -10,
      },
    };
    const command = `A '${JSON.stringify(input)}'`;
    const preview = engine.preview(command);
    const executed = engine.execute(command);
    if (executed.kind !== "commit") throw new Error("Expected ARC commit.");
    expect(executed.committed.changes).toEqual(preview.changes);
    expect(session.document.entities).toEqual([expect.objectContaining({ kind: "arc", handle: "A5", radius: 10, counterClockwise: true })]);
    engine.execute("U");
    expect(session.document.entities).toEqual([]);
    engine.execute("REDO");
    expect(session.document.entities).toEqual([expect.objectContaining({ handle: "A5" })]);
  });

  it("routes the full CIRCLE contract through document guards and atomic command history", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "adapter-circle" }));
    const engine = new CommandLineEngine(session, new CommandRegistry(createGeometryModifyCommandDefinitions(parsers())));
    const input = {
      command: "CIRCLE" as const, handle: "C4", layerId: "0",
      construction: {
        mode: "ttr" as const,
        first: { kind: "line" as const, start: { x: 0, y: -100 }, end: { x: 0, y: 100 }, pickPoint: { x: 0, y: 4 } },
        second: { kind: "line" as const, start: { x: -100, y: 0 }, end: { x: 100, y: 0 }, pickPoint: { x: 4, y: 0 } },
        radius: 4,
      },
    };
    const command = `C '${JSON.stringify(input)}'`;
    const preview = engine.preview(command);
    const executed = engine.execute(command);
    if (executed.kind !== "commit") throw new Error("Expected CIRCLE commit.");
    expect(executed.committed.changes).toEqual(preview.changes);
    expect(session.document.entities).toEqual([expect.objectContaining({ kind: "circle", handle: "C4", center: { x: 4, y: 4 }, radius: 4 })]);
    engine.execute("U");
    expect(session.document.entities).toEqual([]);
    engine.execute("REDO");
    expect(session.document.entities).toEqual([expect.objectContaining({ handle: "C4" })]);
  });

  it("wires LINE preview and commit through the same typed adapter with atomic Undo/Redo", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "adapter-line" }));
    const engine = new CommandLineEngine(session, new CommandRegistry(createGeometryModifyCommandDefinitions(parsers())));
    const input = {
      command: "LINE" as const, handles: ["10", "11"], layerId: "0",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    };
    const command = `L '${JSON.stringify(input)}'`;
    const preview = engine.preview(command);
    const executed = engine.execute(command);
    if (executed.kind !== "commit") throw new Error("Expected LINE commit.");
    expect(executed.committed.changes).toEqual(preview.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
    engine.execute("U");
    expect(session.document.entities).toEqual([]);
    engine.execute("REDO");
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });

  it("normalizes array, PEDIT, SPLINE, BOUNDARY, REGION and matrix families to one atomic contract", () => {
    const arrayDocument = createEmptyDocument({ documentId: "adapter-families" });
    arrayDocument.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(prepareGeometryModifyDocumentCommand(arrayDocument, {
      commandId: "ARRAYRECT",
      input: { command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 1, columns: 2, rowVector: { x: 0, y: 10 }, columnVector: { x: 20, y: 0 } },
    })).toMatchObject({ commandId: "ARRAYRECT", targetHandles: ["10"], changes: [{ type: "put" }] });

    arrayDocument.entities.push({ kind: "arc", handle: "11", layerId: "0", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true });
    expect(prepareGeometryModifyDocumentCommand(arrayDocument, {
      commandId: "PEDIT", input: { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0 }] },
    })).toMatchObject({ commandId: "PEDIT", targetHandles: ["10", "11"], resultHandles: ["10"] });

    expect(prepareGeometryModifyDocumentCommand(arrayDocument, {
      commandId: "SPLINE",
      input: { method: "fit", handle: "20", layerId: "0", points: [{ x: 0, y: 0 }, { x: 40, y: 70 }, { x: 100, y: 0 }], fitTolerance: 5 },
    })).toMatchObject({ commandId: "SPLINE", resultHandles: ["20"], changes: [{ type: "put" }] });

    const boundaryDocument = createEmptyDocument({ documentId: "adapter-boundary" });
    boundaryDocument.entities.push({ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
    expect(prepareGeometryModifyDocumentCommand(boundaryDocument, {
      commandId: "BOUNDARY", input: { handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, output: "polyline" },
    })).toMatchObject({ commandId: "BOUNDARY", targetHandles: ["10"], resultHandles: ["20"] });
    expect(prepareGeometryModifyDocumentCommand(boundaryDocument, {
      commandId: "REGION", input: { targetHandles: ["10"], resultHandles: ["21"] },
    })).toMatchObject({ commandId: "REGION", targetHandles: ["10"], resultHandles: ["21"] });

    expect(prepareGeometryModifyDocumentCommand(crossingDocument(), {
      commandId: "TRIM",
      input: { command: "TRIM", mode: "standard", cuttingHandlesInput: "40", targetsInput: "30@75,0", targetAction: "trim", edgeMode: "no-extend", projectMode: "none" },
    })).toMatchObject({ commandId: "TRIM", targetHandles: ["30"], resultHandles: ["30"] });
  });

  it("keeps QSELECT and SELECTSIMILAR typed and outside document transactions", () => {
    const document = crossingDocument();
    const revision = document.revision;
    expect(prepareGeometryModifySelectionCommand(document, {
      commandId: "QSELECT",
      input: { scope: "entire-drawing", currentSelection: [], property: "kind", operator: "equals", value: "line", resultMode: "replace" },
    })).toEqual({ commandId: "QSELECT", result: { handles: ["30", "40"], matchedHandles: ["30", "40"], examinedCount: 2 } });
    expect(prepareGeometryModifySelectionCommand(document, {
      commandId: "SELECTSIMILAR", input: { sourceHandle: "30", criteria: ["kind", "layerId"] },
    })).toEqual({ commandId: "SELECTSIMILAR", result: { handles: ["30", "40"], matchedHandles: ["30", "40"], examinedCount: 2 } });
    expect(document.revision).toBe(revision);
  });

  it("rejects a parser mutant that prepares a different canonical command before commit", () => {
    const mutated = parsers();
    mutated.LINE = (() => ({
      command: "CIRCLE", handle: "10", layerId: "0",
      construction: { mode: "center-radius", center: { x: 0, y: 0 }, radius: 10 },
    })) as unknown as GeometryModifyInvocationParsers["LINE"];
    const engine = new CommandLineEngine(new CadSession(createEmptyDocument({ documentId: "adapter-mutant" })), new CommandRegistry(createGeometryModifyCommandDefinitions(mutated)));
    expect(() => engine.execute("LINE '{}'")).toThrow(/LINE adapter prepared CIRCLE/);
    expect(engine.session.document.entities).toEqual([]);
  });
});
