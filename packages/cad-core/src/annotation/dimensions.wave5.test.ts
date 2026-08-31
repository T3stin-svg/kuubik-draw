import { describe, expect, it } from "vitest";
import type { CadDimensionStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./annotation.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readDimensionAssociation } from "./contracts.js";
import {
  DIMENSION_STYLE_OVERRIDE_KEY,
  applyDimensionStyle,
  createAlignedDimension,
  createAngularDimension,
  createBaselineDimensions,
  createDimensionStyle,
  createLinearDimension,
  createRadialDimension,
  deriveDimensionPresentation,
  evaluateDimensionCapability,
  updateDimensionStyle,
} from "./dimensions.js";

function style(overrides: Record<string, unknown> = {}): CadDimensionStyle {
  return {
    id: "DIM",
    name: "Dimension",
    textHeight: 2.5,
    arrowSize: 3,
    extensionOffset: 1,
    scale: 2,
    overrides: { [DIMENSION_STYLE_OVERRIDE_KEY]: overrides },
  };
}

function fixture(overrides: Record<string, unknown> = {}): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "dimension-wave5", now: "2026-08-31T19:00:00.000Z" });
  document.units = { linear: "mm", displayPrecision: 2, angularPrecision: 1 };
  document.dimensionStyles.push(style(overrides));
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  return document;
}

