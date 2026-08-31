import { describe, expect, it } from "vitest";
import { CadObjectTrack } from "../src/tracking.js";

describe("complete OTRACK acquisition and polar extension", () => {
  it("returns exact acquisition/release read-back and stable polar candidates", () => {
    const track = new CadObjectTrack();
    expect(track.acquire("B", { x: 20, y: 0 }, 2)).toEqual({ key: "B", point: { x: 20, y: 0 }, acquiredAt: 2 });
    expect(track.acquire("A", { x: 0, y: 0 }, 1)).toEqual({ key: "A", point: { x: 0, y: 0 }, acquiredAt: 1 });
    expect(track.acquired.map((item) => item.key)).toEqual(["A", "B"]);
    const candidates = track.candidates({ x: 10, y: 10.1 }, 0.2, [Math.PI / 4, Math.PI + Math.PI / 4]);
    expect(candidates).toEqual([
      expect.objectContaining({
        id: `otrack:polar:A:${(Math.PI / 4).toPrecision(17)}`,
        key: `otrack:polar:A:${(Math.PI / 4).toPrecision(17)}`,
        mode: "polar-extension", acquiredKeys: ["A"], point: { x: 10.05, y: 10.049999999999999 },
      }),
    ]);
    expect(track.releaseReadback("A")).toEqual({ changed: true, acquired: [{ key: "B", point: { x: 20, y: 0 }, acquiredAt: 2 }] });
    expect(track.releaseReadback("A")).toEqual({ changed: false, acquired: [{ key: "B", point: { x: 20, y: 0 }, acquiredAt: 2 }] });
    expect(track.clearReadback()).toEqual({ changed: true, acquired: [] });
    expect(track.clearReadback()).toEqual({ changed: false, acquired: [] });
  });

  it("produces canonical two-line intersections independent of acquisition order", () => {
    const first = new CadObjectTrack();
    first.acquire("B", { x: 20, y: 0 }, 2);
    first.acquire("A", { x: 0, y: 10 }, 1);
    const second = new CadObjectTrack();
    second.acquire("A", { x: 0, y: 10 }, 9);
    second.acquire("B", { x: 20, y: 0 }, 8);
    const firstCandidates = first.candidates({ x: 20.1, y: 10.1 }, 0.2, [Math.PI / 2, 0]);
    const secondCandidates = second.candidates({ x: 20.1, y: 10.1 }, 0.2, [0, Math.PI / 2, Math.PI]);
    expect(secondCandidates).toEqual(firstCandidates);
    expect(firstCandidates[0]).toMatchObject({
      id: expect.stringMatching(/^otrack:intersection:/u), mode: "intersection",
      point: { x: 20, y: 10 }, acquiredKeys: ["A", "B"], priority: 90,
    });
  });
});
