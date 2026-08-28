import { createEmptyDocument, DEFAULT_MODEL_PAGE_SETUP } from "../../packages/cad-core/src/index.js";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

export function createF106Document(documentId = "F-106"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId });
  document.layouts[0]!.pageSetup = {
    ...structuredClone(DEFAULT_MODEL_PAGE_SETUP),
    mediaName: "ISO_A4",
    orientation: "portrait",
    plotArea: { kind: "extents" },
    plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 50 },
    centerPlot: true,
    plotOriginMm: { x: 0, y: 0 },
    plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
  };
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 1000, y: 2000 }, end: { x: 5000, y: 2000 } },
    { kind: "circle", handle: "11", layerId: "0", center: { x: 3000, y: 5000 }, radius: 1000 },
    { kind: "text", handle: "12", layerId: "0", position: { x: 1000, y: 13000 }, text: "F-106 MODEL 1:50", height: 250, rotationRad: 0 },
  ];
  document.metadata.title = "F-106 Model Plot";
  return document;
}
