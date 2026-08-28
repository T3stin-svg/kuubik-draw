import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RTreeIndex } from "../src/index.js";

describe("RTreeIndex", () => {
  it("returns only intersecting handles", () => {
    const index = new RTreeIndex(4);
    index.load([
      { handle: "a", minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { handle: "b", minX: 100, minY: 100, maxX: 110, maxY: 110 },
    ]);
    expect(index.search({ minX: 5, minY: 5, maxX: 6, maxY: 6 }).map((item) => item.handle)).toEqual(["a"]);
  });

  it("queries 50,000 synthetic entities under the selection budget", () => {
    const index = new RTreeIndex();
    index.load(
      Array.from({ length: 50_000 }, (_, number) => {
        const x = number % 500;
        const y = Math.floor(number / 500);
        return { handle: String(number), minX: x, minY: y, maxX: x + 0.5, maxY: y + 0.5 };
      }),
    );
    const start = performance.now();
    const matches = index.search({ minX: 200, minY: 20, maxX: 210, maxY: 30 });
    const elapsedMs = performance.now() - start;
    expect(matches.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(100);
  });
});
