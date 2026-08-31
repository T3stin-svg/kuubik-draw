import { describe, expect, it } from "vitest";
import { PrecisionFeatureModel } from "./model.js";

describe("F-052 precision UI wiring", () => {
  it("uses byte-identical preview/commit results and the same result for Dynamic Input", () => {
    const model = new PrecisionFeatureModel();
    const request = {
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 8, y: 6 }, input: "10",
      modes: { polar: { incrementRad: Math.PI / 4 }, grid: { spacingX: 0.1, spacingY: 0.1 }, aperture: 0.2 },
      objectSnapCandidates: [{ kind: "endpoint", priority: 0, point: { x: 7.1, y: 7.1 }, key: "E" }],
    };
    const preview = model.preview(request);
    const commit = model.commit(request);
    const dynamic = model.dynamicInput(request, { linear: "mm", displayPrecision: 3, angularPrecision: 2 });
    expect(preview).toEqual(commit);
    expect(dynamic.point).toEqual(commit.point);
    expect(dynamic).toMatchObject({ source: "osnap", distance: "10.041", angleDeg: "45.00" });
  });
});
