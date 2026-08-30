import type { CadEntity, CadLine, CadPoint2, CadPolyline, CadPolylineVertex, CadRay, CadXline } from "@kuubik/cad-schema";

/** Fixed model-space tolerance. Pointer tolerance remains a renderer concern. */
export const CHAMFER_EPSILON = 1e-9;

export type ChamferTrimMode = "trim" | "no-trim";
export type ChamferSpecification =
  | { method: "distance"; firstDistance: number; secondDistance: number }
  | { method: "angle"; firstDistance: number; angleDeg: number };
export type ChamferGeometryRejectReason =
  | "unsupported-target"
  | "same-target"
  | "degenerate-geometry"
  | "parallel"
  | "invalid-angle"
  | "distance-too-large"
  | "no-solution";

export interface ChamferPairGeometryResult {
  firstEntity: CadEntity | null;
  secondEntity: CadEntity | null;
  line: Omit<CadLine, "handle" | "layerId"> | null;
  intersection: CadPoint2 | null;
  chamferPoints: readonly [CadPoint2, CadPoint2] | null;
  effectiveDistances: readonly [number, number] | null;
  reason: ChamferGeometryRejectReason | null;
  /** A trimmed pair from one polyline remains one polyline with the same handle. */
  joinedPolyline?: CadPolyline;
}

export interface ChamferPolylineGeometryResult {
  entity: CadPolyline | null;
  lines: Array<Omit<CadLine, "handle" | "layerId">>;
  chamferCount: number;
  skippedVertices: number[];
  reason: ChamferGeometryRejectReason | null;
}

type LineLike = CadLine | CadRay | CadXline;
type LineSupport = { entity: LineLike; origin: CadPoint2; direction: CadPoint2 };

const add = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x + second.x, y: first.y + second.y });
const subtract = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x - second.x, y: first.y - second.y });
const scaled = (point: CadPoint2, factor: number): CadPoint2 => ({ x: point.x * factor, y: point.y * factor });
const dot = (first: CadPoint2, second: CadPoint2): number => first.x * second.x + first.y * second.y;
const cross = (first: CadPoint2, second: CadPoint2): number => first.x * second.y - first.y * second.x;
const length = (point: CadPoint2): number => Math.hypot(point.x, point.y);
const distance = (first: CadPoint2, second: CadPoint2): number => length(subtract(second, first));
const clean = (value: number): number => Math.abs(value) <= 1e-12 ? 0 : Number(value.toFixed(12));
const cleanPoint = (point: CadPoint2): CadPoint2 => ({ x: clean(point.x), y: clean(point.y) });

function unit(vector: CadPoint2): CadPoint2 | null {
  const magnitude = length(vector);
  return magnitude > CHAMFER_EPSILON ? scaled(vector, 1 / magnitude) : null;
}

function supportOf(entity: CadEntity): LineSupport | null {
  if (entity.kind === "line") {
    const direction = unit(subtract(entity.end, entity.start));
    return direction ? { entity, origin: entity.start, direction } : null;
  }
  if (entity.kind === "ray" || entity.kind === "xline") {
    const direction = unit(entity.direction);
    return direction ? { entity, origin: entity.basePoint, direction } : null;
  }
  return null;
}

function lineIntersection(first: LineSupport, second: LineSupport): CadPoint2 | null {
  const denominator = cross(first.direction, second.direction);
  if (Math.abs(denominator) <= CHAMFER_EPSILON) return null;
  const parameter = cross(subtract(second.origin, first.origin), second.direction) / denominator;
  return cleanPoint(add(first.origin, scaled(first.direction, parameter)));
}

