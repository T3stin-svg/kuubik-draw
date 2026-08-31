import { describe, expect, it } from "vitest";
import { CAD_OSNAP_PRIORITY, CadSnapIndex, CadSnapSelectionCycle, generateCadSnapCandidates } from "../src/snap.js";

describe("complete OSNAP mutation guards", () => {
  it("kills missing mode, unstable-ID, duplicate and cycling mutations", () => {
    expect(Object.keys(CAD_OSNAP_PRIORITY)).toEqual([
      "endpoint", "midpoint", "center", "quadrant", "intersection", "apparentIntersection",
      "extension", "insertion", "perpendicular", "tangent", "nearest", "geometricCenter", "parallel",
    ]);
    const entity = { kind: "line" as const, handle: "L", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const candidates = generateCadSnapCandidates([entity], { modes: ["endpoint", "extension", "parallel"], cursor: { x: 20, y: 10 }, aperture: 30, referencePoint: { x: 0, y: 10 } });
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "endpoint:L:1:10.000000000000000,0.0000000000000000",
      "endpoint:L:0:0.0000000000000000,0.0000000000000000",
      "extension:L:0:end:20.000000000000000,0.0000000000000000",
      "parallel:L:0:1.0000000000000000,0.0000000000000000:20.000000000000000,10.000000000000000",
    ]);
    const cycle = new CadSnapSelectionCycle();
    cycle.update(candidates);
    expect(() => cycle.cycle(candidates, 0)).toThrow("non-zero");
    expect(() => cycle.select(candidates, "missing")).toThrow("not available");
    expect(cycle.cycle(candidates, candidates.length).candidateId).toBe(candidates[0]!.id);
    expect(() => generateCadSnapCandidates([entity], {
      modes: ["bogus" as never], cursor: { x: 0, y: 0 }, aperture: 1,
    })).toThrow("Unsupported OSNAP mode");
    const index = new CadSnapIndex();
    expect(() => index.setEntities([entity, { ...entity }])).toThrow("Duplicate entity handles");
  });
});
