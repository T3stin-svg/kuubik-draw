import type { CadDimensionStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readDimensionAssociation } from "./contracts.js";
import { createLinearDimension, deriveDimensionPresentation, updateAssociativeDimensions } from "./dimensions.js";
import golden from "./dimensions.wave17.golden.json";

const style: CadDimensionStyle = { id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 3, extensionOffset: 1, scale: 1 };
function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "F-061-wave17", units: "mm" });
  document.units.displayPrecision = 2;
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push(style);
  document.layers.push({ id: "DIM-LAYER", name: "DIM-LAYER", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push({ kind: "line", handle: "a1", layerId: "0", start: { x: 10, y: 5 }, end: { x: 70, y: 35 } });
  return document;
}

describe("F-061 DIMLINEAR H/V/Rotated unit and golden contract", () => {
  it("keeps measured origins and explicit orientation while honoring manual text and <> override", () => {
    const document = fixture();
    const anchors = [{ handle: "A1", feature: "start" as const, fallback: { x: 10, y: 5 } }, { handle: "A1", feature: "end" as const, fallback: { x: 70, y: 35 } }];
    const horizontal = createLinearDimension(document, { handle: "D1", layerId: "DIM-LAYER", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 0, y: 50 }, textPoint: { x: 42, y: 55 }, overrideText: "M=<> mm", axis: "horizontal", anchors });
    const vertical = createLinearDimension(document, { handle: "D2", layerId: "DIM-LAYER", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 90, y: 0 }, axis: "vertical" });
    const rotated = createLinearDimension(document, { handle: "D3", layerId: "DIM-LAYER", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 0, y: 50 }, axis: "rotated", rotationRad: Math.PI / 4 });
    expect(horizontal.definitionPoints).toEqual([{ x: 10, y: 5 }, { x: 70, y: 35 }, { x: 0, y: 50 }, { x: 42, y: 55 }]);
    expect(readDimensionAssociation(horizontal)).toMatchObject({ linearAxis: "horizontal", textPlacement: "manual", associative: true });
    expect(readDimensionAssociation(rotated)).toMatchObject({ linearRotationRad: Math.PI / 4, textPlacement: "default" });
    for (const [dimension, expected] of [[horizontal, golden.horizontal], [vertical, golden.vertical], [rotated, golden.rotated]] as const) {
      const presentation = deriveDimensionPresentation(document, dimension);
      expect(presentation.measurement).toBeCloseTo(expected.measurement, 12);
      expect(presentation.text.rotationRad).toBeCloseTo(expected.rotationRad, 12);
      expect(presentation.formattedText).toBe(expected.text);
    }
  });

  it("preserves handle, layer, style, text point and override across case-insensitive associative updates", () => {
    const document = fixture();
    const dimension = createLinearDimension(document, { handle: "D4", layerId: "DIM-LAYER", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 0, y: 50 }, textPoint: { x: 45, y: 55 }, overrideText: "<> REF", axis: "horizontal", anchors: [{ handle: "A1", feature: "start", fallback: { x: 10, y: 5 } }, { handle: "A1", feature: "end", fallback: { x: 70, y: 35 } }] });
    document.entities.push(dimension);
    document.entities[0] = { kind: "line", handle: "a1", layerId: "0", start: { x: 20, y: 15 }, end: { x: 90, y: 45 } };
    const update = updateAssociativeDimensions(document, ["a1"]);
    expect(update.broken).toEqual([]);
    expect(update.changes[0]).toMatchObject({ type: "put", entity: { handle: "D4", layerId: "DIM-LAYER", styleId: "DIM", overrideText: "<> REF", definitionPoints: [{ x: 20, y: 15 }, { x: 90, y: 45 }, { x: 0, y: 50 }, { x: 45, y: 55 }] } });
  });

  it("rejects zero projections and malformed rotated variants (mutation killers)", () => {
    const document = fixture();
    const base = { handle: "E1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 0, y: 10 }, dimensionLinePoint: { x: 5, y: 5 } };
    expect(() => createLinearDimension(document, { ...base, axis: "horizontal" })).toThrow(/projected/u);
    expect(() => createLinearDimension(document, { ...base, axis: "rotated", rotationRad: Number.NaN })).toThrow(/finite rotation/u);
  });
});
