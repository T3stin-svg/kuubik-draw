import { f016StandardDocument } from "./f016-standard-fixture.mjs";

export const f019BasePoint = Object.freeze({ x: 100, y: 200 });
export const f019ReferencePoints = Object.freeze([
  Object.freeze({ x: 100, y: 200 }),
  Object.freeze({ x: 1100, y: 200 }),
]);
export const f019ReferenceLength = 1000;
export const f019NewLength = 2000;
export const f019Factor = 2;

function buildStandardDocument() {
  const document = structuredClone(f016StandardDocument);
  document.metadata = { ...document.metadata, title: "F-019 standard entity SCALE matrix" };
  return document;
}

export const f019StandardDocument = Object.freeze(buildStandardDocument());

function point(value) {
  return {
    x: f019BasePoint.x + (value.x - f019BasePoint.x) * f019Factor,
    y: f019BasePoint.y + (value.y - f019BasePoint.y) * f019Factor,
  };
}

function vertex(value) {
  const result = { ...value, ...point(value) };
  if (value.startWidth !== undefined) result.startWidth = value.startWidth * f019Factor;
  if (value.endWidth !== undefined) result.endWidth = value.endWidth * f019Factor;
  return result;
}

// Independent fixture-side uniform scaling is the golden oracle. It never
// imports cad-core, so production SCALE cannot certify itself.
function scaled(entity) {
  switch (entity.kind) {
    case "line": return { ...structuredClone(entity), start: point(entity.start), end: point(entity.end) };
    case "polyline": return { ...structuredClone(entity), vertices: entity.vertices.map(vertex) };
    case "circle": return { ...structuredClone(entity), center: point(entity.center), radius: entity.radius * f019Factor };
    case "arc": return { ...structuredClone(entity), center: point(entity.center), radius: entity.radius * f019Factor };
    case "ellipse": return {
      ...structuredClone(entity),
      center: point(entity.center),
      majorAxis: { x: entity.majorAxis.x * f019Factor, y: entity.majorAxis.y * f019Factor },
    };
    case "spline": return { ...structuredClone(entity), controlPoints: entity.controlPoints.map(point) };
    case "text":
    case "mtext": return { ...structuredClone(entity), position: point(entity.position), height: entity.height * f019Factor };
    case "leader": return { ...structuredClone(entity), vertices: entity.vertices.map(point) };
    case "dimension": return { ...structuredClone(entity), definitionPoints: entity.definitionPoints.map(point) };
    case "hatch": return {
      ...structuredClone(entity),
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map(point) })),
    };
    case "blockRef": return {
      ...structuredClone(entity),
      insertion: point(entity.insertion),
      scale: { x: entity.scale.x * f019Factor, y: entity.scale.y * f019Factor },
    };
    default: throw new Error(`F-019 golden fixture cannot scale ${entity.kind}.`);
  }
}

export const f019ExpectedScaledHandles = Object.freeze([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B",
]);
export const f019ExpectedRejected = Object.freeze([
  { handle: "1C", reason: "locked-layer" },
  { handle: "1D", reason: "unsupported-entity" },
]);

export const f019ExpectedCommittedEntities = Object.freeze(f019StandardDocument.entities.map((entity) =>
  f019ExpectedScaledHandles.includes(entity.handle) ? scaled(entity) : structuredClone(entity),
));
