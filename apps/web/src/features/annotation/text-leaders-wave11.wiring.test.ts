import { CadSession, createEmptyDocument, readLeaderContract, readMTextContract } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareBlockCommand } from "../blocks/command-adapter.js";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";
import { prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";
import type { CommandPromptStateMachine, CommandPromptValue } from "./prompt-state-machine.js";
import { createAnnotationBlockShellAdapter, type AnnotationBlockPromptRequest, type AnnotationBlockShellAdapter } from "./shell-adapter.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "text-leader-wave11-wiring", now: "2026-08-31T21:30:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.entities.push({ kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } });
  return document;
}

function content(document: KDrawDocumentV1) {
  return structuredClone({ entities: document.entities, textStyles: document.textStyles });
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
  const beforeRevision = session.document.revision;
  complete(shell.createPrompt(request), answers);
  const preview = shell.previewPrompt();
  expect(shell.previewPrompt()).toEqual(preview);
  const result = shell.executePrompt("2026-08-31T21:31:00.000Z");
  expect(result.prepared).toEqual(preview.prepared);
  expect(result.input).toEqual(preview.input);
  expect(result.execution.committed.changes).toEqual(preview.prepared.changes);
  expect(session.document.revision).toBe(beforeRevision + 1);
  const after = content(session.document);
  expect(shell.undo()?.operation.commandId).toBe("UNDO");
  expect(content(session.document)).toEqual(before);
  expect(shell.redo()?.operation.commandId).toBe(result.prepared.commandId);
  expect(content(session.document)).toEqual(after);
  return result;
}

