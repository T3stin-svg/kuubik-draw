import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { createAlignedDimension, updateAssociativeDimensions } from "./dimensions.js";
import { createHatch, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";

describe("annotation mutation ratchet", () => {
  it("kills handle/style-loss and stale-association mutants", () => {
    const document = createEmptyDocument({ documentId: "mutation" });
    document.dimensionStyles.push({ id: "D", name: "D", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0, scale: 1 });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    document.entities.push(createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "D", first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, dimensionLinePoint: { x: 0, y: 5 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 10, y: 0 } }] }));
    document.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: -5, y: 2 }, end: { x: 20, y: 2 } };
    const change = updateAssociativeDimensions(document, ["10"]).changes[0];
    expect(change).toMatchObject({ type: "put", entity: { handle: "D1", styleId: "D", definitionPoints: [{ x: -5, y: 2 }, { x: 20, y: 2 }, { x: 0, y: 5 }, { x: 0, y: 5 }] } });
  });

  it("kills even-odd island, non-associative and stale-loop mutants", () => {
    const document = createEmptyDocument({ documentId: "hatch-mutation" });
    document.entities.push(
      hatchBoundaryPolyline("10", "0", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]),
      hatchBoundaryPolyline("11", "0", [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]),
    );
    const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["10", "11"], pattern: "ANSI31" });
    document.entities.push(hatch);
    expect(hatch.loops.map((loop) => loop.isHole)).toEqual([false, true]);
    document.entities[1] = hatchBoundaryPolyline("11", "0", [{ x: 25, y: 25 }, { x: 30, y: 25 }, { x: 30, y: 30 }, { x: 25, y: 30 }]);
    expect(updateAssociativeHatches(document, ["11"]).changes[0]).toMatchObject({ entity: { handle: "H", loops: [{ isHole: false }, { isHole: false }] } });
  });
});
