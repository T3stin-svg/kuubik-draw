import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";
import { peditCommandAdapter } from "./pedit-command-adapter.js";

function peditDocument() {
  const document = createEmptyDocument({ documentId: "F-034-adapter", now: "2026-09-01T00:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#4a90e2" }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 10, y: 0 }, end: { x: 20, y: 0 } },
  );
  return document;
}

describe("F-034 PEDIT feature wiring", () => {
  it("uses byte-equivalent preparation for preview and commit with atomic Undo/Redo", () => {
    const original = peditDocument();
    const workflow = createAtomicCommandWorkflow(new CadSession(original), peditCommandAdapter);
    const input = { handle: "10", actions: [
      { type: "join" as const, handles: ["11"], tolerance: 0 },
      { type: "vertex-width" as const, index: 1, startWidth: 1, endWidth: 2 },
      { type: "close" as const },
    ] };
    const preview = workflow.preview(input);
    workflow.commit(input, "F-034:adapter:1", "2026-09-01T00:00:01.000Z");
    expect(workflow.session.document.entities).toEqual(preview.changes.filter((change) => change.type === "put").map((change) => change.entity));
    expect(preview).toMatchObject({ commandId: "PEDIT", targetHandles: ["10", "11"], resultHandles: ["10"], operationArgs: input });
    const committed = structuredClone(workflow.session.document.entities);
    workflow.undo("2026-09-01T00:00:02.000Z");
    expect(workflow.session.document.entities).toEqual(original.entities);
    const redo = workflow.redo("2026-09-01T00:00:03.000Z");
    expect(workflow.session.document.entities).toEqual(committed);
    expect(redo?.operation).toMatchObject({ commandId: "PEDIT", targetHandles: ["10", "11"], resultHandles: ["10"] });
  });
});
