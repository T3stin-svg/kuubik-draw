import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareRevcloudCommand } from "../src/revcloud-command.js";

describe("F-011 REVCLOUD geometry properties", () => {
  it("keeps 96 scaled and translated outlines deterministic, finite, closed and outward/reversible", () => {
    const document = createEmptyDocument({ documentId: "F-011-property" });
    for (let index = 1; index <= 96; index += 1) {
      const width = 20 + index * 1.75;
      const height = 15 + (index % 17) * 2.5;
      const origin = { x: 1_000_000 + index / 7, y: -2_000_000 - index / 11 };
      const input = {
        command: "REVCLOUD" as const,
        handle: `R${index}`,
        layerId: "0",
        construction: { mode: "rectangular" as const, firstCorner: origin, oppositeCorner: { x: origin.x + width, y: origin.y + height } },
        arcLengths: { minimum: 2, maximum: 6 },
        direction: index % 2 ? "normal" as const : "reversed" as const,
      };
      const first = prepareRevcloudCommand(document, input);
      const second = prepareRevcloudCommand(document, structuredClone(input));
      expect(second).toEqual(first);
      expect(first.entity.closed).toBe(true);
      expect(first.entity.vertices.length).toBeGreaterThanOrEqual(3);
      expect(first.entity.vertices.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.bulge))).toBe(true);
      expect(first.entity.vertices.every((vertex) => Math.sign(vertex.bulge!) === (index % 2 ? 1 : -1))).toBe(true);
      expect(first.normalized.generatedChordMaximum).toBeLessThanOrEqual(6 + 1e-8);
      expect(first.resultHandles).toEqual([`R${index}`]);
    }
  });
});
