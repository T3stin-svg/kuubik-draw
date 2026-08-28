import { createEmptyDocument, createPaperLayout, DEFAULT_PAGE_SETUP } from "../../packages/cad-core/src/index.js";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

export function createF107Document(documentId = "F-107"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, now: "2026-08-29T00:00:00.000Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } },
    { kind: "text", handle: "11", layerId: "0", position: { x: 0, y: 1000 }, text: "F-107 MODEL GEOMETRY", height: 250, rotationRad: 0 },
  ];
  document.layouts = createPaperLayout(document, {
    name: "F-107 ISSUE LAYOUT",
    pageSetup: {
      ...structuredClone(DEFAULT_PAGE_SETUP),
      mediaName: "ISO_A4",
      orientation: "portrait",
      plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 },
      centerPlot: false,
      plotOriginMm: { x: 0, y: 0 },
      plotStyle: { profile: "monochrome", plotLineweights: true, plotTransparency: true },
    },
    entities: [{ kind: "circle", handle: "12", layerId: "0", center: { x: 30, y: 30 }, radius: 10 }],
  }).layouts;
  document.metadata.title = "F-107 Named Page Setup Fixture";
  return document;
}
