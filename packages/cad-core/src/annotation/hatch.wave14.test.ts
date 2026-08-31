import { createEmptyDocument } from "../document.js";
import { describe, expect, it } from "vitest";
import golden from "./hatch.wave14.golden.json";
import { createHatch, editHatch, hatchBoundaryPolyline } from "./hatch.js";
import { readHatchAssociation } from "./contracts.js";

function nested() {
  const document = createEmptyDocument({ documentId: "f068-nested" });
  const boxes = [[0, 100], [10, 90], [20, 80], [30, 70]] as const;
  for (const [index, [min, max]] of boxes.entries()) {
    document.entities.push(hatchBoundaryPolyline(`B${index}`, "0", [
      { x: min, y: min }, { x: max, y: min }, { x: max, y: max }, { x: min, y: max },
    ]));
  }
  return document;
}

describe("F-068 HATCH islands, holes and associativity", () => {
  it.each(["normal", "outer", "ignore"] as const)("matches the %s nested-loop golden topology", (mode) => {
    const document = nested();
    const hatch = createHatch(document, { handle: `H-${mode}`, layerId: "0", boundaryHandles: ["B0", "B1", "B2", "B3"], pattern: "SOLID", islandDetection: mode });
    const contract = readHatchAssociation(hatch)!;
    expect(contract.boundaryDepths).toEqual(golden[mode].depths);
    expect(hatch.loops.map((loop) => loop.isHole)).toEqual(golden[mode].holes);
  });

  it("preserves exact signed bulges and style state through HATCHEDIT", () => {
    const document = createEmptyDocument({ documentId: "f068-bulges" });
    document.entities.push(hatchBoundaryPolyline("ARC", "0", [
      { x: 0, y: 0, bulge: golden.bulges[0]! }, { x: 100, y: 0, bulge: golden.bulges[1]! },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]));
    const hatch = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["ARC"], pattern: "ANSI31", angleRad: 0.5, scale: 2, origin: { x: 3, y: 4 }, associative: true });
    hatch.appearance = { color: "#123456", transparency: 15 };
    document.entities.push(hatch);
    const change = editHatch(document, "h1", { angleRad: 0.75, scale: 4 });
    if (change.type !== "put" || change.entity.kind !== "hatch") throw new Error("Expected HATCH replacement.");
    expect(change.entity).toMatchObject({ handle: "H1", pattern: "ANSI31", associative: true, appearance: hatch.appearance });
    expect((change.entity.loops[0]!.vertices as Array<{ bulge?: number }>).map((vertex) => vertex.bulge ?? 0)).toEqual(golden.bulges);
    expect(readHatchAssociation(change.entity)).toMatchObject({ version: 2, boundaryHandles: ["ARC"], boundaryDepths: [0], pattern: { angleRad: 0.75, scale: 4, origin: { x: 3, y: 4 } } });
  });
});