function pickedRay(support: LineSupport, intersection: CadPoint2, pick: CadPoint2): CadPoint2 {
  const projection = dot(subtract(pick, intersection), support.direction);
  if (Math.abs(projection) > CHAMFER_EPSILON) return projection > 0 ? support.direction : scaled(support.direction, -1);
  if (support.entity.kind === "line") {
    const start = dot(subtract(support.entity.start, intersection), support.direction);
    const end = dot(subtract(support.entity.end, intersection), support.direction);
    return Math.abs(end) >= Math.abs(start)
      ? (end >= 0 ? support.direction : scaled(support.direction, -1))
      : (start >= 0 ? support.direction : scaled(support.direction, -1));
  }
  return support.direction;
}

function effectiveDistances(specification: ChamferSpecification, firstRay: CadPoint2, secondRay: CadPoint2): readonly [number, number] | null {
  if (specification.method === "distance") return [specification.firstDistance, specification.secondDistance];
  if (specification.firstDistance <= CHAMFER_EPSILON) return [0, 0];
  const theta = specification.angleDeg * Math.PI / 180;
  const wedge = Math.acos(Math.max(-1, Math.min(1, dot(firstRay, secondRay))));
  const denominator = Math.sin(theta + wedge);
  const secondDistance = specification.firstDistance * Math.sin(theta) / denominator;
  return theta > CHAMFER_EPSILON
    && theta < Math.PI - CHAMFER_EPSILON
    && Math.abs(denominator) > CHAMFER_EPSILON
    && secondDistance >= -CHAMFER_EPSILON
    && Number.isFinite(secondDistance)
    ? [specification.firstDistance, clean(Math.max(0, secondDistance))]
    : null;
}

function trimLineLike(entity: LineLike, point: CadPoint2, retainedRay: CadPoint2, intersection: CadPoint2): LineLike | null {
  if (entity.kind === "line") {
    const startProjection = dot(subtract(entity.start, intersection), retainedRay);
    const endProjection = dot(subtract(entity.end, intersection), retainedRay);
    const keepStart = startProjection >= endProjection;
    const output: CadLine = keepStart
      ? { ...structuredClone(entity), end: cleanPoint(point) }
      : { ...structuredClone(entity), start: cleanPoint(point) };
    return distance(output.start, output.end) > CHAMFER_EPSILON ? output : null;
  }
  const direction = cleanPoint(retainedRay);
  if (entity.kind === "ray") {
    const originalDirection = unit(entity.direction);
    if (!originalDirection) return null;
    if (dot(direction, originalDirection) >= 0) return { ...structuredClone(entity), basePoint: cleanPoint(point), direction };
    const pointFromBase = dot(subtract(point, entity.basePoint), originalDirection);
    if (pointFromBase <= CHAMFER_EPSILON) return null;
    const { basePoint, direction: _sourceDirection, ...common } = structuredClone(entity);
    return { ...common, kind: "line", start: cleanPoint(basePoint), end: cleanPoint(point) };
  }
  return { ...structuredClone(entity), kind: "ray", basePoint: cleanPoint(point), direction };
}

function rejected(reason: ChamferGeometryRejectReason): ChamferPairGeometryResult {
  return { firstEntity: null, secondEntity: null, line: null, intersection: null, chamferPoints: null, effectiveDistances: null, reason };
}

