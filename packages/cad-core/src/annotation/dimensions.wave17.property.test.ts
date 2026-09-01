import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { createLinearDimension, deriveDimensionPresentation } from "./dimensions.js";

describe("F-061 DIMLINEAR deterministic projection properties", () => {
  it("matches the absolute dot product for bounded deterministic rotations", () => {
    const document = createEmptyDocument({ documentId: "F-061-property" });
    document.textStyles.push({ id: "T", name: "T", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    document.dimensionStyles.push({ id: "D", name: "D", textStyleId: "T", textHeight: 2.5, arrowSize: 3, extensionOffset: 1, scale: 1 });
    for (let index = 0; index < 64; index += 1) {
      const rotationRad = -Math.PI + index * Math.PI / 37;
      const delta = { x: 17 + index, y: 11 - index / 3 };
      const expected = Math.abs(delta.x * Math.cos(rotationRad) + delta.y * Math.sin(rotationRad));
      if (expected <= 1e-9) continue;
      const dimension = createLinearDimension(document, { handle: `D${index}`, layerId: "0", styleId: "D", first: { x: -3, y: 8 }, second: { x: -3 + delta.x, y: 8 + delta.y }, dimensionLinePoint: { x: 5, y: 6 }, axis: "rotated", rotationRad });
      expect(deriveDimensionPresentation(document, dimension).measurement).toBeCloseTo(expected, 11);
    }
  });
});
