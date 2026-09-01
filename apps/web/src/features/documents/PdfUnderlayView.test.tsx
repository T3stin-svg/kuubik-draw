import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PdfUnderlayAttachPanel } from "./PdfUnderlayAttachPanel.js";
import { PdfUnderlayView } from "./PdfUnderlayView.js";

describe("F-115 visible PDF underlay wiring", () => {
  it("renders page, transform, fade and clip without capturing pointer events", () => {
    const html = renderToStaticMarkup(<PdfUnderlayView sourceUrl="blob:fixture" pixelsPerMm={2} placement={{
      pageNumber: 2, position: { x: 25, y: 40 }, widthMm: 210, heightMm: 148.5,
      rotationRad: Math.PI / 6, opacity: 0.8, fadePercent: 25, visible: true,
      clipBoundary: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }],
    }} />);
    expect(html).toContain("src=\"blob:fixture\"");
    expect(html).toContain("data-effective-opacity=\"0.6000000000000001\"");
    expect(html).toContain("pointer-events:none");
    expect(html).toContain("clip-path:polygon(");
  });

  it("exposes a visible, page-selectable attach form", () => {
    const html = renderToStaticMarkup(<PdfUnderlayAttachPanel attachmentId="a" placementId="p" currentLayerId="0" onAttach={async () => undefined} />);
    expect(html).toContain("PDF alusjoonise lisamine");
    expect(html).toContain("aria-label=\"PDF file\"");
    expect(html).toContain("Lisa PDF alusjoonis");
  });
});
