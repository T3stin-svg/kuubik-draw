import { describe, expect, it } from "vitest";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import golden from "./annotation.golden.json";
import { createEmptyDocument } from "../document.js";
import { CadSession } from "../transaction.js";
import { readDimensionAssociation, readHatchAssociation } from "./contracts.js";
import { createAlignedDimension, createAngularDimension, createContinuedDimensions, createDimensionStyle, createLinearDimension, createRadialDimension, updateAssociativeDimensions, updateDimensionStyle } from "./dimensions.js";
import { createHatch, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";
import { createLeader, createMLeader, createMText, createText, createTextStyle, editMLeaderText, updateTextStyle } from "./text.js";
import { updateAssociativeAnnotations } from "./update.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "annotation", now: "2026-08-31T12:00:00.000Z" });
  document.textStyles.push({ id: "TXT-ISO", name: "ISO", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM-ISO", name: "ISO", textStyleId: "TXT-ISO", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 40 } });
  return document;
}

describe("F-061..F-066 dimensions", () => {
  it("creates linear, aligned, angular, radius, diameter and continued dimensions in model coordinates", () => {
    const document = fixture();
    const anchors = [
      { handle: "10", feature: "start" as const, fallback: { x: 0, y: 0 } },
      { handle: "10", feature: "end" as const, fallback: { x: 100, y: 40 } },
    ];
    const linear = createLinearDimension(document, { handle: "D0", layerId: "0", styleId: "DIM-ISO", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 0, y: 60 }, axis: "horizontal", anchors });
    expect(linear.definitionPoints).toEqual([{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 60 }, { x: 50, y: 60 }]);
    expect(readDimensionAssociation(linear)?.linearAxis).toBe("horizontal");
    const aligned = createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "DIM-ISO", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 20, y: 60 }, anchors });
    expect(aligned).toEqual(golden.dimension);
    expect(createAngularDimension(document, { handle: "D2", layerId: "0", styleId: "DIM-ISO", vertex: { x: 0, y: 0 }, firstRayPoint: { x: 10, y: 0 }, secondRayPoint: { x: 0, y: 10 }, arcPoint: { x: 5, y: 5 } }).dimensionKind).toBe("angular");
    expect(createRadialDimension(document, { handle: "D3", layerId: "0", styleId: "DIM-ISO", center: { x: 10, y: 10 }, circumferencePoint: { x: 20, y: 10 }, textPoint: { x: 25, y: 10 } }).dimensionKind).toBe("radial");
    expect(createRadialDimension(document, { handle: "D4", layerId: "0", styleId: "DIM-ISO", center: { x: 10, y: 10 }, circumferencePoint: { x: 20, y: 10 }, textPoint: { x: 25, y: 10 }, diameter: true }).dimensionKind).toBe("diameter");
    const chain = createContinuedDimensions(document, { handles: ["D5", "D6"], layerId: "0", styleId: "DIM-ISO", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", chainId: "CHAIN-1" });
    expect(readDimensionAssociation(chain[1]!)?.chain).toEqual({ id: "CHAIN-1", index: 1, mode: "continued", previousDimensionHandle: "D5" });
  });

  it("updates stable-handle associations without changing dimension handle or style and commits as one Undo step", () => {
    const document = fixture();
    const dimension = createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "DIM-ISO", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 20, y: 60 }, anchors: [
      { handle: "10", feature: "start", fallback: { x: 0, y: 0 } },
      { handle: "10", feature: "end", fallback: { x: 100, y: 40 } },
    ] });
    document.entities.push(dimension);
    const movedLine: CadEntity = { kind: "line", handle: "10", layerId: "0", start: { x: 5, y: 6 }, end: { x: 125, y: 46 } };
    const staged = structuredClone(document);
    staged.entities[0] = movedLine;
    const updated = updateAssociativeDimensions(staged, ["10"]);
    expect(updated).toMatchObject({ updatedHandles: ["D1"], broken: [] });
    expect(updated.changes[0]).toMatchObject({ entity: { handle: "D1", styleId: "DIM-ISO", definitionPoints: [{ x: 5, y: 6 }, { x: 125, y: 46 }, { x: 20, y: 60 }, { x: 20, y: 60 }] } });

    const session = new CadSession(document);
    session.commit({ opId: "assoc-dim", baseRevision: 0, commandId: "MOVE", args: {}, targetHandles: ["10", "D1"], resultHandles: ["10", "D1"] }, [{ type: "put", entity: movedLine }, ...updated.changes]);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.find((entity) => entity.handle === "D1")).toMatchObject({ styleId: "DIM-ISO" });
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.find((entity) => entity.handle === "D1")).toMatchObject({ definitionPoints: [{ x: 5, y: 6 }, { x: 125, y: 46 }, { x: 20, y: 60 }, { x: 20, y: 60 }] });
  });

  it("creates and updates dimension styles with a stable id", () => {
    const document = fixture();
    const style = { id: "DIM-DETAIL", name: "Detail", textStyleId: "TXT-ISO", textHeight: 3.5, arrowSize: 3, extensionOffset: 0.75, scale: 10 };
    expect(createDimensionStyle(document, style)).toEqual({ type: "put-dimension-style", dimensionStyle: style });
    document.dimensionStyles.push(style);
    expect(updateDimensionStyle(document, { ...style, textHeight: 4 })).toMatchObject({ dimensionStyle: { id: "DIM-DETAIL", textHeight: 4 } });
  });
});

