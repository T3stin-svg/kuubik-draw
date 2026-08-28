import { f016StandardDocument } from "./f016-standard-fixture.mjs";

export const f018BasePoint = Object.freeze({ x: 100, y: 200 });
export const f018ReferencePoints = Object.freeze([
  Object.freeze({ x: 100, y: 200 }),
  Object.freeze({ x: 1100, y: 1200 }),
]);
export const f018ReferenceAngleDeg = 45;
export const f018NewAngleDeg = 135;
export const f018DeltaAngleDeg = 90;

function buildStandardDocument() {
  const document = structuredClone(f016StandardDocument);
  document.metadata = { ...document.metadata, title: "F-018 standard entity ROTATE matrix" };
  return document;
}

export const f018StandardDocument = Object.freeze(buildStandardDocument());

function point(value) {
  const dx = value.x - f018BasePoint.x;
  const dy = value.y - f018BasePoint.y;
  return { x: f018BasePoint.x - dy, y: f018BasePoint.y + dx };
}

function vector(value) {
  return { x: -value.y, y: value.x };
}

function angle(value) {
  const fullTurn = Math.PI * 2;
  const result = ((value + Math.PI / 2) % fullTurn + fullTurn) % fullTurn;
  return Math.abs(result) < 1e-15 ? 0 : result;
}

// This independent fixture-side quarter-turn is the golden oracle. It never
// imports cad-core and therefore cannot accidentally certify production code
// against itself.
function rotated(entity) {
  switch (entity.kind) {
    case "line": return { ...structuredClone(entity), start: point(entity.start), end: point(entity.end) };
    case "polyline": return { ...structuredClone(entity), vertices: entity.vertices.map((vertex) => ({ ...vertex, ...point(vertex) })) };
    case "circle": return { ...structuredClone(entity), center: point(entity.center) };
    case "arc": return { ...structuredClone(entity), center: point(entity.center), startAngleRad: angle(entity.startAngleRad), endAngleRad: angle(entity.endAngleRad) };
    case "ellipse": return { ...structuredClone(entity), center: point(entity.center), majorAxis: vector(entity.majorAxis) };
    case "spline": return { ...structuredClone(entity), controlPoints: entity.controlPoints.map(point) };
    case "text":
    case "mtext": return { ...structuredClone(entity), position: point(entity.position), rotationRad: angle(entity.rotationRad) };
    case "leader": return { ...structuredClone(entity), vertices: entity.vertices.map(point) };
    case "dimension": return { ...structuredClone(entity), definitionPoints: entity.definitionPoints.map(point) };
    case "hatch": return {
      ...structuredClone(entity),
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map(point) })),
    };
    case "blockRef": return { ...structuredClone(entity), insertion: point(entity.insertion), rotationRad: angle(entity.rotationRad) };
    default: throw new Error(`F-018 golden fixture cannot rotate ${entity.kind}.`);
  }
}

export const f018ExpectedRotatedHandles = Object.freeze([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B",
]);
export const f018ExpectedRejected = Object.freeze([
  { handle: "1C", reason: "locked-layer" },
  { handle: "1D", reason: "unsupported-entity" },
]);

export const f018ExpectedCommittedEntities = Object.freeze(f018StandardDocument.entities.map((entity) =>
  f018ExpectedRotatedHandles.includes(entity.handle) ? rotated(entity) : structuredClone(entity),
));
