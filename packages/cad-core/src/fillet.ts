import type { CadArc, CadCircle, CadEntity, CadLine, CadPoint2, CadPolyline, CadPolylineVertex } from "@kuubik/cad-schema";

/** Fixed model-space tolerance. Pointer tolerance remains a renderer concern. */
export const FILLET_EPSILON = 1e-9;
const FULL_TURN = Math.PI * 2;

export type FilletTrimMode = "trim" | "no-trim";
export type FilletGeometryRejectReason =
  | "unsupported-target"
  | "same-target"
  | "degenerate-geometry"
  | "no-solution"
  | "radius-too-large";

export interface FilletPairGeometryResult {
  firstEntity: CadEntity | null;
  secondEntity: CadEntity | null;
  arc: Omit<CadArc, "handle" | "layerId"> | null;
  center: CadPoint2 | null;
  tangentPoints: readonly [CadPoint2, CadPoint2] | null;
  effectiveRadius: number | null;
  reason: FilletGeometryRejectReason | null;
}

export interface FilletPolylineGeometryResult {
  entity: CadPolyline | null;
  filletCount: number;
  skippedVertices: number[];
  reason: FilletGeometryRejectReason | null;
}

type PairEntity = CadLine | CadArc | CadCircle;
type Support =
  | { kind: "line"; entity: CadLine; origin: CadPoint2; direction: CadPoint2; normal: CadPoint2 }
  | { kind: "circle"; entity: CadArc | CadCircle; center: CadPoint2; radius: number };
type OffsetSupport =
  | { kind: "line"; origin: CadPoint2; direction: CadPoint2 }
  | { kind: "circle"; center: CadPoint2; radius: number; tangentDirection: 1 | -1 };

