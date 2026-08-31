import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareRevcloudCommand } from "../src/revcloud-command.js";

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

describe("F-011 REVCLOUD golden", () => {
  it("matches the versioned rectangular bulge fixture", () => {
    const golden = JSON.parse(readFileSync(new URL("./f011-revcloud.golden.json", import.meta.url), "utf8"));
    const document = createEmptyDocument({ documentId: "F-011-golden" });
    document.layers.push({ id: "REV", name: "REV", visible: true, frozen: false, locked: false, plottable: true });
    const prepared = prepareRevcloudCommand(document, {
      command: "REVCLOUD", handle: "11", layerId: "REV",
      construction: { mode: "rectangular", firstCorner: { x: 0, y: 0 }, oppositeCorner: { x: 40, y: 20 } },
      arcLengths: { minimum: 10, maximum: 20 },
    });
    expect({
      handle: prepared.entity.handle,
      layerId: prepared.entity.layerId,
      closed: prepared.entity.closed,
      direction: prepared.normalized.direction,
      winding: prepared.normalized.winding,
      vertices: prepared.entity.vertices.map((vertex) => ({ x: rounded(vertex.x), y: rounded(vertex.y), bulge: rounded(vertex.bulge!) })),
    }).toEqual(golden);
  });
});
