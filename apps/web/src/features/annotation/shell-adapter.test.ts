import { CadSession, createEmptyDocument, hatchBoundaryPolyline } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { prepareBlockCommand } from "../blocks/command-adapter.js";
import { prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";
import { createAnnotationBlockShellAdapter, type AnnotationBlockShellAdapter } from "./shell-adapter.js";

function annotationSession(): CadSession {
  const document = createEmptyDocument({ documentId: "annotation-shell" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 });
  document.entities.push(hatchBoundaryPolyline("P1", "0", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]));
  return new CadSession(document);
}

function adapter(session = annotationSession(), dxfVersion = "AC1021"): AnnotationBlockShellAdapter {
  return createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion });
}

describe("AnnotationBlockShellAdapter contract", () => {
  it("publishes a stable command registry and user-visible capability state", () => {
    const shell = adapter();
    expect(shell.commandDefinitions.map((definition) => definition.id)).toEqual([
      "TEXT", "MTEXT", "LEADER", "MLEADER", "DIM", "STYLE", "HATCH",
      "BLOCK", "INSERT", "BEDIT", "EXPLODE", "ATTRIB",
    ]);
    expect(shell.commandDefinitions.find((definition) => definition.id === "DIM")?.options?.map((option) => option.id)).toEqual(["LINEAR", "ALIGNED", "ANGULAR", "RADIUS", "DIAMETER", "CONTINUE", "STYLE"]);
    expect(shell.capabilities.every((state) => state.executable)).toBe(true);
  });

  it("fails closed when planner/session support is absent or MLEADER targets AC1018", () => {
    const noPlanner = createAnnotationBlockShellAdapter({ sessionAdapter: { session: annotationSession() }, annotationPlanner: null, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    expect(noPlanner.capability("TEXT")).toMatchObject({ executable: false, code: "missing-planner" });
    expect(noPlanner.capability("BLOCK")).toMatchObject({ executable: true, code: "ready" });
    const noSession = createAnnotationBlockShellAdapter({ sessionAdapter: null, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    expect(noSession.capability("HATCH")).toMatchObject({ executable: false, code: "missing-session-adapter" });

    const session = annotationSession();
    const ac1018 = adapter(session, "AC1018");
    const input: AnnotationCommandInput = { commandId: "MLEADER", args: { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "M", textPosition: { x: 12, y: 10 }, styleId: "MLS", textStyleId: "TXT", textHeight: 2.5 } };
    expect(ac1018.capability("MLEADER")).toMatchObject({ executable: false, code: "unsupported-dxf-version" });
    expect(ac1018.commandDefinitions.some((definition) => definition.id === "MLEADER")).toBe(false);
    expect(() => ac1018.execute(input)).toThrow(/AC1021/u);
    expect(session.document.revision).toBe(0);
  });

  it("wires preview, one atomic commit, prompt cancel/repeat and whole-command Undo/Redo", () => {
    const session = annotationSession();
    const shell = adapter(session);
    const prompt = shell.createPrompt({ commandId: "TEXT" });
    prompt.answer({ x: 5, y: 6 });
    expect(shell.cancel()).toMatchObject({ status: "cancelled", values: {} });
    expect(shell.repeat().snapshot).toMatchObject({ status: "active", currentFieldId: "position" });

    const input: AnnotationCommandInput = { commandId: "TEXT", args: { handle: "T1", layerId: "0", position: { x: 5, y: 6 }, text: "Kuubik", height: 2.5, styleId: "TXT" } };
    const preview = shell.preview(input);
    const result = shell.execute(input, "2026-08-31T18:00:00.000Z");
    expect(result).toMatchObject({ kind: "commit", committed: { operation: { commandId: "TEXT" } } });
    if (result.kind !== "commit") throw new Error("Expected TEXT commit.");
    expect(result.committed.changes).toEqual(preview.changes);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.find((entity) => entity.handle === "T1")).toMatchObject({ kind: "text", text: "Kuubik" });
    expect(shell.undo()?.operation.commandId).toBe("UNDO");
    expect(session.document.entities.some((entity) => entity.handle === "T1")).toBe(false);
    expect(shell.redo()?.operation.commandId).toBe("TEXT");
    expect(session.document.entities.some((entity) => entity.handle === "T1")).toBe(true);
  });

  it("routes DIM options and rejects a typed-command mutation before commit", () => {
    const session = annotationSession();
    const shell = adapter(session);
    const input: AnnotationCommandInput = { commandId: "DIMLINEAR", args: { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 20, y: 0 }, dimensionLinePoint: { x: 0, y: 5 }, axis: "horizontal" } };
    expect(shell.execute(input)).toMatchObject({ kind: "commit", invocation: { commandId: "DIM", options: ["LINEAR"] } });
    const revision = session.document.revision;
    const definition = shell.commandDefinitions.find((candidate) => candidate.id === "TEXT")!;
    expect(() => definition.prepare(session.document, { commandId: "TEXT", invokedAs: "TEXT", options: [], arguments: [encodeURIComponent(JSON.stringify({ ...input, commandId: "MTEXT" }))], raw: "mutant" })).toThrow(/received MTEXT/u);
    expect(session.document.revision).toBe(revision);
  });
});
