import { createEmptyDocument, CadSession, type CadChange } from "@kuubik/cad-core";
import type { CadEntity } from "@kuubik/cad-schema";
import { describe, expect, it, vi } from "vitest";
import { createGeometryWorkflow, type GeometryPreparation } from "./geometry-workflow.js";

describe("geometry workflow wiring contract", () => {
  it("previews and commits through the same adapter, then undoes the whole command", () => {
    const entity: CadEntity = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const prepared: GeometryPreparation = {
      commandId: "LINE",
      entities: [entity],
      changes: [{ type: "put", entity }] satisfies CadChange[],
      resultHandles: ["10"],
    };
    const prepare = vi.fn(() => structuredClone(prepared));
    const workflow = createGeometryWorkflow(new CadSession(createEmptyDocument({ documentId: "wiring" })), { prepare });
    const input = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };

    expect(workflow.preview(input).entities).toEqual(prepared.entities);
    workflow.commit(input, "geometry:wire:1", "2026-08-31T12:00:00.000Z");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0]).toEqual(prepare.mock.calls[1]);
    expect(workflow.session.document.entities).toEqual(prepared.entities);
    expect(workflow.session.nextUndoCommandId).toBe("LINE");
    workflow.undo("2026-08-31T12:00:01.000Z");
    expect(workflow.session.document.entities).toEqual([]);
    workflow.redo("2026-08-31T12:00:02.000Z");
    expect(workflow.session.document.entities).toEqual(prepared.entities);
  });
});
