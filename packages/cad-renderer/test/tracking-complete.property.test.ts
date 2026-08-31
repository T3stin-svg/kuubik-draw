import { describe, expect, it } from "vitest";
import { CadObjectTrack } from "../src/tracking.js";

describe("OTRACK seeded property coverage", () => {
  it("keeps 1,000 reversed acquisition/angle sets clone-stable and finite", () => {
    for (let index = 1; index <= 1_000; index += 1) {
      const angle = (index % 12) * Math.PI / 12;
      const cursor = { x: index * 0.125, y: index * -0.0625 };
      const first = new CadObjectTrack();
      first.acquire("B", { x: index, y: -index }, 2);
      first.acquire("A", { x: -index, y: index }, 1);
      const second = new CadObjectTrack();
      second.acquire("A", { x: -index, y: index }, 10);
      second.acquire("B", { x: index, y: -index }, 20);
      const a = first.candidates(cursor, 1e9, [angle, angle + Math.PI, 0, Math.PI / 2]);
      const b = second.candidates(structuredClone(cursor), 1e9, [Math.PI / 2, 0, angle + Math.PI, angle]);
      expect(b).toEqual(a);
      expect(new Set(a.map((candidate) => candidate.id)).size).toBe(a.length);
      expect(a.every((candidate) => [candidate.point.x, candidate.point.y, candidate.priority].every(Number.isFinite))).toBe(true);
    }
  });
});
