import { CadSession, createEmptyDocument, hatchBoundaryPolyline, readHatchAssociation } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareBlockCommand } from "../blocks/command-adapter.js";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";
import { prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";
import type { CommandPromptStateMachine, CommandPromptValue } from "./prompt-state-machine.js";
import { createAnnotationBlockShellAdapter, type AnnotationBlockPromptRequest, type AnnotationBlockShellAdapter } from "./shell-adapter.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "hatch-wave12-wiring", now: "2026-09-01T00:00:00.000Z" });
  document.entities.push(
    hatchBoundaryPolyline("A0", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
    hatchBoundaryPolyline("A1", "0", [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }]),
    hatchBoundaryPolyline("A2", "0", [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]),
  );
  return document;
}

function content(document: KDrawDocumentV1) {
  return structuredClone({ entities: document.entities });
}

function complete(prompt: CommandPromptStateMachine, answers: Readonly<Record<string, unknown>>): void {
  while (prompt.snapshot.status === "active") {
    const id = prompt.snapshot.currentFieldId!;
    if (Object.hasOwn(answers, id)) prompt.answer(answers[id] as CommandPromptValue);
    else prompt.skip();
  }
  expect(prompt.snapshot.status).toBe("ready");
}

function runPrompt(shell: AnnotationBlockShellAdapter, session: CadSession, request: AnnotationBlockPromptRequest, answers: Readonly<Record<string, unknown>>) {
  const before = content(session.document);
  complete(shell.createPrompt(request), answers);
  const preview = shell.previewPrompt();
  expect(shell.previewPrompt()).toEqual(preview);
  const committed = shell.executePrompt("2026-09-01T00:01:00.000Z");
  expect(committed.prepared).toEqual(preview.prepared);
  expect(committed.execution.committed.changes).toEqual(preview.prepared.changes);
  const after = content(session.document);
  shell.undo();
  expect(content(session.document)).toEqual(before);
  shell.redo();
  expect(content(session.document)).toEqual(after);
  return committed;
}

describe("F-067 browser-ready HATCH wiring", () => {
  it("creates and edits pattern/island/association state with exact preview and one Undo/Redo step", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    const created = runPrompt(shell, session, { commandId: "HATCH" }, { boundaryHandles: ["A0", "A1", "A2"], pattern: "ANSI31", angleRad: 0.5, scale: 2, associative: true, islandDetection: "outer", origin: { x: 3, y: 4 } });
    const handle = created.prepared.resultHandles[0]!;
    expect(created.readBack.entities[0]).toMatchObject({ kind: "hatch", handle, loops: [{ isHole: false }, { isHole: true }] });
    expect(readHatchAssociation(created.readBack.entities[0]!)).toMatchObject({ islandDetection: "outer", boundaryHandles: ["A0", "A1", "A2"], pattern: { angleRad: 0.5, scale: 2, origin: { x: 3, y: 4 } } });

    const edited = runPrompt(shell, session, { commandId: "HATCH", context: { selectedHandles: [handle] } }, { mode: "edit", patch: { pattern: "SOLID", angleRad: 0.75, scale: 4, origin: { x: 8, y: 9 }, associative: false, islandDetection: "ignore" } });
    expect(edited.readBack.entities[0]).toMatchObject({ kind: "hatch", handle, pattern: "SOLID", associative: false, loops: [{ isHole: false }] });
    expect(readHatchAssociation(edited.readBack.entities[0]!)).toMatchObject({ islandDetection: "ignore", pattern: { type: "solid", angleRad: 0.75, scale: 4, origin: { x: 8, y: 9 } } });
  });

  it("updates an associative boundary under the same hatch handle in the geometry command", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    const created = runPrompt(shell, session, { commandId: "HATCH" }, { boundaryHandles: ["A0", "A1", "A2"], pattern: "ANSI31", angleRad: 1.1, scale: 3, associative: true, islandDetection: "normal", origin: { x: 5, y: 6 } });
    const hatchHandle = created.prepared.resultHandles[0]!;
    const workflow = createAssociativeEntityWorkflow(session);
    const moved = hatchBoundaryPolyline("A0", "0", [{ x: -10, y: -5 }, { x: 120, y: -5 }, { x: 120, y: 110 }, { x: -10, y: 110 }]);
    const input = { commandId: "STRETCH", entityChanges: [{ type: "put" as const, entity: moved }], changedHandles: ["A0"] };
    const preview = workflow.preview(input);
    expect(preview.resultHandles).toEqual(["A0", hatchHandle]);
    workflow.commit(input, "wave12:hatch-association");
    const updated = session.document.entities.find((entity) => entity.handle === hatchHandle)!;
    expect(updated).toMatchObject({ handle: hatchHandle, loops: [{ vertices: moved.vertices }, { isHole: true }, { isHole: false }] });
    expect(readHatchAssociation(updated)).toEqual(readHatchAssociation(created.readBack.entities[0]!));
    const after = content(session.document);
    workflow.undo();
    workflow.redo();
    expect(content(session.document)).toEqual(after);
  });

  it("rejects malformed and hidden-layer payloads before revision changes", () => {
    const document = fixture();
    document.layers.push({ id: "OFF", name: "OFF", visible: false, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    const malformed = { commandId: "HATCH", args: { handle: "20", layerId: "0", boundaryHandles: ["A0"], pattern: "SOLID", islandDetection: "all" } } as unknown as AnnotationCommandInput;
    expect(() => shell.execute(malformed)).toThrow(/island detection/u);
    const hidden = { commandId: "HATCH", args: { handle: "21", layerId: "OFF", boundaryHandles: ["A0"], pattern: "SOLID" } } as AnnotationCommandInput;
    expect(() => shell.execute(hidden)).toThrow(/off layer/u);
    expect(session.document.revision).toBe(0);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["A0", "A1", "A2"]);
  });
});
