import { describe, expect, it } from "vitest";
import { generateCadSnapCandidates } from "../src/snap.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("complete OSNAP seeded property coverage", () => {
  it("keeps 2,000 candidate sets finite, ordered, unique and clone-stable", () => {
    const random = seeded(0x534e4150);
    const modes = ["endpoint", "midpoint", "center", "quadrant", "intersection", "extension", "insertion", "perpendicular", "tangent", "nearest", "geometricCenter", "parallel"] as const;
    for (let index = 0; index < 2_000; index += 1) {
      const x = (random() - 0.5) * 1e6;
      const y = (random() - 0.5) * 1e6;
      const length = random() * 1e4 + 1;
      const entities = [
        { kind: "line" as const, handle: `L${index}`, layerId: "0", start: { x, y }, end: { x: x + length, y } },
        { kind: "circle" as const, handle: `C${index}`, layerId: "0", center: { x: x + length / 2, y: y + length }, radius: length / 4 },
        { kind: "polyline" as const, handle: `P${index}`, layerId: "0", closed: true, vertices: [{ x, y }, { x: x + length, y }, { x: x + length, y: y + length }, { x, y: y + length }] },
      ];
      const options = { modes, cursor: { x: x + length * 1.25, y: y + length * 0.1 }, aperture: length * 4, referencePoint: { x, y: y + length * 2 } };
      const first = generateCadSnapCandidates(entities, options);
      const second = generateCadSnapCandidates(structuredClone(entities), structuredClone(options));
      expect(second).toEqual(first);
      expect(new Set(first.map((candidate) => candidate.id)).size).toBe(first.length);
      expect(first.map((candidate) => candidate.priority)).toEqual([...first.map((candidate) => candidate.priority)].sort((a, b) => a - b));
      expect(first.every((candidate) => [candidate.point.x, candidate.point.y, candidate.distance].every(Number.isFinite))).toBe(true);
    }
  });
});
