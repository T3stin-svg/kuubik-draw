import { createEmptyDocument } from "@kuubik/cad-core";
import { addPdfUnderlay, readPdfUnderlays } from "../../cad-core/src/pdf-underlays.js";
import { describe, expect, it } from "vitest";
import { createPdfUnderlayPlacement, exportLayoutsVectorPdf, preparePdfUnderlay, renderPdfUnderlayPageSvg } from "../src/index.js";

function twoPagePdf(): Uint8Array {
  const document = createEmptyDocument({ documentId: "pdf-source" });
  const pageSetup = (mediaName: string, orientation: "portrait" | "landscape") => ({
    mediaName,
    orientation,
    plotArea: { kind: "layout" as const },
    plotScale: { mode: "fit" as const },
    centerPlot: false,
    plotOriginMm: { x: 0, y: 0 },
  });
  document.layouts.push(
    { id: "a4", name: "A4", kind: "paper", paper: { widthMm: 210, heightMm: 297, marginsMm: { top: 0, right: 0, bottom: 0, left: 0 } }, pageSetup: pageSetup("ISO_A4_(210.00_x_297.00_MM)", "portrait"), viewports: [], entities: [{ kind: "line", handle: "A4-L", layerId: "0", start: { x: 10, y: 10 }, end: { x: 200, y: 287 } }] },
    { id: "a3", name: "A3", kind: "paper", paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 0, right: 0, bottom: 0, left: 0 } }, pageSetup: pageSetup("ISO_A3_(420.00_x_297.00_MM)", "landscape"), viewports: [], entities: [{ kind: "text", handle: "A3-T", layerId: "0", position: { x: 25, y: 270 }, height: 12, text: "F-115 PAGE 2", rotationRad: 0 }] },
  );
  return exportLayoutsVectorPdf(document, ["a4", "a3"]).bytes;
}

describe("F-115 PDF underlay import", () => {
  it("hashes, inspects and attaches an immutable PDF page descriptor", async () => {
    const prepared = await preparePdfUnderlay(twoPagePdf(), { attachmentId: "pdf-1", fileName: "reference.pdf" });
    expect(prepared.inspection.pages.map((page) => [Math.round(page.widthMm), Math.round(page.heightMm)])).toEqual([[210, 297], [420, 297]]);
    expect(prepared.attachment.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const document = addPdfUnderlay(createEmptyDocument({ documentId: "target" }), {
      attachment: prepared.attachment,
      placement: createPdfUnderlayPlacement(prepared, {
        id: "underlay-1",
        pageNumber: 2,
        position: { x: 25, y: 40 },
        rotationRad: Math.PI / 2,
        opacity: 0.6,
        fadePercent: 25,
        layerId: "0",
        referencePath: "references/reference.pdf",
        referenceMode: "linked-copy",
        clipBoundary: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      }),
    });
    expect(readPdfUnderlays(document)).toEqual([expect.objectContaining({ id: "underlay-1", pageNumber: 2, opacity: 0.6, fadePercent: 25, layerId: "0", referencePath: "references/reference.pdf" })]);
    expect(document.attachments).toEqual([prepared.attachment]);
    expect(() => createPdfUnderlayPlacement(prepared, { id: "missing", pageNumber: 3 })).toThrow(/outside 1\.\.2/u);
  });

  it("rejects active content and encrypted inputs before attachment creation", async () => {
    const base = new TextDecoder("latin1").decode(twoPagePdf());
    await expect(preparePdfUnderlay(new TextEncoder().encode(base.replace("/Type /Catalog", "/Type /Catalog /OpenAction << /S /JavaScript >>")), { attachmentId: "bad", fileName: "bad.pdf" }))
      .rejects.toThrow(/active content/u);
    await expect(preparePdfUnderlay(new TextEncoder().encode(base.replace("trailer", "trailer\n/Encrypt 99 0 R")), { attachmentId: "bad", fileName: "bad.pdf" }))
      .rejects.toThrow(/Encrypted PDFs/u);
  });

  it("validates clip, fade, path and page rotation metadata before placement", async () => {
    const base = new TextDecoder("latin1").decode(twoPagePdf());
    const rotated = new TextEncoder().encode(base.replace("/Type /Page /Parent", "/Type /Page /Rotate 90 /Parent"));
    const prepared = await preparePdfUnderlay(rotated, { attachmentId: "rotated", fileName: "rotated.pdf" });
    expect(prepared.inspection.pages[0]).toMatchObject({ rotationDeg: 90, widthMm: expect.any(Number), heightMm: expect.any(Number) });
    expect(() => createPdfUnderlayPlacement(prepared, { id: "bad-fade", pageNumber: 1, fadePercent: 101 })).toThrow(/fade/u);
    expect(() => createPdfUnderlayPlacement(prepared, { id: "bad-clip", pageNumber: 1, clipBoundary: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }] })).toThrow(/clip/u);
    expect(() => createPdfUnderlayPlacement(prepared, { id: "bad-path", pageNumber: 1, referencePath: "bad\u0000.pdf" })).toThrow(/path/u);
  });

  it("renders an inert SVG preview for an uncompressed selected page", () => {
    const rendered = renderPdfUnderlayPageSvg(twoPagePdf(), 2);
    expect(rendered).toMatchObject({ pageNumber: 2, operatorCount: expect.any(Number) });
    expect(rendered.operatorCount).toBeGreaterThan(5);
    expect(rendered.svg).toContain("F-115 PAGE 2");
    expect(rendered.svg).toContain("<text");
    expect(rendered.svg).not.toContain("<script");
  });
});
