import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import {
  applyPlineCommandAction,
  preparePlineCommandState,
  startPlineCommand,
  type PlineCommandState,
} from "../src/pline-command.js";
import { CadSession } from "../src/transaction.js";

function goldenState(): PlineCommandState {
  let state = startPlineCommand({ handle: "20", layerId: "A-GEOM", start: { x: 0, y: 0 } });
  state = applyPlineCommandAction(state, { type: "width", startWidth: 2, endWidth: 4 });
  state = applyPlineCommandAction(state, { type: "line", end: { x: 10, y: 0 } });
  state = applyPlineCommandAction(state, { type: "mode", mode: "arc" });
  state = applyPlineCommandAction(state, { type: "halfwidth", startHalfWidth: 1, endHalfWidth: 2 });
  state = applyPlineCommandAction(state, {
    type: "arc",
    construction: { mode: "through", point: { x: 15, y: 5 }, end: { x: 10, y: 10 } },
  });
  state = applyPlineCommandAction(state, { type: "mode", mode: "line" });
  state = applyPlineCommandAction(state, { type: "line", end: { x: 0, y: 10 } });
  return applyPlineCommandAction(state, { type: "close" });
}

describe("F-002 PLINE command matrix", () => {
  it("matches the line/arc/width/halfwidth/close golden without duplicating the seam", () => {
    const prepared = preparePlineCommandState(goldenState());
    expect(prepared).toEqual({
      commandId: "PLINE",
      resultHandles: ["20"],
      entities: [{
        kind: "polyline",
        handle: "20",
        layerId: "A-GEOM",
        closed: true,
        vertices: [
          { x: 0, y: 0, startWidth: 2, endWidth: 4 },
          { x: 10, y: 0, bulge: 0.9999999999999999, startWidth: 2, endWidth: 4 },
          { x: 10, y: 10, startWidth: 2, endWidth: 4 },
          { x: 0, y: 10, startWidth: 2, endWidth: 4 },
        ],
      }],
      changes: [{
        type: "put",
        entity: {
          kind: "polyline",
          handle: "20",
          layerId: "A-GEOM",
          closed: true,
          vertices: [
            { x: 0, y: 0, startWidth: 2, endWidth: 4 },
            { x: 10, y: 0, bulge: 0.9999999999999999, startWidth: 2, endWidth: 4 },
            { x: 10, y: 10, startWidth: 2, endWidth: 4 },
            { x: 0, y: 10, startWidth: 2, endWidth: 4 },
          ],
        },
      }],
    });
  });

  it("supports Angle, Center, Direction and Radius arc variants with signed bulges", () => {
    const variants = [
      { construction: { mode: "angle", end: { x: 10, y: 10 }, includedAngleRad: Math.PI / 2 } as const, expected: Math.tan(Math.PI / 8) },
      { construction: { mode: "center", center: { x: 0, y: 10 }, end: { x: 10, y: 10 } } as const, expected: Math.tan(Math.PI / 8) },
      { construction: { mode: "direction", end: { x: 10, y: 10 }, tangentDirectionRad: 0 } as const, expected: Math.tan(Math.PI / 8) },
      { construction: { mode: "radius", end: { x: 10, y: 10 }, radius: 10, side: "right" } as const, expected: -Math.tan(Math.PI / 8) },
      { construction: { mode: "radius", end: { x: 10, y: 10 }, radius: 10, major: true } as const, expected: Math.tan(3 * Math.PI / 8) },
    ];
    for (const variant of variants) {
      let state = startPlineCommand({ handle: "30", layerId: "0", start: { x: 0, y: 0 } });
      state = applyPlineCommandAction(state, { type: "arc", construction: variant.construction });
      const entity = preparePlineCommandState(state).entities[0];
      expect(entity).toMatchObject({ kind: "polyline", vertices: [{ x: 0, y: 0, bulge: expect.closeTo(variant.expected, 12) }, { x: 10, y: 10 }] });
    }
  });

  it("uses the previous segment tangent when Arc mode closes the polyline", () => {
    let state = startPlineCommand({ handle: "40", layerId: "0", start: { x: 0, y: 0 } });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 10, y: 0 } });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 10, y: 10 } });
    state = applyPlineCommandAction(state, { type: "mode", mode: "arc" });
    state = applyPlineCommandAction(state, { type: "close" });
    const entity = preparePlineCommandState(state).entities[0];
    expect(entity).toMatchObject({
      kind: "polyline",
      closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, bulge: expect.closeTo(1 + Math.SQRT2, 12) }],
    });
  });

  it("replays command-local Undo immutably, including reopening Close", () => {
    const closed = goldenState();
    const reopened = applyPlineCommandAction(closed, { type: "undo" });
    expect(reopened.closed).toBe(false);
    expect(reopened.vertices.at(-1)).toEqual({ x: 0, y: 10 });
    const beforeUndo = structuredClone(reopened);
    const withoutLastLine = applyPlineCommandAction(reopened, { type: "undo" });
    expect(reopened).toEqual(beforeUndo);
    expect(withoutLastLine.vertices).toHaveLength(3);
    expect(withoutLastLine.mode).toBe("line");
    const beforeNoOp = startPlineCommand({ handle: "50", layerId: "0", start: { x: 0, y: 0 } });
    expect(applyPlineCommandAction(beforeNoOp, { type: "undo" })).toBe(beforeNoOp);
  });

  it("uses the same prepared bytes for preview and one atomic Commit/Undo/Redo step", () => {
    const state = { ...goldenState(), layerId: "0" };
    const preview = preparePlineCommandState(state);
    const commit = preparePlineCommandState(state);
    expect(commit).toEqual(preview);

    const session = new CadSession(createEmptyDocument({ documentId: "F-002-atomic" }));
    session.commit({
      opId: "F-002:1",
      baseRevision: 0,
      commandId: commit.commandId,
      args: { variant: "line-arc-width-close" },
      targetHandles: [],
      resultHandles: commit.resultHandles,
    }, commit.changes, "2026-08-31T18:00:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(1);
    session.undo("2026-08-31T18:00:01.000Z");
    expect(session.document.entities).toEqual([]);
    expect(session.document.revision).toBe(2);
    session.redo("2026-08-31T18:00:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });

  it("holds the included-angle/bulge property across 64 deterministic arc cases", () => {
    for (let index = 0; index < 64; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      const angle = sign * (0.1 + (index + 1) * 0.08);
      let state = startPlineCommand({ handle: `P${index}`, layerId: "0", start: { x: index, y: -index } });
      state = applyPlineCommandAction(state, {
        type: "arc",
        construction: { mode: "angle", end: { x: index + 10, y: 20 - index }, includedAngleRad: angle },
      });
      const entity = preparePlineCommandState(state).entities[0];
      if (entity?.kind !== "polyline") throw new Error("Expected PLINE result.");
      expect(4 * Math.atan(entity.vertices[0]!.bulge!)).toBeCloseTo(angle, 12);
      expect(entity.handle).toBe(`P${index}`);
    }
  });
});
