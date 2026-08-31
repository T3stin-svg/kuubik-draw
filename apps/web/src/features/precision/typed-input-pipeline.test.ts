import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function typedContract() {
  const document = createEmptyDocument({ documentId: "typed-input-wave6" });
  document.entities = [
    { kind: "line", handle: "horizontal", layerId: "0", start: { x: -20, y: 0 }, end: { x: 25, y: 0 } },
    { kind: "line", handle: "vertical", layerId: "0", start: { x: 10, y: -15 }, end: { x: 10, y: 20 } },
  ];
  return new PrecisionLayersShellContract(document, {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 5, gridSpacingY: 5, aperture: 1 },
    units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
    inputFormat: { decimalSeparator: ",", defaultAngleUnit: "deg" },
    initialPrecision: { ortho: true, polar: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
  });
}

describe("F-041/F-042/F-044..F-047 shell pointer pipeline", () => {
  it("normalizes locale/unit input once and preserves exact parsed read-back", () => {
    const contract = typedContract();
    const prepared = contract.preparePointer({
      basePoint: { x: 100, y: 100 }, cursorPoint: { x: 999, y: 999 }, input: "@1,5m;-250,25mm",
    });
    const resolved = prepared.resolve();
    expect(resolved.request.input).toEqual({ kind: "relative-cartesian", delta: { x: 1500, y: -250.25 } });
    expect(resolved.preview).toEqual(resolved.commit);
    expect(resolved.commit).toMatchObject({ source: "typed-cartesian", point: { x: 1600, y: -150.25 } });
    expect(resolved.dynamicInput.point).toEqual(resolved.commit.point);
    expect(resolved.dynamicInput.distanceValue).toBe(Math.hypot(1500, -250.25));
    expect(resolved.snapCandidateIds).toEqual([]);
  });

  it("keeps explicit polar independent of aids and applies all aids to direct distance", () => {
    const contract = typedContract();
    const polar = contract.preparePointer({ basePoint: { x: 5, y: 5 }, cursorPoint: { x: 999, y: 999 }, input: "@10<-90" }).resolve();
    expect(polar.commit.source).toBe("typed-polar");
    expect(polar.commit.point.x).toBeCloseTo(5, 14);
    expect(polar.commit.point.y).toBeCloseTo(-5, 14);
    expect(polar.request.objectSnapCandidates).toEqual([]);
    expect(polar.request.trackingCandidates).toEqual([]);

    const direct = contract.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 4 }, input: "12" }).resolve();
    expect(direct.preview).toEqual(direct.commit);
    expect(direct.commit).toMatchObject({ source: "osnap", point: { x: 10, y: 0 } });
    expect(direct.commit.stages.map(({ stage }) => stage)).toEqual(["ortho", "direct-distance", "grid", "osnap:intersection"]);
    expect(direct.request.objectSnapCandidates?.some(({ kind }) => kind === "intersection")).toBe(true);
  });

  it("returns the exact base for zero distance without GRID/OSNAP inventing movement", () => {
    const contract = typedContract();
    const resolved = contract.preparePointer({ basePoint: { x: 2.5, y: -7.25 }, cursorPoint: { x: 2.5, y: -7.25 }, input: "0" }).resolve();
    expect(resolved.preview).toEqual(resolved.commit);
    expect(resolved.commit).toMatchObject({ source: "direct-distance", point: { x: 2.5, y: -7.25 }, stages: [{ stage: "direct-distance", point: { x: 2.5, y: -7.25 } }] });
    expect(resolved.commit.parsedInput).toEqual({ kind: "direct-distance", distance: 0 });
    expect(resolved.request.objectSnapCandidates).toEqual([]);
    expect(resolved.request.trackingCandidates).toEqual([]);
  });
});
