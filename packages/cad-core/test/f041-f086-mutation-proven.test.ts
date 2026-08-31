import { describe, expect, it } from "vitest";
import { resolvePrecisionPoint } from "../src/precision.js";
import { layerParticipation } from "../src/layer-policy.js";

describe("precision/layer mutation guards", () => {
  it("fails if closest distance is allowed to outrank endpoint OSNAP priority", () => {
    const result = resolvePrecisionPoint({
      basePoint: { x: 0, y: 0 }, cursorPoint: { x: 10, y: 0 }, modes: { aperture: 1 },
      objectSnapCandidates: [
        { kind: "nearest", point: { x: 10.01, y: 0 }, priority: 7, key: "nearest" },
        { kind: "endpoint", point: { x: 10.5, y: 0 }, priority: 0, key: "endpoint" },
      ],
    });
    expect(result.point).toEqual({ x: 10.5, y: 0 });
  });

  it("fails if lock is mutated into hidden or non-snappable behavior", () => {
    const locked = { id: "A", name: "A", visible: true, frozen: false, locked: true, plottable: true };
    expect(layerParticipation(locked, "render").participates).toBe(true);
    expect(layerParticipation(locked, "select").participates).toBe(true);
    expect(layerParticipation(locked, "snap").participates).toBe(true);
    expect(layerParticipation(locked, "print").participates).toBe(true);
    expect(layerParticipation(locked, "edit").participates).toBe(false);
  });
});
