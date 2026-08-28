import { describe, expect, it } from "vitest";
import { importLegacyDrawProject } from "../src/index.js";

describe("read-only legacy Draw import", () => {
  it("imports only Draw data, preserves unsupported geometry, and never mutates Plan", () => {
    const legacy = {
      name: "Synthetic",
      storeys: [
        {
          id: "s1",
          walls: [{ id: "wall-secret", ax: 0, ay: 0, bx: 10, by: 0 }],
          rooms: [{ id: "room-1" }],
          floors: [
            { k: "element", id: "structural-column" },
            {
              v: 1,
              k: "drawLayers",
              id: "layers",
              layers: [
                { id: "0", name: "0", color: "#ffffff", lwMm: 0.25, lt: "continuous", vis: true, lock: false, plot: true },
                { id: "detail", name: "Detail", color: "#ff0000", lwMm: 0.35, lt: "dashed", vis: true, lock: true, plot: true },
              ],
            },
            {
              v: 1,
              k: "draw",
              id: "drawing",
              ents: [
                { id: "L1", layerId: "detail", g: { t: "line", a: { x: 0.25, y: 1.5 }, b: { x: 50.75, y: 1.5 } } },
                { id: "A1", layerId: "detail", g: { t: "arc", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, bulge: 0.5 } },
              ],
            },
            {
              v: 1,
              k: "drawLayouts",
              id: "layouts",
              layouts: [
                {
                  id: "sheet-a3",
                  name: "A3",
                  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 5, bottom: 5, left: 5 } },
                  viewports: [],
                },
              ],
              pageSetups: [],
            },
          ],
        },
      ],
    };
    const before = structuredClone(legacy);
    const { document, report } = importLegacyDrawProject(legacy, "migrated", "2026-08-28T00:00:00Z");
    expect(legacy).toEqual(before);
    expect(document.entities.map((entity) => entity.kind)).toEqual(["line", "proxy"]);
    expect(JSON.stringify(document)).not.toContain("wall-secret");
    expect(JSON.stringify(document)).not.toContain("room-1");
    expect(report).toMatchObject({
      sourceDrawBlobs: 1,
      importedEntities: 2,
      proxyEntities: 1,
      layers: 2,
      layouts: 2,
      ignoredKinds: ["element"],
      extents: { minX: 0.25, minY: 1.5, maxX: 50.75, maxY: 1.5 },
    });
  });
});
