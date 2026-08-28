import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createF104Document, F104_LAYOUT_ID } from "../../../parity/fixtures/f104-document.js";
import { exportLayoutSvg, exportLayoutVectorPdf } from "../src/index.js";

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

describe("F-104 mutation sensitivity", () => {
  it("changes both vector outputs for viewport scale, clip and paper-title mutations, then restores exact bytes", () => {
    const document = createF104Document();
    const baselineSvg = exportLayoutSvg(document, F104_LAYOUT_ID).text;
    const baselinePdf = exportLayoutVectorPdf(document, F104_LAYOUT_ID).bytes;
    const baseline = { svg: sha256(baselineSvg), pdf: sha256(baselinePdf) };

    const scaleMutation = structuredClone(document);
    scaleMutation.layouts[1]!.viewports[0]!.viewHeight = 24700;
    expect(sha256(exportLayoutSvg(scaleMutation, F104_LAYOUT_ID).text)).not.toBe(baseline.svg);
    expect(sha256(exportLayoutVectorPdf(scaleMutation, F104_LAYOUT_ID).bytes)).not.toBe(baseline.pdf);

    const clipMutation = structuredClone(document);
    clipMutation.layouts[1]!.viewports[1]!.clipBoundary![2]!.x = 370;
    expect(sha256(exportLayoutSvg(clipMutation, F104_LAYOUT_ID).text)).not.toBe(baseline.svg);
    expect(sha256(exportLayoutVectorPdf(clipMutation, F104_LAYOUT_ID).bytes)).not.toBe(baseline.pdf);

    const titleMutation = structuredClone(document);
    const title = titleMutation.layouts[1]!.entities!.find((entity) => entity.handle === "32");
    if (!title || (title.kind !== "text" && title.kind !== "mtext")) throw new Error("F-104 title fixture is missing.");
    title.text = "MUTATED TITLE";
    expect(sha256(exportLayoutSvg(titleMutation, F104_LAYOUT_ID).text)).not.toBe(baseline.svg);
    expect(sha256(exportLayoutVectorPdf(titleMutation, F104_LAYOUT_ID).bytes)).not.toBe(baseline.pdf);

    const restored = structuredClone(document);
    expect(sha256(exportLayoutSvg(restored, F104_LAYOUT_ID).text)).toBe(baseline.svg);
    expect(sha256(exportLayoutVectorPdf(restored, F104_LAYOUT_ID).bytes)).toBe(baseline.pdf);
  });
});
