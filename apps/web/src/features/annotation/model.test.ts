import { describe, expect, it } from "vitest";
import { ANNOTATION_TOOLS, createAnnotationAction } from "./model.js";

describe("annotation feature contract", () => {
  it("covers F-057..F-068 in the required work order", () => {
    const rows = new Set(ANNOTATION_TOOLS.flatMap((tool) => tool.rowIds));
    expect(Array.from({ length: 12 }, (_, index) => `F-${String(index + 57).padStart(3, "0")}`).every((row) => rows.has(row))).toBe(true);
    expect(ANNOTATION_TOOLS.find((tool) => tool.id === "HATCH")?.rowIds).toEqual(["F-067", "F-068"]);
    expect(ANNOTATION_TOOLS.find((tool) => tool.id === "TABLE")?.rowIds).toEqual(["F-069"]);
    expect(ANNOTATION_TOOLS.slice(0, 8).map((tool) => tool.id)).toEqual(["DIMLINEAR", "DIMALIGNED", "DIMANGULAR", "DIMRADIUS", "DIMDIAMETER", "DIMCONTINUE", "DIMBASELINE", "DIMSTYLE"]);
  });

  it("normalizes selection and fails closed for selection-incompatible commands", () => {
    expect(createAnnotationAction("HATCH", [" 10 ", "10", "20"])).toEqual({ commandId: "HATCH", selectedHandles: ["10", "20"] });
    expect(() => createAnnotationAction("HATCH", [])).toThrow(/requires a selection/u);
    expect(createAnnotationAction("STYLE", ["10"])).toEqual({ commandId: "STYLE", selectedHandles: ["10"] });
    expect(createAnnotationAction("TABLE", ["T1"])).toEqual({ commandId: "TABLE", selectedHandles: ["T1"] });
  });
});
