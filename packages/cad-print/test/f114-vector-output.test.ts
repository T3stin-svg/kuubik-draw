import { describe, expect, it } from "vitest";
import { createF114Document, F114_LAYOUT_IDS, F114_LAYOUT_NAMES } from "../../../parity/fixtures/f114-document.js";
import { exportLayoutsVectorPdf, readPdfSummary } from "../src/index.js";

const decode = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

describe("F-114 mixed-size vector PDF", () => {
  it("writes deterministic A3-landscape and A4-portrait vector pages", () => {
    const document = createF114Document();
    const first = exportLayoutsVectorPdf(document, F114_LAYOUT_IDS);
    const second = exportLayoutsVectorPdf(structuredClone(document), F114_LAYOUT_IDS);
    expect(second.bytes).toEqual(first.bytes);
    expect(first.skippedHandles).toEqual([]);
    expect(first.pages.map((page) => page.layoutId)).toEqual([...F114_LAYOUT_IDS]);
    expect(first.pages.map((page) => [page.placement.paper.widthMm, page.placement.paper.heightMm])).toEqual([[420, 297], [210, 297]]);
    expect(readPdfSummary(first.bytes)).toEqual({ version: "1.4", pages: 2, vectorStrokeCommands: 4, hasXref: true, xrefOffsetsValid: true });

    const pdf = decode(first.bytes);
    expect(pdf.match(/\/MediaBox \[0 0 1190\.551181 841\.889764\]/gu)).toHaveLength(1);
    expect(pdf.match(/\/MediaBox \[0 0 595\.275591 841\.889764\]/gu)).toHaveLength(1);
    expect(pdf.indexOf(`(${F114_LAYOUT_NAMES[0]}) Tj`)).toBeGreaterThan(0);
    expect(pdf.indexOf(`(${F114_LAYOUT_NAMES[1]}) Tj`)).toBeGreaterThan(pdf.indexOf(`(${F114_LAYOUT_NAMES[0]}) Tj`));
    expect(pdf).toContain("(KUUBIK F-114 VECTOR PDF) Tj");
    expect(pdf).toContain("1 0 0 RG 1 0 0 rg");
    expect(pdf).toContain("0 0 1 RG 0 0 1 rg");
    expect(pdf).toContain("/GS60 gs");
    expect(pdf).not.toContain("/Subtype /Image");
  });
});