function chamferLineLikePair(
  first: LineLike,
  firstPick: CadPoint2,
  second: LineLike,
  secondPick: CadPoint2,
  specification: ChamferSpecification,
  trimMode: ChamferTrimMode,
): ChamferPairGeometryResult {
  if (first.handle === second.handle) return rejected("same-target");
  const firstSupport = supportOf(first); const secondSupport = supportOf(second);
  if (!firstSupport || !secondSupport) return rejected("degenerate-geometry");
  const intersection = lineIntersection(firstSupport, secondSupport);
  if (!intersection) return rejected("parallel");
  const firstRay = pickedRay(firstSupport, intersection, firstPick);
  const secondRay = pickedRay(secondSupport, intersection, secondPick);
  const distances = effectiveDistances(specification, firstRay, secondRay);
  if (!distances) return rejected("invalid-angle");
  const firstPoint = cleanPoint(add(intersection, scaled(firstRay, distances[0])));
  const secondPoint = cleanPoint(add(intersection, scaled(secondRay, distances[1])));
  const sharpCorner = distance(firstPoint, secondPoint) <= CHAMFER_EPSILON;
  const firstEntity = trimMode === "trim" ? trimLineLike(first, firstPoint, firstRay, intersection) : structuredClone(first);
  const secondEntity = trimMode === "trim" ? trimLineLike(second, secondPoint, secondRay, intersection) : structuredClone(second);
  if (trimMode === "trim" && (!firstEntity || !secondEntity)) return rejected("distance-too-large");
  return {
    firstEntity,
    secondEntity,
    line: sharpCorner ? null : { kind: "line", start: firstPoint, end: secondPoint },
    intersection,
    chamferPoints: [firstPoint, secondPoint],
    effectiveDistances: distances,
    reason: null,
  };
}

function segmentCount(entity: CadPolyline): number {
  return entity.closed ? entity.vertices.length : Math.max(0, entity.vertices.length - 1);
}

function segmentEndpoints(entity: CadPolyline, segment: number): readonly [CadPolylineVertex, CadPolylineVertex] | null {
  const count = segmentCount(entity);
  if (!Number.isSafeInteger(segment) || segment < 0 || segment >= count) return null;
  const start = entity.vertices[segment];
  const end = entity.vertices[(segment + 1) % entity.vertices.length];
  return start && end ? [start, end] : null;
}

function straightSegmentEntity(entity: CadPolyline, segment: number): CadLine | null {
  const endpoints = segmentEndpoints(entity, segment);
  if (!endpoints || Math.abs(endpoints[0].bulge ?? 0) > CHAMFER_EPSILON || distance(endpoints[0], endpoints[1]) <= CHAMFER_EPSILON) return null;
  return { kind: "line", handle: `${entity.handle}#${segment}`, layerId: entity.layerId, start: cleanPoint(endpoints[0]), end: cleanPoint(endpoints[1]) };
}

function pointWithinStraightSegmentBounds(entity: CadPolyline, segment: number, point: CadPoint2): boolean {
  const endpoints = segmentEndpoints(entity, segment);
  if (!endpoints || Math.abs(endpoints[0].bulge ?? 0) > CHAMFER_EPSILON) return false;
  const direction = subtract(endpoints[1], endpoints[0]);
  const denominator = dot(direction, direction);
  if (denominator <= CHAMFER_EPSILON) return false;
  const parameter = dot(subtract(point, endpoints[0]), direction) / denominator;
  return parameter >= -CHAMFER_EPSILON && parameter <= 1 + CHAMFER_EPSILON;
}

function pointVertex(point: CadPoint2, source: CadPolylineVertex = point): CadPolylineVertex {
  const vertex: CadPolylineVertex = { x: clean(point.x), y: clean(point.y) };
  if (source.startWidth !== undefined) vertex.startWidth = source.startWidth;
  if (source.endWidth !== undefined) vertex.endWidth = source.endWidth;
  return vertex;
}

function samePolylineTopology(firstSegment: number, secondSegment: number, count: number, closed: boolean): { incoming: number; outgoing: number; gap: 1 | 2 } | "close-open" | null {
  if (!closed && ((firstSegment === 0 && secondSegment === count - 1) || (secondSegment === 0 && firstSegment === count - 1))) return "close-open";
  const forward = (secondSegment - firstSegment + count) % count;
  const reverse = (firstSegment - secondSegment + count) % count;
  if ((closed || secondSegment > firstSegment) && (forward === 1 || forward === 2)) return { incoming: firstSegment, outgoing: secondSegment, gap: forward };
  if ((closed || firstSegment > secondSegment) && (reverse === 1 || reverse === 2)) return { incoming: secondSegment, outgoing: firstSegment, gap: reverse };
  return null;
}

