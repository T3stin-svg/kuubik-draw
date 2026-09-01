import { describe, expect, it } from "vitest";
import { addPdfUnderlay, createEmptyDocument, effectivePdfUnderlayOpacity, readPdfUnderlays } from "../src/index.js";

function next(seed: number): number { return (seed * 1664525 + 1013904223) >>> 0; }

describe("F-115 deterministic property matrix", () => {
  it("roundtrips 256 finite page/transform/fade/clip combinations", () => {
    let seed = 0xF1152026;
    for (let index = 0; index < 256; index += 1) {
      seed = next(seed); const opacity = (seed % 101) / 100;
      seed = next(seed); const fadePercent = seed % 101;
      seed = next(seed); const scale = 0.01 + (seed % 10000) / 100;
      seed = next(seed); const rotationRad = ((seed % 720) - 360) * Math.PI / 180;
      const attachment = { id: `pdf-${index}`, mediaType: "application/pdf", sha256: index.toString(16).padStart(64, "0"), fileName: `fixture-${index}.pdf`, role: "underlay" as const };
      const placement = {
        id: `underlay-${index}`, attachmentId: attachment.id, pageNumber: 1 + index % 9,
        position: { x: index * -3.25, y: index * 7.5 }, widthMm: 210 * scale, heightMm: 297 * scale,
        rotationRad, opacity, visible: true, layerId: "0", fadePercent,
        clipBoundary: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
        referencePath: `refs/fixture-${index}.pdf`, referenceMode: "linked-copy" as const,
      };
      const result = addPdfUnderlay(createEmptyDocument({ documentId: `property-${index}` }), { attachment, placement });
      expect(readPdfUnderlays(result)).toEqual([placement]);
      expect(effectivePdfUnderlayOpacity(placement)).toBeCloseTo(opacity * (1 - fadePercent / 100), 12);
    }
  });
});
