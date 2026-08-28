import { f016StandardDocument } from "./f016-standard-fixture.mjs";

export const f020AxisStart = Object.freeze({ x: 1500, y: -500 });
export const f020AxisEnd = Object.freeze({ x: 1500, y: 1500 });
export const f020ExpectedSourceHandles = Object.freeze([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B",
]);
export const f020ExpectedCreatedHandles = Object.freeze([
  "1E", "1F", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
]);
export const f020ExpectedRejected = Object.freeze([
  { handle: "1C", reason: "locked-layer" },
  { handle: "1D", reason: "unsupported-entity" },
]);

function standardDocument() {
  const document = structuredClone(f016StandardDocument);
  document.metadata = { ...document.metadata, title: "F-020 standard entity MIRROR matrix" };
  return document;
}

export const f020StandardDocument = Object.freeze(standardDocument());

function normalized(value) {
  const fullTurn = Math.PI * 2;
  const result = ((value % fullTurn) + fullTurn) % fullTurn;
  return Math.abs(result) < 1e-12 || Math.abs(result - fullTurn) < 1e-12 ? 0 : result;
}

function point(value) {
  return { x: 2 * f020AxisStart.x - value.x, y: value.y };
}

function readableAngle(value) {
  let result = normalized(Math.PI - value);
  if (result > Math.PI / 2 && result < Math.PI * 1.5) result = normalized(result + Math.PI);
  return result;
}

// Independent fixture-side reflection is the golden oracle. It never imports
// cad-core, so production MIRROR cannot certify itself.
function mirrored(entity, handle) {
  const common = { ...structuredClone(entity), handle };
  switch (entity.kind) {
    case "line": return { ...common, start: point(entity.start), end: point(entity.end) };
    case "polyline": return {
      ...common,
      vertices: entity.vertices.map((vertex) => ({
        ...vertex,
        ...point(vertex),
        ...(vertex.bulge === undefined ? {} : { bulge: -vertex.bulge }),
      })),
    };
    case "circle": return { ...common, center: point(entity.center) };
    case "arc": return {
      ...common,
      center: point(entity.center),
      startAngleRad: normalized(Math.PI - entity.startAngleRad),
      endAngleRad: normalized(Math.PI - entity.endAngleRad),
      counterClockwise: !entity.counterClockwise,
    };
    case "ellipse": return {
      ...common,
      center: point(entity.center),
      majorAxis: { x: -entity.majorAxis.x, y: entity.majorAxis.y },
      startParameter: 0,
      endParameter: Math.PI * 2,
    };
    case "spline": return { ...common, controlPoints: entity.controlPoints.map(point) };
    case "text":
    case "mtext": return {
      ...common,
      position: point(entity.position),
      rotationRad: readableAngle(entity.rotationRad),
      extensionData: { ...entity.extensionData, kuubikMirrorTextAlign: "end" },
    };
    case "leader": return { ...common, vertices: entity.vertices.map(point) };
    case "dimension": return { ...common, definitionPoints: entity.definitionPoints.map(point) };
    case "hatch": return {
      ...common,
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map(point) })),
    };
    case "blockRef": return {
      ...common,
      insertion: point(entity.insertion),
      scale: { x: -entity.scale.x, y: entity.scale.y },
      rotationRad: normalized((Math.PI - entity.rotationRad) + Math.PI),
    };
    default: throw new Error(`F-020 golden fixture cannot mirror ${entity.kind}.`);
  }
}

export const f020ExpectedCopiedEntities = Object.freeze(f020ExpectedSourceHandles.map((handle, index) => {
  const source = f020StandardDocument.entities.find((entity) => entity.handle === handle);
  if (!source) throw new Error(`F-020 source handle ${handle} is missing.`);
  return mirrored(source, f020ExpectedCreatedHandles[index]);
}));

export const f020ExpectedPreservedEntities = Object.freeze([
  ...structuredClone(f020StandardDocument.entities),
  ...structuredClone(f020ExpectedCopiedEntities),
]);

export const f020ExpectedReplacedEntities = Object.freeze(f020StandardDocument.entities.map((entity) => {
  const index = f020ExpectedSourceHandles.indexOf(entity.handle);
  return index < 0 ? structuredClone(entity) : mirrored(entity, entity.handle);
}));
