import { f016StandardDocument } from "./f016-standard-fixture.mjs";

export const f017BasePoint = Object.freeze({ x: 100, y: 200 });
export const f017DestinationPoints = Object.freeze([
  Object.freeze({ x: 600, y: 950 }),
  Object.freeze({ x: -200, y: 300 }),
]);
export const f017Deltas = Object.freeze([
  Object.freeze({ x: 500, y: 750 }),
  Object.freeze({ x: -300, y: 100 }),
]);

function buildStandardDocument() {
  const document = structuredClone(f016StandardDocument);
  document.metadata = { ...document.metadata, title: "F-017 standard entity COPY matrix" };
  // Numeric block-space handles share the global handle namespace. Reserving 1E
  // here proves that model-space COPY allocation skips block-definition handles.
  document.blocks[0].entities[0].handle = "1E";
  return document;
}

export const f017StandardDocument = Object.freeze(buildStandardDocument());

function point(value, delta) {
  return { x: value.x + delta.x, y: value.y + delta.y };
}

// This fixture-side transform is deliberately independent from cad-core. It is
// the golden oracle for COPY and never imports the production implementation.
function translated(entity, delta, handle) {
  switch (entity.kind) {
    case "line": return { ...structuredClone(entity), handle, start: point(entity.start, delta), end: point(entity.end, delta) };
    case "polyline": return { ...structuredClone(entity), handle, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...point(vertex, delta) })) };
    case "circle":
    case "arc":
    case "ellipse": return { ...structuredClone(entity), handle, center: point(entity.center, delta) };
    case "spline": return { ...structuredClone(entity), handle, controlPoints: entity.controlPoints.map((value) => point(value, delta)) };
    case "text":
    case "mtext": return { ...structuredClone(entity), handle, position: point(entity.position, delta) };
    case "leader": return { ...structuredClone(entity), handle, vertices: entity.vertices.map((value) => point(value, delta)) };
    case "dimension": return { ...structuredClone(entity), handle, definitionPoints: entity.definitionPoints.map((value) => point(value, delta)) };
    case "hatch": return {
      ...structuredClone(entity),
      handle,
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((value) => point(value, delta)) })),
    };
    case "blockRef": return { ...structuredClone(entity), handle, insertion: point(entity.insertion, delta) };
    default: throw new Error(`F-017 golden fixture cannot translate ${entity.kind}.`);
  }
}

export const f017ExpectedSourceHandles = Object.freeze([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1A", "1B",
]);
export const f017ExpectedCopiedHandles = Object.freeze([
  "1F", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "2A",
  "2B", "2C", "2D", "2E", "2F", "30", "31", "32", "33", "34", "35", "36",
]);
export const f017ExpectedRejected = Object.freeze([
  { handle: "1C", reason: "locked-layer" },
  { handle: "1D", reason: "unsupported-entity" },
]);

const sources = f017StandardDocument.entities.filter((entity) => f017ExpectedSourceHandles.includes(entity.handle));
const copies = f017Deltas.flatMap((delta, placementIndex) => sources.map((entity, sourceIndex) =>
  translated(entity, delta, f017ExpectedCopiedHandles[placementIndex * sources.length + sourceIndex]),
));

export const f017ExpectedCommittedEntities = Object.freeze([
  ...structuredClone(f017StandardDocument.entities),
  ...copies,
]);
