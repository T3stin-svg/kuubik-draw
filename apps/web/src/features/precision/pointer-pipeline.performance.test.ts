import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

describe("50,000-object typed precision regression", () => {
  it("keeps indexed direct-distance snap frames bounded and preview-identical", () => {
    const document = createEmptyDocument({ documentId: "precision-50k" });
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const,
      handle: index.toString(16).toUpperCase(),
      layerId: "0",
      start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
      end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
    }));
    const buildStarted = performance.now();
    const contract = new PrecisionLayersShellContract(document, {
      settings: {
        polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1,
        aperture: 999, aperturePixels: 10, worldUnitsPerCssPixel: 0.025,
      },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
      initialPrecision: { ortho: true, snap: true, osnap: true, otrack: true },
    });
    const buildMs = performance.now() - buildStarted;
    const timings: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      const resolved = contract.preparePointer({ basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.1, y: 0.01 }, input: "5" }).resolve();
      timings.push(performance.now() - started);
      expect(resolved.preview).toEqual(resolved.commit);
      expect(resolved.commit).toMatchObject({ source: "osnap", point: { x: 0, y: 0 } });
    }
    const sorted = [...timings].sort((first, second) => first - second);
    const p95Ms = sorted[Math.floor(sorted.length * 0.95)]!;
    const zero = contract.preparePointer({ basePoint: { x: 123.25, y: 456.75 }, cursorPoint: { x: 0, y: 0 }, input: "0" }).resolve();
    expect(zero.commit).toMatchObject({ source: "direct-distance", point: { x: 123.25, y: 456.75 } });
    expect(zero.snapCandidateIds).toEqual([]);
    expect(buildMs).toBeLessThan(5_000);
    expect(p95Ms).toBeLessThan(100);
  });
});