describe("F-057..F-060 browser-ready text/leader adapter wiring", () => {
  it("wires MTEXT, STYLE, LEADER and MLEADER create/edit/apply through exact preview and atomic read-back", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    runPrompt(shell, session, { commandId: "STYLE" }, { mode: "create", style: { id: "NARROW", name: "Narrow", fontFamily: "Arial Narrow", widthFactor: 0.8, obliqueAngleRad: 0.1 } });
    runPrompt(shell, session, { commandId: "STYLE" }, { mode: "update", style: { id: "NARROW", name: "Narrow", fontFamily: "Liberation Sans Narrow", widthFactor: 0.75, obliqueAngleRad: 0.05 } });

    const mtext = runPrompt(shell, session, { commandId: "MTEXT" }, { position: { x: 10, y: 20 }, text: "Pealkiri\nSisu 😀", height: 2.5, width: 40, styleId: "TXT", attachment: "middle-center", lineSpacingFactor: 1.2, wrapMode: "word", paragraphs: [{ id: "TITLE", alignment: "center" }, { id: "BODY", alignment: "justify" }] });
    const mtextHandle = mtext.prepared.resultHandles[0]!;
    const mtextEdit = runPrompt(shell, session, { commandId: "MTEXT", context: { selectedHandles: [mtextHandle] } }, { mode: "edit", patch: { text: "Pealkiri\nSisu 😀\nLisa", width: 24, wrapMode: "character", styleId: null } });
    expect(mtextEdit.readBack.entities[0]).toMatchObject({ handle: mtextHandle, kind: "mtext" });
    expect(mtextEdit.readBack.entities[0]).not.toHaveProperty("styleId");
    expect(readMTextContract(mtextEdit.readBack.entities[0]!)).toMatchObject({ paragraphs: [{ id: "TITLE" }, { id: "BODY" }, { id: "P1" }] });

    const leader = runPrompt(shell, session, { commandId: "LEADER", context: { leaderAnchor: { handle: "A1", feature: "end", fallback: { x: 100, y: 20 } } } }, { vertices: [{ x: -1, y: -1 }, { x: 20, y: 10 }], text: "Viide", contentPosition: { x: 25, y: 10 }, textStyleId: "TXT", textHeight: 2.5, arrowType: "open", arrowSize: 3, landingEnabled: true, landingLength: 5, associative: true });
    const leaderHandle = leader.prepared.resultHandles[0]!;
    const leaderEdit = runPrompt(shell, session, { commandId: "LEADER", context: { selectedHandles: [leaderHandle] } }, { mode: "edit", patch: { text: null, textStyleId: null, anchor: null, arrowType: "none", landingEnabled: false } });
    expect(leaderEdit.readBack.entities[0]).toMatchObject({ handle: leaderHandle });
    expect(leaderEdit.readBack.entities[0]).not.toHaveProperty("text");
    expect(readLeaderContract(leaderEdit.readBack.entities[0]!)).toMatchObject({ kind: "leader", associative: false, arrow: { type: "none" }, landing: { enabled: false } });

    const mleader = runPrompt(shell, session, { commandId: "MLEADER", context: { leaderAnchor: { handle: "A1", feature: "start", fallback: { x: 0, y: 0 } } } }, { vertices: [{ x: -1, y: -1 }, { x: 30, y: 15 }], text: "Multiviide", textPosition: { x: 35, y: 15 }, styleId: "MLS", textStyleId: "TXT", textHeight: 2.5, landingGap: 1.25, arrowType: "dot", arrowSize: 3.5, landingEnabled: true, landingLength: 8, associative: true });
    const mleaderHandle = mleader.prepared.resultHandles[0]!;
    const apply = runPrompt(shell, session, { commandId: "STYLE", context: { selectedHandles: [mtextHandle, mleaderHandle] } }, { mode: "apply", styleId: "NARROW" });
    expect(apply.readBack.entities.map((entity) => entity.handle)).toEqual([mtextHandle, mleaderHandle]);
    expect(readLeaderContract(apply.readBack.entities.find((entity) => entity.handle === mleaderHandle)!)).toMatchObject({ kind: "mleader", styleId: "MLS", textStyleId: "NARROW", anchor: { handle: "A1" } });
    const mleaderEdit = runPrompt(shell, session, { commandId: "MLEADER", context: { selectedHandles: [mleaderHandle] } }, { mode: "edit", patch: { textPosition: { x: 40, y: 18 }, textStyleId: null, anchor: null } });
    expect(readLeaderContract(mleaderEdit.readBack.entities[0]!)).toMatchObject({ kind: "mleader", styleId: "MLS", textPosition: { x: 40, y: 18 }, associative: false });
    expect(readLeaderContract(mleaderEdit.readBack.entities[0]!)).not.toHaveProperty("textStyleId");
  });

  it("updates two associated leader heads with their handles in the geometry command's one Undo/Redo step", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    const first = runPrompt(shell, session, { commandId: "LEADER", context: { leaderAnchor: { handle: "A1", feature: "start", fallback: { x: 0, y: 0 } } } }, { vertices: [{ x: 0, y: 0 }, { x: 20, y: 10 }], associative: true });
    const second = runPrompt(shell, session, { commandId: "MLEADER", context: { leaderAnchor: { handle: "A1", feature: "end", fallback: { x: 100, y: 20 } } } }, { vertices: [{ x: 100, y: 20 }, { x: 30, y: 15 }], text: "M", textPosition: { x: 35, y: 15 }, styleId: "MLS", textHeight: 2.5, associative: true });
    const handles = [first.prepared.resultHandles[0]!, second.prepared.resultHandles[0]!];
    const workflow = createAssociativeEntityWorkflow(session);
    const moved = { kind: "line" as const, handle: "A1", layerId: "0", start: { x: 7, y: 8 }, end: { x: 130, y: 50 } };
    const input = { commandId: "MOVE", entityChanges: [{ type: "put" as const, entity: moved }], changedHandles: ["A1"] };
    const before = content(session.document);
    const preview = workflow.preview(input);
    expect(preview.resultHandles).toEqual(["A1", ...handles]);
    expect(workflow.preview(input)).toEqual(preview);
    workflow.commit(input, "wave11:move-leaders");
    expect(session.document.entities.find((entity) => entity.handle === handles[0])).toMatchObject({ vertices: [{ x: 7, y: 8 }, { x: 20, y: 10 }] });
    expect(session.document.entities.find((entity) => entity.handle === handles[1])).toMatchObject({ vertices: [{ x: 130, y: 50 }, { x: 30, y: 15 }] });
    const after = content(session.document);
    workflow.undo();
    expect(content(session.document)).toEqual(before);
    workflow.redo();
    expect(content(session.document)).toEqual(after);
  });

  it("fails malformed runtime payloads and AC1018 MLEADER capability before revision changes", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    const malformed = { commandId: "MTEXT", args: { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "A", height: 2.5, width: 20, attachment: "baseline" } } as unknown as AnnotationCommandInput;
    expect(() => shell.execute(malformed)).toThrow(/attachment/u);
    expect(session.document.revision).toBe(0);
    const legacy = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    expect(legacy.capability("MLEADER")).toMatchObject({ executable: false, code: "unsupported-dxf-version" });
    expect(legacy.commandDefinitions.some((definition) => definition.id === "MLEADER")).toBe(false);
    expect(session.document.revision).toBe(0);
  });
});
