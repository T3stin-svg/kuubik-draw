import { createEmptyDocument, DEFAULT_PAGE_SETUP } from "../../packages/cad-core/src/index.js";
import type { CadLayout, KDrawDocumentV1 } from "@kuubik/cad-schema";

export const F114_LAYOUT_IDS = ["layout-f114-a3", "layout-f114-a4"] as const;
export const F114_LAYOUT_NAMES = ["F-114 A3 LAYOUT", "F-114 A4 DETAIL"] as const;

function layout(index: 0 | 1): CadLayout {
  const a3 = index === 0;
  const paper = a3
    ? { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } }
    : { widthMm: 210, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } };
  return {
    id: F114_LAYOUT_IDS[index],
    name: F114_LAYOUT_NAMES[index],
    kind: "paper",
    paper,
    pageSetup: {
      ...structuredClone(DEFAULT_PAGE_SETUP),
      mediaName: a3 ? "ISO_A3" : "ISO_A4",
      orientation: a3 ? "landscape" : "portrait",
      plotArea: { kind: "layout" },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 1 },
      plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true },
    },
    viewports: [{
      id: a3 ? "viewport-f114-a3" : "viewport-f114-a4",
      center: { x: paper.widthMm / 2, y: paper.heightMm / 2 },
      width: a3 ? 390 : 180,
      height: 247,
      viewCenter: { x: a3 ? 0 : 15000, y: 0 },
      viewHeight: a3 ? 7000 : 7000,
      twistAngleRad: 0,
      locked: true,
      layerOverrides: { [a3 ? "blue" : "red"]: { frozen: true } },
    }],
    entities: [
      {
        kind: "polyline",
        handle: a3 ? "30" : "40",
        layerId: "0",
        closed: true,
        vertices: [
          { x: 5, y: 5 },
          { x: paper.widthMm - 5, y: 5 },
          { x: paper.widthMm - 5, y: paper.heightMm - 5 },
          { x: 5, y: paper.heightMm - 5 },
        ],
      },
      { kind: "text", handle: a3 ? "31" : "41", layerId: "0", position: { x: 12, y: 16 }, text: F114_LAYOUT_NAMES[index], height: 6, rotationRad: 0 },
      { kind: "text", handle: a3 ? "32" : "42", layerId: "0", position: { x: 12, y: 26 }, text: "KUUBIK F-114 VECTOR PDF", height: 5, rotationRad: 0 },
    ],
  };
}

export function createF114Document(documentId = "F-114"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, now: "2026-08-29T00:00:00.000Z" });
  document.layers.push(
    { id: "red", name: "F114 RED", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ff0000", colorMethod: "trueColor", lineweightMm: 0.7 } },
    { id: "blue", name: "F114 BLUE", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#0000ff", colorMethod: "trueColor", lineweightMm: 0.25 } },
  );
  document.entities = [
    { kind: "line", handle: "10", layerId: "red", start: { x: -3000, y: -2000 }, end: { x: 3000, y: 2000 }, appearance: { transparency: 40 } },
    { kind: "text", handle: "11", layerId: "red", position: { x: -2500, y: 2500 }, text: "F-114 A3 MODEL VECTOR", height: 450, rotationRad: 0 },
    { kind: "circle", handle: "20", layerId: "blue", center: { x: 15000, y: 0 }, radius: 2500 },
    { kind: "text", handle: "21", layerId: "blue", position: { x: 12500, y: 3000 }, text: "F-114 A4 MODEL VECTOR", height: 450, rotationRad: 0 },
  ];
  document.layouts = [document.layouts[0]!, layout(0), layout(1)];
  document.metadata.title = "F-114 mixed-size vector PDF";
  return document;
}
