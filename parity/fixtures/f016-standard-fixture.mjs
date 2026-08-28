const now = "2026-08-28T11:30:00.000Z";

export const f016BasePoint = Object.freeze({ x: 100, y: 200 });
export const f016DestinationPoint = Object.freeze({ x: 600, y: 950 });
export const f016Delta = Object.freeze({ x: 500, y: 750 });

export const f016StandardDocument = Object.freeze({
  schemaVersion: 1,
  documentId: "local",
  revision: 0,
  units: { linear: "mm", displayPrecision: 4, angularPrecision: 6 },
  currentLayerId: "0",
  entities: [
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff4040", lineweightMm: 0.5 }, start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
    { kind: "polyline", handle: "11", layerId: "0", appearance: { linetypeId: "DASHED" }, closed: false, vertices: [{ x: 100, y: 0, bulge: 0.25, startWidth: 2 }, { x: 150, y: 25 }, { x: 200, y: 0, endWidth: 3 }] },
    { kind: "circle", handle: "12", layerId: "0", center: { x: 300, y: 0 }, radius: 25 },
    { kind: "arc", handle: "13", layerId: "0", center: { x: 500, y: 0 }, radius: 30, startAngleRad: 0, endAngleRad: 1.5707963267948966, counterClockwise: true },
    { kind: "ellipse", handle: "14", layerId: "0", center: { x: 700, y: 0 }, majorAxis: { x: 50, y: 10 }, ratio: 0.5, startParameter: 0, endParameter: 6.283185307179586 },
    { kind: "spline", handle: "15", layerId: "0", degree: 2, controlPoints: [{ x: 900, y: 0 }, { x: 950, y: 75 }, { x: 1000, y: 0 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.75, 1], closed: false, periodic: false },
    { kind: "text", handle: "16", layerId: "0", position: { x: 1100, y: 0 }, text: "F016 TEXT", height: 20, rotationRad: 0.25, styleId: "STANDARD" },
    { kind: "mtext", handle: "17", layerId: "0", position: { x: 1250, y: 0 }, text: "F016 MTEXT", height: 20, rotationRad: 0, styleId: "STANDARD" },
    { kind: "leader", handle: "18", layerId: "0", vertices: [{ x: 1400, y: 0 }, { x: 1450, y: 50 }, { x: 1500, y: 50 }], text: "F016" },
    { kind: "dimension", handle: "19", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 1550, y: 0 }, { x: 1650, y: 0 }, { x: 1550, y: 50 }], styleId: "STANDARD", overrideText: "100" },
    { kind: "hatch", handle: "1A", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 1700, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 100 }, { x: 1700, y: 100 }] }] },
    { kind: "blockRef", handle: "1B", layerId: "0", blockId: "B1", insertion: { x: 1900, y: 0 }, scale: { x: 1.5, y: 0.5 }, rotationRad: 0.25, attributes: { TAG: "F016" } },
    { kind: "line", handle: "1C", layerId: "locked", start: { x: 2100, y: 0 }, end: { x: 2200, y: 0 } },
    { kind: "proxy", handle: "1D", layerId: "0", originalType: "THIRD_PARTY_CUSTOM", raw: { preserved: true }, bounds: { min: { x: 2300, y: 0 }, max: { x: 2400, y: 100 } } },
  ],
  layers: [
    { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    { id: "locked", name: "F016_LOCKED", visible: true, frozen: false, locked: true, plottable: true },
  ],
  linetypes: [{ id: "DASHED", name: "DASHED", description: "Synthetic F-016 fixture", pattern: [10, -5] }],
  textStyles: [{ id: "STANDARD", name: "Standard", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 }],
  dimensionStyles: [{ id: "STANDARD", name: "Standard", textStyleId: "STANDARD", textHeight: 20, arrowSize: 10, extensionOffset: 5, scale: 1 }],
  blocks: [{
    id: "B1",
    name: "F016_BLOCK",
    basePoint: { x: 0, y: 0 },
    entities: [{ kind: "line", handle: "B1-10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
  }],
  layouts: [{ id: "model", name: "Model", kind: "model", viewports: [] }],
  attachments: [],
  metadata: { title: "F-016 standard entity matrix", createdAt: now, updatedAt: now, source: "synthetic parity fixture" },
});

export const f016ExpectedCommittedEntities = Object.freeze([
  { kind: "line", handle: "10", layerId: "0", appearance: { color: "#ff4040", lineweightMm: 0.5 }, start: { x: 500, y: 750 }, end: { x: 550, y: 750 } },
  { kind: "polyline", handle: "11", layerId: "0", appearance: { linetypeId: "DASHED" }, closed: false, vertices: [{ x: 600, y: 750, bulge: 0.25, startWidth: 2 }, { x: 650, y: 775 }, { x: 700, y: 750, endWidth: 3 }] },
  { kind: "circle", handle: "12", layerId: "0", center: { x: 800, y: 750 }, radius: 25 },
  { kind: "arc", handle: "13", layerId: "0", center: { x: 1000, y: 750 }, radius: 30, startAngleRad: 0, endAngleRad: 1.5707963267948966, counterClockwise: true },
  { kind: "ellipse", handle: "14", layerId: "0", center: { x: 1200, y: 750 }, majorAxis: { x: 50, y: 10 }, ratio: 0.5, startParameter: 0, endParameter: 6.283185307179586 },
  { kind: "spline", handle: "15", layerId: "0", degree: 2, controlPoints: [{ x: 1400, y: 750 }, { x: 1450, y: 825 }, { x: 1500, y: 750 }], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.75, 1], closed: false, periodic: false },
  { kind: "text", handle: "16", layerId: "0", position: { x: 1600, y: 750 }, text: "F016 TEXT", height: 20, rotationRad: 0.25, styleId: "STANDARD" },
  { kind: "mtext", handle: "17", layerId: "0", position: { x: 1750, y: 750 }, text: "F016 MTEXT", height: 20, rotationRad: 0, styleId: "STANDARD" },
  { kind: "leader", handle: "18", layerId: "0", vertices: [{ x: 1900, y: 750 }, { x: 1950, y: 800 }, { x: 2000, y: 800 }], text: "F016" },
  { kind: "dimension", handle: "19", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 2050, y: 750 }, { x: 2150, y: 750 }, { x: 2050, y: 800 }], styleId: "STANDARD", overrideText: "100" },
  { kind: "hatch", handle: "1A", layerId: "0", pattern: "SOLID", associative: false, loops: [{ isHole: false, vertices: [{ x: 2200, y: 750 }, { x: 2300, y: 750 }, { x: 2300, y: 850 }, { x: 2200, y: 850 }] }] },
  { kind: "blockRef", handle: "1B", layerId: "0", blockId: "B1", insertion: { x: 2400, y: 750 }, scale: { x: 1.5, y: 0.5 }, rotationRad: 0.25, attributes: { TAG: "F016" } },
  { kind: "line", handle: "1C", layerId: "locked", start: { x: 2100, y: 0 }, end: { x: 2200, y: 0 } },
  { kind: "proxy", handle: "1D", layerId: "0", originalType: "THIRD_PARTY_CUSTOM", raw: { preserved: true }, bounds: { min: { x: 2300, y: 0 }, max: { x: 2400, y: 100 } } },
]);

export const f016ExpectedMovedHandles = Object.freeze(["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B"]);
export const f016ExpectedRejected = Object.freeze([
  { handle: "1C", reason: "locked-layer" },
  { handle: "1D", reason: "unsupported-entity" },
]);
