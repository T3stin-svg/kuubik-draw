import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import {
  MODIFY_COMMAND_MATRIX,
  commitModifyMatrixCommand,
  previewModifyMatrixCommand,
  undoLastModifyMatrixStep,
  type ModifyMatrixInput,
} from "./modify-command-matrix.js";

function crossingDocument() {
  const document = createEmptyDocument({ documentId: "modify-matrix", now: "2026-08-31T00:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
  );
  return document;
}

describe("AutoCAD modify command matrix", () => {
  it("declares every routed option without changing the shared registry", () => {
    expect(MODIFY_COMMAND_MATRIX.TRIM).toMatchObject({ aliases: ["TR", "TRIM"], modes: ["quick", "standard"] });
    expect(MODIFY_COMMAND_MATRIX.EXTEND.options).toContain("Trim");
    expect(MODIFY_COMMAND_MATRIX.FILLET.options).toContain("Polyline");
    expect(MODIFY_COMMAND_MATRIX.STRETCH.modes).toContain("crossing-polygon");
  });

  it.each([
    { command: "TRIM", mode: "standard", cuttingHandlesInput: "20", targetsInput: "10@75,0", targetAction: "trim", edgeMode: "no-extend", projectMode: "none" },
    { command: "TRIM", mode: "quick", cuttingHandlesInput: "", targetsInput: "10@75,0", targetAction: "trim", edgeMode: "extend", projectMode: "view" },
    { command: "EXTEND", mode: "standard", boundaryHandlesInput: "20", targetsInput: "10@75,0", targetAction: "trim", edgeMode: "extend", projectMode: "ucs" },
    { command: "FILLET", mode: "pairs", radiusInput: "10", pairsInput: "10@25,0>20@50,25", polylineHandlesInput: "", trimMode: "no-trim" },
    { command: "STRETCH", crossingInput: "40,-10; 110,20", individualHandles: [], baseInput: "0,0", destinationInput: "@25,5" },
  ] as ModifyMatrixInput[])("prepares $command preview deterministically", (input) => {
    expect(previewModifyMatrixCommand(crossingDocument(), input)).toEqual(previewModifyMatrixCommand(crossingDocument(), input));
  });

  it("uses identical preview changes for an atomic commit, Undo and Redo", () => {
    const session = new CadSession(crossingDocument());
    const input: ModifyMatrixInput = {
      command: "TRIM", mode: "standard", cuttingHandlesInput: "20", targetsInput: "10@75,0",
      targetAction: "trim", edgeMode: "no-extend", projectMode: "none",
    };
    const preview = previewModifyMatrixCommand(session.document, input);
    const committed = commitModifyMatrixCommand(session, input, "matrix:trim:1", "2026-08-31T12:00:00.000Z");
    expect(committed.changes).toEqual(preview.changes);
    expect(session.nextUndoCommandId).toBe("TRIM");
    expect(session.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 50, y: 0 } });
    session.undo("2026-08-31T12:00:01.000Z");
    expect(session.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 100, y: 0 } });
    session.redo("2026-08-31T12:00:02.000Z");
    expect(session.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 50, y: 0 } });
  });

  it("implements command-local Undo by replaying a shorter immutable input", () => {
    const input: ModifyMatrixInput = {
      command: "TRIM", mode: "standard", cuttingHandlesInput: "20", targetsInput: "10@25,0; 10@75,0",
      targetAction: "trim", edgeMode: "no-extend", projectMode: "none",
    };
    const previous = undoLastModifyMatrixStep(input);
    expect(previous).toMatchObject({ targetsInput: "10@25,0" });
    expect(input.targetsInput).toBe("10@25,0; 10@75,0");
  });

  it("rejects mutated matrix input before a document transaction", () => {
    const bad: ModifyMatrixInput = {
      command: "FILLET", mode: "pairs", radiusInput: "-1", pairsInput: "10@25,0>20@50,25",
      polylineHandlesInput: "", trimMode: "trim",
    };
    expect(() => previewModifyMatrixCommand(crossingDocument(), bad)).toThrow(/zero or greater/);
  });
});
