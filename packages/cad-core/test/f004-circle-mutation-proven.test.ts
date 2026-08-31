import { describe, expect, it } from "vitest";
import { CircleCommandInputError, prepareCompleteCircleCommand, solveCircleTangentConstruction } from "../src/circle-command.js";

const vertical = (x: number) => ({ kind: "line" as const, start: { x, y: -100 }, end: { x, y: 100 } });
const horizontal = (y: number) => ({ kind: "line" as const, start: { x: -100, y }, end: { x: 100, y } });

describe("F-004 CIRCLE mutation-proven guards", () => {
  it("kills identity, radius, diameter, collapsed 2P and collinear 3P mutants", () => {
    expect(() => prepareCompleteCircleCommand({ command: "CIRCLE", handle: "", layerId: "0", construction: { mode: "center-radius", center: { x: 0, y: 0 }, radius: 1 } })).toThrow(CircleCommandInputError);
    expect(() => prepareCompleteCircleCommand({ command: "CIRCLE", handle: "10", layerId: "0", construction: { mode: "center-radius", center: { x: 0, y: 0 }, radius: 0 } })).toThrowError(expect.objectContaining({ code: "INVALID_RADIUS" }));
    expect(() => prepareCompleteCircleCommand({ command: "CIRCLE", handle: "10", layerId: "0", construction: { mode: "center-diameter", center: { x: 0, y: 0 }, diameter: Number.NaN } })).toThrowError(expect.objectContaining({ code: "INVALID_DIAMETER" }));
    expect(() => prepareCompleteCircleCommand({ command: "CIRCLE", handle: "10", layerId: "0", construction: { mode: "2p", first: { x: 0, y: 0 }, second: { x: 0, y: 0 } } })).toThrow(/must differ/);
    expect(() => prepareCompleteCircleCommand({ command: "CIRCLE", handle: "10", layerId: "0", construction: { mode: "3p", first: { x: 0, y: 0 }, second: { x: 1, y: 1 }, third: { x: 2, y: 2 } } })).toThrow(/non-collinear/);
  });

  it("kills zero-length tangent, no-solution and invalid-index mutants", () => {
    expect(() => solveCircleTangentConstruction({ mode: "ttr", first: { kind: "line", start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }, second: horizontal(0), radius: 1 })).toThrow(/non-zero length/);
    expect(() => prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "20", layerId: "0",
      construction: {
        mode: "ttr",
        first: { kind: "circle", center: { x: 0, y: 0 }, radius: 10 },
        second: { kind: "circle", center: { x: 0, y: 0 }, radius: 10 },
        radius: 2,
      },
    })).toThrowError(expect.objectContaining({ code: "NO_TANGENT_SOLUTION" }));
    expect(() => prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "21", layerId: "0",
      construction: { mode: "ttr", first: vertical(0), second: horizontal(0), radius: 2, selection: { mode: "index", index: 99 } },
    })).toThrowError(expect.objectContaining({ code: "INVALID_SOLUTION_SELECTION" }));
  });

  it("fails closed on ambiguous solutions instead of guessing a pick side", () => {
    expect(() => prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "30", layerId: "0",
      construction: { mode: "ttr", first: vertical(0), second: horizontal(0), radius: 5 },
    })).toThrowError(expect.objectContaining({ code: "AMBIGUOUS_TANGENT_SOLUTION" }));
    expect(() => prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "31", layerId: "0",
      construction: { mode: "ttr", first: vertical(0), second: horizontal(0), radius: 5, selection: { mode: "near-center", point: { x: 0, y: 0 } } },
    })).toThrow(/equidistant/);
  });

  it("kills center/radius and tangent-point corruption mutants", () => {
    const prepared = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "40", layerId: "0",
      construction: {
        mode: "ttr",
        first: { ...vertical(0), pickPoint: { x: 0, y: 5 } },
        second: { ...horizontal(0), pickPoint: { x: 5, y: 0 } },
        radius: 5,
      },
    });
    expect(prepared.entity).toMatchObject({ center: { x: 5, y: 5 }, radius: 5 });
    expect(prepared.candidates[prepared.selectedCandidateIndex!]?.tangentPoints).toEqual([{ x: 0, y: 5 }, { x: 5, y: 0 }]);
    expect(prepared.changes).toEqual([{ type: "put", entity: prepared.entity }]);
  });
});
