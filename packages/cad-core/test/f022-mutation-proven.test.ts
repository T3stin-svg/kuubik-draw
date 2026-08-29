import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeTrim, extendCadEntity, trimCadEntity } from "../src/index.js";
import type { CadLine, CadSpline } from "@kuubik/cad-schema";

const target: CadLine = {
  kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, extensionData: { rowId: "F-022" },
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
};
const boundary = (handle: string, x: number, startY = -10, endY = 10): CadLine => ({
  kind: "line", handle, layerId: "0", start: { x, y: startY }, end: { x, y: endY },
});

function probe(pickX = 50, boundaries = [boundary("20", 25), boundary("21", 75)]) {
  return trimCadEntity(target, { x: pickX, y: 0 }, boundaries, { edgeMode: "no-extend", projectMode: "none" });
}

describe("F-022 mutation-proven TRIM ratchet", () => {
  it("kills pick-side, intersection-count, property-loss and source-mutation mutants", () => {
    const source = structuredClone(target);
    const middle = probe();
    expect(middle).toMatchObject({
      reason: null,
      entities: [
        { start: { x: 0, y: 0 }, end: { x: 25, y: 0 }, appearance: target.appearance, extensionData: target.extensionData },
        { start: { x: 75, y: 0 }, end: { x: 100, y: 0 }, appearance: target.appearance, extensionData: target.extensionData },
      ],
    });
    expect(probe(10).entities).toMatchObject([{ start: { x: 25, y: 0 }, end: { x: 100, y: 0 } }]);
    expect(probe(90).entities).toMatchObject([{ start: { x: 0, y: 0 }, end: { x: 75, y: 0 } }]);
    expect(probe(50, [boundary("20", 25)]).entities).toMatchObject([{ start: { x: 0, y: 0 }, end: { x: 25, y: 0 } }]);
    expect(target).toEqual(source);
  });

  it("kills Edge-mode and Shift-endpoint mutants", () => {
    const short = boundary("20", 50, 10, 20);
    expect(trimCadEntity(target, { x: 10, y: 0 }, [short], { edgeMode: "no-extend" }).reason).toBe("no-intersection");
    expect(trimCadEntity(target, { x: 10, y: 0 }, [short], { edgeMode: "extend" }).entities).toMatchObject([{ start: { x: 50, y: 0 }, end: { x: 100, y: 0 } }]);
    const shortTarget = { ...target, start: { x: 20, y: 0 }, end: { x: 80, y: 0 } };
    expect(extendCadEntity(shortTarget, { x: 20, y: 0 }, [boundary("20", 0), boundary("21", 100)]).entity).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 80, y: 0 } });
    expect(extendCadEntity(shortTarget, { x: 80, y: 0 }, [boundary("20", 0), boundary("21", 100)]).entity).toMatchObject({ start: { x: 20, y: 0 }, end: { x: 100, y: 0 } });
  });

  it("kills Quick/Standard, Erase, ordered-step and split-handle mutants", () => {
    const document = createEmptyDocument({ documentId: "F-022-mutation" });
    document.entities.push(target, boundary("20", 25), boundary("21", 75), boundary("30", 200));
    const standard = executeTrim(document, {
      mode: "standard", cuttingEdgeHandles: ["20", "21"],
      targets: [{ handle: "10", pickPoint: { x: 50, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    });
    expect(standard).toMatchObject({
      resultHandles: ["10", "31"],
      changes: [{ type: "put", entity: { handle: "10" } }, { type: "put", entity: { handle: "31" } }],
      steps: [{ action: "trim", resultHandles: ["10", "31"] }],
    });
    const noIntersectionDocument = createEmptyDocument({ documentId: "F-022-mode" });
    noIntersectionDocument.entities.push(target, boundary("20", 200));
    const common = { cuttingEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 50, y: 0 } }], edgeMode: "no-extend" as const, projectMode: "none" as const };
    expect(executeTrim(noIntersectionDocument, { ...common, mode: "standard" })).toMatchObject({ changes: [], rejected: [{ reason: "no-intersection" }] });
    expect(executeTrim(noIntersectionDocument, { ...common, mode: "quick" })).toMatchObject({ changes: [{ type: "delete", handle: "10" }], steps: [{ action: "quick-erase" }] });
    expect(executeTrim(document, { ...common, mode: "standard", targets: [{ handle: "10", pickPoint: { x: 50, y: 0 }, action: "erase" }] })).toMatchObject({ changes: [{ type: "delete", handle: "10" }], steps: [{ action: "erase" }] });
  });

  it("kills sampled-SPLINE, approximate-split and rational-weight-loss mutants", () => {
    const spline: CadSpline = {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 100 / 3, y: 100 }, { x: 200 / 3, y: -100 }, { x: 100, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [2, 2, 2, 2], closed: false, periodic: false,
    };
    const output = trimCadEntity(spline, { x: 50, y: 0 }, [boundary("20", 25, -100, 100), boundary("21", 75, -100, 100)]);
    expect(output.reason).toBeNull();
    const pieces = output.entities as CadSpline[];
    expect(pieces.map((piece) => piece.controlPoints.length)).toEqual([4, 4]);
    expect(pieces.map((piece) => piece.knots)).toEqual([
      [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25],
      [0.75, 0.75, 0.75, 0.75, 1, 1, 1, 1],
    ]);
    expect(pieces.map((piece) => piece.weights)).toEqual([[2, 2, 2, 2], [2, 2, 2, 2]]);
    expect(pieces[0]!.controlPoints.at(-1)).toEqual({ x: 25, y: 28.125 });
    expect(pieces[1]!.controlPoints[0]).toEqual({ x: 75, y: -28.125 });
  });
});
