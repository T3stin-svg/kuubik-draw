import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

describe("F-052 Dynamic Input 50,000-object performance", () => {
  it("keeps 100 pointer-adjacent immutable frames spatially bounded", () => {
    const document = createEmptyDocument({ documentId: "dynamic-50k" });
    document.entities = Array.from({ length: 50_000 }, (_, index) => ({
      kind: "line" as const, handle: `H${index}`, layerId: "0",
      start: { x: (index % 500) * 20, y: Math.floor(index / 500) * 20 },
      end: { x: (index % 500) * 20 + 10, y: Math.floor(index / 500) * 20 },
    }));
    const buildStarted = performance.now();
    const shell = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 999, aperturePixels: 10, worldUnitsPerCssPixel: 0.025 },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
      initialPrecision: { ortho: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
    });
    const coordinate = new PrecisionCoordinateEntryAdapter(new CadSession(document), (input) => shell.preparePointer(input));
    const dynamic = new PrecisionDynamicInputAdapter(coordinate, shell);
    const buildMs = performance.now() - buildStarted;
    const timings: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      const snapshot = dynamic.start(
        { basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.1, y: 0.01 } },
        { x: 500 + index, y: 300 },
      );
      timings.push(performance.now() - started);
      expect(snapshot).toMatchObject({ visible: true, result: { source: "osnap", point: { x: 0, y: 0 } } });
      expect(snapshot.overlay.leftCssPx).toBe(516 + index);
    }
    const sorted = [...timings].sort((a, b) => a - b);
    expect(buildMs).toBeLessThan(5_000);
    expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThan(100);
  });
});
