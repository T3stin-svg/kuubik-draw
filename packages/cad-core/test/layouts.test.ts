import { describe, expect, it } from "vitest";
import type { CadLayout, CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  LayoutCommandError,
  allocateEntityHandles,
  copyPaperLayout,
  createEmptyDocument,
  createPaperLayout,
  deletePaperLayout,
  movePaperLayout,
  renamePaperLayout,
} from "../src/index.js";

function operation(baseRevision: number, commandId: string, args: unknown = {}): CadOperation {
  return { opId: `${commandId}-${baseRevision}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

describe("F-097 layout transactions", () => {
  it("creates and copies a full paper layout before its source with independent viewport/entity ids", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "F-097", now: "2026-08-28T00:00:00Z" }));
    const plan = createPaperLayout(session.document, {
      name: "F097 PLAN",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
      viewports: [{
        id: "f097-source-vp", center: { x: 210, y: 148.5 }, width: 390, height: 267,
        viewCenter: { x: 1250, y: -750 }, viewHeight: 5000, twistAngleRad: Math.PI / 12,
        locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } },
      }],
      entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 50, y: 50 }, radius: 25 }],
    });
    session.commit(operation(0, "LAYOUT_CREATE", { name: "F097 PLAN" }), plan.changes);
    const notes = createPaperLayout(session.document, { name: "F097 NOTES" });
    session.commit(operation(1, "LAYOUT_CREATE", { name: "F097 NOTES" }), notes.changes);

    const copied = copyPaperLayout(session.document, plan.layoutId);
    session.commit(operation(2, "LAYOUT_COPY", { layoutId: plan.layoutId }), copied.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 PLAN (2)", "F097 PLAN", "F097 NOTES"]);
    const source = session.document.layouts.find((layout) => layout.id === plan.layoutId)!;
    const copy = session.document.layouts.find((layout) => layout.id === copied.layoutId)!;
    expect(copy).toMatchObject({
      name: "F097 PLAN (2)",
      paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
      viewports: [{ viewCenter: { x: 1250, y: -750 }, locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } } }],
      entities: [{ kind: "circle", center: { x: 50, y: 50 }, radius: 25 }],
    });
    expect(copy.viewports[0]!.id).not.toBe(source.viewports[0]!.id);
    expect(copy.entities![0]!.handle).not.toBe(source.entities![0]!.handle);
    expect(allocateEntityHandles(session.document, 1)).not.toContain(copy.entities![0]!.handle);

    const changedLayouts = structuredClone(session.document.layouts);
    const changedSource = changedLayouts.find((layout) => layout.id === plan.layoutId)!;
    if (changedSource.entities?.[0]?.kind === "circle") changedSource.entities[0].radius = 30;
    session.commit(operation(3, "LAYOUT_EDIT", { layoutId: plan.layoutId }), [{ type: "set-layouts", layouts: changedLayouts }]);
    expect((session.document.layouts.find((layout) => layout.id === copied.layoutId)!.entities![0] as { radius: number }).radius).toBe(25);
    expect((session.document.layouts.find((layout) => layout.id === plan.layoutId)!.entities![0] as { radius: number }).radius).toBe(30);
    session.undo();
    expect((session.document.layouts.find((layout) => layout.id === plan.layoutId)!.entities![0] as { radius: number }).radius).toBe(25);
  });

  it("reorders, deletes and restores each layout action as one atomic undo/redo step", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "F-097-order" }));
    const plan = createPaperLayout(session.document, { name: "F097 PLAN" });
    session.commit(operation(0, "LAYOUT_CREATE"), plan.changes);
    const notes = createPaperLayout(session.document, { name: "F097 NOTES" });
    session.commit(operation(1, "LAYOUT_CREATE"), notes.changes);
    const copy = copyPaperLayout(session.document, plan.layoutId);
    session.commit(operation(2, "LAYOUT_COPY"), copy.changes);

    const firstMove = movePaperLayout(session.document, notes.layoutId, -1);
    session.commit(operation(3, "LAYOUT_REORDER"), firstMove.changes);
    const secondMove = movePaperLayout(session.document, notes.layoutId, -1);
    session.commit(operation(4, "LAYOUT_REORDER"), secondMove.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);

    const deleted = deletePaperLayout(session.document, copy.layoutId);
    expect(deleted.layoutId).toBe(plan.layoutId);
    session.commit(operation(5, "LAYOUT_DELETE"), deleted.changes);
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
    session.undo();
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN (2)", "F097 PLAN"]);
    session.redo();
    expect(session.document.layouts.map((layout) => layout.name)).toEqual(["Model", "F097 NOTES", "F097 PLAN"]);
  });

  it("enforces AutoCAD-compatible name, model, final-paper and 255-paper boundaries", () => {
    const document = createEmptyDocument({ documentId: "F-097-guards" });
    const first = createPaperLayout(document, { name: "Issue A" });
    const withFirst = { ...document, layouts: first.layouts };
    expect(() => createPaperLayout(withFirst, { name: "issue a" })).toThrowError(LayoutCommandError);
    expect(() => renamePaperLayout(withFirst, first.layoutId, "x".repeat(256))).toThrowError(LayoutCommandError);
    expect(() => copyPaperLayout(withFirst, "model")).toThrowError(LayoutCommandError);
    expect(() => movePaperLayout(withFirst, "model", 1)).toThrowError(LayoutCommandError);
    expect(() => deletePaperLayout(withFirst, first.layoutId)).toThrowError(LayoutCommandError);

    const layouts: CadLayout[] = [document.layouts[0]!, ...Array.from({ length: 255 }, (_, index) => ({
      id: `layout-${index + 1}`, name: `Layout ${index + 1}`, kind: "paper" as const, viewports: [], entities: [],
    }))];
    expect(() => createPaperLayout({ ...document, layouts })).toThrowError(LayoutCommandError);
  });
});