/** CHAMFER between two selected straight segments of one 2D polyline. */
export function chamferCadPolylineSegmentPair(
  entity: CadPolyline,
  firstSegment: number,
  firstPick: CadPoint2,
  secondSegment: number,
  secondPick: CadPoint2,
  specification: ChamferSpecification,
  trimMode: ChamferTrimMode,
): ChamferPairGeometryResult {
  if (firstSegment === secondSegment) return rejected("same-target");
  const first = straightSegmentEntity(entity, firstSegment); const second = straightSegmentEntity(entity, secondSegment);
  if (!first || !second) return rejected("unsupported-target");
  const geometry = chamferLineLikePair(first, firstPick, second, secondPick, specification, trimMode);
  if (geometry.reason || !geometry.chamferPoints) return geometry;
  if (trimMode === "no-trim") return { ...geometry, firstEntity: structuredClone(entity), secondEntity: null };
  const count = segmentCount(entity);
  const topology = samePolylineTopology(firstSegment, secondSegment, count, entity.closed);
  if (!topology) return rejected("unsupported-target");
  // AutoCAD may extend the two terminal segments to close an open polyline.
  // Other selected polyline segments remain finite and a too-large setback is rejected.
  if (topology !== "close-open" && (!pointWithinStraightSegmentBounds(entity, firstSegment, geometry.chamferPoints[0])
    || !pointWithinStraightSegmentBounds(entity, secondSegment, geometry.chamferPoints[1]))) return rejected("distance-too-large");
  const pointBySegment = new Map<number, CadPoint2>([[firstSegment, geometry.chamferPoints[0]], [secondSegment, geometry.chamferPoints[1]]]);
  if (topology === "close-open") {
    const startSegment = 0; const endSegment = count - 1;
    const startPoint = pointBySegment.get(startSegment)!; const endPoint = pointBySegment.get(endSegment)!;
    const vertices = [pointVertex(startPoint, entity.vertices[0]), ...entity.vertices.slice(1, -1).map((vertex) => structuredClone(vertex)), pointVertex(endPoint, entity.vertices.at(-1))];
    return { ...geometry, firstEntity: null, secondEntity: null, line: null, joinedPolyline: { ...structuredClone(entity), closed: true, vertices } };
  }
  const incomingPoint = pointBySegment.get(topology.incoming)!;
  const outgoingPoint = pointBySegment.get(topology.outgoing)!;
  if (topology.gap === 1 && geometry.line === null) {
    const sharedVertex = entity.vertices[topology.outgoing]!;
    if (distance(incomingPoint, sharedVertex) <= CHAMFER_EPSILON && distance(outgoingPoint, sharedVertex) <= CHAMFER_EPSILON) {
      return { ...geometry, firstEntity: null, secondEntity: null, line: null, joinedPolyline: structuredClone(entity) };
    }
  }
  const removeStart = topology.incoming + 1;
  const removeCount = topology.gap;
  if (entity.closed && topology.outgoing < topology.incoming) {
    const vertices = [
      pointVertex(outgoingPoint, entity.vertices[topology.outgoing]),
      ...entity.vertices.slice(topology.outgoing + 1, topology.incoming + 1).map((vertex) => structuredClone(vertex)),
      pointVertex(incomingPoint),
    ];
    return { ...geometry, firstEntity: null, secondEntity: null, line: null, joinedPolyline: { ...structuredClone(entity), vertices } };
  }
  const vertices = [
    ...entity.vertices.slice(0, removeStart).map((vertex) => structuredClone(vertex)),
    pointVertex(incomingPoint),
    pointVertex(outgoingPoint, entity.vertices[topology.outgoing]),
    ...entity.vertices.slice(removeStart + removeCount).map((vertex) => structuredClone(vertex)),
  ];
  return { ...geometry, firstEntity: null, secondEntity: null, line: null, joinedPolyline: { ...structuredClone(entity), vertices } };
}

