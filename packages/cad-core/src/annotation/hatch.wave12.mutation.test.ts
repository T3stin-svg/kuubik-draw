import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readHatchAssociation } from "./contracts.js";
import { requiredAnnotationBlockDxfCapabilities } from "./dxf-capability.js";
import { createHatch, editHatch, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "hatch-wave12-mutation" });
  document.entities.push(
    hatchBoundaryPolyline("A0", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
    hatchBoundaryPolyline("11", "0", [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }]),
    hatchBoundaryPolyline("12", "0", [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]),
  );
  return document;
}

describe("F-067 HATCH mutation ratchet", () => {
  it("kills always-Normal, Outer-depth-two and Ignore-hole mutants", () => {
    const document = fixture();
    expect(createHatch(document, { handle: "20", layerId: "0", boundaryHandles: ["A0", "11", "12"], pattern: "SOLID", islandDetection: "normal" }).loops.map((loop) => loop.isHole)).toEqual([false, true, false]);
    expect(createHatch(document, { handle: "21", layerId: "0", boundaryHandles: ["A0", "11", "12"], pattern: "SOLID", islandDetection: "outer" }).loops.map((loop) => loop.isHole)).toEqual([false, true]);
    expect(createHatch(document, { handle: "22", layerId: "0", boundaryHandles: ["A0", "11", "12"], pattern: "SOLID", islandDetection: "ignore" }).loops.map((loop) => loop.isHole)).toEqual([false]);
  });

  it("kills property reset, handle replacement and case-sensitive association mutants", () => {
    const document = fixture();
    const hatch = createHatch(document, { handle: "20", layerId: "0", boundaryHandles: ["A0", "11"], pattern: "ANSI31", angleRad: 0.7, scale: 2.25, origin: { x: 3, y: 4 }, islandDetection: "outer" });
    document.entities.push(hatch);
    const edited = editHatch(document, "20", { scale: 4 });
    if (edited.type !== "put") throw new Error("Expected HATCH edit.");
    expect(edited.entity.handle).toBe("20");
    expect(readHatchAssociation(edited.entity)).toMatchObject({ islandDetection: "outer", pattern: { angleRad: 0.7, scale: 4, origin: { x: 3, y: 4 } }, boundaryHandles: ["A0", "11"] });
    document.entities[0] = hatchBoundaryPolyline("A0", "0", [{ x: -5, y: 0 }, { x: 105, y: 0 }, { x: 105, y: 100 }, { x: -5, y: 100 }]);
    expect(updateAssociativeHatches(document, ["a0"]).updatedHandles).toEqual(["20"]);
  });

  it("kills malformed-extension fail-open mutants in update and DXF capability paths", () => {
    const document = fixture();
    const hatch = createHatch(document, { handle: "20", layerId: "0", boundaryHandles: ["A0"], pattern: "SOLID" });
    (hatch.extensionData!["kuubik.annotation.v1"] as { boundaryHandles: string[] }).boundaryHandles = ["A0", "a0"];
    document.entities.push(hatch);
    expect(readHatchAssociation(hatch)).toBeNull();
    expect(() => updateAssociativeHatches(document, ["A0"])).toThrow(/Malformed associative HATCH/u);
    expect(() => requiredAnnotationBlockDxfCapabilities(document)).toThrow(/Malformed HATCH extension/u);
  });
});
