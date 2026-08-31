import { CadSession, createEmptyDocument, hatchBoundaryPolyline, readDimensionAssociation, readLeaderContract, readMTextContract, readTableContract } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareBlockCommand } from "../blocks/command-adapter.js";
import { prepareAnnotationCommand } from "./command-adapter.js";
import { readBackAnnotationBlockCommit } from "./command-read-back.js";
import type { AnnotationBlockPromptRequest, AnnotationBlockPromptCommit, AnnotationBlockShellAdapter } from "./shell-adapter.js";
import { createAnnotationBlockShellAdapter } from "./shell-adapter.js";
import type { CommandPromptStateMachine, CommandPromptValue } from "./prompt-state-machine.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "annotation-block-live" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 });
  document.entities.push(
    { kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } },
    hatchBoundaryPolyline("P1", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
    { kind: "line", handle: "BL1", layerId: "0", start: { x: 200, y: 0 }, end: { x: 260, y: 0 } },
  );
  return document;
}

function content(document: KDrawDocumentV1) {
  return structuredClone({
    entities: document.entities,
    blocks: document.blocks,
    textStyles: document.textStyles,
    dimensionStyles: document.dimensionStyles,
    metadataExtensions: document.metadata.extensions ?? {},
  });
}

function complete(prompt: CommandPromptStateMachine, answers: Readonly<Record<string, unknown>>): void {
  while (prompt.snapshot.status === "active") {
    const fieldId = prompt.snapshot.currentFieldId!;
    if (Object.hasOwn(answers, fieldId)) prompt.answer(answers[fieldId] as CommandPromptValue);
    else prompt.skip();
  }
  expect(prompt.snapshot.status).toBe("ready");
}

function runPrompt(
  shell: AnnotationBlockShellAdapter,
  session: CadSession,
  request: AnnotationBlockPromptRequest,
  answers: Readonly<Record<string, unknown>>,
): AnnotationBlockPromptCommit {
  const beforeRevision = session.document.revision;
  const before = content(session.document);
  complete(shell.createPrompt(request), answers);
  const firstPreview = shell.previewPrompt();
  const result = shell.executePrompt("2026-08-31T18:30:00.000Z");
  expect(result.prepared).toEqual(firstPreview.prepared);
  expect(result.input).toEqual(firstPreview.input);
  expect(result.execution.committed.committedRevision).toBe(beforeRevision + 1);
  expect(result.readBack).toMatchObject({ commandId: result.prepared.commandId, revision: beforeRevision + 1, targetHandles: result.prepared.targetHandles, resultHandles: result.prepared.resultHandles });
  const after = content(session.document);
  expect(shell.undo()?.operation.commandId).toBe("UNDO");
  expect(content(session.document)).toEqual(before);
  expect(shell.redo()?.operation.commandId).toBe(result.prepared.commandId);
  expect(content(session.document)).toEqual(after);
  return result;
}

