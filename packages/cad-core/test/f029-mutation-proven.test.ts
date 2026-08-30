import type { CadLine } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeAlign } from "../src/index.js";

describe("F-029 mutation-proven contract", () => {
  it("distinguishes translation-only, rotation-only and uniform-scale ALIGN mutants", () => {
    const document = createEmptyDocument({ documentId: "f029-mutation" });
    const line: CadLine = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    document.entities.push(line);
    const pairs = [
      { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 50, y: 25 } },
      { sourcePoint: { x: 100, y: 0 }, destinationPoint: { x: 50, y: 225 } },
    ] as const;
    const noScale = executeAlign(document, { targetHandles: ["10"], pointPairs: pairs, scaleToFit: false });
    const scale = executeAlign(document, { targetHandles: ["10"], pointPairs: pairs, scaleToFit: true });
    expect(noScale.changes[0]).toMatchObject({ entity: { start: { x: 50, y: 25 }, end: { x: 50, y: 125 } } });
    expect(scale.changes[0]).toMatchObject({ entity: { start: { x: 50, y: 25 }, end: { x: 50, y: 225 } } });
    expect(noScale.angleRad).toBeCloseTo(Math.PI / 2, 12);
    expect(scale.scaleFactor).toBeCloseTo(2, 12);
  });

  it("keeps mixed locked selection atomic and records only editable source handles", () => {
    const document = createEmptyDocument({ documentId: "f029-locked" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 10 }, end: { x: 10, y: 10 } },
    );
    const result = executeAlign(document, {
      targetHandles: ["10", "11"],
      pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 20, y: 30 } }],
      scaleToFit: false,
    });
    expect(result.changes).toHaveLength(1);
    expect(result.sourceHandles).toEqual(["10"]);
    expect(result.rejected).toEqual([{ handle: "11", reason: "locked-layer" }]);
    expect(document.entities[0]).toMatchObject({ start: { x: 0, y: 0 } });
  });
});
