import { describe, expect, it } from "vitest";
import {
  ArcCommandInputError,
  prepareCompleteArcCommand,
  prepareCompleteArcDocumentCommand,
} from "../src/arc-command.js";
import { createEmptyDocument } from "../src/document.js";

const base = { command: "ARC" as const, handle: "10", layerId: "0" };

describe("F-005 ARC mutation-proven guards", () => {
  it("rejects invalid identity, non-finite points, zero radius and collapsed endpoints", () => {
    expect(() => prepareCompleteArcCommand({ ...base, handle: "", construction: { mode: "start-center-end", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, end: { x: 0, y: 1 } } })).toThrowError(expect.objectContaining({ code: "INVALID_IDENTITY" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "3p", start: { x: Number.NaN, y: 0 }, point: { x: 0, y: 1 }, end: { x: -1, y: 0 } } })).toThrowError(expect.objectContaining({ code: "INVALID_POINT" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-center-end", start: { x: 0, y: 0 }, center: { x: 0, y: 0 }, end: { x: 1, y: 0 } } })).toThrowError(expect.objectContaining({ code: "INVALID_RADIUS" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-end-angle", start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, includedAngleRad: 1 } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_CONSTRUCTION" }));
  });

  it("rejects collinear 3P, zero/full angles and impossible chord/radius inputs", () => {
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "3p", start: { x: 0, y: 0 }, point: { x: 1, y: 1 }, end: { x: 2, y: 2 } } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_CONSTRUCTION" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-center-angle", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad: 0 } })).toThrowError(expect.objectContaining({ code: "INVALID_ANGLE" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-center-angle", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad: Math.PI * 2 } })).toThrowError(expect.objectContaining({ code: "FULL_CIRCLE_UNSUPPORTED" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-center-length", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, chordLength: 3 } })).toThrowError(expect.objectContaining({ code: "NO_ARC_SOLUTION" }));
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-end-radius", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, radius: 4 } })).toThrowError(expect.objectContaining({ code: "NO_ARC_SOLUTION" }));
  });

  it("uses AutoCAD signed-radius defaults and fails closed on invalid selection", () => {
    const construction = { mode: "start-end-radius" as const, start: { x: -5, y: 0 }, end: { x: 5, y: 0 }, radius: 10 };
    expect(prepareCompleteArcCommand({ ...base, construction }).selected).toMatchObject({ counterClockwise: true, major: false });
    expect(prepareCompleteArcCommand({ ...base, construction: { ...construction, radius: -10 } }).selected).toMatchObject({ counterClockwise: true, major: true });
    expect(() => prepareCompleteArcCommand({ ...base, construction: { ...construction, selection: { mode: "index", index: 99 } } })).toThrowError(expect.objectContaining({ code: "INVALID_SOLUTION_SELECTION" }));
  });

  it("rejects infinite-radius direction and proves signed-angle direction", () => {
    expect(() => prepareCompleteArcCommand({ ...base, construction: { mode: "start-end-direction", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, tangentDirectionRad: 0 } })).toThrowError(expect.objectContaining({ code: "DEGENERATE_CONSTRUCTION" }));
    const signed = prepareCompleteArcCommand({ ...base, construction: { mode: "start-end-angle", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, includedAngleRad: -Math.PI / 2 } });
    expect(signed.entity.counterClockwise).toBe(false);
    expect(signed.selected.sweepRad).toBeCloseTo(Math.PI / 2, 10);
    expect(signed.changes).toEqual([{ type: "put", entity: signed.entity }]);
    expect(signed).toBeInstanceOf(Object);
    expect(ArcCommandInputError.prototype).toBeInstanceOf(Error);
  });

  it.each([
    ["LAYER_NOT_FOUND", "MISSING", {}],
    ["LAYER_LOCKED", "BLOCKED", { locked: true }],
    ["LAYER_HIDDEN", "BLOCKED", { visible: false }],
    ["LAYER_HIDDEN", "BLOCKED", { frozen: true }],
  ] as const)("fails closed for document policy %s", (code, layerId, patch) => {
    const document = createEmptyDocument({ documentId: `F-005-${code}` });
    if (layerId === "BLOCKED") {
      document.layers.push({ id: layerId, name: layerId, visible: true, frozen: false, locked: false, plottable: true, ...patch });
    }
    expect(() => prepareCompleteArcDocumentCommand(document, {
      command: "ARC", handle: "A5", layerId,
      construction: { mode: "start-center-end", start: { x: 10, y: 0 }, center: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
    })).toThrowError(expect.objectContaining({ code }));
    expect(document.entities).toEqual([]);
  });

  it("rejects handle collisions, near-collinear scale mutants and numeric overflow", () => {
    const document = createEmptyDocument({ documentId: "F-005-document-guards" });
    document.entities.push({ kind: "line", handle: "A5", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    expect(() => prepareCompleteArcDocumentCommand(document, {
      command: "ARC", handle: "a5", layerId: "0",
      construction: { mode: "start-center-angle", start: { x: 10, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad: 1 },
    })).toThrowError(expect.objectContaining({ code: "HANDLE_COLLISION" }));
    expect(() => prepareCompleteArcCommand({
      ...base,
      construction: { mode: "3p", start: { x: 0, y: 0 }, point: { x: 1e9, y: 1e9 }, end: { x: 2e9, y: 2e9 + 1e-3 } },
    })).toThrowError(expect.objectContaining({ code: "DEGENERATE_CONSTRUCTION" }));
    expect(() => prepareCompleteArcCommand({
      ...base,
      construction: { mode: "3p", start: { x: Number.MAX_VALUE, y: 0 }, point: { x: 0, y: Number.MAX_VALUE }, end: { x: -Number.MAX_VALUE, y: 0 } },
    })).toThrow(ArcCommandInputError);
  });
});
