import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";
import { boundaryCommandAdapter, regionCommandAdapter } from "./boundary-region-command-adapter.js";

function squareDocument() {
  const document = createEmptyDocument({ documentId: "F-014-adapter", now: "2026-09-01T02:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 20, y: 0 }, end: { x: 20, y: 20 } },
    { kind: "line", handle: "12", layerId: "0", start: { x: 20, y: 20 }, end: { x: 0, y: 20 } },
    { kind: "line", handle: "13", layerId: "0", start: { x: 0, y: 20 }, end: { x: 0, y: 0 } },
  );
  return document;
}

describe("F-014 BOUNDARY/REGION feature wiring", () => {
  it("uses identical BOUNDARY preparation for preview and commit with atomic Undo/Redo", () => {
    const original = squareDocument();
    const workflow = createAtomicCommandWorkflow(new CadSession(original), boundaryCommandAdapter);
    const input = { handle: "20", layerId: "0", seedPoint: { x: 10, y: 10 }, sourceHandles: ["13", "11", "10", "12"], output: "polyline" as const };
    const preview = workflow.preview(input);
    workflow.commit(input, "F-014:boundary:1", "2026-09-01T02:00:01.000Z");
    expect(workflow.session.document.entities.find((entity) => entity.handle === "20")).toEqual(preview.changes[0]!.type === "put" ? preview.changes[0]!.entity : null);
    expect(preview).toMatchObject({ commandId: "BOUNDARY", targetHandles: ["10", "11", "12", "13"], resultHandles: ["20"], operationArgs: input });
    const committed = structuredClone(workflow.session.document.entities);
    workflow.undo("2026-09-01T02:00:02.000Z");
    expect(workflow.session.document.entities).toEqual(original.entities);
    workflow.redo("2026-09-01T02:00:03.000Z");
    expect(workflow.session.document.entities).toEqual(committed);
  });

  it("deletes all source curves and creates the REGION proxy in one atomic operation", () => {
    const original = squareDocument();
    const workflow = createAtomicCommandWorkflow(new CadSession(original), regionCommandAdapter);
    const input = { targetHandles: ["13", "10", "12", "11"], resultHandles: ["20"] };
    const preview = workflow.preview(input);
    workflow.commit(input, "F-014:region:1", "2026-09-01T02:01:01.000Z");
    expect(workflow.session.document.entities).toEqual(preview.changes.filter((change) => change.type === "put").map((change) => change.entity));
    expect(workflow.session.document.entities[0]).toMatchObject({ kind: "proxy", handle: "20", originalType: "ACDBREGION" });
    workflow.undo("2026-09-01T02:01:02.000Z");
    expect(workflow.session.document.entities).toEqual(original.entities);
    workflow.redo("2026-09-01T02:01:03.000Z");
    expect(workflow.session.document.entities).toEqual(preview.changes.filter((change) => change.type === "put").map((change) => change.entity));
  });
});
