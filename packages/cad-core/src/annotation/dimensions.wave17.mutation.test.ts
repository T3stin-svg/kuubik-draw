import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readDimensionAssociation } from "./contracts.js";
import { createLinearDimension, deriveDimensionPresentation } from "./dimensions.js";

describe("F-061 DIMLINEAR mutation proof", () => {
  it("kills axis inference, override literalization, text-position and projection mutants", () => {
    const document = createEmptyDocument({ documentId: "F-061-mutation", units: "mm" });
    document.units.displayPrecision = 2;
    document.textStyles.push({ id: "T", name: "T", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    document.dimensionStyles.push({ id: "D", name: "D", textStyleId: "T", textHeight: 2.5, arrowSize: 3, extensionOffset: 1, scale: 1 });
    const dimension = createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "D", first: { x: 0, y: 0 }, second: { x: 60, y: 30 }, dimensionLinePoint: { x: 0, y: 50 }, textPoint: { x: 44, y: 55 }, overrideText: "X=<>/<> mm", axis: "rotated", rotationRad: Math.PI / 4 });
    expect(readDimensionAssociation(dimension)).toEqual({ kind: "dimension", associative: false, anchors: [], linearRotationRad: Math.PI / 4, textPlacement: "manual" });
    expect(dimension.definitionPoints[3]).toEqual({ x: 44, y: 55 });
    const presentation = deriveDimensionPresentation(document, dimension);
    expect(presentation.measurement).toBeCloseTo(63.63961030678928, 12);
    expect(presentation.formattedText).toBe("X=63.64/63.64 mm");
    expect(presentation.text.rotationRad).toBeCloseTo(Math.PI / 4, 12);
  });
});