const add = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x + second.x, y: first.y + second.y });
const subtract = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x - second.x, y: first.y - second.y });
const scaled = (point: CadPoint2, factor: number): CadPoint2 => ({ x: point.x * factor, y: point.y * factor });
const dot = (first: CadPoint2, second: CadPoint2): number => first.x * second.x + first.y * second.y;
const cross = (first: CadPoint2, second: CadPoint2): number => first.x * second.y - first.y * second.x;
const length = (point: CadPoint2): number => Math.hypot(point.x, point.y);
const distance = (first: CadPoint2, second: CadPoint2): number => length(subtract(second, first));
const finitePoint = (point: CadPoint2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const normalizedAngle = (value: number): number => ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
const clean = (value: number): number => Math.abs(value) <= 1e-12 ? 0 : Number(value.toFixed(12));
const cleanPoint = (point: CadPoint2): CadPoint2 => ({ x: clean(point.x), y: clean(point.y) });

function unit(vector: CadPoint2): CadPoint2 | null {
  const magnitude = length(vector);
  return magnitude > FILLET_EPSILON ? scaled(vector, 1 / magnitude) : null;
}

function supportOf(entity: CadEntity): Support | null {
  if (entity.kind === "line") {
    const direction = unit(subtract(entity.end, entity.start));
    return direction ? { kind: "line", entity, origin: entity.start, direction, normal: { x: -direction.y, y: direction.x } } : null;
  }
  if (entity.kind === "arc" || entity.kind === "circle") {
    return entity.radius > FILLET_EPSILON && finitePoint(entity.center)
      ? { kind: "circle", entity, center: entity.center, radius: entity.radius }
      : null;
  }
  return null;
}

function lineLineIntersection(first: Extract<OffsetSupport, { kind: "line" }>, second: Extract<OffsetSupport, { kind: "line" }>): CadPoint2 | null {
  const denominator = cross(first.direction, second.direction);
  if (Math.abs(denominator) <= FILLET_EPSILON) return null;
  const parameter = cross(subtract(second.origin, first.origin), second.direction) / denominator;
  return cleanPoint(add(first.origin, scaled(first.direction, parameter)));
}

function lineCircleIntersections(line: Extract<OffsetSupport, { kind: "line" }>, circle: Extract<OffsetSupport, { kind: "circle" }>): CadPoint2[] {
  const relative = subtract(line.origin, circle.center);
  const projected = dot(relative, line.direction);
  const constant = dot(relative, relative) - circle.radius * circle.radius;
  const discriminant = projected * projected - constant;
  if (discriminant < -FILLET_EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [...new Set([clean(-projected - root), clean(-projected + root)])]
    .map((parameter) => cleanPoint(add(line.origin, scaled(line.direction, parameter))));
}

function circleCircleIntersections(first: Extract<OffsetSupport, { kind: "circle" }>, second: Extract<OffsetSupport, { kind: "circle" }>): CadPoint2[] {
  const delta = subtract(second.center, first.center);
  const separation = length(delta);
  if (!(separation > FILLET_EPSILON) || separation > first.radius + second.radius + FILLET_EPSILON || separation < Math.abs(first.radius - second.radius) - FILLET_EPSILON) return [];
  const along = (first.radius * first.radius - second.radius * second.radius + separation * separation) / (2 * separation);
  const heightSquared = first.radius * first.radius - along * along;
  if (heightSquared < -FILLET_EPSILON) return [];
  const axis = scaled(delta, 1 / separation);
  const base = add(first.center, scaled(axis, along));
  const normal = { x: -axis.y, y: axis.x };
  const height = Math.sqrt(Math.max(0, heightSquared));
  return [...new Set([-height, height].map(clean))].map((offset) => cleanPoint(add(base, scaled(normal, offset))));
}

function offsetIntersections(first: OffsetSupport, second: OffsetSupport): CadPoint2[] {
  if (first.kind === "line" && second.kind === "line") {
    const point = lineLineIntersection(first, second);
    return point ? [point] : [];
  }
  if (first.kind === "line" && second.kind === "circle") return lineCircleIntersections(first, second);
  if (first.kind === "circle" && second.kind === "line") return lineCircleIntersections(second, first);
  return circleCircleIntersections(first as Extract<OffsetSupport, { kind: "circle" }>, second as Extract<OffsetSupport, { kind: "circle" }>);
}

function offsetSupports(support: Support, radius: number): OffsetSupport[] {
  if (support.kind === "line") return [-1, 1].map((side) => ({
    kind: "line" as const,
    origin: add(support.origin, scaled(support.normal, radius * side)),
    direction: support.direction,
  }));
  const candidates: Array<{ radius: number; tangentDirection: 1 | -1 }> = [
    { radius: support.radius + radius, tangentDirection: 1 },
    { radius: Math.abs(support.radius - radius), tangentDirection: support.radius >= radius ? 1 : -1 },
  ];
  return candidates
    .filter((candidate) => candidate.radius > FILLET_EPSILON)
    .filter((candidate, index, all) => index === all.findIndex((item) => Math.abs(item.radius - candidate.radius) <= FILLET_EPSILON && item.tangentDirection === candidate.tangentDirection))
    .map((candidate) => ({ kind: "circle" as const, center: support.center, radius: clean(candidate.radius), tangentDirection: candidate.tangentDirection }));
}

function tangentPoint(support: Support, offset: OffsetSupport, center: CadPoint2): CadPoint2 | null {
  if (support.kind === "line") {
    const parameter = dot(subtract(center, support.origin), support.direction);
    return cleanPoint(add(support.origin, scaled(support.direction, parameter)));
  }
  const radial = unit(subtract(center, support.center));
  const tangentDirection = offset.kind === "circle" ? offset.tangentDirection : 1;
  return radial ? cleanPoint(add(support.center, scaled(radial, support.radius * tangentDirection))) : null;
}

function arcFromTangencies(
  center: CadPoint2,
  radius: number,
  first: CadPoint2,
  second: CadPoint2,
  preferredMidpointDirection?: CadPoint2,
): Omit<CadArc, "handle" | "layerId"> | null {
  const startAngleRad = Math.atan2(first.y - center.y, first.x - center.x);
  const endAngleRad = Math.atan2(second.y - center.y, second.x - center.x);
  const counterClockwiseSweep = normalizedAngle(endAngleRad - startAngleRad);
  const clockwiseSweep = normalizedAngle(startAngleRad - endAngleRad);
  if (Math.min(counterClockwiseSweep, clockwiseSweep) <= FILLET_EPSILON) return null;
  let counterClockwise = counterClockwiseSweep <= clockwiseSweep;
  if (preferredMidpointDirection && Math.abs(counterClockwiseSweep - clockwiseSweep) <= FILLET_EPSILON) {
    const ccwMidpointDirection = {
      x: Math.cos(startAngleRad + counterClockwiseSweep / 2),
      y: Math.sin(startAngleRad + counterClockwiseSweep / 2),
    };
    const clockwiseMidpointDirection = {
      x: Math.cos(startAngleRad - clockwiseSweep / 2),
      y: Math.sin(startAngleRad - clockwiseSweep / 2),
    };
    counterClockwise = dot(ccwMidpointDirection, preferredMidpointDirection) >= dot(clockwiseMidpointDirection, preferredMidpointDirection);
  }
  return {
    kind: "arc",
    center: cleanPoint(center),
    radius: clean(radius),
    startAngleRad: clean(startAngleRad),
    endAngleRad: clean(endAngleRad),
    counterClockwise,
  };
}

function pointOnArc(entity: CadArc, atStart: boolean): CadPoint2 {
  const angle = atStart ? entity.startAngleRad : entity.endAngleRad;
  return { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) };
}

function replaceStartEndpoint(entity: CadLine | CadArc, pick: CadPoint2, corner: CadPoint2 | null): boolean {
  const start = entity.kind === "line" ? entity.start : pointOnArc(entity, true);
  const end = entity.kind === "line" ? entity.end : pointOnArc(entity, false);
  if (corner && entity.kind === "line") {
    const direction = unit(subtract(end, start));
    if (direction) {
      const selectedProjection = dot(subtract(pick, corner), direction);
      if (Math.abs(selectedProjection) > FILLET_EPSILON) {
        const selectedSign = Math.sign(selectedProjection);
        const startRayScore = dot(subtract(start, corner), direction) * selectedSign;
        const endRayScore = dot(subtract(end, corner), direction) * selectedSign;
        if (Math.abs(startRayScore - endRayScore) > FILLET_EPSILON) return startRayScore < endRayScore;
      }
    }
    return distance(corner, start) <= distance(corner, end);
  }
  const startPickDistance = distance(pick, start);
  const endPickDistance = distance(pick, end);
  if (!corner && Math.abs(startPickDistance - endPickDistance) > FILLET_EPSILON) return startPickDistance < endPickDistance;
  if (corner && Math.abs(startPickDistance - endPickDistance) > FILLET_EPSILON) return endPickDistance < startPickDistance;
  return corner ? distance(corner, start) <= distance(corner, end) : true;
}

function trimmedEntity(entity: PairEntity, pick: CadPoint2, tangent: CadPoint2, corner: CadPoint2 | null): PairEntity {
  if (entity.kind === "circle") return structuredClone(entity);
  if (entity.kind === "line") {
    return replaceStartEndpoint(entity, pick, corner)
      ? { ...structuredClone(entity), start: tangent }
      : { ...structuredClone(entity), end: tangent };
  }
  return replaceStartEndpoint(entity, pick, corner)
    ? { ...structuredClone(entity), startAngleRad: Math.atan2(tangent.y - entity.center.y, tangent.x - entity.center.x) }
    : { ...structuredClone(entity), endAngleRad: Math.atan2(tangent.y - entity.center.y, tangent.x - entity.center.x) };
}

function supportIntersection(first: Support, second: Support): CadPoint2[] {
  const firstOffset: OffsetSupport = first.kind === "line" ? { kind: "line", origin: first.origin, direction: first.direction } : { kind: "circle", center: first.center, radius: first.radius, tangentDirection: 1 };
  const secondOffset: OffsetSupport = second.kind === "line" ? { kind: "line", origin: second.origin, direction: second.direction } : { kind: "circle", center: second.center, radius: second.radius, tangentDirection: 1 };
  return offsetIntersections(firstOffset, secondOffset);
}

function sharpCorner(first: PairEntity, firstPick: CadPoint2, second: PairEntity, secondPick: CadPoint2, trimMode: FilletTrimMode): FilletPairGeometryResult {
  const firstSupport = supportOf(first)!; const secondSupport = supportOf(second)!;
  const intersections = supportIntersection(firstSupport, secondSupport);
  if (intersections.length === 0) return { firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason: "no-solution" };
  const intersection = intersections.sort((a, b) => distance(a, firstPick) + distance(a, secondPick) - distance(b, firstPick) - distance(b, secondPick))[0]!;
  if (trimMode === "no-trim") return { firstEntity: structuredClone(first), secondEntity: structuredClone(second), arc: null, center: intersection, tangentPoints: [intersection, intersection], effectiveRadius: 0, reason: null };
  return {
    firstEntity: trimmedEntity(first, firstPick, intersection, intersection),
    secondEntity: trimmedEntity(second, secondPick, intersection, intersection),
    arc: null,
    center: intersection,
    tangentPoints: [intersection, intersection],
    effectiveRadius: 0,
    reason: null,
  };
}

function parallelLineRound(first: CadLine, firstPick: CadPoint2, second: CadLine, secondPick: CadPoint2, trimMode: FilletTrimMode): FilletPairGeometryResult {
  const firstSupport = supportOf(first) as Extract<Support, { kind: "line" }>;
  const separationVector = subtract(second.start, first.start);
  const signedSeparation = cross(firstSupport.direction, separationVector);
  const effectiveRadius = Math.abs(signedSeparation) / 2;
  if (!(effectiveRadius > FILLET_EPSILON)) return { firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason: "no-solution" };
  const firstParameter = dot(subtract(firstPick, firstSupport.origin), firstSupport.direction);
  const secondParameter = dot(subtract(secondPick, firstSupport.origin), firstSupport.direction);
  const parameter = (firstParameter + secondParameter) / 2;
  const firstTangent = cleanPoint(add(firstSupport.origin, scaled(firstSupport.direction, parameter)));
  const secondTangent = cleanPoint(add(firstTangent, scaled(firstSupport.normal, signedSeparation)));
  const center = cleanPoint(scaled(add(firstTangent, secondTangent), 0.5));
  const replaceFirstStart = replaceStartEndpoint(first, firstPick, null);
  const outwardDirection = scaled(firstSupport.direction, replaceFirstStart ? -1 : 1);
  const arc = arcFromTangencies(center, effectiveRadius, firstTangent, secondTangent, outwardDirection);
  if (!arc) return { firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason: "no-solution" };
  return {
    firstEntity: trimMode === "trim" ? trimmedEntity(first, firstPick, firstTangent, null) : structuredClone(first),
    secondEntity: trimMode === "trim" ? trimmedEntity(second, secondPick, secondTangent, null) : structuredClone(second),
    arc,
    center,
    tangentPoints: [firstTangent, secondTangent],
    effectiveRadius: clean(effectiveRadius),
    reason: null,
  };
}

/** Pure pair predicate used identically by preview and commit. */
export function filletCadEntityPair(
  first: CadEntity,
  firstPick: CadPoint2,
  second: CadEntity,
  secondPick: CadPoint2,
  radius: number,
  trimMode: FilletTrimMode = "trim",
): FilletPairGeometryResult {
  const rejected = (reason: FilletGeometryRejectReason): FilletPairGeometryResult => ({ firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason });
  if (first.handle === second.handle) return rejected("same-target");
  if (!finitePoint(firstPick) || !finitePoint(secondPick) || !Number.isFinite(radius) || radius < 0) return rejected("degenerate-geometry");
  const firstSupport = supportOf(first); const secondSupport = supportOf(second);
  if (!firstSupport || !secondSupport) return rejected("unsupported-target");
  if (radius <= FILLET_EPSILON) return sharpCorner(firstSupport.entity, firstPick, secondSupport.entity, secondPick, trimMode);
  if (firstSupport.kind === "line" && secondSupport.kind === "line" && Math.abs(cross(firstSupport.direction, secondSupport.direction)) <= FILLET_EPSILON) {
    return parallelLineRound(firstSupport.entity, firstPick, secondSupport.entity, secondPick, trimMode);
  }

  const supportCorners = supportIntersection(firstSupport, secondSupport);
  const corner = supportCorners.length
    ? [...supportCorners].sort((firstCorner, secondCorner) => distance(firstCorner, firstPick) + distance(firstCorner, secondPick) - distance(secondCorner, firstPick) - distance(secondCorner, secondPick))[0]!
    : null;
  const candidates = offsetSupports(firstSupport, radius).flatMap((firstOffset) =>
    offsetSupports(secondSupport, radius).flatMap((secondOffset) => offsetIntersections(firstOffset, secondOffset).flatMap((center) => {
      const firstTangent = tangentPoint(firstSupport, firstOffset, center); const secondTangent = tangentPoint(secondSupport, secondOffset, center);
      if (!firstTangent || !secondTangent) return [];
      const arc = arcFromTangencies(center, radius, firstTangent, secondTangent);
      if (!arc) return [];
      return [{ center, firstTangent, secondTangent, arc, score: distance(firstPick, firstTangent) + distance(secondPick, secondTangent) }];
    })),
  ).sort((firstCandidate, secondCandidate) => firstCandidate.score - secondCandidate.score);
  const candidate = candidates[0];
  if (!candidate) return rejected("no-solution");
  return {
    firstEntity: trimMode === "trim" ? trimmedEntity(firstSupport.entity, firstPick, candidate.firstTangent, corner) : structuredClone(firstSupport.entity),
    secondEntity: trimMode === "trim" ? trimmedEntity(secondSupport.entity, secondPick, candidate.secondTangent, corner) : structuredClone(secondSupport.entity),
    arc: candidate.arc,
    center: candidate.center,
    tangentPoints: [candidate.firstTangent, candidate.secondTangent],
    effectiveRadius: clean(radius),
    reason: null,
  };
}

interface PolylineCorner {
  before: CadPoint2;
  after: CadPoint2;
  bulge: number;
  beforeDistance: number;
  afterDistance: number;
}

function polylineCorner(previous: CadPoint2, corner: CadPoint2, next: CadPoint2, radius: number): PolylineCorner | null {
  const toPrevious = unit(subtract(previous, corner)); const toNext = unit(subtract(next, corner));
  if (!toPrevious || !toNext) return null;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(toPrevious, toNext))));
  const turn = cross(subtract(corner, previous), subtract(next, corner));
  if (angle <= FILLET_EPSILON || Math.PI - angle <= FILLET_EPSILON || Math.abs(turn) <= FILLET_EPSILON) return null;
  const tangentDistance = radius / Math.tan(angle / 2);
  if (!(tangentDistance > FILLET_EPSILON)) return null;
  const sweep = Math.PI - angle;
  return {
    before: cleanPoint(add(corner, scaled(toPrevious, tangentDistance))),
    after: cleanPoint(add(corner, scaled(toNext, tangentDistance))),
    bulge: clean(Math.sign(turn) * Math.tan(sweep / 4)),
    beforeDistance: tangentDistance,
    afterDistance: tangentDistance,
  };
}