function trimPolylineSegment(entity: CadPolyline, segment: number, point: CadPoint2, pick: CadPoint2): CadPolyline | null {
  const endpoints = segmentEndpoints(entity, segment);
  if (!endpoints || Math.abs(endpoints[0].bulge ?? 0) > CHAMFER_EPSILON) return null;
  const keepStart = distance(pick, endpoints[0]) <= distance(pick, endpoints[1]);
  const vertices = entity.vertices.map((vertex) => structuredClone(vertex));
  const replaceIndex = keepStart ? (segment + 1) % vertices.length : segment;
  vertices[replaceIndex] = pointVertex(point, vertices[replaceIndex]);
  const output = { ...structuredClone(entity), vertices };
  const changed = segmentEndpoints(output, segment);
  return changed && distance(changed[0], changed[1]) > CHAMFER_EPSILON ? output : null;
}

/** CHAMFER between a selected straight polyline segment and a separate line/ray/xline. */
export function chamferCadPolylineSegmentWithEntity(
  polyline: CadPolyline,
  segment: number,
  polylinePick: CadPoint2,
  other: CadEntity,
  otherPick: CadPoint2,
  specification: ChamferSpecification,
  trimMode: ChamferTrimMode,
  polylineFirst: boolean,
): ChamferPairGeometryResult {
  const segmentEntity = straightSegmentEntity(polyline, segment);
  const otherLine = supportOf(other)?.entity;
  if (!segmentEntity || !otherLine) return rejected("unsupported-target");
  const geometry = polylineFirst
    ? chamferLineLikePair(segmentEntity, polylinePick, otherLine, otherPick, specification, trimMode)
    : chamferLineLikePair(otherLine, otherPick, segmentEntity, polylinePick, specification, trimMode);
  if (geometry.reason || !geometry.chamferPoints) return geometry;
  if (trimMode === "no-trim") return polylineFirst
    ? { ...geometry, firstEntity: structuredClone(polyline), secondEntity: structuredClone(other) }
    : { ...geometry, firstEntity: structuredClone(other), secondEntity: structuredClone(polyline) };
  const polylinePoint = geometry.chamferPoints[polylineFirst ? 0 : 1];
  if (!pointWithinStraightSegmentBounds(polyline, segment, polylinePoint)) return rejected("distance-too-large");
  const trimmedPolyline = trimPolylineSegment(polyline, segment, polylinePoint, polylinePick);
  if (!trimmedPolyline) return rejected("distance-too-large");
  return polylineFirst
    ? { ...geometry, firstEntity: trimmedPolyline, secondEntity: geometry.secondEntity }
    : { ...geometry, firstEntity: geometry.firstEntity, secondEntity: trimmedPolyline };
}

/** CHAMFER between selected straight segments of two separate 2D polylines. */
export function chamferCadPolylineSegments(
  first: CadPolyline,
  firstSegment: number,
  firstPick: CadPoint2,
  second: CadPolyline,
  secondSegment: number,
  secondPick: CadPoint2,
  specification: ChamferSpecification,
  trimMode: ChamferTrimMode,
): ChamferPairGeometryResult {
  if (first.handle === second.handle) return chamferCadPolylineSegmentPair(first, firstSegment, firstPick, secondSegment, secondPick, specification, trimMode);
  const firstLine = straightSegmentEntity(first, firstSegment); const secondLine = straightSegmentEntity(second, secondSegment);
  if (!firstLine || !secondLine) return rejected("unsupported-target");
  const geometry = chamferLineLikePair(firstLine, firstPick, secondLine, secondPick, specification, trimMode);
  if (geometry.reason || !geometry.chamferPoints) return geometry;
  if (trimMode === "no-trim") return { ...geometry, firstEntity: structuredClone(first), secondEntity: structuredClone(second) };
  if (!pointWithinStraightSegmentBounds(first, firstSegment, geometry.chamferPoints[0])
    || !pointWithinStraightSegmentBounds(second, secondSegment, geometry.chamferPoints[1])) return rejected("distance-too-large");
  const firstEntity = trimPolylineSegment(first, firstSegment, geometry.chamferPoints[0], firstPick);
  const secondEntity = trimPolylineSegment(second, secondSegment, geometry.chamferPoints[1], secondPick);
  return firstEntity && secondEntity
    ? { ...geometry, firstEntity, secondEntity }
    : rejected("distance-too-large");
}

