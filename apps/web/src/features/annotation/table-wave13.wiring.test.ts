import { CadSession, createEmptyDocument, createTableStyle, readTableContract, readTableStyles } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareBlockCommand } from "../blocks/command-adapter.js";
import { prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";
import type { CommandPromptStateMachine, CommandPromptValue } from "./prompt-state-machine.js";
import { createAnnotationBlockShellAdapter, type AnnotationBlockPromptRequest, type AnnotationBlockShellAdapter } from "./shell-adapter.js";

const style = { id: "TS", name: "Standard", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left" as const, verticalAlignment: "middle" as const };

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "table-wave13-wiring", now: "2026-09-01T07:00:00.000Z" });
  const change = createTableStyle(document, style);
  if (change.type !== "set-metadata") throw new Error("Expected TABLESTYLE metadata change.");
  document.metadata = change.metadata;
  return document;
}

function content(document: KDrawDocumentV1) {
  const { updatedAt: _updatedAt, ...metadata } = document.metadata;
  return structuredClone({ entities: document.entities, metadata });
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
  const committed = shell.executePrompt("2026-09-01T07:01:00.000Z");
  expect(committed.prepared).toEqual(preview.prepared);
  expect(committed.execution.committed.changes).toEqual(preview.prepared.changes);
  const after = content(session.document);
  shell.undo(); expect(content(session.document)).toEqual(before);
  shell.redo(); expect(content(session.document)).toEqual(after);
  return committed;
}

describe("F-068 browser-ready TABLE wiring", () => {
  it("creates, edits and styles through exact preview=commit with one Undo/Redo step each", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    const created = runPrompt(shell, session, { commandId: "TABLE" }, {
      mode: "create", definition: { origin: { x: 10, y: 20 }, styleId: "TS", rows: [{ id: "R1", height: 6 }, { id: "R2", height: 7 }], columns: [{ id: "C1", width: 20 }, { id: "C2", width: 30 }] },
    });
    const handle = created.prepared.resultHandles[0]!;
    expect(readTableContract(created.readBack.entities[0]!)).toMatchObject({ styleId: "TS", rows: [{ id: "R1" }, { id: "R2" }], columns: [{ id: "C1" }, { id: "C2" }] });

    const edited = runPrompt(shell, session, { commandId: "TABLE", context: { selectedHandles: [handle] } }, {
      mode: "edit", operations: [
        { type: "set-cell", cellId: "R2:C2", value: { kind: "text", text: "A-02" }, horizontalAlignment: "right", format: { bold: true, color: "#123456" } },
        { type: "insert-row", index: 1, row: { id: "RX", height: 8 }, cells: [{ id: "X1", columnId: "C1" }, { id: "X2", columnId: "C2" }] },
        { type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } },
      ],
    });
    expect(edited.prepared.targetHandles).toEqual([handle]);
    expect(readTableContract(edited.readBack.entities[0]!)).toMatchObject({ merges: [{ id: "M1" }], rows: [{ id: "R1" }, { id: "RX" }, { id: "R2" }] });

    const styled = runPrompt(shell, session, { commandId: "TABLE" }, { mode: "style-update", style: { ...style, textHeight: 4, horizontalAlignment: "center" } });
    expect(styled.readBack.metadata).not.toBeNull();
    expect(readTableStyles(session.document)).toEqual([{ ...style, textHeight: 4, horizontalAlignment: "center" }]);
    expect(session.document.entities.find((entity) => entity.handle === handle)?.handle).toBe(handle);
  });

  it("rejects hidden-layer and malformed edit payloads before revision changes", () => {
    const document = fixture();
    document.layers.push({ id: "OFF", name: "OFF", visible: false, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1018" });
    const hidden = { commandId: "TABLE", mode: "create", args: { handle: "10", layerId: "OFF", origin: { x: 0, y: 0 }, styleId: "TS", rows: [{ id: "R", height: 5 }], columns: [{ id: "C", width: 10 }] } } as AnnotationCommandInput;
    expect(() => shell.execute(hidden)).toThrow(/Layer is off|off layer/u);
    const malformed = { commandId: "TABLE", mode: "edit", handle: "missing", operations: [{ type: "execute-field" }] } as unknown as AnnotationCommandInput;
    expect(() => shell.execute(malformed)).toThrow(/Unknown TABLE/u);
    expect(session.document.revision).toBe(0);
    expect(session.document.entities).toEqual([]);
  });
});