/** FILLET Polyline option for straight 2D polylines. Existing bulges/widths are rejected explicitly. */
export function filletCadPolyline(entity: CadPolyline, radius: number): FilletPolylineGeometryResult {
  const rejected = (reason: FilletGeometryRejectReason): FilletPolylineGeometryResult => ({ entity: null, filletCount: 0, skippedVertices: [], reason });
  if (!Number.isFinite(radius) || radius < 0 || entity.vertices.length < (entity.closed ? 3 : 2)) return rejected("degenerate-geometry");
  if (entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > FILLET_EPSILON || vertex.startWidth !== undefined || vertex.endWidth !== undefined)) return rejected("unsupported-target");
  if (radius <= FILLET_EPSILON) return { entity: structuredClone(entity), filletCount: 0, skippedVertices: [], reason: null };
  const count = entity.vertices.length;
  const corners = Array.from({ length: count }, (_, index) => {
    if (!entity.closed && (index === 0 || index === count - 1)) return null;
    const previous = entity.vertices[(index - 1 + count) % count]!;
    const current = entity.vertices[index]!;
    const next = entity.vertices[(index + 1) % count]!;
    return polylineCorner(previous, current, next, radius);
  });
  const valid = corners.map((corner) => corner !== null);
  for (let segment = 0; segment < (entity.closed ? count : count - 1); segment += 1) {
    const next = (segment + 1) % count;
    const available = distance(entity.vertices[segment]!, entity.vertices[next]!);
    const used = (valid[segment] ? corners[segment]!.afterDistance : 0) + (valid[next] ? corners[next]!.beforeDistance : 0);
    if (used > available + FILLET_EPSILON) {
      if (valid[segment]) valid[segment] = false;
      if (valid[next]) valid[next] = false;
    }
  }
  const vertices: CadPolylineVertex[] = [];
  for (let index = 0; index < count; index += 1) {
    const corner = corners[index];
    if (!corner || !valid[index]) vertices.push(structuredClone(entity.vertices[index]!));
    else vertices.push({ ...corner.before, bulge: corner.bulge }, corner.after);
  }
  const filletCount = valid.filter(Boolean).length;
  const skippedVertices = corners.flatMap((corner, index) => corner && !valid[index] ? [index] : []);
  return filletCount > 0
    ? { entity: { ...structuredClone(entity), vertices }, filletCount, skippedVertices, reason: null }
    : { entity: null, filletCount: 0, skippedVertices, reason: "radius-too-large" };
}
