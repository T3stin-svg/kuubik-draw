import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readHatchAssociation } from "./contracts.js";
import { createHatch, editHatch, evaluateHatchCapability, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";

function nestedFixture() {
  const document = createEmptyDocument({ documentId: "hatch-wave12", now: "2026-08-31T23:00:00.000Z" });
  document.entities.push(
    hatchBoundaryPolyline("P0", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
    hatchBoundaryPolyline("P1", "0", [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }]),
    hatchBoundaryPolyline("P2", "0", [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]),
  );
  return document;
}

describe("F-067 HATCH AutoCAD-style completion", () => {
  it("implements Normal, Outer and Ignore island detection deterministically", () => {
    const document = nestedFixture();
    const boundaryHandles = ["P0", "P1", "P2"];
    const normal = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles, pattern: "SOLID", islandDetection: "normal" });
    const outer = createHatch(document, { handle: "H2", layerId: "0", boundaryHandles, pattern: "SOLID", islandDetection: "outer" });
    const ignore = createHatch(document, { handle: "H3", layerId: "0", boundaryHandles, pattern: "SOLID", islandDetection: "ignore" });
    expect(normal.loops.map((loop) => loop.isHole)).toEqual([false, true, false]);
    expect(outer.loops.map((loop) => loop.isHole)).toEqual([false, true]);
    expect(ignore.loops.map((loop) => loop.isHole)).toEqual([false]);
    expect([normal, outer, ignore].map((entity) => readHatchAssociation(entity)?.islandDetection)).toEqual(["normal", "outer", "ignore"]);
  });

  it("edits boundary, pattern and associativity under the same handle without mutating the source", () => {
    const document = nestedFixture();
    const hatch = createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["P0", "P1", "P2"], pattern: "ANSI31", angleRad: 0.25, scale: 2, origin: { x: 3, y: 4 }, associative: true, islandDetection: "normal" });
    hatch.appearance = { color: "#123456", transparency: 20 };
    hatch.extensionData = { ...hatch.extensionData, "kuubik.test": { keep: true } };
    document.entities.push(hatch);
    const before = structuredClone(document);
    const change = editHatch(document, "h1", { boundaryHandles: ["p0", "P1", "p1"], pattern: "SOLID", angleRad: 0.75, scale: 4, origin: { x: 8, y: 9 }, associative: false, islandDetection: "ignore" });
    expect(document).toEqual(before);
    if (change.type !== "put") throw new Error("Expected HATCH put change.");
    expect(change.entity).toMatchObject({ kind: "hatch", handle: "H1", pattern: "SOLID", associative: false, appearance: hatch.appearance, loops: [{ isHole: false }] });
    expect(change.entity.extensionData?.["kuubik.test"]).toEqual({ keep: true });
    expect(readHatchAssociation(change.entity)).toMatchObject({
      kind: "hatch", islandDetection: "ignore", pattern: { type: "solid", angleRad: 0.75, scale: 4, origin: { x: 8, y: 9 } }, boundaryHandles: ["P0", "P1"],
    });
  });

  it("fails closed for locked, off and frozen target or boundary layers", () => {
    for (const state of ["locked", "off", "frozen"] as const) {
      const document = nestedFixture();
      document.layers.push({ id: state, name: state, visible: state !== "off", frozen: state === "frozen", locked: state === "locked", plottable: true });
      document.entities.push(hatchBoundaryPolyline(`B-${state}`, state, [{ x: 200, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 10 }, { x: 200, y: 10 }]));
      expect(() => createHatch(document, { handle: `HT-${state}`, layerId: state, boundaryHandles: ["P0"], pattern: "SOLID" })).toThrow(new RegExp(`${state === "off" ? "off" : state} layer`, "u"));
      expect(() => createHatch(document, { handle: `HB-${state}`, layerId: "0", boundaryHandles: [`B-${state}`], pattern: "SOLID" })).toThrow(new RegExp(`${state === "off" ? "off" : state} layer`, "u"));
      const hatch = createHatch(document, { handle: `H-${state}`, layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID" });
      document.entities.push(hatch);
      const boundary = document.entities.find((entity) => entity.handle === "P0")!;
      boundary.layerId = state;
      expect(evaluateHatchCapability(document, hatch.handle)).toEqual({ executable: false, code: state === "locked" ? "locked-layer" : state === "off" ? "off-layer" : "frozen-layer", handle: state });
      expect(() => updateAssociativeHatches(document, ["P0"])).toThrow(new RegExp(`${state === "off" ? "off" : state} layer`, "u"));
    }
  });

  it("rejects malformed runtime variants and case-insensitive handle collisions", () => {
    const document = nestedFixture();
    document.entities.push(createHatch(document, { handle: "Case", layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID" }));
    expect(() => createHatch(document, { handle: "case", layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID" })).toThrow(/duplicate hatch handle/u);
    expect(() => createHatch(document, { handle: "H2", layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID", islandDetection: "through" as never })).toThrow(/island detection/u);
    expect(() => createHatch(document, { handle: "H3", layerId: "0", boundaryHandles: ["P0"], pattern: "SOLID", associative: "yes" as never })).toThrow(/pattern settings/u);
    expect(() => editHatch(document, "Case", { scale: null as never })).toThrow(/pattern settings/u);
    const corrupt = structuredClone(document.entities.find((entity) => entity.handle === "Case")!);
    (corrupt.extensionData!["kuubik.annotation.v1"] as { islandDetection?: unknown }).islandDetection = null;
    expect(readHatchAssociation(corrupt)).toBeNull();
  });
});
