import { createEmptyDocument } from "../document.js";
import { describe, expect, it } from "vitest";
import { ANNOTATION_EXTENSION_KEY, readHatchAssociation } from "./contracts.js";
import { createHatch, evaluateHatchCapability, hatchBoundaryPolyline, updateAssociativeHatches } from "./hatch.js";

describe("F-068 HATCH mutation ratchet", () => {
  it("distinguishes missing and invalid stable-handle boundaries without retargeting", () => {
    const document = createEmptyDocument({ documentId: "f068-lifecycle" });
    document.entities.push(hatchBoundaryPolyline("B", "0", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
    document.entities.push(createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["B"], pattern: "SOLID" }));
    const invalid = structuredClone(document);
    invalid.entities[0] = { kind: "line", handle: "B", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    expect(updateAssociativeHatches(invalid, ["B"]).broken).toEqual([{ hatchHandle: "H", boundaryHandle: "B", reason: "invalid-boundary" }]);
    const missing = structuredClone(document);
    missing.entities.shift();
    expect(updateAssociativeHatches(missing, ["B"]).broken).toEqual([{ hatchHandle: "H", boundaryHandle: "B", reason: "missing-boundary" }]);
    expect(evaluateHatchCapability(missing, "H")).toEqual({ executable: false, code: "orphan-boundary", handle: "B" });
  });

  it("kills malformed version, depth, geometry and non-finite bulge mutants", () => {
    const document = createEmptyDocument({ documentId: "f068-contract-mutants" });
    document.entities.push(hatchBoundaryPolyline("B", "0", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]));
    const hatch = createHatch(document, { handle: "H", layerId: "0", boundaryHandles: ["B"], pattern: "SOLID" });
    const contract = structuredClone(hatch.extensionData![ANNOTATION_EXTENSION_KEY]) as Record<string, unknown>;
    for (const mutation of [
      { ...contract, version: 3 },
      { ...contract, boundaryDepths: [0, 1] },
      { ...contract, boundaryVertices: [[]] },
      { ...contract, boundaryVertices: [[{ x: 0, y: 0, bulge: Number.NaN }, { x: 1, y: 0 }, { x: 1, y: 1 }]] },
    ]) {
      const mutant = { ...hatch, extensionData: { ...hatch.extensionData, [ANNOTATION_EXTENSION_KEY]: mutation } };
      expect(readHatchAssociation(mutant)).toBeNull();
    }
  });
});
