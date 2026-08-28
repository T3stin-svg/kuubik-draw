import { createEmptyDocument, DEFAULT_PAGE_SETUP } from "../../packages/cad-core/src/index.js";
import type { CadLayout, KDrawDocumentV1 } from "@kuubik/cad-schema";

export const F105_LAYOUT_IDS = ["layout-f105-section", "layout-f105-plan"] as const;
export const F105_LAYOUT_NAMES = ["F-105 SHEET 10 SECTION", "F-105 SHEET 20 PLAN"] as const;

const paper = { widthMm: 210, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } };
const pageSetup = {
  ...structuredClone(DEFAULT_PAGE_SETUP),
  mediaName: "ISO_A4",
  orientation: "portrait" as const,
  plotStyle: { profile: "color" as const, plotLineweights: true, plotTransparency: true },
};

function paperLayout(index: 0 | 1): CadLayout {
  const section = index === 0;
  return {
    id: F105_LAYOUT_IDS[index],
    name: F105_LAYOUT_NAMES[index],
    kind: "paper",
    paper: structuredClone(paper),
    pageSetup: structuredClone(pageSetup),
    viewports: [{
      id: `viewport-f105-${section ? "section" : "plan"}`,
      center: { x: 105, y: 148.5 }, width: 180, height: 247,
      viewCenter: { x: section ? 0 : 20000, y: 0 }, viewHeight: 12350,
      twistAngleRad: 0, locked: true,
      layerOverrides: { [section ? "red" : "blue"]: { frozen: true } },
    }],
    entities: [
      { kind: "polyline", handle: section ? "40" : "50", layerId: "0", closed: true, vertices: [
        { x: 5, y: 5 }, { x: 205, y: 5 }, { x: 205, y: 292 }, { x: 5, y: 292 },
      ] },
      { kind: "text", handle: section ? "41" : "51", layerId: section ? "blue" : "red", position: { x: 15, y: 15 }, text: F105_LAYOUT_NAMES[index], height: 6, rotationRad: 0 },
    ],
  };
}

export function createF105Document(documentId = "F-105"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId });
  document.layers.push(
    { id: "red", name: "F105 RED", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ff0000", colorMethod: "trueColor", lineweightMm: 0.35 } },
    { id: "blue", name: "F105 BLUE", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#0066ff", colorMethod: "trueColor", lineweightMm: 0.35 } },
  );
  document.entities = [
    { kind: "circle", handle: "20", layerId: "blue", center: { x: 0, y: 0 }, radius: 3500 },
    { kind: "line", handle: "30", layerId: "red", start: { x: 15000, y: -4000 }, end: { x: 25000, y: 4000 } },
  ];
  document.layouts = [document.layouts[0]!, paperLayout(0), paperLayout(1)];
  document.metadata.title = "F-105 Publish Set";
  return document;
}
