import { describe, expect, it } from "vitest";
import { BoundaryRegionInputError, prepareBoundaryCommand, prepareRegionCommand } from "../src/boundary-region.js";
import { createEmptyDocument } from "../src/document.js";
import { CadSession } from "../src/transaction.js";

function squareDocument(gap = 0) {
  const document = createEmptyDocument({ documentId: "boundary", now: "2026-08-31T00:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 100 + gap, y: 0 }, end: { x: 100, y: 100 } },
    { kind: "line", handle: "12", layerId: "0", start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
    { kind: "line", handle: "13", layerId: "0", start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
  );
  return document;
}

describe("F-014 BOUNDARY", () => {
  it("discovers the smallest stitched loop around a seed point", () => {
    const result = prepareBoundaryCommand(squareDocument(), {
      handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, output: "polyline",
    });
    expect(result).toMatchObject({ commandId: "BOUNDARY", targetHandles: ["10", "11", "12", "13"], resultHandles: ["20"] });
    expect(result.entity).toMatchObject({ kind: "polyline", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
  });

  it("uses Gap Tolerance and keeps the same preparation for preview and commit", () => {
    const document = squareDocument(0.5);
    expect(() => prepareBoundaryCommand(document, { handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, gapTolerance: 0, output: "polyline" })).toThrow(BoundaryRegionInputError);
    const input = { handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, gapTolerance: 1, output: "polyline" as const };
    expect(prepareBoundaryCommand(document, input)).toEqual(prepareBoundaryCommand(document, input));
  });

  it("captures nested islands in a region proxy without claiming native REGION schema support", () => {
    const document = squareDocument();
    document.entities.push({ kind: "circle", handle: "14", layerId: "0", center: { x: 50, y: 50 }, radius: 10 });
    const result = prepareBoundaryCommand(document, {
      handle: "20", layerId: "0", seedPoint: { x: 20, y: 20 }, output: "region", islandDetection: true,
    });
    expect(result.loops).toHaveLength(2);
    expect(result.entity).toMatchObject({ kind: "proxy", originalType: "ACDBREGION", raw: { schema: "kuubik-region-v1", sourceKind: "BOUNDARY" } });
  });

  it("commits one BOUNDARY result as one Undo/Redo operation", () => {
    const session = new CadSession(squareDocument());
    const prepared = prepareBoundaryCommand(session.document, { handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, output: "polyline" });
    session.commit({ opId: "boundary:1", baseRevision: 0, commandId: "BOUNDARY", args: {}, targetHandles: prepared.targetHandles, resultHandles: prepared.resultHandles }, prepared.changes);
    expect(session.document.entities).toHaveLength(5);
    session.undo();
    expect(session.document.entities).toHaveLength(4);
    session.redo();
    expect(session.document.entities).toHaveLength(5);
  });

  it.each([
    { handle: "20", layerId: "0", seedPoint: { x: Number.NaN, y: 0 }, output: "polyline" as const },
    { handle: "20", layerId: "0", seedPoint: { x: 50, y: 50 }, gapTolerance: -1, output: "polyline" as const },
    { handle: "20", layerId: "0", seedPoint: { x: 500, y: 500 }, output: "polyline" as const },
  ])("rejects a mutated invalid boundary before changes", (input) => {
    expect(() => prepareBoundaryCommand(squareDocument(), input)).toThrow(BoundaryRegionInputError);
  });
});

describe("F-014 REGION", () => {
  it("converts closed curves atomically and explicitly rejects open ones", () => {
    const document = createEmptyDocument({ documentId: "region" });
    document.entities.push(
      { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
      { kind: "polyline", handle: "11", layerId: "0", closed: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    );
    const result = prepareRegionCommand(document, { targetHandles: ["10", "11"], resultHandles: ["20", "21"] });
    expect(result).toMatchObject({ targetHandles: ["10", "11"], resultHandles: ["20"], rejected: [{ handle: "11", reason: "not-closed-curve" }] });
    expect(result.changes).toMatchObject([{ type: "delete", handle: "10" }, { type: "put", entity: { handle: "20", originalType: "ACDBREGION" } }]);

    const session = new CadSession(document);
    session.commit({ opId: "region:1", baseRevision: 0, commandId: "REGION", args: {}, targetHandles: result.targetHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["11", "20"]);
    session.undo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });
});
