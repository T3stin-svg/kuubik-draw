import { describe, expect, it } from "vitest";
import { CAD_OSNAP_PRIORITY, generateCadSnapCandidates } from "../src/snap.js";

describe("F-050 OSNAP mutation guards", () => {
  it("kills priority, aperture, trim-filter and deterministic-key mutations", () => {
    expect(Object.values(CAD_OSNAP_PRIORITY)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const quarter = {
      kind: "ellipse" as const, handle: "E", layerId: "0", center: { x: 0, y: 0 },
      majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI / 2,
    };
    const first = generateCadSnapCandidates([quarter], {
      modes: ["endpoint", "quadrant", "tangent"], cursor: { x: 10, y: 0 }, aperture: 0, referencePoint: { x: 20, y: 0 },
    });
    const second = generateCadSnapCandidates([structuredClone(quarter)], {
      modes: ["endpoint", "quadrant", "tangent"], cursor: { x: 10, y: 0 }, aperture: 0, referencePoint: { x: 20, y: 0 },
    });
    expect(first).toEqual(second);
    expect(first.map((item) => [item.mode, item.point])).toEqual([
      ["endpoint", { x: 10, y: 0 }],
      ["quadrant", { x: 10, y: 0 }],
    ]);
  });
});
