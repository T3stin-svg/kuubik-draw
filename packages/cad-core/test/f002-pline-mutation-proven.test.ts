import { describe, expect, it } from "vitest";
import { GeometryCommandInputError } from "../src/geometry-commands.js";
import { applyPlineCommandAction, preparePlineCommandState, startPlineCommand } from "../src/pline-command.js";

describe("F-002 PLINE mutation-proven guards", () => {
  it("kills collapsed-point, width-sign and premature-close mutants", () => {
    const state = startPlineCommand({ handle: "10", layerId: "0", start: { x: 0, y: 0 } });
    expect(() => applyPlineCommandAction(state, { type: "line", end: { x: 0, y: 0 } })).toThrow(GeometryCommandInputError);
    expect(() => applyPlineCommandAction(state, { type: "width", startWidth: -1, endWidth: 0 })).toThrow(GeometryCommandInputError);
    expect(() => applyPlineCommandAction(state, { type: "halfwidth", startHalfWidth: 0, endHalfWidth: Number.NaN })).toThrow(GeometryCommandInputError);
    expect(() => applyPlineCommandAction(state, { type: "close" })).toThrow(GeometryCommandInputError);
    expect(() => preparePlineCommandState(state)).toThrow(GeometryCommandInputError);
  });

  it("kills invalid Through, Center, Direction and Radius arc mutants", () => {
    const state = startPlineCommand({ handle: "20", layerId: "0", start: { x: 0, y: 0 } });
    expect(() => applyPlineCommandAction(state, {
      type: "arc", construction: { mode: "through", point: { x: 5, y: 0 }, end: { x: 10, y: 0 } },
    })).toThrow(/collinear/);
    expect(() => applyPlineCommandAction(state, {
      type: "arc", construction: { mode: "center", center: { x: 0, y: 10 }, end: { x: 20, y: 10 } },
    })).toThrow(/same non-zero radius/);
    expect(() => applyPlineCommandAction(state, {
      type: "arc", construction: { mode: "direction", end: { x: 10, y: 0 }, tangentDirectionRad: 0 },
    })).toThrow(/finite-radius/);
    expect(() => applyPlineCommandAction(state, {
      type: "arc", construction: { mode: "radius", end: { x: 10, y: 0 }, radius: 4 },
    })).toThrow(/too small/);
    expect(() => applyPlineCommandAction(state, {
      type: "arc", construction: { mode: "angle", end: { x: 10, y: 0 }, includedAngleRad: Math.PI * 2 },
    })).toThrow(/less than 2π/);
  });

  it("kills post-Close mutation and duplicated-seam mutants", () => {
    let state = startPlineCommand({ handle: "30", layerId: "0", start: { x: 0, y: 0 } });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 10, y: 0 } });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 10, y: 10 } });
    state = applyPlineCommandAction(state, { type: "close" });
    expect(state.vertices).toHaveLength(3);
    expect(state.vertices.at(-1)).not.toMatchObject(state.vertices[0]!);
    expect(() => applyPlineCommandAction(state, { type: "line", end: { x: 0, y: 10 } })).toThrow(/only accepts Undo/);

    let duplicateSeam = startPlineCommand({ handle: "31", layerId: "0", start: { x: 0, y: 0 } });
    duplicateSeam = applyPlineCommandAction(duplicateSeam, { type: "line", end: { x: 10, y: 0 } });
    duplicateSeam = applyPlineCommandAction(duplicateSeam, { type: "line", end: { x: 10, y: 10 } });
    duplicateSeam = applyPlineCommandAction(duplicateSeam, { type: "line", end: { x: 0, y: 0 } });
    expect(() => applyPlineCommandAction(duplicateSeam, { type: "close" })).toThrow(/duplicate the seam/);
  });
});
