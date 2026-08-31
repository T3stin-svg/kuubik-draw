import { describe, expect, it } from "vitest";
import { BoundaryRegionInputError, createEmptyDocument, prepareBoundaryCommand, prepareRegionCommand } from "../src/index.js";

function square(gap = 0) {
  const document = createEmptyDocument({ documentId: "F-014-mutation" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#123456" }, extensionData: { owner: "F-014" }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 10 + gap, y: 0 }, end: { x: 10, y: 10 } },
    { kind: "line", handle: "12", layerId: "0", start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { kind: "line", handle: "13", layerId: "0", start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
  );
  return document;
}

describe("F-014 mutation-proven BOUNDARY/REGION ratchet", () => {
  it("kills tolerance, canonical-order, source-mutation and appearance-loss mutants", () => {
    const document = square(0.25);
    const before = structuredClone(document.entities);
    expect(() => prepareBoundaryCommand(document, {
      handle: "20", layerId: "0", seedPoint: { x: 5, y: 5 }, sourceHandles: ["13", "12", "11", "10"], gapTolerance: 0.249, output: "polyline",
    })).toThrow(BoundaryRegionInputError);
    const result = prepareBoundaryCommand(document, {
      handle: "20", layerId: "0", seedPoint: { x: 5, y: 5 }, sourceHandles: ["13", "12", "11", "10"], gapTolerance: 0.25, output: "polyline",
    });
    expect(result.targetHandles).toEqual(["10", "11", "12", "13"]);
    expect(result.entity).toMatchObject({ handle: "20", appearance: { color: "#123456" }, extensionData: { owner: "F-014" } });
    expect(result.entity.kind === "polyline" ? result.entity.vertices[0] : null).toMatchObject({ x: 0, y: 0 });
    expect(document.entities).toEqual(before);
  });

  it("kills sampled-circle, lost-bulge, signed-area and nesting-parity mutants", () => {
    const document = createEmptyDocument({ documentId: "F-014-circle-mutation" });
    document.entities.push(
      { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 20 },
      { kind: "circle", handle: "11", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
    );
    const result = prepareBoundaryCommand(document, {
      handle: "20", layerId: "0", seedPoint: { x: 15, y: 0 }, sourceHandles: ["11", "10"], islandDetection: true, output: "region",
    });
    expect(result.loops).toHaveLength(2);
    expect(result.loops[0]).toMatchObject({ signedArea: expect.closeTo(Math.PI * 400, 9), nestingDepth: 0, isIsland: false });
    expect(result.loops[1]).toMatchObject({ signedArea: expect.closeTo(-Math.PI * 100, 9), nestingDepth: 1, isIsland: true });
    expect(result.loops.every((loop) => loop.vertices.length === 4 && loop.vertices.every((vertex) => Math.abs(vertex.bulge ?? 0) > 0))).toBe(true);
  });

  it("kills partial-success, missing-delete, source-property and result-handle mutants", () => {
    const document = square();
    const region = prepareRegionCommand(document, { targetHandles: ["13", "10", "12", "11"], resultHandles: ["20"] });
    expect(region.changes.slice(0, 4)).toEqual(["10", "11", "12", "13"].map((handle) => ({ type: "delete", handle })));
    expect(region.entities[0]).toMatchObject({ handle: "20", layerId: "0", appearance: { color: "#123456" }, extensionData: { owner: "F-014" } });
    const mutated = square();
    mutated.entities.push({ kind: "line", handle: "14", layerId: "0", start: { x: 50, y: 0 }, end: { x: 60, y: 0 } });
    expect(() => prepareRegionCommand(mutated, { targetHandles: ["10", "11", "12", "13", "14"], resultHandles: ["20"] })).toThrow(BoundaryRegionInputError);
  });
});