describe("F-057..F-060 text and leaders", () => {
  it("preserves MTEXT model coordinates and text-style references and supports LEADER/MLEADER editing", () => {
    const document = fixture();
    expect(createText(document, { handle: "T0", layerId: "0", position: { x: -2, y: 8 }, text: "Üks rida", height: 2.5, rotationRad: 0.25, styleId: "TXT-ISO" })).toMatchObject({ kind: "text", handle: "T0", position: { x: -2, y: 8 }, styleId: "TXT-ISO" });
    const mtext = createMText(document, { handle: "T1", layerId: "0", position: { x: 1234.5, y: -55 }, text: "Rida 1\nRida 2", height: 2.5, width: 80, styleId: "TXT-ISO", lineSpacingFactor: 1.2 });
    expect(mtext).toMatchObject({ kind: "mtext", position: { x: 1234.5, y: -55 }, styleId: "TXT-ISO" });
    expect(createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "Viide" })).toMatchObject({ kind: "leader", text: "Viide" });
    const mleader = createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }], text: "Märkus", textPosition: { x: 22, y: 10 }, styleId: "MLEADER-STD", textStyleId: "TXT-ISO", textHeight: 2.5 });
    document.entities.push(mleader);
    expect(editMLeaderText(document, "ML1", "Muudetud")).toMatchObject({ entity: { handle: "ML1", text: "Muudetud" } });
  });

  it("creates and updates text styles case-insensitively", () => {
    const document = createEmptyDocument({ documentId: "styles" });
    const style = { id: "TXT-ISO", name: "ISO", fontFamily: "Arial", widthFactor: 0.9, obliqueAngleRad: 0.1 };
    expect(createTextStyle(document, style)).toEqual({ type: "put-text-style", textStyle: style });
    document.textStyles.push(style);
    expect(updateTextStyle(document, { ...style, fontFamily: "Liberation Sans" })).toMatchObject({ textStyle: { id: "TXT-ISO", fontFamily: "Liberation Sans" } });
    expect(() => createTextStyle(document, { ...style, id: "OTHER", name: "iso" })).toThrow(/already exists/u);
  });
});

describe("F-067 hatch", () => {
  it("builds solid/line patterns, classifies islands and holes and records stable boundary handles", () => {
    const document = fixture();
    document.entities.push(
      hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
      hatchBoundaryPolyline("21", "0", [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }]),
    );
    const hatch = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["20", "21"], pattern: "ANSI31", angleRad: Math.PI / 4, scale: 2, origin: { x: 5, y: 5 } });
    expect(hatch.loops.map((loop) => loop.isHole)).toEqual([false, true]);
    expect(readHatchAssociation(hatch)).toMatchObject(golden.hatchPattern);
    expect(createHatch(document, { handle: "H2", layerId: "0", boundaryHandles: ["20"], pattern: "SOLID" })).toMatchObject({ pattern: "SOLID", associative: true });
  });

  it("updates an associative hatch in place and fails closed when a boundary disappears", () => {
    const document = fixture();
    const outer = hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    document.entities.push(outer);
    document.entities.push(createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["20"], pattern: "SOLID" }));
    const staged = structuredClone(document);
    staged.entities[1] = hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }]);
    const result = updateAssociativeHatches(staged, ["20"]);
    expect(result).toMatchObject({ updatedHandles: ["H1"], broken: [], changes: [{ entity: { handle: "H1", associative: true } }] });
    const missing = { ...structuredClone(staged), entities: staged.entities.filter((entity) => entity.handle !== "20") };
    expect(updateAssociativeHatches(missing, ["20"]).broken).toEqual([{ hatchHandle: "H1", boundaryHandle: "20", reason: "missing-boundary" }]);
  });

  it("batches dimension and hatch propagation into the geometry command's single Undo/Redo step", () => {
    const document = fixture();
    const boundary = hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    document.entities.push(boundary);
    document.entities.push(createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "DIM-ISO", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 20, y: 60 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 40 } }] }));
    document.entities.push(createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["20"], pattern: "SOLID" }));
    const movedLine: CadEntity = { kind: "line", handle: "10", layerId: "0", start: { x: 5, y: 5 }, end: { x: 105, y: 45 } };
    const movedBoundary = hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }]);
    const staged = structuredClone(document);
    staged.entities = staged.entities.map((entity) => entity.handle === "10" ? movedLine : entity.handle === "20" ? movedBoundary : entity);
    const associations = updateAssociativeAnnotations(staged, ["10", "20"]);
    expect(associations.updatedHandles).toEqual(["D1", "H1"]);
    const session = new CadSession(document);
    session.commit({ opId: "move-with-associations", baseRevision: 0, commandId: "MOVE", args: {}, targetHandles: ["10", "20", "D1", "H1"], resultHandles: ["10", "20", "D1", "H1"] }, [{ type: "put", entity: movedLine }, { type: "put", entity: movedBoundary }, ...associations.changes]);
    expect(session.document.revision).toBe(1);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.find((entity) => entity.handle === "H1")).toMatchObject({ loops: [{ vertices: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }] }] });
  });
});
