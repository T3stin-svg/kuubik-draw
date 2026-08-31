import { describe, expect, it } from "vitest";
import { ANNOTATION_TOOLS, createAnnotationAction } from "./model.js";

describe("annotation feature contract", () => {
  it("covers F-057..F-068 in the required work order", () => {
    expect(new Set(ANNOTATION_TOOLS.flatMap((tool) => tool.rowIds))).toEqual(new Set(Array.from({ length: 12 }, (_, index) => `F-${String(index + 57).padStart(3, "0")}`)));
    expect(ANNOTATION_TOOLS.slice(0, 7).map((tool) => tool.id)).toEqual(["DIMLINEAR", "DIMALIGNED", "DIMANGULAR", "DIMRADIUS", "DIMDIAMETER", "DIMCONTINUE", "DIMSTYLE"]);
  });

  it("normalizes selection and fails closed for selection-incompatible commands", () => {
    expect(createAnnotationAction("HATCH", [" 10 ", "10", "20"])).toEqual({ commandId: "HATCH", selectedHandles: ["10", "20"] });
    expect(() => createAnnotationAction("HATCH", [])).toThrow(/requires a selection/u);
    expect(() => createAnnotationAction("STYLE", ["10"])).toThrow(/does not accept/u);
  });
});
