import { createEmptyDocument } from "../../packages/cad-core/src/index.js";
import type { CadEntity, CadHatch, KDrawDocumentV1 } from "@kuubik/cad-schema";

const rectangle = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];

export function createF109Document(documentId = "F-109"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, now: "2026-08-29T00:00:00.000Z", units: "mm" });
  document.currentLayerId = "lines";
  document.linetypes = [
    { id: "dashed", name: "DASHED", description: "Dashed", pattern: [12, -3] },
    { id: "dashdot", name: "DASHDOT", description: "Dash dot", pattern: [12, -3, 0, -3] },
  ];
  document.layers = [
    { id: "lines", name: "JOONED", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ffffff", colorMethod: "aci", aciIndex: 7, lineweightMm: 0.25 } },
    { id: "axes", name: "TELJED", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#00ffff", colorMethod: "aci", aciIndex: 4, lineweightMm: 0.13, linetypeId: "dashdot" } },
    { id: "walls", name: "SEINAD", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ff00ff", colorMethod: "aci", aciIndex: 6, lineweightMm: 0.5, linetypeId: "dashed" } },
    { id: "hatches", name: "VIIRUTUS", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#c0c0c0", colorMethod: "trueColor", aciIndex: 9, lineweightMm: 0.13, transparency: 20 } },
  ];
  document.textStyles = [
    { id: "normal", name: "NORMAL", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 },
    { id: "standard", name: "Standard", fontFamily: "txt", widthFactor: 1, obliqueAngleRad: 0 },
  ];
  document.dimensionStyles = [
    { id: "dim-standard", name: "Standard", textStyleId: "standard", textHeight: 250, arrowSize: 250, extensionOffset: 62.5, scale: 1 },
  ];

  const entities: CadEntity[] = [];
  for (let index = 0; index < 12; index += 1) {
    const y = index === 0 ? -600 : index * 250;
    const entity: CadEntity = {
      kind: "line", handle: (0x1000 + index).toString(16), layerId: index % 3 === 0 ? "axes" : "lines",
      start: { x: index === 0 ? -200 : 0, y }, end: { x: 5000, y },
    };
    if (index === 0) entity.appearance = { color: "#ff7f00", colorMethod: "aci", aciIndex: 30, lineweightMm: 0.7, linetypeId: "dashed", transparency: 40 };
    if (index === 1) entity.appearance = { color: "#0a64dc", colorMethod: "trueColor", aciIndex: 152, lineweightMm: 0.35, transparency: 15 };
    entities.push(entity);
  }
  for (let index = 0; index < 9; index += 1) {
    const x = index * 450;
    entities.push({
      kind: "polyline", handle: (0x1100 + index).toString(16), layerId: "walls", closed: index !== 8,
      vertices: index < 2
        ? [{ x, y: 3000, bulge: 0.414213562373095 }, { x: x + 300, y: 3300, bulge: index === 1 ? -0.414213562373095 : undefined }, { x, y: 3600 }]
        : rectangle(x, 3000, 300, 300),
    });
  }
  for (let index = 0; index < 10; index += 1) {
    entities.push({
      kind: "text", handle: (0x1200 + index).toString(16), layerId: "lines", styleId: index % 2 ? "normal" : "standard",
      position: { x: index * 500, y: index === 9 ? 4400 : 3900 }, text: index === 9 ? "MÕÕT ŠŽ€ 10" : `F109 TEXT ${index + 1}`, height: 180, rotationRad: 0,
    });
  }
  for (let index = 0; index < 7; index += 1) {
    const hatch: CadHatch = {
      kind: "hatch", handle: (0x1300 + index).toString(16), layerId: "hatches", pattern: index === 0 ? "SOLID" : `F109_${index}`,
      associative: false,
      loops: [{ isHole: false, vertices: rectangle(5200 + index * 250, 3000, 180, 240) }],
    };
    entities.push(hatch);
  }
  entities.push({ kind: "circle", handle: "1400", layerId: "lines", center: { x: 7500, y: 0 }, radius: 366.6667 });
  entities.push({
    kind: "dimension", handle: "1500", layerId: "lines", dimensionKind: "aligned", styleId: "dim-standard",
    definitionPoints: [{ x: 0, y: 4000 }, { x: 5000, y: 4000 }, { x: 0, y: 4400 }, { x: 2500, y: 4400 }],
  });
  document.entities = entities;
  return document;
}
