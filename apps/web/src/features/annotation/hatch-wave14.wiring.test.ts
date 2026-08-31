import { CadSession, createEmptyDocument, createHatch, evaluateHatchCapability, hatchBoundaryPolyline, readHatchAssociation } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";

function sessionFixture(): CadSession {
  const document = createEmptyDocument({ documentId: "f068-wire", now: "2026-09-01T00:00:00.000Z" });
  document.entities.push(hatchBoundaryPolyline("B", "0", [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ]));
  document.entities.push(createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["B"], pattern: "ANSI31", associative: true }));
  return new CadSession(document);
}

describe("F-068 browser associative HATCH wiring", () => {
  it("keeps preview equal to commit and move/edit propagation in one Undo/Redo step", () => {
    const session = sessionFixture();
    const workflow = createAssociativeEntityWorkflow(session);
    const moved = hatchBoundaryPolyline("B", "0", [
      { x: -5, y: -10, bulge: 0.5 }, { x: 120, y: -10 }, { x: 120, y: 110 }, { x: -5, y: 110 },
    ]);
    const input = { commandId: "PEDIT", entityChanges: [{ type: "put" as const, entity: moved }], changedHandles: ["B"] };
    const before = session.document;
    const preview = workflow.preview(input);
    expect(preview.changes).toHaveLength(2);
    const committed = workflow.commit(input, "f068-move");
    expect(committed.changes).toEqual(preview.changes);
    expect(session.history.undo).toHaveLength(1);
    const after = session.document;
    const hatch = after.entities.find((entity) => entity.handle === "H")!;
    expect((hatch as { loops: Array<{ vertices: Array<{ bulge?: number }> }> }).loops[0]!.vertices[0]!.bulge).toBe(0.5);
    expect(readHatchAssociation(hatch)?.boundaryVertices?.[0]?.[0]?.bulge).toBe(0.5);
    workflow.undo();
    expect(session.document.entities).toEqual(before.entities);
    workflow.redo();
    expect(session.document.entities).toEqual(after.entities);
  });

  it("rejects boundary delete atomically by default and permits explicit broken lifecycle with Undo", () => {
    const session = sessionFixture();
    const workflow = createAssociativeEntityWorkflow(session);
    const deletion = { commandId: "ERASE", entityChanges: [{ type: "delete" as const, handle: "B" }], changedHandles: ["B"] };
    expect(() => workflow.preview(deletion)).toThrow(/Broken hatch association H -> B/u);
    expect(session.document.revision).toBe(0);
    const allowed = { ...deletion, allowBrokenAssociations: true };
    const preview = workflow.preview(allowed);
    workflow.commit(allowed, "f068-delete");
    expect(session.history.undo).toHaveLength(1);
    expect(session.document.entities.some((entity) => entity.handle === "B")).toBe(false);
    expect(evaluateHatchCapability(session.document, "H")).toEqual({ executable: false, code: "orphan-boundary", handle: "B" });
    expect(preview.changes).toEqual([{ type: "delete", handle: "B" }]);
    workflow.undo();
    expect(evaluateHatchCapability(session.document, "H")).toEqual({ executable: true, code: "ready" });
  });
});
