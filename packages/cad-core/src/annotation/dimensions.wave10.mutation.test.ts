import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { DIMENSION_STYLE_OVERRIDE_KEY, createAngularDimension, createLinearDimension, deriveDimensionPresentation } from "./dimensions.js";

describe("F-061..F-066 dimension mutation ratchet", () => {
  it("kills collapsed-arrow, ignored-placement, ignored-suppression and ignored-zero-suppression mutants", () => {
    const document = createEmptyDocument({ documentId: "dimension-wave10-mutation" });
    document.units = { linear: "mm", displayPrecision: 2, angularPrecision: 2 };
    document.dimensionStyles.push({
      id: "D",
      name: "D",
      textHeight: 2,
      arrowSize: 3,
      extensionOffset: 1,
      scale: 1,
      overrides: { [DIMENSION_STYLE_OVERRIDE_KEY]: {
        firstArrowType: "architectural-tick",
        secondArrowType: "open",
        textHorizontalPlacement: "centered",
        textVerticalPlacement: "above",
        textOffset: 3,
        zeroSuppression: { leading: true, trailing: true },
        suppression: { firstExtensionLine: true, secondArrow: true },
      } },
    });
    const dimension = createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "D", first: { x: 0, y: 0 }, second: { x: 0.5, y: 0 }, dimensionLinePoint: { x: 0, y: 2 }, axis: "horizontal" });
    const presentation = deriveDimensionPresentation(document, dimension);
    expect(presentation.formattedText).toBe(".5");
    expect(presentation.text.position).toEqual({ x: 0.25, y: 5 });
    expect(presentation.extensionLines).toEqual([{ start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 3 } }]);
    expect(presentation.arrows).toEqual([{ tip: { x: 0, y: 2 }, direction: { x: 1, y: 0 }, size: 3, type: "architectural-tick" }]);
  });

  it("kills angular centered-text mutants by ignoring the manually supplied arc-point angle", () => {
    const document = createEmptyDocument({ documentId: "dimension-angular-mutation" });
    document.dimensionStyles.push({ id: "D", name: "D", textHeight: 2, arrowSize: 2, extensionOffset: 0, scale: 1, overrides: { [DIMENSION_STYLE_OVERRIDE_KEY]: { textHorizontalPlacement: "centered" } } });
    const dimension = createAngularDimension(document, { handle: "A", layerId: "0", styleId: "D", vertex: { x: 0, y: 0 }, firstRayPoint: { x: 10, y: 0 }, secondRayPoint: { x: 0, y: 10 }, arcPoint: { x: 20, y: 20 } });
    const position = deriveDimensionPresentation(document, dimension).text.position;
    expect(position.x).toBeCloseTo(20, 12);
    expect(position.y).toBeCloseTo(20, 12);
  });
});
