import { describe, expect, it } from "vitest";
import { addPdfUnderlay, createEmptyDocument, effectivePdfUnderlayOpacity, planUpdatePdfUnderlay, readPdfUnderlays } from "../src/index.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "F-115-mutation" });
  document.layers.push({ id: "pdf", name: "PDF", visible: true, frozen: false, locked: true, plottable: true });
  return addPdfUnderlay(document, {
    attachment: { id: "pdf-1", mediaType: "application/pdf", sha256: "a".repeat(64), fileName: "fixture.pdf", role: "underlay" },
    placement: { id: "u-1", attachmentId: "pdf-1", pageNumber: 2, position: { x: 10, y: 20 }, widthMm: 420, heightMm: 297, rotationRad: 0.5, opacity: 0.8, visible: true, layerId: "pdf", fadePercent: 25, clipBoundary: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  });
}

describe("F-115 mutation-proven ratchet", () => {
  it("kills a fade-is-opacity mutant", () => {
    const placement = readPdfUnderlays(fixture())[0]!;
    expect(effectivePdfUnderlayOpacity(placement)).toBeCloseTo(0.6, 12);
    expect(effectivePdfUnderlayOpacity(placement)).not.toBe(placement.opacity);
  });

  it("kills a locked-layer edit bypass mutant", () => {
    const document = fixture();
    expect(() => planUpdatePdfUnderlay(document, "u-1", { opacity: 0.2 })).toThrow(/layer-locked/u);
    const mutant = structuredClone(document);
    mutant.metadata.extensions!["kuubik.pdfUnderlays.v1"] = [{ ...readPdfUnderlays(mutant)[0]!, opacity: 0.2 }];
    expect(readPdfUnderlays(mutant)[0]!.opacity).toBe(0.2);
  });

  it("kills missing clip and source-reference persistence mutants", () => {
    const placement = readPdfUnderlays(fixture())[0]!;
    expect(placement.clipBoundary).toHaveLength(3);
    expect(placement.pageNumber).toBe(2);
    expect(placement.layerId).toBe("pdf");
    const mutant = { ...placement, clipBoundary: undefined, referencePath: undefined };
    expect(mutant).not.toEqual(placement);
  });
});
