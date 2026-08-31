import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";

export function createF110Document(documentId = "F-110-source", units: KDrawDocumentV1["units"]["linear"] = "mm"): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId, units, now: "2026-08-31T20:00:00.000Z" });
  document.linetypes = [{ id: "dash", name: "DASHED", description: "Dashed", pattern: [12, -6] }];
  document.layers = [
    { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    { id: "geometry", name: "GEOMETRY", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "dash", lineweightMm: 0.35 } },
  ];
  document.currentLayerId = "geometry";
  document.textStyles = [{ id: "iso", name: "ISO", fontFamily: "Arial", widthFactor: 0.8, obliqueAngleRad: 0 }];
  document.dimensionStyles = [{ id: "dim", name: "DIM-ISO", textStyleId: "iso", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 }];
  document.blocks = [{
    id: "symbol",
    name: "SYMBOL",
    basePoint: { x: 5, y: 5 },
    entities: [
      { kind: "line", handle: "C0", layerId: "geometry", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "circle", handle: "C1", layerId: "geometry", center: { x: 5, y: 5 }, radius: 2 },
    ],
  }];
  document.entities = [
    { kind: "line", handle: "10", layerId: "geometry", start: { x: 0, y: 0 }, end: { x: 100, y: 25 }, appearance: { color: "#00ff00", colorMethod: "trueColor", linetypeId: "dash", linetypeScale: 0.5 } },
    { kind: "polyline", handle: "20", layerId: "geometry", closed: true, vertices: [{ x: 0, y: 0, startWidth: 1, endWidth: 2 }, { x: 50, y: 0, bulge: 0.5 }, { x: 50, y: 50 }] },
    { kind: "circle", handle: "30", layerId: "geometry", center: { x: 20, y: 20 }, radius: 8 },
    { kind: "arc", handle: "40", layerId: "geometry", center: { x: 40, y: 40 }, radius: 12, startAngleRad: 0.25, endAngleRad: 2.5, counterClockwise: true },
    { kind: "ellipse", handle: "50", layerId: "geometry", center: { x: 75, y: 20 }, majorAxis: { x: 16, y: 4 }, ratio: 0.4, startParameter: 0, endParameter: Math.PI * 1.5 },
    { kind: "spline", handle: "60", layerId: "geometry", degree: 2, controlPoints: [{ x: 0, y: 80 }, { x: 40, y: 110 }, { x: 80, y: 80 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.75, 1], closed: false, periodic: false },
    { kind: "text", handle: "70", layerId: "geometry", position: { x: 0, y: 125 }, text: "TÕEND ŠŽ€", height: 4, rotationRad: 0.1, styleId: "iso" },
    { kind: "mtext", handle: "80", layerId: "geometry", position: { x: 0, y: 140 }, text: "Rida 1\nRida 2", height: 3.5, rotationRad: 0.2, styleId: "iso", extensionData: { "kuubik.dxf.mtext.v1": { width: 60, attachment: 5 } } },
    { kind: "hatch", handle: "90", layerId: "geometry", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 100, y: 0 }, { x: 130, y: 0 }, { x: 130, y: 30 }, { x: 100, y: 30 }] }] },
    { kind: "dimension", handle: "A0", layerId: "geometry", dimensionKind: "aligned", definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 25 }, { x: 0, y: 35 }, { x: 50, y: 35 }], styleId: "dim", overrideText: "100.00" },
    { kind: "blockRef", handle: "B0", layerId: "geometry", blockId: "symbol", insertion: { x: 150, y: 50 }, scale: { x: 2, y: 0.5 }, rotationRad: Math.PI / 6 },
  ];
  return document;
}
