import { createEmptyDocument } from "../document.js";
import { describe, expect, it } from "vitest";
import { createHatch, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";
import { readHatchAssociation } from "./contracts.js";

describe("F-068 HATCH property and fuzz ratchet", () => {
  it("keeps nesting depth invariant across 192 translations, scales and boundary orders", () => {
    for (let seed = 1; seed <= 192; seed += 1) {
      const document = createEmptyDocument({ documentId: `f068-fuzz-${seed}` });
      const offset = seed * 17 - 1_600;
      const scale = 1 + seed / 97;
      const loops = [0, 1, 2].map((depth) => {
        const inset = depth * 10 * scale;
        const handle = `B${depth}`;
        document.entities.push(hatchBoundaryPolyline(handle, "0", [
          { x: offset + inset, y: offset + inset }, { x: offset + 100 * scale - inset, y: offset + inset },
          { x: offset + 100 * scale - inset, y: offset + 100 * scale - inset }, { x: offset + inset, y: offset + 100 * scale - inset },
        ]));
        return handle;
      });
      if (seed % 2 === 0) loops.reverse();
      const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: loops, pattern: "SOLID", islandDetection: "normal" });
      expect([...readHatchAssociation(hatch)!.boundaryDepths!].sort()).toEqual([0, 1, 2]);
      expect(hatch.loops.filter((loop) => loop.isHole)).toHaveLength(1);
    }
  });

  it("updates the topology snapshot even when Ignore hides the changed inner loop", () => {
    const document = createEmptyDocument({ documentId: "f068-hidden-loop-update" });
    document.entities.push(
      hatchBoundaryPolyline("OUT", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
      hatchBoundaryPolyline("IN", "0", [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }]),
    );
    const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["OUT", "IN"], pattern: "SOLID", islandDetection: "ignore" });
    document.entities.push(hatch);
    document.entities[1] = hatchBoundaryPolyline("IN", "0", [{ x: 60, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 80 }, { x: 60, y: 80 }]);
    const result = updateAssociativeHatches(document, ["IN"]);
    expect(result.updatedHandles).toEqual(["H"]);
    if (result.changes[0]?.type !== "put") throw new Error("Expected HATCH update.");
    expect(readHatchAssociation(result.changes[0].entity)?.boundaryVertices?.[1]?.[0]).toEqual({ x: 60, y: 60 });
    expect((result.changes[0].entity as { loops: unknown[] }).loops).toHaveLength(1);
  });

  it("does not propagate boundary edits into a detached non-associative HATCH", () => {
    const document = createEmptyDocument({ documentId: "f068-detached" });
    document.entities.push(hatchBoundaryPolyline("B", "0", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]));
    const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["B"], pattern: "SOLID", associative: false });
    document.entities.push(hatch);
    document.entities[0] = hatchBoundaryPolyline("B", "0", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]);
    expect(updateAssociativeHatches(document, ["B"])).toEqual({ changes: [], updatedHandles: [], broken: [] });
  });
});
