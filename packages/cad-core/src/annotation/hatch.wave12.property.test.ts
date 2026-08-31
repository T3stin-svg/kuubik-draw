import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readHatchAssociation } from "./contracts.js";
import { createHatch, hatchBoundaryPolyline, updateAssociativeHatches, type HatchIslandDetection } from "./hatch.js";

const styles: HatchIslandDetection[] = ["normal", "outer", "ignore"];

describe("F-067 HATCH deterministic property ratchet", () => {
  it("preserves island semantics across 128 translated and reordered corpora", () => {
    for (let seed = 0; seed < 128; seed += 1) {
      const document = createEmptyDocument({ documentId: `hatch-property-${seed}` });
      const dx = seed * 11.25; const dy = seed * -7.5;
      const shifted = (points: Array<{ x: number; y: number }>) => points.map(({ x, y }) => ({ x: x + dx, y: y + dy }));
      const loops = [
        hatchBoundaryPolyline("P0", "0", shifted([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])),
        hatchBoundaryPolyline("P1", "0", shifted([{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }])),
        hatchBoundaryPolyline("P2", "0", shifted([{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }])),
      ];
      const order = seed % 2 ? [loops[2]!, loops[0]!, loops[1]!] : loops;
      document.entities.push(...order);
      for (const [index, islandDetection] of styles.entries()) {
        const hatch = createHatch(document, { handle: `H${index}`, layerId: "0", boundaryHandles: order.map((loop) => loop.handle), pattern: "ANSI31", angleRad: seed / 10, scale: 0.5 + seed / 20, origin: { x: dx + 1, y: dy + 2 }, islandDetection });
        const expected = islandDetection === "normal" ? { loops: 3, holes: 1 } : islandDetection === "outer" ? { loops: 2, holes: 1 } : { loops: 1, holes: 0 };
        expect({ loops: hatch.loops.length, holes: hatch.loops.filter((loop) => loop.isHole).length }).toEqual(expected);
        expect(readHatchAssociation(hatch)?.pattern).toEqual({ type: "line", angleRad: seed / 10, scale: 0.5 + seed / 20, origin: { x: dx + 1, y: dy + 2 } });
      }
    }
  });

  it("keeps handle and pattern contract stable through associative boundary updates", () => {
    for (const islandDetection of styles) {
      const document = createEmptyDocument({ documentId: `hatch-association-${islandDetection}` });
      document.entities.push(hatchBoundaryPolyline("A0", "0", [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]));
      const hatch = createHatch(document, { handle: "A1", layerId: "0", boundaryHandles: ["A0"], pattern: "ANSI31", angleRad: 1.25, scale: 3.5, origin: { x: 4, y: 5 }, islandDetection });
      document.entities.push(hatch);
      document.entities[0] = hatchBoundaryPolyline("A0", "0", [{ x: -10, y: -5 }, { x: 70, y: -5 }, { x: 70, y: 55 }, { x: -10, y: 55 }]);
      const update = updateAssociativeHatches(document, ["a0"]);
      expect(update.updatedHandles).toEqual(["A1"]);
      if (update.changes[0]?.type !== "put") throw new Error("Expected associative HATCH put change.");
      expect(update.changes[0].entity.handle).toBe("A1");
      expect(readHatchAssociation(update.changes[0].entity)).toMatchObject({
        kind: "hatch", islandDetection, boundaryHandles: ["A0"],
        pattern: readHatchAssociation(hatch)!.pattern,
      });
    }
  });
});
