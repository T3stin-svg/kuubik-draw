import type { CadPoint2 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  prepareCompleteCircleCommand,
  solveCircleTangentConstruction,
  type CircleTangentConstraint,
  type CompleteCircleCommandInput,
} from "../src/circle-command.js";
import { createEmptyDocument } from "../src/document.js";
import { CadSession } from "../src/transaction.js";

const vertical = (x: number, pickPoint?: CadPoint2): CircleTangentConstraint => ({
  kind: "line", start: { x, y: -1_000 }, end: { x, y: 1_000 }, ...(pickPoint ? { pickPoint } : {}),
});
const horizontal = (y: number, pickPoint?: CadPoint2): CircleTangentConstraint => ({
  kind: "line", start: { x: -1_000, y }, end: { x: 1_000, y }, ...(pickPoint ? { pickPoint } : {}),
});

function lineDistance(point: CadPoint2, line: Extract<CircleTangentConstraint, { kind: "line" }>): number {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.abs(dy * point.x - dx * point.y + line.end.x * line.start.y - line.end.y * line.start.x) / Math.hypot(dx, dy);
}

describe("F-004 complete CIRCLE command matrix", () => {
  it.each([
    ["center-radius", { mode: "center-radius", center: { x: 5, y: 6 }, radius: 4 }, { center: { x: 5, y: 6 }, radius: 4 }],
    ["center-diameter", { mode: "center-diameter", center: { x: 5, y: 6 }, diameter: 8 }, { center: { x: 5, y: 6 }, radius: 4 }],
    ["2p", { mode: "2p", first: { x: 1, y: 2 }, second: { x: 9, y: 2 } }, { center: { x: 5, y: 2 }, radius: 4 }],
    ["3p", { mode: "3p", first: { x: 10, y: 0 }, second: { x: 0, y: 10 }, third: { x: -10, y: 0 } }, { center: { x: 0, y: 0 }, radius: 10 }],
  ] as const)("matches the %s golden", (_label, construction, expected) => {
    const prepared = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "10", layerId: "A-GEOM", construction,
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
      extensionData: { rowId: "F-004" },
    });
    expect(prepared.entity).toMatchObject({
      kind: "circle", handle: "10", layerId: "A-GEOM", ...expected,
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
      extensionData: { rowId: "F-004" },
    });
    expect(prepared.entities).toEqual([prepared.entity]);
    expect(prepared.changes).toEqual([{ type: "put", entity: prepared.entity }]);
    expect(prepared.candidates).toEqual([]);
    expect(prepared.selectedCandidateIndex).toBeNull();
  });

  it("enumerates all four perpendicular-line TTR solutions and uses pick sides", () => {
    const construction = {
      mode: "ttr" as const,
      first: vertical(0, { x: 0, y: 5 }),
      second: horizontal(0, { x: 5, y: 0 }),
      radius: 5,
      selection: { mode: "pick-points" as const },
    };
    const candidates = solveCircleTangentConstruction(construction);
    expect(candidates.map((solution) => solution.center)).toEqual([
      { x: -5, y: -5 }, { x: -5, y: 5 }, { x: 5, y: -5 }, { x: 5, y: 5 },
    ]);
    const prepared = prepareCompleteCircleCommand({ command: "CIRCLE", handle: "20", layerId: "0", construction });
    expect(prepared.entity).toMatchObject({ center: { x: 5, y: 5 }, radius: 5 });
    expect(prepared.candidates[prepared.selectedCandidateIndex!]).toMatchObject({
      center: { x: 5, y: 5 },
      tangentPoints: [{ x: 0, y: 5 }, { x: 5, y: 0 }],
    });
  });

  it("solves exact line-circle and circle-circle TTR alternatives", () => {
    const lineCircle = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "21", layerId: "0",
      construction: {
        mode: "ttr",
        first: horizontal(20, { x: 0, y: 20 }),
        second: { kind: "circle", center: { x: 0, y: 0 }, radius: 10, pickPoint: { x: 0, y: 10 } },
        radius: 5,
      },
    });
    expect(lineCircle.entity).toMatchObject({ center: { x: expect.closeTo(0, 12), y: 15 }, radius: 5 });
    expect(lineCircle.candidates[lineCircle.selectedCandidateIndex!]?.tangentPoints).toEqual([
      { x: expect.closeTo(0, 12), y: 20 },
      { x: expect.closeTo(0, 12), y: 10 },
    ]);

    const twoCircles = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "22", layerId: "0",
      construction: {
        mode: "ttr",
        first: { kind: "circle", center: { x: -10, y: 0 }, radius: 5 },
        second: { kind: "circle", center: { x: 10, y: 0 }, radius: 5 },
        radius: 6,
        selection: { mode: "near-center", point: { x: 0, y: 5 } },
      },
    });
    expect(twoCircles.entity.center.x).toBeCloseTo(0, 12);
    expect(twoCircles.entity.center.y).toBeCloseTo(Math.sqrt(21), 12);
  });

  it("solves the three-line TTT incircle and exposes excircle candidates", () => {
    const diagonal: CircleTangentConstraint = {
      kind: "line",
      start: { x: 20, y: 0 },
      end: { x: 0, y: 20 },
      pickPoint: { x: 10, y: 10 },
    };
    const prepared = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "30", layerId: "0",
      construction: {
        mode: "ttt",
        first: vertical(0, { x: 0, y: 5 }),
        second: horizontal(0, { x: 5, y: 0 }),
        third: diagonal,
        selection: { mode: "pick-points" },
      },
    });
    const inradius = 20 - 10 * Math.SQRT2;
    expect(prepared.candidates.length).toBeGreaterThanOrEqual(4);
    expect(prepared.entity).toMatchObject({ center: { x: expect.closeTo(inradius, 12), y: expect.closeTo(inradius, 12) }, radius: expect.closeTo(inradius, 12) });
    expect(prepared.candidates[prepared.selectedCandidateIndex!]?.tangentPoints).toHaveLength(3);
  });

  it("solves mixed and three-circle TTT systems", () => {
    const mixed = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "31", layerId: "0",
      construction: {
        mode: "ttt",
        first: vertical(0),
        second: horizontal(0),
        third: { kind: "circle", center: { x: 20, y: 20 }, radius: 5 },
        selection: { mode: "near-center", point: { x: 8, y: 8 } },
      },
    });
    expect(lineDistance(mixed.entity.center, vertical(0) as Extract<CircleTangentConstraint, { kind: "line" }>)).toBeCloseTo(mixed.entity.radius, 9);
    expect(lineDistance(mixed.entity.center, horizontal(0) as Extract<CircleTangentConstraint, { kind: "line" }>)).toBeCloseTo(mixed.entity.radius, 9);
    expect(Math.min(
      Math.abs(distance(mixed.entity.center, { x: 20, y: 20 }) - (5 + mixed.entity.radius)),
      Math.abs(distance(mixed.entity.center, { x: 20, y: 20 }) - Math.abs(5 - mixed.entity.radius)),
    )).toBeLessThan(1e-8);

    const oneLineTwoCircles = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "31B", layerId: "0",
      construction: {
        mode: "ttt",
        first: horizontal(0, { x: 0, y: 0 }),
        second: { kind: "circle", center: { x: -10, y: 10 }, radius: 5, pickPoint: { x: -5.384615384615, y: 8.076923076923 } },
        third: { kind: "circle", center: { x: 10, y: 10 }, radius: 5, pickPoint: { x: 5.384615384615, y: 8.076923076923 } },
        selection: { mode: "pick-points" },
      },
    });
    expect(oneLineTwoCircles.entity).toMatchObject({
      center: { x: expect.closeTo(0, 9), y: expect.closeTo(35 / 6, 9) },
      radius: expect.closeTo(35 / 6, 9),
    });
    expect(distance(oneLineTwoCircles.entity.center, { x: -10, y: 10 })).toBeCloseTo(5 + 35 / 6, 9);
    expect(distance(oneLineTwoCircles.entity.center, { x: 10, y: 10 })).toBeCloseTo(5 + 35 / 6, 9);

    const height = 10 * Math.sqrt(3);
    const centroid = { x: 10, y: height / 3 };
    const threeCircles = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "32", layerId: "0",
      construction: {
        mode: "ttt",
        first: { kind: "circle", center: { x: 0, y: 0 }, radius: 10, pickPoint: { x: 5 * Math.sqrt(3), y: 5 } },
        second: { kind: "circle", center: { x: 20, y: 0 }, radius: 10, pickPoint: { x: 20 - 5 * Math.sqrt(3), y: 5 } },
        third: { kind: "circle", center: { x: 10, y: height }, radius: 10, pickPoint: { x: 10, y: height - 10 } },
        selection: { mode: "pick-points" },
      },
    });
    expect(threeCircles.entity.center.x).toBeCloseTo(centroid.x, 9);
    expect(threeCircles.entity.center.y).toBeCloseTo(centroid.y, 9);
    expect(threeCircles.entity.radius).toBeCloseTo(10 * (2 / Math.sqrt(3) - 1), 9);
  });

  it("uses identical preparation for preview and one atomic Commit/Undo/Redo", () => {
    const input: CompleteCircleCommandInput = {
      command: "CIRCLE", handle: "40", layerId: "0",
      construction: { mode: "ttr", first: vertical(0), second: horizontal(0), radius: 12, selection: { mode: "near-center", point: { x: 12, y: 12 } } },
      appearance: { color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, thickness: -2 },
    };
    const preview = prepareCompleteCircleCommand(input);
    const commit = prepareCompleteCircleCommand(input);
    expect(commit).toEqual(preview);
    const session = new CadSession(createEmptyDocument({ documentId: "F-004-atomic" }));
    session.commit({
      opId: "F-004:1", baseRevision: 0, commandId: "CIRCLE", args: input,
      targetHandles: [], resultHandles: commit.resultHandles,
    }, commit.changes, "2026-08-31T19:00:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    session.undo("2026-08-31T19:00:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T19:00:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });

  it("keeps 64 deterministic TTR/TTT tangency properties exact", () => {
    for (let index = 1; index <= 64; index += 1) {
      const radius = 1 + index / 8;
      const ttr = prepareCompleteCircleCommand({
        command: "CIRCLE", handle: `TTR${index}`, layerId: "0",
        construction: { mode: "ttr", first: vertical(0), second: horizontal(0), radius, selection: { mode: "near-center", point: { x: radius, y: radius } } },
      });
      expect(ttr.entity.center).toEqual({ x: radius, y: radius });
      expect(lineDistance(ttr.entity.center, vertical(0) as Extract<CircleTangentConstraint, { kind: "line" }>)).toBeCloseTo(radius, 12);
      expect(lineDistance(ttr.entity.center, horizontal(0) as Extract<CircleTangentConstraint, { kind: "line" }>)).toBeCloseTo(radius, 12);

      const leg = 20 + index;
      const diagonal: CircleTangentConstraint = { kind: "line", start: { x: leg, y: 0 }, end: { x: 0, y: leg } };
      const expected = leg * (1 - 1 / Math.sqrt(2));
      const ttt = prepareCompleteCircleCommand({
        command: "CIRCLE", handle: `TTT${index}`, layerId: "0",
        construction: { mode: "ttt", first: vertical(0), second: horizontal(0), third: diagonal, selection: { mode: "near-center", point: { x: expected, y: expected } } },
      });
      expect(ttt.entity.center.x).toBeCloseTo(expected, 9);
      expect(ttt.entity.center.y).toBeCloseTo(expected, 9);
      expect(ttt.entity.radius).toBeCloseTo(expected, 9);
      expect(lineDistance(ttt.entity.center, diagonal as Extract<CircleTangentConstraint, { kind: "line" }>)).toBeCloseTo(expected, 9);
    }
  });
});

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