describe("DOM-independent annotation/block live workflow", () => {
  it("runs registry -> prompts/options -> planner -> atomic session -> exact read-back for annotation commands", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });

    runPrompt(shell, session, { commandId: "STYLE" }, {
      mode: "create",
      style: { id: "TXT2", name: "TXT2", fontFamily: "Liberation Sans", widthFactor: 0.9, obliqueAngleRad: 0.1 },
    });
    runPrompt(shell, session, { commandId: "DIM", dimensionCommandId: "DIMSTYLE" }, {
      mode: "create",
      style: { id: "DIM2", name: "DIM2", textStyleId: "TXT2", textHeight: 3, arrowSize: 2, extensionOffset: 0.75, scale: 10 },
    });
    const text = runPrompt(shell, session, { commandId: "TEXT" }, { position: { x: 2, y: 3 }, text: "Üks rida", height: 2.5, rotationRad: 0.25, styleId: "TXT2" });
    expect(text.readBack.entities[0]).toEqual(expect.objectContaining({ handle: text.prepared.resultHandles[0], kind: "text", position: { x: 2, y: 3 }, rotationRad: 0.25, styleId: "TXT2" }));
    const mutatedCommit = structuredClone(text.execution.committed);
    mutatedCommit.committedRevision = session.document.revision;
    const put = mutatedCommit.changes.find((change) => change.type === "put");
    if (!put || put.type !== "put" || (put.entity.kind !== "text" && put.entity.kind !== "mtext")) throw new Error("Expected TEXT put change.");
    put.entity.position.x += 1;
    expect(() => readBackAnnotationBlockCommit(session, text.prepared, mutatedCommit)).toThrow(/change set/u);
    const beforeRepeat = content(session.document);
    complete(shell.repeat(), { position: { x: 8, y: 9 }, text: "Kordus", height: 2.5, rotationRad: 0, styleId: "TXT2" });
    const repeatedText = shell.executePrompt();
    expect(repeatedText.prepared.resultHandles[0]).not.toBe(text.prepared.resultHandles[0]);
    expect(repeatedText.readBack.entities[0]).toMatchObject({ handle: repeatedText.prepared.resultHandles[0], text: "Kordus" });
    const afterRepeat = content(session.document);
    shell.undo();
    expect(content(session.document)).toEqual(beforeRepeat);
    shell.redo();
    expect(content(session.document)).toEqual(afterRepeat);

    const mtext = runPrompt(shell, session, { commandId: "MTEXT" }, { position: { x: 5, y: 6 }, text: "Rida 1\nRida 2", height: 3, width: 80, rotationRad: 0.5, styleId: "TXT2", attachment: "middle-center", lineSpacingFactor: 1.2 });
    expect(mtext.readBack.entities[0]).toMatchObject({ handle: mtext.prepared.resultHandles[0], kind: "mtext", styleId: "TXT2", extensionData: { "kuubik.annotation.v1": { width: 80, attachment: "middle-center", lineSpacingFactor: 1.2 } } });
    const mtextHandle = mtext.prepared.resultHandles[0]!;
    const mtextEdit = runPrompt(shell, session, { commandId: "MTEXT", context: { selectedHandles: [mtextHandle] } }, { mode: "edit", patch: { text: "Pealkiri\nPikem kirjeldus", width: 24, rotationRad: 0.75, wrapMode: "word", paragraphs: [{ id: "TITLE", alignment: "center" }, { id: "BODY", alignment: "justify" }] } });
    expect(mtextEdit.prepared.targetHandles).toEqual([mtextHandle]);
    expect(readMTextContract(mtextEdit.readBack.entities[0]!)).toMatchObject({ width: 24, wrapMode: "word", paragraphs: [{ id: "TITLE", alignment: "center" }, { id: "BODY", alignment: "justify" }] });
    expect(mtextEdit.readBack.entities[0]).toMatchObject({ handle: mtextHandle, rotationRad: 0.75, styleId: "TXT2" });

    const leader = runPrompt(shell, session, { commandId: "LEADER", context: { leaderAnchor: { handle: "A1", feature: "end", fallback: { x: 100, y: 20 } } } }, { vertices: [{ x: -1, y: -1 }, { x: 10, y: 10 }, { x: 20, y: 10 }], text: "Viide", contentPosition: { x: 25, y: 10 }, textStyleId: "TXT2", textHeight: 2.5, arrowType: "open", arrowSize: 3, landingEnabled: true, landingLength: 5, associative: true });
    const leaderHandle = leader.prepared.resultHandles[0]!;
    expect(leader.readBack.entities[0]).toMatchObject({ handle: leaderHandle, kind: "leader", text: "Viide", vertices: [{ x: 100, y: 20 }, { x: 10, y: 10 }, { x: 20, y: 10 }] });
    expect(readLeaderContract(leader.readBack.entities[0]!)).toMatchObject({ kind: "leader", arrow: { type: "open", size: 3 }, landing: { enabled: true, length: 5 }, content: { textStyleId: "TXT2" }, anchor: { handle: "A1", feature: "end" } });

    const mleader = runPrompt(shell, session, { commandId: "MLEADER", context: { leaderAnchor: { handle: "A1", feature: "start", fallback: { x: 0, y: 0 } } } }, { vertices: [{ x: -1, y: -1 }, { x: 10, y: 10 }], text: "Märkus", textPosition: { x: 12, y: 10 }, styleId: "MLS", textHeight: 2.75, textStyleId: "TXT2", landingGap: 1.5, arrowType: "dot", arrowSize: 3.25, landingEnabled: true, landingLength: 6, associative: true });
    const mleaderHandle = mleader.prepared.resultHandles[0]!;
    expect(mleader.readBack.entities[0]).toMatchObject({ handle: mleaderHandle, kind: "leader", extensionData: { "kuubik.annotation.v1": { kind: "mleader", styleId: "MLS", textStyleId: "TXT2", textHeight: 2.75, landingGap: 1.5, arrow: { type: "dot", size: 3.25 }, landing: { enabled: true, length: 6 }, associative: true, anchor: { handle: "A1" } } } });
    const mleaderEdit = runPrompt(shell, session, { commandId: "MLEADER", context: { selectedHandles: [mleaderHandle] } }, { mode: "edit", patch: { text: "Muudetud märkus", textPosition: { x: 15, y: 12 }, arrowType: "open", landingLength: 8 } });
    expect(mleaderEdit.readBack.entities[0]).toMatchObject({ handle: mleaderHandle, text: "Muudetud märkus" });
    expect(readLeaderContract(mleaderEdit.readBack.entities[0]!)).toMatchObject({ kind: "mleader", styleId: "MLS", textStyleId: "TXT2", textPosition: { x: 15, y: 12 }, arrow: { type: "open" }, landing: { length: 8 }, anchor: { handle: "A1" } });

    const styleApply = runPrompt(shell, session, { commandId: "STYLE", context: { selectedHandles: [mtextHandle, leaderHandle, mleaderHandle] } }, { mode: "apply", styleId: "TXT" });
    expect(styleApply.prepared.targetHandles).toEqual([mtextHandle, leaderHandle, mleaderHandle]);
    expect(styleApply.readBack.entities.map((entity) => entity.handle)).toEqual([mtextHandle, leaderHandle, mleaderHandle]);
    expect(styleApply.readBack.entities.find((entity) => entity.handle === mtextHandle)).toMatchObject({ styleId: "TXT" });
    expect(readLeaderContract(styleApply.readBack.entities.find((entity) => entity.handle === mleaderHandle)!)).toMatchObject({ kind: "mleader", styleId: "MLS", textStyleId: "TXT" });

    const dimension = runPrompt(shell, session, { commandId: "DIM", dimensionCommandId: "DIMLINEAR", context: { dimensionAnchors: [
      { handle: "A1", feature: "start", fallback: { x: 0, y: 0 } },
      { handle: "A1", feature: "end", fallback: { x: 100, y: 20 } },
    ] } }, { first: { x: 0, y: 0 }, second: { x: 100, y: 20 }, dimensionLinePoint: { x: 0, y: 40 }, axis: "horizontal", associative: true, styleId: "DIM2" });
    const dimensionEntity = session.document.entities.find((entity) => entity.handle === dimension.prepared.resultHandles[0]);
    expect(dimensionEntity).toMatchObject({ kind: "dimension", styleId: "DIM2" });
    expect(dimensionEntity?.kind === "dimension" ? readDimensionAssociation(dimensionEntity)?.anchors.map((anchor) => anchor.handle) : []).toEqual(["A1", "A1"]);

    const baseline = runPrompt(shell, session, { commandId: "DIM", dimensionCommandId: "DIMBASELINE", context: { dimensionAnchors: [
      { handle: "A1", feature: "start", fallback: { x: 0, y: 0 } },
      { handle: "A1", feature: "end", fallback: { x: 100, y: 20 } },
      { handle: "P1", feature: "vertex", vertexIndex: 2, fallback: { x: 100, y: 100 } },
    ] } }, { points: [{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }], dimensionLinePoints: [{ x: 0, y: 50 }, { x: 0, y: 60 }], axis: "horizontal", chainId: "BASE-1", associative: true, styleId: "DIM2" });
    expect(baseline.readBack.entities).toHaveLength(2);
    expect(baseline.readBack.entities.map((entity) => entity.handle)).toEqual(baseline.prepared.resultHandles);

    const apply = runPrompt(shell, session, { commandId: "DIM", dimensionCommandId: "DIMSTYLE", context: { selectedHandles: [dimension.prepared.resultHandles[0]!] } }, { mode: "apply", styleId: "DIM" });
    expect(apply.readBack.entities).toEqual([expect.objectContaining({ handle: dimension.prepared.resultHandles[0], kind: "dimension", styleId: "DIM" })]);

    const hatch = runPrompt(shell, session, { commandId: "HATCH" }, { boundaryHandles: ["P1"], pattern: "ANSI31", angleRad: Math.PI / 4, scale: 2, associative: true, origin: { x: 1, y: 2 } });
    expect(hatch.readBack.entities[0]).toMatchObject({ handle: hatch.prepared.resultHandles[0], kind: "hatch", pattern: "ANSI31", associative: true, extensionData: { "kuubik.annotation.v1": { boundaryHandles: ["P1"], pattern: { angleRad: Math.PI / 4, scale: 2, origin: { x: 1, y: 2 } } } } });

    const tableStyle = runPrompt(shell, session, { commandId: "TABLE" }, { mode: "style-create", style: { id: "TABLE-STD", name: "Standard", textStyleId: "TXT2", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" } });
    expect(tableStyle.readBack.metadata?.extensions?.["kuubik.tableStyles.v1"]).toEqual([{ id: "TABLE-STD", name: "Standard", textStyleId: "TXT2", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" }]);
    const table = runPrompt(shell, session, { commandId: "TABLE" }, { mode: "create", definition: {
      origin: { x: 200, y: 100 }, rotationRad: 0, styleId: "TABLE-STD",
      rows: [{ id: "R1", height: 8 }, { id: "R2", height: 10 }], columns: [{ id: "C1", width: 30 }, { id: "C2", width: 40 }],
      cells: [
        { id: "A1", rowId: "R1", columnId: "C1", value: { kind: "text", text: "Mark" } },
        { id: "A2", rowId: "R1", columnId: "C2", value: { kind: "text", text: "Väärtus" } },
        { id: "B1", rowId: "R2", columnId: "C1", value: { kind: "text", text: "A-01" } },
        { id: "B2", rowId: "R2", columnId: "C2", value: { kind: "field", code: "%<SheetNumber>%", fallback: "1" } },
      ],
    } });
    const tableHandle = table.prepared.resultHandles[0]!;
    expect(table.readBack.entities[0]).toMatchObject({ handle: tableHandle, kind: "proxy", originalType: "TABLE" });
    const tableEdit = runPrompt(shell, session, { commandId: "TABLE", context: { selectedHandles: [tableHandle] } }, { mode: "edit", operations: [
      { type: "set-cell", cellId: "B2", value: { kind: "field", code: "%<ProjectNumber>%", fallback: "P-001" }, horizontalAlignment: "right" },
      { type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } },
      { type: "resize-column", columnId: "C2", width: 55 },
    ] });
    expect(tableEdit.prepared.targetHandles).toEqual([tableHandle]);
    const tableContract = readTableContract(tableEdit.readBack.entities[0]!);
    expect(tableContract?.cells.find((cell) => cell.id === "B2")).toMatchObject({ id: "B2", value: { kind: "field", code: "%<ProjectNumber>%", fallback: "P-001" }, horizontalAlignment: "right" });
    expect(tableContract?.merges).toEqual([{ id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] }]);
  });

  it("runs BLOCK/INSERT/ATTRIB/BEDIT/EXPLODE with stable inserts and exact property read-back", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    const attributeDefinitions = [{ tag: "MARK", prompt: "Mark", defaultValue: "B1", position: { x: 210, y: 5 }, height: 2.5 }];

    const block = runPrompt(shell, session, { commandId: "BLOCK", context: { selectedHandles: ["BL1"] } }, { id: "B", name: "Detail", basePoint: { x: 200, y: 0 }, attributes: attributeDefinitions });
    const firstInsertHandle = block.prepared.resultHandles[0]!;
    expect(session.document.entities.find((entity) => entity.handle === firstInsertHandle)).toMatchObject({ kind: "blockRef", blockId: "B" });

    const insert = runPrompt(shell, session, { commandId: "INSERT" }, { blockId: "B", insertion: { x: 300, y: 50 }, scaleX: -2, scaleY: 0.5, rotationRad: Math.PI / 3, attributes: { MARK: "B2" } });
    const secondInsertHandle = insert.prepared.resultHandles[0]!;
    expect(insert.readBack.entities[0]).toMatchObject({ handle: secondInsertHandle, kind: "blockRef", blockId: "B", insertion: { x: 300, y: 50 }, scale: { x: -2, y: 0.5 }, rotationRad: Math.PI / 3, attributes: { MARK: "B2" } });

    const attrib = runPrompt(shell, session, { commandId: "ATTRIB", context: { selectedHandles: [secondInsertHandle] } }, { values: { MARK: "B9" } });
    expect(attrib.readBack.entities[0]).toMatchObject({ handle: secondInsertHandle, attributes: { MARK: "B9" } });

    const insertsBeforeBedit = structuredClone(session.document.entities.filter((entity) => entity.kind === "blockRef"));
    const bedit = runPrompt(shell, session, { commandId: "BEDIT", context: { selectedHandles: [firstInsertHandle] } }, { basePoint: { x: 200, y: 0 }, entities: [{ kind: "line", handle: "BM2", layerId: "0", start: { x: 200, y: 0 }, end: { x: 280, y: 0 } }], attributes: attributeDefinitions });
    expect(bedit.readBack.blocks.find((definition) => definition.id === "B")?.entities).toEqual([{ kind: "line", handle: "BM2", layerId: "0", start: { x: 200, y: 0 }, end: { x: 280, y: 0 } }]);
    expect(session.document.entities.filter((entity) => entity.kind === "blockRef")).toEqual(insertsBeforeBedit);

    const explode = runPrompt(shell, session, { commandId: "EXPLODE", context: { selectedHandles: [firstInsertHandle] } }, { confirm: true });
    expect(explode.readBack.deletedHandles).toContain(firstInsertHandle);
    expect(explode.readBack.entities.length).toBeGreaterThan(0);
    expect(session.document.entities.some((entity) => entity.handle === secondInsertHandle)).toBe(true);
  });

  it("rejects prompt and typed-payload mutants before revision or handle allocation is committed", () => {
    const session = new CadSession(fixture());
    const shell = createAnnotationBlockShellAdapter({ sessionAdapter: { session }, annotationPlanner: prepareAnnotationCommand, blockPlanner: prepareBlockCommand, dxfVersion: "AC1021" });
    complete(shell.createPrompt({ commandId: "HATCH" }), { boundaryHandles: ["MISSING"], pattern: "SOLID", angleRad: 0, scale: 1, associative: true });
    expect(() => shell.executePrompt()).toThrow(/boundary/u);
    expect(session.document.revision).toBe(0);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["A1", "P1", "BL1"]);

    const definition = shell.commandDefinitions.find((candidate) => candidate.id === "INSERT")!;
    expect(() => definition.prepare(session.document, { commandId: "INSERT", invokedAs: "INSERT", options: [], arguments: [encodeURIComponent(JSON.stringify({ commandId: "INSERT", handle: "10", layerId: "0" }))], raw: "mutant" })).toThrow();
    expect(session.document.revision).toBe(0);
  });
});
