import { CadSession, createEmptyDocument, type CadChange } from "@kuubik/cad-core";
import { describe, expect, it, vi } from "vitest";
import { createAtomicCommandWorkflow, type PreparedAtomicCommand } from "./atomic-command-workflow.js";

describe("atomic command feature wiring", () => {
  it("uses one adapter for preview/commit and one session entry for Undo/Redo", () => {
    const prepared: PreparedAtomicCommand = {
      commandId: "ARRAYRECT",
      changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } }] satisfies CadChange[],
      targetHandles: [], resultHandles: ["10"], operationArgs: { rows: 1, columns: 2 },
    };
    const prepare = vi.fn(() => structuredClone(prepared));
    const workflow = createAtomicCommandWorkflow(new CadSession(createEmptyDocument({ documentId: "atomic-workflow" })), { prepare });
    const input = { rows: 1, columns: 2 };
    expect(workflow.preview(input)).toEqual(prepared);
    const committed = workflow.commit(input, "array:1");
    expect(committed.changes).toEqual(prepared.changes);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(workflow.session.document.entities).toHaveLength(1);
    workflow.undo();
    expect(workflow.session.document.entities).toHaveLength(0);
    workflow.redo();
    expect(workflow.session.document.entities).toHaveLength(1);
  });
});
