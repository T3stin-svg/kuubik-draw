import type { CadDimensionStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import golden from "./annotation.golden.json";
import { readDimensionAssociation } from "./contracts.js";
import {
  DIMENSION_STYLE_OVERRIDE_KEY,
  createAngularDimension,
  createBaselineDimensions,
  createContinuedDimensions,
  createDimensionStyle,
  createLinearDimension,
  createRadialDimension,
  deriveDimensionPresentation,
  updateAssociativeDimensions,
} from "./dimensions.js";

function dimensionStyle(id = "DIM", overrides: Record<string, unknown> = {}): CadDimensionStyle {
  return {
    id,
    name: id,
    textStyleId: "TXT",
    textHeight: 2.5,
    arrowSize: 3,
    extensionOffset: 1,
    scale: 1,
    overrides: { [DIMENSION_STYLE_OVERRIDE_KEY]: overrides },
  };
}

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "dimension-wave10", now: "2026-08-31T20:00:00.000Z" });
  document.units = { linear: "mm", displayPrecision: 2, angularPrecision: 2 };
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push(dimensionStyle());
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 200, y: 100 }, radius: 10 },
  );
  return document;
}

describe("F-061..F-066 dimension completion wave", () => {
  it("keeps linear horizontal/vertical measured origins in model coordinates and projects only presentation geometry", () => {
    const document = fixture();
    const horizontal = createLinearDimension(document, { handle: "H", layerId: "0", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 0, y: 50 }, axis: "horizontal" });
    const vertical = createLinearDimension(document, { handle: "V", layerId: "0", styleId: "DIM", first: { x: 10, y: 5 }, second: { x: 70, y: 35 }, dimensionLinePoint: { x: 90, y: 0 }, axis: "vertical" });
    expect(horizontal.definitionPoints.slice(0, 2)).toEqual([{ x: 10, y: 5 }, { x: 70, y: 35 }]);
    expect(vertical.definitionPoints.slice(0, 2)).toEqual([{ x: 10, y: 5 }, { x: 70, y: 35 }]);
    expect(deriveDimensionPresentation(document, horizontal)).toMatchObject({ measurement: 60, dimensionLines: [{ start: { x: 10, y: 50 }, end: { x: 70, y: 50 } }], text: { rotationRad: 0 } });
    expect(deriveDimensionPresentation(document, vertical)).toMatchObject({ measurement: 30, dimensionLines: [{ start: { x: 90, y: 5 }, end: { x: 90, y: 35 } }], text: { rotationRad: Math.PI / 2 } });
  });

  it("matches the golden style contract for precision, arrows, placement and suppression", () => {
    const document = fixture();
    const style = dimensionStyle("DIM-STYLE", {
      linearPrecision: 2,
      prefix: "L=",
      suffix: " mm",
      firstArrowType: "architectural-tick",
      secondArrowType: "open",
      extensionBeyond: 2,
      textHorizontalPlacement: "centered",
      textVerticalPlacement: "above",
      textOffset: 4,
      zeroSuppression: { leading: true, trailing: true },
      suppression: { firstExtensionLine: true, secondArrow: true },
    });
    document.dimensionStyles.push(style);
    const before = structuredClone(document);
    const dimension = createLinearDimension(document, {
      handle: "D-STYLE",
      layerId: "0",
      styleId: "DIM-STYLE",
      first: { x: 0, y: 0 },
      second: { x: 0.5, y: 0 },
      dimensionLinePoint: { x: 0, y: 2 },
      axis: "horizontal",
    });
    expect(document).toEqual(before);
    expect(deriveDimensionPresentation(document, dimension)).toEqual(golden.dimensionStylePresentation);
    expect(style.textStyleId).toBe("TXT");
  });

  it("resolves circle center/quadrant anchors and updates radius/diameter without changing handles", () => {
    const document = fixture();
    const anchors = [
      { handle: "20", feature: "center" as const, fallback: { x: 200, y: 100 } },
      { handle: "20", feature: "quadrant" as const, quadrantIndex: 0 as const, fallback: { x: 210, y: 100 } },
    ];
    const radius = createRadialDimension(document, { handle: "R1", layerId: "0", styleId: "DIM", center: { x: 200, y: 100 }, circumferencePoint: { x: 210, y: 100 }, textPoint: { x: 220, y: 100 }, anchors });
    const diameter = createRadialDimension(document, { handle: "R2", layerId: "0", styleId: "DIM", center: { x: 200, y: 100 }, circumferencePoint: { x: 210, y: 100 }, textPoint: { x: 220, y: 100 }, diameter: true, anchors });
    document.entities.push(radius, diameter);
    const circleIndex = document.entities.findIndex((entity) => entity.handle === "20");
    document.entities[circleIndex] = { kind: "circle", handle: "20", layerId: "0", center: { x: 205, y: 105 }, radius: 15 };
    const update = updateAssociativeDimensions(document, ["20"]);
    expect(update.broken).toEqual([]);
    expect(update.updatedHandles).toEqual(["R1", "R2"]);
    expect(update.changes).toEqual([
      expect.objectContaining({ type: "put", entity: expect.objectContaining({ handle: "R1", definitionPoints: [{ x: 205, y: 105 }, { x: 220, y: 105 }, { x: 220, y: 100 }] }) }),
      expect.objectContaining({ type: "put", entity: expect.objectContaining({ handle: "R2", definitionPoints: [{ x: 205, y: 105 }, { x: 220, y: 105 }, { x: 220, y: 100 }] }) }),
    ]);
  });

  it("keeps three angular anchors stable and centers text on the measured arc sweep", () => {
    const document = fixture();
    document.dimensionStyles.push(dimensionStyle("CENTERED", { textHorizontalPlacement: "centered" }));
    const dimension = createAngularDimension(document, {
      handle: "A1",
      layerId: "0",
      styleId: "CENTERED",
      vertex: { x: 0, y: 0 },
      firstRayPoint: { x: 100, y: 0 },
      secondRayPoint: { x: 0, y: 100 },
      arcPoint: { x: 20, y: 20 },
      anchors: [
        { handle: "10", feature: "start", fallback: { x: 0, y: 0 } },
        { handle: "10", feature: "end", fallback: { x: 100, y: 0 } },
        { handle: "11", feature: "end", fallback: { x: 0, y: 100 } },
      ],
    });
    const presentation = deriveDimensionPresentation(document, dimension);
    expect(presentation.text.position.x).toBeCloseTo(20, 12);
    expect(presentation.text.position.y).toBeCloseTo(20, 12);
    expect(readDimensionAssociation(dimension)?.anchors).toHaveLength(3);
    document.entities.push(dimension);
    document.entities[1] = { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: -100, y: 0 } };
    expect(updateAssociativeDimensions(document, ["11"]).changes[0]).toMatchObject({ entity: { handle: "A1", definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -100, y: 0 }, { x: 20, y: 20 }] } });
  });

  it("rejects orphan, incompatible, mismatched and case-insensitive duplicate anchors/handles", () => {
    const document = fixture();
    const base = { layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal" as const };
    expect(() => createLinearDimension(document, { ...base, handle: "ORPHAN", anchors: [{ handle: "404", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "404", feature: "end", fallback: { x: 100, y: 0 } }] })).toThrow(/orphaned/u);
    expect(() => createLinearDimension(document, { ...base, handle: "BAD-TYPE", anchors: [{ handle: "20", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] })).toThrow(/incompatible/u);
    expect(() => createLinearDimension(document, { ...base, handle: "MISMATCH", first: { x: 1, y: 0 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 1, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] })).toThrow(/does not match/u);
    document.entities.push(createLinearDimension(document, { ...base, handle: "DUP" }));
    expect(() => createLinearDimension(document, { ...base, handle: "dup" })).toThrow(/Duplicate/u);
  });

  it("commits continued and baseline sets as one immutable Undo/Redo operation each", () => {
    const document = fixture();
    const origin = structuredClone(document);
    const continued = createContinuedDimensions(document, { handles: ["C1", "C2"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", chainId: "CHAIN" });
    expect(document).toEqual(origin);
    const session = new CadSession(document);
    session.commit({ opId: "continue", baseRevision: 0, commandId: "DIMCONTINUE", args: {}, targetHandles: [], resultHandles: ["C1", "C2"] }, continued.map((entity) => ({ type: "put" as const, entity })));
    const baseline = createBaselineDimensions(session.document, { handles: ["B1", "B2"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoints: [{ x: 0, y: 30 }, { x: 0, y: 40 }], axis: "horizontal", chainId: "BASE" });
    session.commit({ opId: "baseline", baseRevision: 1, commandId: "DIMBASELINE", args: {}, targetHandles: [], resultHandles: ["B1", "B2"] }, baseline.map((entity) => ({ type: "put" as const, entity })));
    expect(session.document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.handle)).toEqual(["C1", "C2", "B1", "B2"]);
    session.undo();
    expect(session.document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.handle)).toEqual(["C1", "C2"]);
    session.redo();
    expect(session.document.entities.filter((entity) => entity.kind === "dimension").map((entity) => entity.handle)).toEqual(["C1", "C2", "B1", "B2"]);
  });

  it("validates complete style references and nested profile fields before creating a style", () => {
    const document = fixture();
    expect(createDimensionStyle(document, dimensionStyle("VALID", { firstArrowType: "open", secondArrowType: "closed-filled", textHorizontalPlacement: "second-extension", textVerticalPlacement: "below", textRotationRad: Math.PI / 4, suppression: { dimensionLine: true } }))).toMatchObject({ type: "put-dimension-style", dimensionStyle: { id: "VALID", textStyleId: "TXT" } });
    expect(() => createDimensionStyle(document, { ...dimensionStyle("NO-TEXT"), textStyleId: "MISSING" })).toThrow(/Unknown text style/u);
    expect(() => createDimensionStyle(document, dimensionStyle("UNKNOWN", { guessedAutoCadField: true }))).toThrow(/Unsupported dimension style profile field/u);
    expect(() => createDimensionStyle(document, dimensionStyle("BAD-SUPPRESSION", { suppression: { thirdArrow: true } }))).toThrow(/suppression.thirdArrow/u);
  });
});
