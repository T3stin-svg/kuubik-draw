import { describe, expect, it } from "vitest";
import { profileCadSpatialIndexes } from "../src/selection-index.js";
import { CadObjectTrack } from "../src/tracking.js";

describe("F-051 OTRACK", () => {
  it("acquires stable points and produces projected and two-ray intersection candidates", () => {
    const track = new CadObjectTrack();
    track.acquire("A", { x: 0, y: 10 }, 1);
    track.acquire("B", { x: 20, y: 0 }, 2);
    const candidates = track.candidates({ x: 20.2, y: 10.1 }, 0.5);
    expect(candidates.some((item) => item.acquiredKeys.join(",") === "A,B" && item.point.x === 20 && Math.abs(item.point.y - 10) < 1e-12)).toBe(true);
    expect(track.release("A")).toBe(true);
    expect(track.acquired.map((item) => item.key)).toEqual(["B"]);
  });
});

describe("50,000 object snap/selection performance", () => {
  it("indexes 50,000 entities and keeps local selection/snap candidate work bounded", () => {
    const entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const,
      handle: index.toString(16).toUpperCase(),
      layerId: "0",
      start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
      end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
    }));
    const result = profileCadSpatialIndexes(entities, {
      selectionPoint: { x: 5, y: 0 }, selectionTolerance: 6,
      snap: { modes: ["endpoint", "midpoint", "nearest", "intersection"], cursor: { x: 5, y: 0 }, aperture: 6 },
    });
    expect(result.selection[0]?.handle).toBe("0");
    expect(result.snaps.length).toBeLessThan(20);
    expect(result.profile).toMatchObject({ entityCount: 50_000, selectionHits: 1, snapCandidates: result.snaps.length });
    expect(result.profile.selectionBuildMs + result.profile.snapBuildMs).toBeLessThan(5_000);
    expect(result.profile.queryMs).toBeLessThan(100);
  });
});
