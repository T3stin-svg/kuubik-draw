import { describe, expect, it } from "vitest";
import { CadObjectTrack } from "../src/tracking.js";

describe("OTRACK mutation guards", () => {
  it("kills angle-index, acquisition-order, duplicate-line and release-state mutations", () => {
    const track = new CadObjectTrack();
    track.acquire("A", { x: 0, y: 0 }, 1);
    const candidates = track.candidates({ x: 10, y: 0 }, 0, [0, Math.PI, Math.PI * 2]);
    expect(candidates).toEqual([{
      id: "otrack:polar:A:0.0000000000000000", key: "otrack:polar:A:0.0000000000000000",
      kind: "otrack", mode: "polar-extension", point: { x: 10, y: 0 }, priority: 100,
      acquiredKeys: ["A"], angleRad: 0,
    }]);
    expect(track.releaseReadback("A")).toMatchObject({ changed: true, acquired: [] });
    expect(track.candidates({ x: 10, y: 0 }, 0)).toEqual([]);
  });
});
