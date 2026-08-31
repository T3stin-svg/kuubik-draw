import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("prepared pointer property coverage", () => {
  it("keeps 2,000 seeded double-precision preview/commit frames identical", () => {
    const document = createEmptyDocument({ documentId: "pointer-property" });
    const contract = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 12, gridSpacingX: 0.125, gridSpacingY: 0.25, aperture: 0.5 },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 4 },
      initialPrecision: { ortho: true, snap: true, dynamicInput: true },
    });
    const random = seeded(0x50545233);
    for (let index = 0; index < 2_000; index += 1) {
      const basePoint = { x: (random() - 0.5) * 1e9, y: (random() - 0.5) * 1e9 };
      const cursorPoint = { x: basePoint.x + (random() - 0.5) * 1e6, y: basePoint.y + (random() - 0.5) * 1e6 };
      const prepared = contract.preparePointer({ basePoint, cursorPoint });
      const requestCopy = prepared.request;
      requestCopy.cursorPoint.x += 12345;
      const resolved = prepared.resolve();
      expect(resolved.preview).toEqual(resolved.commit);
      expect(resolved.dynamicInput.point).toEqual(resolved.commit.point);
      expect([resolved.commit.point.x, resolved.commit.point.y]).toSatisfy((values: number[]) => values.every(Number.isFinite));
    }
  });
});