/** CHAMFER between two standalone line/ray/xline objects. */
export function chamferCadEntityPair(
  first: CadEntity,
  firstPick: CadPoint2,
  second: CadEntity,
  secondPick: CadPoint2,
  specification: ChamferSpecification,
  trimMode: ChamferTrimMode,
): ChamferPairGeometryResult {
  const firstLine = supportOf(first)?.entity; const secondLine = supportOf(second)?.entity;
  return firstLine && secondLine
    ? chamferLineLikePair(firstLine, firstPick, secondLine, secondPick, specification, trimMode)
    : rejected("unsupported-target");
}

interface PlannedCorner {
  vertex: number;
  incomingSegment: number;
  outgoingSegment: number;
  incomingConsumption: number;
  outgoingConsumption: number;
  incoming: CadPoint2;
  outgoing: CadPoint2;
  line: Omit<CadLine, "handle" | "layerId"> | null;
}

function isIdentityCorner(plan: PlannedCorner, source: CadPolylineVertex): boolean {
  return plan.line === null
    && distance(plan.incoming, source) <= CHAMFER_EPSILON
    && distance(plan.outgoing, source) <= CHAMFER_EPSILON;
}

function segmentParameter(start: CadPoint2, end: CadPoint2, point: CadPoint2): number | null {
  const direction = subtract(end, start);
  const denominator = dot(direction, direction);
  return denominator > CHAMFER_EPSILON ? dot(subtract(point, start), direction) / denominator : null;
}