describe("F-061..F-066 exact dimension presentation", () => {
  it("derives deterministic text, arrows and extension geometry from a referenced style", () => {
    const document = fixture({ linearUnit: "cm", linearPrecision: 1, prefix: "L=", suffix: " cm", decimalSeparator: ",", tolerance: { mode: "symmetric", value: 0.1, precision: 1 }, arrowType: "open", extensionBeyond: 2, textGap: 0.75 });
    const dimension = createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal" });
    expect(deriveDimensionPresentation(document, dimension)).toEqual(golden.dimensionPresentation);
  });

  it("derives aligned, angular, radius and diameter measurements without changing model coordinates", () => {
    const document = fixture({ linearPrecision: 2, angularPrecision: 1 });
    const aligned = createAlignedDimension(document, { handle: "DA", layerId: "0", styleId: "DIM", first: { x: 10, y: 10 }, second: { x: 40, y: 50 }, dimensionLinePoint: { x: 0, y: 20 } });
    const alignedPresentation = deriveDimensionPresentation(document, aligned);
    expect(alignedPresentation).toMatchObject({ measurement: 50, formattedText: "50.00" });
    expect(alignedPresentation.text.rotationRad).toBeCloseTo(Math.atan2(40, 30), 14);
    const angular = createAngularDimension(document, { handle: "DG", layerId: "0", styleId: "DIM", vertex: { x: 0, y: 0 }, firstRayPoint: { x: 10, y: 0 }, secondRayPoint: { x: 0, y: 10 }, arcPoint: { x: 5, y: 5 } });
    expect(deriveDimensionPresentation(document, angular)).toMatchObject({ measurement: Math.PI / 2, formattedText: "90.0°", arc: { center: { x: 0, y: 0 }, radius: Math.sqrt(50), startAngleRad: 0, endAngleRad: Math.PI / 2 } });
    const radial = createRadialDimension(document, { handle: "DR", layerId: "0", styleId: "DIM", center: { x: 0, y: 0 }, circumferencePoint: { x: 10, y: 0 }, textPoint: { x: 15, y: 0 } });
    const diameter = createRadialDimension(document, { handle: "DD", layerId: "0", styleId: "DIM", center: { x: 0, y: 0 }, circumferencePoint: { x: 10, y: 0 }, textPoint: { x: 15, y: 0 }, diameter: true });
    expect(deriveDimensionPresentation(document, radial)).toMatchObject({ measurement: 10, formattedText: "10.00", arrows: [{ tip: { x: 10, y: 0 } }] });
    expect(deriveDimensionPresentation(document, diameter)).toMatchObject({ measurement: 20, formattedText: "20.00", dimensionLines: [{ start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }] });
  });

  it("creates associative baseline dimensions from one immutable origin", () => {
    const document = fixture();
    document.entities.push({ kind: "line", handle: "11", layerId: "0", start: { x: 50, y: 0 }, end: { x: 150, y: 0 } });
    const anchors = [
      { handle: "10", feature: "start" as const, fallback: { x: 0, y: 0 } },
      { handle: "10", feature: "end" as const, fallback: { x: 100, y: 0 } },
      { handle: "11", feature: "end" as const, fallback: { x: 100, y: 0 } },
    ];
    const dimensions = createBaselineDimensions(document, { handles: ["B1", "B2"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], dimensionLinePoints: [{ x: 0, y: 20 }, { x: 0, y: 30 }], axis: "horizontal", chainId: "BASE", anchors });
    expect(dimensions.map((item) => item.definitionPoints.slice(0, 2))).toEqual([[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 150, y: 0 }]]);
    expect(readDimensionAssociation(dimensions[1]!)?.chain).toEqual({ id: "BASE", index: 1, mode: "baseline", baselineDimensionHandle: "B1" });
    expect(readDimensionAssociation(dimensions[1]!)?.anchors.map((anchor) => anchor.handle)).toEqual(["10", "11"]);
  });

  it("applies and updates style references atomically without replacing dimension handles", () => {
    const document = fixture();
    document.dimensionStyles.push({ ...style(), id: "DIM2", name: "Dimension 2", scale: 1 });
    const first = createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal" });
    const second = createLinearDimension(document, { handle: "D2", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 50, y: 0 }, dimensionLinePoint: { x: 0, y: 30 }, axis: "horizontal" });
    document.entities.push(first, second);
    const session = new CadSession(document);
    session.commit({ opId: "style-apply", baseRevision: 0, commandId: "DIMSTYLE", args: {}, targetHandles: ["D1", "D2"], resultHandles: ["D1", "D2"] }, applyDimensionStyle(document, "DIM2", ["D1", "D2"]));
    expect(session.document.entities.slice(-2).map((entity) => [entity.handle, entity.kind === "dimension" ? entity.styleId : null])).toEqual([["D1", "DIM2"], ["D2", "DIM2"]]);
    session.undo();
    expect(session.document.entities.slice(-2).map((entity) => [entity.handle, entity.kind === "dimension" ? entity.styleId : null])).toEqual([["D1", "DIM"], ["D2", "DIM"]]);
    session.redo();
    expect(session.document.entities.slice(-2).map((entity) => entity.handle)).toEqual(["D1", "D2"]);

    const updated = { ...style(), scale: 4 };
    expect(updateDimensionStyle(session.document, updated)).toMatchObject({ dimensionStyle: { id: "DIM", scale: 4 } });
  });

  it("fails closed for locked layers, orphan anchors and malformed style profiles", () => {
    const document = fixture();
    document.layers[0]!.locked = true;
    expect(() => createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, dimensionLinePoint: { x: 0, y: 5 }, axis: "horizontal" })).toThrow(/locked/u);
    document.layers[0]!.locked = false;
    expect(() => createAlignedDimension(document, { handle: "BROKEN", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, anchors: [{ handle: "MISSING", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "MISSING", feature: "end", fallback: { x: 100, y: 0 } }] })).toThrow(/orphaned/u);
    const dimension = createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] });
    document.entities.push(dimension);
    document.entities = document.entities.filter((entity) => entity.handle !== "10");
    expect(evaluateDimensionCapability(document, "D1")).toEqual({ executable: false, code: "orphan-association", handle: "10" });
    expect(() => createDimensionStyle(document, { ...style({ linearPrecision: -1 }), id: "BAD", name: "Bad" })).toThrow(/linearPrecision/u);
  });

  it("keeps measurement and formatting invariant under translation for a deterministic property corpus", () => {
    for (let index = 1; index <= 32; index += 1) {
      const document = fixture({ linearPrecision: 3 });
      const delta = { x: index * 13.25, y: -index * 7.5 };
      const base = createAlignedDimension(document, { handle: `P${index}`, layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: index * 3, y: index * 4 }, dimensionLinePoint: { x: 0, y: index * 6 } });
      const translated = createAlignedDimension(document, { handle: `Q${index}`, layerId: "0", styleId: "DIM", first: delta, second: { x: delta.x + index * 3, y: delta.y + index * 4 }, dimensionLinePoint: { x: delta.x, y: delta.y + index * 6 } });
      const first = deriveDimensionPresentation(document, base);
      const second = deriveDimensionPresentation(document, translated);
      expect(second.measurement).toBeCloseTo(first.measurement, 12);
      expect(second.formattedText).toBe(first.formattedText);
    }
  });
});
