import { describe, expect, it } from "vitest";
import { createGeometryPreview, hitTestGeometryPreview } from "../src/geometry-preview.js";

describe("geometry preview", () => {
  it("uses the committed entity representation for preview and hit-testing", () => {
    const entities = [{ kind: "circle", handle: "10", layerId: "0", center: { x: 5, y: 5 }, radius: 3 }] as const;
    const preview = createGeometryPreview("CIRCLE", entities);
    expect(preview.entities).toEqual(entities);
    const hit = hitTestGeometryPreview(preview, { x: 8.1, y: 5 }, 0.2);
    expect(hit).toMatchObject({ handle: "10" });
    expect(hit?.distance).toBeCloseTo(0.1, 12);
  });

  it("rejects duplicate preview handles", () => {
    const duplicate = [
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
    ] as const;
    expect(() => createGeometryPreview("LINE", duplicate)).toThrow(/duplicated/);
  });
});