/** AutoCAD-style CHAMFER Polyline option for every eligible straight-line vertex. */
export function chamferCadPolyline(entity: CadPolyline, specification: ChamferSpecification, trimMode: ChamferTrimMode = "trim"): ChamferPolylineGeometryResult {
  const rejectedPolyline = (reason: ChamferGeometryRejectReason): ChamferPolylineGeometryResult => ({ entity: null, lines: [], chamferCount: 0, skippedVertices: [], reason });
  if (entity.vertices.length < (entity.closed ? 3 : 2)) return rejectedPolyline("degenerate-geometry");
  const candidates = entity.closed
    ? [...entity.vertices.slice(1).map((_, index) => index + 1), 0]
    : entity.vertices.slice(1, -1).map((_, index) => index + 1);
  const planByVertex = new Map<number, PlannedCorner>();
  const skippedVertices: number[] = [];
  for (const vertex of candidates) {
    const incomingSegment = (vertex - 1 + segmentCount(entity)) % segmentCount(entity);
    const outgoingSegment = vertex % segmentCount(entity);
    const incoming = straightSegmentEntity(entity, incomingSegment);
    const outgoing = straightSegmentEntity(entity, outgoingSegment);
    if (!incoming || !outgoing) { skippedVertices.push(vertex); continue; }
    const geometry = chamferLineLikePair(incoming, incoming.start, outgoing, outgoing.end, specification, trimMode);
    if (geometry.reason || !geometry.chamferPoints) { skippedVertices.push(vertex); continue; }
    const incomingLength = distance(incoming.start, incoming.end);
    const outgoingLength = distance(outgoing.start, outgoing.end);
    const incomingParameter = segmentParameter(incoming.start, incoming.end, geometry.chamferPoints[0]);
    const outgoingParameter = segmentParameter(outgoing.start, outgoing.end, geometry.chamferPoints[1]);
    if (incomingParameter === null || outgoingParameter === null) { skippedVertices.push(vertex); continue; }
    const candidate: PlannedCorner = {
      vertex,
      incomingSegment,
      outgoingSegment,
      incomingConsumption: clean(incomingLength * (1 - incomingParameter)),
      outgoingConsumption: clean(outgoingLength * outgoingParameter),
      incoming: geometry.chamferPoints[0],
      outgoing: geometry.chamferPoints[1],
      line: geometry.line,
    };
    if (trimMode === "trim") {
      if (incomingParameter < -CHAMFER_EPSILON || incomingParameter > 1 + CHAMFER_EPSILON || outgoingParameter < -CHAMFER_EPSILON || outgoingParameter > 1 + CHAMFER_EPSILON) {
        skippedVertices.push(vertex); continue;
      }
      const previousVertex = (vertex - 1 + entity.vertices.length) % entity.vertices.length;
      const nextVertex = (vertex + 1) % entity.vertices.length;
      const previous = planByVertex.get(previousVertex);
      const next = planByVertex.get(nextVertex);
      if ((previous && previous.outgoingSegment === incomingSegment && previous.outgoingConsumption + candidate.incomingConsumption >= incomingLength - CHAMFER_EPSILON)
        || (next && candidate.outgoingSegment === next.incomingSegment && candidate.outgoingConsumption + next.incomingConsumption >= outgoingLength - CHAMFER_EPSILON)) {
        skippedVertices.push(vertex); continue;
      }
    }
    planByVertex.set(vertex, candidate);
  }
  const activePlans = [...planByVertex.values()].sort((first, second) => first.vertex - second.vertex);
  if (activePlans.length === 0) return { entity: structuredClone(entity), lines: [], chamferCount: 0, skippedVertices: skippedVertices.sort((a, b) => a - b), reason: null };
  const lines = activePlans.flatMap((plan) => plan.line ? [plan.line] : []);
  if (trimMode === "no-trim") return { entity: structuredClone(entity), lines, chamferCount: activePlans.length, skippedVertices: skippedVertices.sort((a, b) => a - b), reason: null };
  const vertices: CadPolylineVertex[] = [];
  if (!entity.closed) {
    vertices.push(structuredClone(entity.vertices[0]!));
    for (let index = 1; index < entity.vertices.length - 1; index += 1) {
      const plan = planByVertex.get(index);
      if (plan && isIdentityCorner(plan, entity.vertices[index]!)) vertices.push(structuredClone(entity.vertices[index]!));
      else if (plan) vertices.push(pointVertex(plan.incoming), pointVertex(plan.outgoing, entity.vertices[index]));
      else vertices.push(structuredClone(entity.vertices[index]!));
    }
    vertices.push(structuredClone(entity.vertices.at(-1)!));
  } else {
    const zero = planByVertex.get(0);
    vertices.push(zero && !isIdentityCorner(zero, entity.vertices[0]!) ? pointVertex(zero.outgoing, entity.vertices[0]) : structuredClone(entity.vertices[0]!));
    for (let index = 1; index < entity.vertices.length; index += 1) {
      const plan = planByVertex.get(index);
      if (plan && isIdentityCorner(plan, entity.vertices[index]!)) vertices.push(structuredClone(entity.vertices[index]!));
      else if (plan) vertices.push(pointVertex(plan.incoming), pointVertex(plan.outgoing, entity.vertices[index]));
      else vertices.push(structuredClone(entity.vertices[index]!));
    }
    if (zero && !isIdentityCorner(zero, entity.vertices[0]!)) vertices.push(pointVertex(zero.incoming));
  }
  return { entity: { ...structuredClone(entity), vertices }, lines: [], chamferCount: activePlans.length, skippedVertices: skippedVertices.sort((a, b) => a - b), reason: null };
}
