import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "@kuubik/cad-core";
import { exportModelVectorPdf } from "../src/index.js";

const hex = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

function fixture() {
  const document = createEmptyDocument({ documentId: "F-106-mutation" });
  document.entities = [
    { kind: "line" as const, handle: "10", layerId: "0", start: { x: 1000, y: 2000 }, end: { x: 5000, y: 2000 } },
    { kind: "circle" as const, handle: "11", layerId: "0", center: { x: 3000, y: 5000 }, radius: 1000 },
  ];
  document.layouts[0]!.pageSetup = {
    mediaName: "ISO_A4", orientation: "portrait", plotArea: { kind: "extents" },
    plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 50 }, centerPlot: true, plotOriginMm: { x: 0, y: 0 },
    plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
  };
  return document;
}

describe("F-106 mutation proof", () => {
  it("makes scale, source geometry and plottability observable in production PDF bytes", () => {
    const document = fixture();
    const baseline = exportModelVectorPdf(document);
    expect(hex(exportModelVectorPdf(structuredClone(document)).bytes)).toBe(hex(baseline.bytes));

    const scaleMutation = structuredClone(document);
    scaleMutation.layouts[0]!.pageSetup!.plotScale = { mode: "custom", paperUnits: 1, drawingUnits: 25 };
    expect(hex(exportModelVectorPdf(scaleMutation).bytes)).not.toBe(hex(baseline.bytes));

    const geometryMutation = structuredClone(document);
    if (geometryMutation.entities[0]?.kind === "line") geometryMutation.entities[0].end.x += 500;
    expect(hex(exportModelVectorPdf(geometryMutation).bytes)).not.toBe(hex(baseline.bytes));

    const layerMutation = structuredClone(document);
    layerMutation.layers[0]!.plottable = false;
    expect(() => exportModelVectorPdf(layerMutation)).toThrow(/no printable model-space geometry/u);
  });
});
