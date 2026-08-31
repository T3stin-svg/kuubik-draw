import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { DIMENSION_STYLE_OVERRIDE_KEY, createAlignedDimension, createLinearDimension, deriveDimensionPresentation, updateAssociativeDimensions } from "./dimensions.js";
import { createHatch, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";
import { createTable, createTableStyle, editTable } from "./table.js";
import { readTableContract } from "./contracts.js";
import { createMLeader, createMText, deriveMTextLayout, updateAssociativeLeaders } from "./text.js";
import { readLeaderContract, readMTextContract } from "./contracts.js";

describe("annotation mutation ratchet", () => {
  it("kills handle/style-loss and stale-association mutants", () => {
    const document = createEmptyDocument({ documentId: "mutation" });
    document.dimensionStyles.push({ id: "D", name: "D", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0, scale: 1 });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    document.entities.push(createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "D", first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, dimensionLinePoint: { x: 0, y: 5 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 10, y: 0 } }] }));
    document.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: -5, y: 2 }, end: { x: 20, y: 2 } };
    const change = updateAssociativeDimensions(document, ["10"]).changes[0];
    expect(change).toMatchObject({ type: "put", entity: { handle: "D1", styleId: "D", definitionPoints: [{ x: -5, y: 2 }, { x: 20, y: 2 }, { x: 0, y: 5 }, { x: 0, y: 5 }] } });
    document.layers[0]!.locked = true;
    expect(() => updateAssociativeDimensions(document, ["10"])).toThrow(/locked layer/u);
  });

  it("kills unit, precision, tolerance and annotation-scale presentation mutants", () => {
    const document = createEmptyDocument({ documentId: "dimension-presentation-mutation" });
    document.units = { linear: "mm", displayPrecision: 0, angularPrecision: 0 };
    document.dimensionStyles.push({
      id: "D", name: "D", textHeight: 2, arrowSize: 3, extensionOffset: 1, scale: 4,
      overrides: { [DIMENSION_STYLE_OVERRIDE_KEY]: { linearUnit: "cm", linearPrecision: 2, tolerance: { mode: "deviation", upper: 0.2, lower: 0.1, precision: 2 }, arrowType: "architectural-tick", extensionBeyond: 2 } },
    });
    const dimension = createLinearDimension(document, { handle: "D1", layerId: "0", styleId: "D", first: { x: 0, y: 0 }, second: { x: 125, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal" });
    const presentation = deriveDimensionPresentation(document, dimension);
    expect(presentation).toMatchObject({ formattedText: "12.50 +0.20/-0.10", text: { height: 8 } });
    expect(presentation.arrows).toHaveLength(2);
    expect(presentation.arrows.every((arrow) => arrow.size === 12 && arrow.type === "architectural-tick")).toBe(true);
    expect(presentation.extensionLines[0]).toEqual({ start: { x: 0, y: 4 }, end: { x: 0, y: 28 } });
  });

  it("kills even-odd island, non-associative and stale-loop mutants", () => {
    const document = createEmptyDocument({ documentId: "hatch-mutation" });
    document.entities.push(
      hatchBoundaryPolyline("10", "0", [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]),
      hatchBoundaryPolyline("11", "0", [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]),
    );
    const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["10", "11"], pattern: "ANSI31" });
    document.entities.push(hatch);
    expect(hatch.loops.map((loop) => loop.isHole)).toEqual([false, true]);
    document.entities[1] = hatchBoundaryPolyline("11", "0", [{ x: 25, y: 25 }, { x: 30, y: 25 }, { x: 30, y: 30 }, { x: 25, y: 30 }]);
    expect(updateAssociativeHatches(document, ["11"]).changes[0]).toMatchObject({ entity: { handle: "H", loops: [{ isHole: false }, { isHole: false }] } });
  });

  it("kills TABLE cell-handle, field-evaluation and merge-overlap mutants", () => {
    const document = createEmptyDocument({ documentId: "table-mutation" });
    const style = createTableStyle(document, { id: "TS", name: "TS", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
    if (style.type !== "set-metadata") throw new Error("Expected metadata change.");
    document.metadata = style.metadata;
    const table = createTable(document, { handle: "T1", layerId: "0", origin: { x: 0, y: 0 }, styleId: "TS", rows: [{ id: "R1", height: 8 }, { id: "R2", height: 8 }], columns: [{ id: "C1", width: 20 }, { id: "C2", width: 20 }] });
    document.entities.push(table);
    const change = editTable(document, "T1", [{ type: "set-cell", cellId: "R2:C2", value: { kind: "field", code: "%<TrustedField>%", fallback: "SAFE" } }]);
    if (change.type !== "put") throw new Error("Expected TABLE put change.");
    expect(readTableContract(change.entity)?.cells.find((cell) => cell.id === "R2:C2")).toMatchObject({ id: "R2:C2", value: { kind: "field", code: "%<TrustedField>%", fallback: "SAFE" } });
    expect(() => editTable(document, "T1", [{ type: "merge", merge: { id: "M1", rowIds: ["R1"], columnIds: ["C1", "C2"] } }, { type: "merge", merge: { id: "M2", rowIds: ["R1", "R2"], columnIds: ["C2"] } }])).toThrow(/overlaps/u);
  });

  it("kills MTEXT wrap/style and MLEADER anchor/style-loss mutants", () => {
    const document = createEmptyDocument({ documentId: "text-leader-mutation" });
    document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const mtext = createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "AAAA BBBB", height: 2, width: 6, styleId: "TXT", wrapMode: "word", paragraphs: [{ id: "P", alignment: "right" }] });
    expect(readMTextContract(mtext)).toMatchObject({ width: 6, wrapMode: "word", paragraphs: [{ id: "P", alignment: "right" }] });
    expect(deriveMTextLayout(document, mtext).map((line) => line.text)).toEqual(["AAAA", "BBBB"]);
    const mleader = createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: -1, y: -1 }, { x: 20, y: 5 }], text: "M", textPosition: { x: 22, y: 5 }, styleId: "MLS", textStyleId: "TXT", textHeight: 2.5, landingLength: 4, arrowType: "dot", anchor: { handle: "10", feature: "end", fallback: { x: 10, y: 0 } } });
    document.entities.push(mleader);
    document.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: 1, y: 2 }, end: { x: 15, y: 3 } };
    const change = updateAssociativeLeaders(document, ["10"]).changes[0];
    expect(change).toMatchObject({ type: "put", entity: { handle: "ML1", vertices: [{ x: 15, y: 3 }, { x: 20, y: 5 }] } });
    if (!change || change.type !== "put") throw new Error("Expected MLEADER association change.");
    expect(readLeaderContract(change.entity)).toMatchObject({ kind: "mleader", styleId: "MLS", textStyleId: "TXT", arrow: { type: "dot" }, landing: { length: 4 }, anchor: { handle: "10" } });
  });
});
