import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";
import { arrayCommandAdapter, arrayPathPropertyUpdateAdapter, refreshArrayPathAdapter } from "./array-command-adapter.js";

function arrayDocument() {
  const document = createEmptyDocument({ documentId: "F-031-F-032-adapter", now: "2026-08-31T20:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  );
  return document;
}

describe("F-031/F-032 ARRAY feature wiring", () => {
  it("uses identical preparation for preview and commit with atomic Undo/Redo", () => {
    const workflow = createAtomicCommandWorkflow(new CadSession(arrayDocument()), arrayCommandAdapter);
    const input = {
      command: "ARRAYRECT" as const, targetHandles: ["10"], basePoint: { x: 0, y: 0 },
      rows: 2, columns: 3, rowSpacing: 10, columnSpacing: 20, arrayAngleRad: 0,
    };
    const preview = workflow.preview(input);
    workflow.commit(input, "F-031:adapter:1", "2026-08-31T20:00:01.000Z");
    const committedCopies = workflow.session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle));
    expect(committedCopies).toEqual(preview.changes.map((change) => change.type === "put" ? change.entity : null));
    expect(workflow.session.document.entities).toHaveLength(7);
    workflow.undo("2026-08-31T20:00:02.000Z");
    expect(workflow.session.document.entities).toEqual(arrayDocument().entities);
    workflow.redo("2026-08-31T20:00:03.000Z");
    expect(workflow.session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle))).toEqual(committedCopies);
  });

  it("refreshes an associative path array as one preview-equal atomic operation", () => {
    const session = new CadSession(arrayDocument());
    const createWorkflow = createAtomicCommandWorkflow(session, arrayCommandAdapter);
    const input = {
      command: "ARRAYPATH" as const, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide" as const, items: 3, alignItems: true, associationId: "ADAPTER-PATH",
    };
    createWorkflow.commit(input, "F-032:create:1", "2026-08-31T20:01:00.000Z");
    const beforeMove = session.document.entities;
    const path = session.document.entities.find((entity) => entity.handle === "20")!;
    if (path.kind !== "line") throw new Error("Expected line path.");
    session.commit({
      opId: "F-032:path:move", baseRevision: session.document.revision, commandId: "MOVE",
      args: {}, targetHandles: ["20"], resultHandles: ["20"],
    }, [{ type: "put", entity: { ...path, end: { x: 200, y: 0 } } }], "2026-08-31T20:01:01.000Z");
    const refreshWorkflow = createAtomicCommandWorkflow(session, refreshArrayPathAdapter);
    const preview = refreshWorkflow.preview({ changedHandles: ["20"] });
    const handlesBeforeRefresh = session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle)).map((entity) => entity.handle);
    refreshWorkflow.commit({ changedHandles: ["20"] }, "F-032:refresh:1", "2026-08-31T20:01:02.000Z");
    expect(session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle))).toEqual(preview.changes.map((change) => change.type === "put" ? change.entity : null));
    expect(preview.resultHandles).toEqual(handlesBeforeRefresh);
    refreshWorkflow.undo("2026-08-31T20:01:03.000Z");
    expect(session.document.entities.filter((entity) => entity.handle !== "20")).toEqual(beforeMove.filter((entity) => entity.handle !== "20"));
    refreshWorkflow.redo("2026-08-31T20:01:04.000Z");
    expect(session.document.entities.find((entity) => entity.handle === preview.resultHandles[2])).toMatchObject({ kind: "line", start: { x: 200, y: 0 } });
  });

  it("commits an ARRAYPATH Properties count edit atomically with stable surviving handles", () => {
    const session = new CadSession(arrayDocument());
    createAtomicCommandWorkflow(session, arrayCommandAdapter).commit({
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 3, alignItems: false, associationId: "ADAPTER-PROPS",
    }, "F-032:create:properties", "2026-08-31T20:02:00.000Z");
    const before = session.document.entities;
    const originalHandles = before.slice(-3).map((entity) => entity.handle);
    const workflow = createAtomicCommandWorkflow(session, arrayPathPropertyUpdateAdapter);
    const input = { associationId: "ADAPTER-PROPS", patch: { items: 5, alignItems: true } };
    const preview = workflow.preview(input);
    expect(preview.resultHandles.slice(0, 3)).toEqual(originalHandles);
    workflow.commit(input, "F-032:properties:1", "2026-08-31T20:02:01.000Z");
    expect(session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle))).toEqual(preview.changes.map((change) => change.type === "put" ? change.entity : null));
    workflow.undo("2026-08-31T20:02:02.000Z");
    expect(session.document.entities).toEqual(before);
    workflow.redo("2026-08-31T20:02:03.000Z");
    expect(session.document.entities.filter((entity) => preview.resultHandles.includes(entity.handle))).toHaveLength(5);
  });
});
