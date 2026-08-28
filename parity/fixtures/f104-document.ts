import { createEmptyDocument, createPaperLayout } from "../../packages/cad-core/src/index.js";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

export const F104_LAYOUT_ID = "layout-1";
export const F104_LAYOUT_NAME = "F104 VECTOR OUTPUT";
export const F104_VIEWPORT_IDS = ["viewport-f104-50", "viewport-f104-100"] as const;

export function createF104Document(documentId = "F-104"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, now: "2026-08-28T00:00:00.000Z" });
  document.layers[0]!.appearance = { color: "#000000", colorMethod: "aci", lineweightMm: 0.25 };
  document.layers.push(
    { id: "red", name: "F104 RED", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ff0000", colorMethod: "aci", lineweightMm: 0.7 } },
    { id: "blue", name: "F104 BLUE", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#0064dc", colorMethod: "trueColor", lineweightMm: 0.35 } },
  );
  document.entities = [
    { kind: "line", handle: "10", layerId: "red", start: { x: -3500, y: -2000 }, end: { x: 3500, y: 2000 } },
    {
      kind: "hatch", handle: "11", layerId: "red", pattern: "SOLID", associative: false, appearance: { transparency: 40 },
      loops: [{ isHole: false, vertices: [{ x: -1800, y: -1200 }, { x: 1800, y: -1200 }, { x: 1800, y: 1200 }, { x: -1800, y: 1200 }] }],
    },
    { kind: "text", handle: "12", layerId: "red", position: { x: -2800, y: 3000 }, text: "VIEW 1 SCALE 1:50", height: 500, rotationRad: 0 },
    { kind: "circle", handle: "20", layerId: "blue", center: { x: 20000, y: 0 }, radius: 3000 },
    { kind: "line", handle: "21", layerId: "blue", start: { x: 16500, y: 0 }, end: { x: 23500, y: 0 } },
    { kind: "text", handle: "22", layerId: "blue", position: { x: 16600, y: 4500 }, text: "VIEW 2 SCALE 1:100", height: 900, rotationRad: 0 },
  ];
  const paper = createPaperLayout(document, {
    name: F104_LAYOUT_NAME,
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
    pageSetup: {
      mediaName: "ISO_A3", orientation: "landscape", plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 }, centerPlot: false, plotOriginMm: { x: 0, y: 0 },
      plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true }, displayPlotStyles: true,
    },
    viewports: [
      {
        id: F104_VIEWPORT_IDS[0], center: { x: 108.75, y: 148.5 }, width: 185, height: 247,
        viewCenter: { x: 0, y: 0 }, viewHeight: 12350, twistAngleRad: 0, locked: true,
      },
      {
        id: F104_VIEWPORT_IDS[1], center: { x: 311.25, y: 148.5 }, width: 185, height: 247,
        viewCenter: { x: 20000, y: 0 }, viewHeight: 24700, twistAngleRad: 0, locked: true,
        clipBoundary: [{ x: 218.75, y: 25 }, { x: 403.75, y: 25 }, { x: 382, y: 272 }, { x: 240.5, y: 272 }],
      },
    ],
    entities: [
      {
        kind: "polyline", handle: "30", layerId: "0", closed: true,
        vertices: [{ x: 10, y: 10 }, { x: 410, y: 10 }, { x: 410, y: 287 }, { x: 10, y: 287 }],
      },
      { kind: "line", handle: "31", layerId: "0", start: { x: 210, y: 10 }, end: { x: 210, y: 287 } },
      { kind: "text", handle: "32", layerId: "0", position: { x: 15, y: 17 }, text: "KUUBIK F-104 VECTOR LAYOUT", height: 5, rotationRad: 0 },
      { kind: "text", handle: "33", layerId: "0", position: { x: 255, y: 17 }, text: "A3 420x297 | 1:50 + 1:100", height: 4, rotationRad: 0 },
    ],
  });
  document.layouts = paper.layouts;
  return document;
}
