import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter, type DynamicInputEntryMode } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("F-052 Dynamic Input property coverage", () => {
  it("keeps 2,000 absolute/relative Cartesian and polar field previews deterministic", () => {
    const document = createEmptyDocument({ documentId: "dynamic-property" });
    const shell = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 12, gridSpacingX: 0.125, gridSpacingY: 0.25, aperture: 0.5 },
      units: { linear: "mm", displayPrecision: 12, angularPrecision: 12 },
      initialPrecision: { ortho: true, polar: true, snap: true, dynamicInput: true },
    });
    const coordinate = new PrecisionCoordinateEntryAdapter(new CadSession(document), (input) => shell.preparePointer(input));
    const dynamic = new PrecisionDynamicInputAdapter(coordinate, shell);
    const random = seeded(0x44594e49);
    const modes: readonly DynamicInputEntryMode[] = ["absolute-cartesian", "relative-cartesian", "absolute-polar", "relative-polar"];
    for (let index = 0; index < 2_000; index += 1) {
      const base = { x: (random() - 0.5) * 1e8, y: (random() - 0.5) * 1e8 };
      const first = (random() - 0.5) * 1e6;
      const second = (random() - 0.5) * 1e6;
      const mode = modes[index % modes.length]!;
      dynamic.start({ basePoint: base, cursorPoint: { x: first, y: second } }, { x: random() * 1920, y: random() * 1080 }, mode);
      let snapshot;
      if (mode.endsWith("cartesian")) {
        dynamic.editField("x", first.toPrecision(17));
        snapshot = dynamic.editField("y", second.toPrecision(17));
        const expected = mode === "relative-cartesian" ? { x: base.x + first, y: base.y + second } : { x: first, y: second };
        expect(snapshot.result?.point).toEqual(expected);
      } else {
        const distance = Math.abs(first) + 1e-6;
        const angleDeg = second / 1e4;
        dynamic.editField("distance", distance.toPrecision(17));
        snapshot = dynamic.editField("angle", angleDeg.toPrecision(17));
        const origin = mode === "relative-polar" ? base : { x: 0, y: 0 };
        expect(snapshot.result?.point.x).toBeCloseTo(origin.x + Math.cos(angleDeg * Math.PI / 180) * distance, 7);
        expect(snapshot.result?.point.y).toBeCloseTo(origin.y + Math.sin(angleDeg * Math.PI / 180) * distance, 7);
      }
      expect(snapshot.commitReady).toBe(true);
      expect(snapshot.result?.point).toEqual(snapshot.result?.coordinate);
      expect(dynamic.handleKey("Enter")).toMatchObject({ handled: true, action: "commit-requested" });
    }
  });
});
