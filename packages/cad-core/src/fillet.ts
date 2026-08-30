import type { CadArc, CadCircle, CadEntity, CadLine, CadPoint2, CadPolyline, CadPolylineVertex, CadRay, CadXline } from "@kuubik/cad-schema";
import { trimClosestPoint, trimCurveIntersections, trimCurvePiece, trimCurvesOfEntity, trimPointAt, type TrimArcCurve, type TrimCurve, type TrimLineCurve } from "./trim.js";

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
  /** AutoCAD joins a trimmed LINE + open 2D POLYLINE into the polyline. */
  joinedPolyline?: CadPolyline;
}

export interface FilletPolylineGeometryResult {
  entity: CadPolyline | null;
  arcs: Array<Omit<CadArc, "handle" | "layerId">>;
  filletCount: number;
  skippedVertices: number[];
  reason: FilletGeometryRejectReason | null;
}

export interface FilletPolylineOptions {
  trimMode?: FilletTrimMode;
  /** Mirrors the AutoCAD FILLETPOLYARC system variable for the Polyline option. */
  filletPolylineArc?: 0 | 1;
}

type LinePairEntity = CadLine | CadRay | CadXline;
type PairEntity = LinePairEntity | CadArc | CadCircle;
type LineSupport = { kind: "line"; entity: LinePairEntity; origin: CadPoint2; direction: CadPoint2; normal: CadPoint2 };
type Support =
  | LineSupport
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
  if (entity.kind === "ray" || entity.kind === "xline") {
    const direction = unit(entity.direction);
    return direction ? { kind: "line", entity, origin: entity.basePoint, direction, normal: { x: -direction.y, y: direction.x } } : null;
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

function trimmedEntity(entity: PairEntity, pick: CadPoint2, tangent: CadPoint2, corner: CadPoint2 | null): CadEntity | null {
  if (entity.kind === "circle") return structuredClone(entity);
  if (entity.kind === "xline") {
    const sourceDirection = unit(entity.direction);
    if (!sourceDirection) return null;
    const selectedSign = dot(subtract(pick, tangent), sourceDirection) < 0 ? -1 : 1;
    const source = structuredClone(entity);
    const { kind: _kind, basePoint: _basePoint, direction: _direction, ...base } = source;
    return {
      ...base,
      kind: "ray",
      basePoint: cleanPoint(tangent),
      direction: cleanPoint(scaled(sourceDirection, selectedSign)),
    };
  }
  if (entity.kind === "ray") {
    if (distance(entity.basePoint, tangent) <= FILLET_EPSILON) return null;
    const source = structuredClone(entity);
    const { kind: _kind, basePoint, direction: _direction, ...base } = source;
    return { ...base, kind: "line", start: basePoint, end: cleanPoint(tangent) };
  }
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

function fullParametricCurve(curve: TrimCurve): boolean {
  return curve.kind === "spline" ? curve.closed : (curve.kind === "arc" || curve.kind === "ellipse") && Math.abs(Math.abs(curve.sweep) - FULL_TURN) <= 1e-8;
}

function boundedParameter(curve: TrimCurve, parameter: number): number {
  if (fullParametricCurve(curve)) return ((parameter % 1) + 1) % 1;
  return Math.max(0, Math.min(1, parameter));
}

function curveTangent(curve: TrimCurve, parameter: number): CadPoint2 | null {
  const step = 1e-5;
  const beforeParameter = boundedParameter(curve, parameter - step);
  const afterParameter = boundedParameter(curve, parameter + step);
  if (!fullParametricCurve(curve) && Math.abs(afterParameter - beforeParameter) <= 1e-12) return null;
  return unit(subtract(trimPointAt(curve, afterParameter), trimPointAt(curve, beforeParameter)));
}

function offsetCurvePoint(curve: TrimCurve, parameter: number, side: -1 | 1, radius: number): CadPoint2 | null {
  const tangent = curveTangent(curve, parameter);
  if (!tangent) return null;
  const normal = { x: -tangent.y, y: tangent.x };
  return add(trimPointAt(curve, boundedParameter(curve, parameter)), scaled(normal, side * radius));
}

function offsetCurveDerivative(curve: TrimCurve, parameter: number, side: -1 | 1, radius: number): CadPoint2 | null {
  const step = 1e-5;
  const beforeParameter = boundedParameter(curve, parameter - step);
  const afterParameter = boundedParameter(curve, parameter + step);
  const before = offsetCurvePoint(curve, beforeParameter, side, radius);
  const after = offsetCurvePoint(curve, afterParameter, side, radius);
  if (!before || !after) return null;
  const parameterSpan = fullParametricCurve(curve) ? step * 2 : afterParameter - beforeParameter;
  return Math.abs(parameterSpan) > 1e-12 ? scaled(subtract(after, before), 1 / parameterSpan) : null;
}

interface NumericFilletCandidate {
  center: CadPoint2;
  firstParameter: number;
  secondParameter: number;
  firstTangent: CadPoint2;
  secondTangent: CadPoint2;
  arc: Omit<CadArc, "handle" | "layerId">;
  score: number;
}

function numericFilletCandidates(
  firstCurve: TrimCurve,
  firstPick: CadPoint2,
  secondCurve: TrimCurve,
  secondPick: CadPoint2,
  radius: number,
): NumericFilletCandidate[] {
  const firstSeed = [trimPointParameter(firstCurve, firstPick), 0, 0.25, 0.5, 0.75, 1];
  const secondSeed = [trimPointParameter(secondCurve, secondPick), 0, 0.25, 0.5, 0.75, 1];
  const candidates: NumericFilletCandidate[] = [];
  for (const firstSide of [-1, 1] as const) for (const secondSide of [-1, 1] as const) {
    for (const firstStart of firstSeed) for (const secondStart of secondSeed) {
      let firstParameter = boundedParameter(firstCurve, firstStart);
      let secondParameter = boundedParameter(secondCurve, secondStart);
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const firstOffset = offsetCurvePoint(firstCurve, firstParameter, firstSide, radius);
        const secondOffset = offsetCurvePoint(secondCurve, secondParameter, secondSide, radius);
        if (!firstOffset || !secondOffset) break;
        const residual = subtract(firstOffset, secondOffset);
        if (length(residual) <= Math.max(1e-7, radius * 1e-8)) break;
        const firstDerivative = offsetCurveDerivative(firstCurve, firstParameter, firstSide, radius);
        const secondDerivative = offsetCurveDerivative(secondCurve, secondParameter, secondSide, radius);
        if (!firstDerivative || !secondDerivative) break;
        const secondColumn = scaled(secondDerivative, -1);
        const determinant = cross(firstDerivative, secondColumn);
        if (Math.abs(determinant) <= 1e-14) break;
        const negativeResidual = scaled(residual, -1);
        const firstDelta = Math.max(-0.25, Math.min(0.25, cross(negativeResidual, secondColumn) / determinant));
        const secondDelta = Math.max(-0.25, Math.min(0.25, cross(firstDerivative, negativeResidual) / determinant));
        firstParameter = boundedParameter(firstCurve, firstParameter + firstDelta);
        secondParameter = boundedParameter(secondCurve, secondParameter + secondDelta);
      }
      const firstCenter = offsetCurvePoint(firstCurve, firstParameter, firstSide, radius);
      const secondCenter = offsetCurvePoint(secondCurve, secondParameter, secondSide, radius);
      if (!firstCenter || !secondCenter || distance(firstCenter, secondCenter) > Math.max(1e-5, radius * 1e-6)) continue;
      const center = cleanPoint(scaled(add(firstCenter, secondCenter), 0.5));
      const firstTangent = cleanPoint(trimPointAt(firstCurve, firstParameter));
      const secondTangent = cleanPoint(trimPointAt(secondCurve, secondParameter));
      const arc = arcFromTangencies(center, radius, firstTangent, secondTangent);
      if (!arc || distance(firstTangent, secondTangent) <= FILLET_EPSILON) continue;
      if (candidates.some((candidate) => distance(candidate.center, center) <= 1e-6)) continue;
      candidates.push({ center, firstParameter, secondParameter, firstTangent, secondTangent, arc, score: distance(firstPick, firstTangent) + distance(secondPick, secondTangent) });
    }
  }
  return candidates.sort((first, second) => first.score - second.score);
}

function trimPointParameter(curve: TrimCurve, point: CadPoint2): number {
  let bestParameter = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const samples = curve.kind === "spline" ? Math.max(512, curve.controlPoints.length * 128) : 512;
  for (let index = 0; index <= samples; index += 1) {
    const parameter = index / samples;
    const candidateDistance = distance(trimPointAt(curve, parameter), point);
    if (candidateDistance < bestDistance) { bestDistance = candidateDistance; bestParameter = parameter; }
  }
  let span = 1 / samples;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const left = boundedParameter(curve, bestParameter - span);
    const right = boundedParameter(curve, bestParameter + span);
    const leftDistance = distance(trimPointAt(curve, left), point);
    const rightDistance = distance(trimPointAt(curve, right), point);
    if (leftDistance < bestDistance) { bestDistance = leftDistance; bestParameter = left; }
    if (rightDistance < bestDistance) { bestDistance = rightDistance; bestParameter = right; }
    span /= 2;
  }
  return bestParameter;
}

function trimParametricEntity(entity: CadEntity, curve: TrimCurve, pick: CadPoint2, tangentParameter: number): CadEntity | null {
  if (fullParametricCurve(curve)) return structuredClone(entity);
  const pickParameter = trimPointParameter(curve, pick);
  const replaceStart = pickParameter <= 0.5;
  return replaceStart
    ? trimCurvePiece(entity, curve, tangentParameter, 1)
    : trimCurvePiece(entity, curve, 0, tangentParameter);
}

function numericSharpCorner(first: CadEntity, firstCurve: TrimCurve, firstPick: CadPoint2, second: CadEntity, secondCurve: TrimCurve, secondPick: CadPoint2, trimMode: FilletTrimMode): FilletPairGeometryResult | null {
  const intersection = trimCurveIntersections(firstCurve, secondCurve, false, false)
    .sort((a, b) => distance(a.point, firstPick) + distance(a.point, secondPick) - distance(b.point, firstPick) - distance(b.point, secondPick))[0];
  if (!intersection) return null;
  if (trimMode === "no-trim") return { firstEntity: structuredClone(first), secondEntity: structuredClone(second), arc: null, center: intersection.point, tangentPoints: [intersection.point, intersection.point], effectiveRadius: 0, reason: null };
  const firstEntity = trimParametricEntity(first, firstCurve, firstPick, intersection.first);
  const secondEntity = trimParametricEntity(second, secondCurve, secondPick, intersection.second);
  return firstEntity && secondEntity
    ? { firstEntity, secondEntity, arc: null, center: intersection.point, tangentPoints: [intersection.point, intersection.point], effectiveRadius: 0, reason: null }
    : null;
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

function parallelLineRound(firstSupport: LineSupport, firstPick: CadPoint2, secondSupport: LineSupport, secondPick: CadPoint2, trimMode: FilletTrimMode): FilletPairGeometryResult {
  const first = firstSupport.entity; const second = secondSupport.entity;
  const separationVector = subtract(secondSupport.origin, firstSupport.origin);
  const signedSeparation = cross(firstSupport.direction, separationVector);
  const effectiveRadius = Math.abs(signedSeparation) / 2;
  if (!(effectiveRadius > FILLET_EPSILON)) return { firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason: "no-solution" };
  const firstParameter = dot(subtract(firstPick, firstSupport.origin), firstSupport.direction);
  const secondParameter = dot(subtract(secondPick, firstSupport.origin), firstSupport.direction);
  const parameter = (firstParameter + secondParameter) / 2;
  const firstTangent = cleanPoint(add(firstSupport.origin, scaled(firstSupport.direction, parameter)));
  const secondTangent = cleanPoint(add(firstTangent, scaled(firstSupport.normal, signedSeparation)));
  const center = cleanPoint(scaled(add(firstTangent, secondTangent), 0.5));
  const outwardDirection = first.kind === "line"
    ? scaled(firstSupport.direction, replaceStartEndpoint(first, firstPick, null) ? -1 : 1)
    : scaled(
        firstSupport.direction,
        dot(subtract(firstPick, firstTangent), firstSupport.direction) < 0 ? -1 : 1,
      );
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
  if (!firstSupport || !secondSupport) {
    const firstCurves = trimCurvesOfEntity(first); const secondCurves = trimCurvesOfEntity(second);
    if (firstCurves.length !== 1 || secondCurves.length !== 1 || first.kind === "polyline" || second.kind === "polyline") return rejected("unsupported-target");
    const firstCurve = firstCurves[0]!; const secondCurve = secondCurves[0]!;
    if (radius <= FILLET_EPSILON) return numericSharpCorner(first, firstCurve, firstPick, second, secondCurve, secondPick, trimMode) ?? rejected("no-solution");
    const candidate = numericFilletCandidates(firstCurve, firstPick, secondCurve, secondPick, radius)[0];
    if (!candidate) return rejected("no-solution");
    const firstEntity = trimMode === "trim" ? trimParametricEntity(first, firstCurve, firstPick, candidate.firstParameter) : structuredClone(first);
    const secondEntity = trimMode === "trim" ? trimParametricEntity(second, secondCurve, secondPick, candidate.secondParameter) : structuredClone(second);
    if (!firstEntity || !secondEntity) return rejected("radius-too-large");
    return {
      firstEntity,
      secondEntity,
      arc: candidate.arc,
      center: candidate.center,
      tangentPoints: [candidate.firstTangent, candidate.secondTangent],
      effectiveRadius: clean(radius),
      reason: null,
    };
  }
  if (radius <= FILLET_EPSILON) return sharpCorner(firstSupport.entity, firstPick, secondSupport.entity, secondPick, trimMode);
  if (firstSupport.kind === "line" && secondSupport.kind === "line" && Math.abs(cross(firstSupport.direction, secondSupport.direction)) <= FILLET_EPSILON) {
    return parallelLineRound(firstSupport, firstPick, secondSupport, secondPick, trimMode);
  }

  const supportCorners = supportIntersection(firstSupport, secondSupport);
  const corner = supportCorners.length
    ? [...supportCorners].sort((firstCorner, secondCorner) => distance(firstCorner, firstPick) + distance(firstCorner, secondPick) - distance(secondCorner, firstPick) - distance(secondCorner, secondPick))[0]!
    : null;
  const candidates = offsetSupports(firstSupport, radius).flatMap((firstOffset) =>
    offsetSupports(secondSupport, radius).flatMap((secondOffset) => offsetIntersections(firstOffset, secondOffset).flatMap((center) => {
      const firstTangent = tangentPoint(firstSupport, firstOffset, center); const secondTangent = tangentPoint(secondSupport, secondOffset, center);
      if (!firstTangent || !secondTangent) return [];
      if (firstSupport.kind === "line" && firstSupport.entity.kind === "ray" && dot(subtract(firstTangent, firstSupport.origin), firstSupport.direction) < -FILLET_EPSILON) return [];
      if (secondSupport.kind === "line" && secondSupport.entity.kind === "ray" && dot(subtract(secondTangent, secondSupport.origin), secondSupport.direction) < -FILLET_EPSILON) return [];
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

/** FILLET between two selected segments of the same 2D polyline. */
export function filletCadPolylineSegmentPair(
  entity: CadPolyline,
  firstSegment: number,
  firstPick: CadPoint2,
  secondSegment: number,
  secondPick: CadPoint2,
  radius: number,
  trimMode: FilletTrimMode = "trim",
): FilletPairGeometryResult {
  const rejected = (reason: FilletGeometryRejectReason): FilletPairGeometryResult => ({ firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason });
  const curves = trimCurvesOfEntity(entity);
  const segmentCount = entity.closed ? entity.vertices.length : entity.vertices.length - 1;
  if (curves.length !== segmentCount || !Number.isInteger(firstSegment) || !Number.isInteger(secondSegment) || firstSegment < 0 || secondSegment < 0 || firstSegment >= segmentCount || secondSegment >= segmentCount) return rejected("degenerate-geometry");
  if (firstSegment === secondSegment) return rejected("same-target");
  const next = (segment: number): number | null => {
    if (segment + 1 < segmentCount) return segment + 1;
    return entity.closed ? 0 : null;
  };
  let incoming = firstSegment; let outgoing = secondSegment; let incomingPick = firstPick; let outgoingPick = secondPick;
  let closesOpenPolyline = false;
  let removedSegment: number | null = null;
  const firstThenArcThenSecond = next(firstSegment) !== null && next(next(firstSegment)!) === secondSegment && curves[next(firstSegment)!]?.kind === "arc";
  const secondThenArcThenFirst = next(secondSegment) !== null && next(next(secondSegment)!) === firstSegment && curves[next(secondSegment)!]?.kind === "arc";
  if (firstThenArcThenSecond) {
    removedSegment = next(firstSegment)!;
  } else if (secondThenArcThenFirst) {
    [incoming, outgoing] = [outgoing, incoming];
    [incomingPick, outgoingPick] = [outgoingPick, incomingPick];
    removedSegment = next(incoming)!;
  } else if (!entity.closed && new Set([firstSegment, secondSegment]).has(0) && new Set([firstSegment, secondSegment]).has(segmentCount - 1)) {
    incoming = segmentCount - 1; outgoing = 0;
    incomingPick = firstSegment === incoming ? firstPick : secondPick;
    outgoingPick = firstSegment === outgoing ? firstPick : secondPick;
    closesOpenPolyline = true;
  } else if (next(incoming) !== outgoing) {
    if (next(outgoing) === incoming) {
      [incoming, outgoing] = [outgoing, incoming];
      [incomingPick, outgoingPick] = [outgoingPick, incomingPick];
    } else return rejected("no-solution");
  }
  const incomingCurve = curves[incoming]; const outgoingCurve = curves[outgoing];
  if (!incomingCurve || !outgoingCurve || !["line", "arc"].includes(incomingCurve.kind) || !["line", "arc"].includes(outgoingCurve.kind)) return rejected("unsupported-target");
  const incomingEntity = pairEntityFromCurve(entity, incomingCurve as TrimLineCurve | TrimArcCurve);
  const outgoingEntity = pairEntityFromCurve(entity, outgoingCurve as TrimLineCurve | TrimArcCurve);
  const geometry = filletCadEntityPair(incomingEntity, incomingPick, outgoingEntity, outgoingPick, radius, trimMode);
  if (geometry.reason || !geometry.firstEntity || !geometry.secondEntity || !geometry.tangentPoints) return rejected(geometry.reason ?? "no-solution");
  if (trimMode === "no-trim") {
    const source = structuredClone(entity);
    return { ...geometry, firstEntity: source, secondEntity: structuredClone(source) };
  }
  const mayExtendSelectedSegments = removedSegment !== null || closesOpenPolyline;
  const incomingParameter = curveParameterAt(incomingCurve as TrimLineCurve | TrimArcCurve, incomingEntity, geometry.tangentPoints[0], 1, mayExtendSelectedSegments);
  const outgoingParameter = curveParameterAt(outgoingCurve as TrimLineCurve | TrimArcCurve, outgoingEntity, geometry.tangentPoints[1], 0, mayExtendSelectedSegments);
  if (incomingParameter === null || outgoingParameter === null) return rejected("no-solution");
  if (!mayExtendSelectedSegments && (incomingParameter < -FILLET_EPSILON || incomingParameter > 1 + FILLET_EPSILON || outgoingParameter < -FILLET_EPSILON || outgoingParameter > 1 + FILLET_EPSILON)) return rejected("radius-too-large");
  const fromOutgoing = mayExtendSelectedSegments ? outgoingParameter : Math.max(0, Math.min(1, outgoingParameter));
  const toIncoming = mayExtendSelectedSegments ? incomingParameter : Math.max(0, Math.min(1, incomingParameter));
  if (toIncoming <= FILLET_EPSILON || fromOutgoing >= 1 - FILLET_EPSILON) return rejected("radius-too-large");
  const vertices: CadPolylineVertex[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    if (segment === removedSegment) continue;
    const curve = curves[segment]!;
    const from = segment === outgoing ? fromOutgoing : 0;
    const to = segment === incoming ? toIncoming : 1;
    if (to - from <= FILLET_EPSILON) return rejected("radius-too-large");
    vertices.push(vertexForCurvePiece(entity, curve, from, to));
    if (segment === incoming && geometry.arc) {
      const incomingWidth = widthAt(entity.vertices[incoming]!, toIncoming);
      const outgoingWidth = widthAt(entity.vertices[outgoing]!, fromOutgoing);
      vertices.push({
        ...cleanPoint(geometry.tangentPoints[0]),
        bulge: filletBulge(geometry.arc, geometry.tangentPoints[0], geometry.tangentPoints[1]),
        ...(incomingWidth === undefined ? {} : { startWidth: incomingWidth }),
        ...(outgoingWidth === undefined ? {} : { endWidth: outgoingWidth }),
      });
    }
  }
  const closed = entity.closed || closesOpenPolyline;
  if (!closed) vertices.push({ ...structuredClone(entity.vertices.at(-1)!), ...cleanPoint(entity.vertices.at(-1)!) });
  const output: CadPolyline = { ...structuredClone(entity), vertices, closed };
  return { ...geometry, firstEntity: output, secondEntity: structuredClone(output), arc: null };
}

/** FILLET between one selected polyline segment and a separate supported entity. */
export function filletCadPolylineSegmentWithEntity(
  polyline: CadPolyline,
  segment: number,
  polylinePick: CadPoint2,
  other: CadEntity,
  otherPick: CadPoint2,
  radius: number,
  trimMode: FilletTrimMode = "trim",
  polylineFirst = true,
): FilletPairGeometryResult {
  const rejected = (reason: FilletGeometryRejectReason): FilletPairGeometryResult => ({ firstEntity: null, secondEntity: null, arc: null, center: null, tangentPoints: null, effectiveRadius: null, reason });
  const curves = trimCurvesOfEntity(polyline);
  const segmentCount = polyline.closed ? polyline.vertices.length : polyline.vertices.length - 1;
  if (!Number.isInteger(segment) || segment < 0 || segment >= segmentCount || curves.length !== segmentCount) return rejected("degenerate-geometry");
  const curve = curves[segment];
  if (!curve || (curve.kind !== "line" && curve.kind !== "arc")) return rejected("unsupported-target");
  const segmentEntity = pairEntityFromCurve(polyline, curve);
  const geometry = polylineFirst
    ? filletCadEntityPair(segmentEntity, polylinePick, other, otherPick, radius, trimMode)
    : filletCadEntityPair(other, otherPick, segmentEntity, polylinePick, radius, trimMode);
  const polylineOutput = polylineFirst ? geometry.firstEntity : geometry.secondEntity;
  if (geometry.reason || !polylineOutput || !geometry.tangentPoints) return rejected(geometry.reason ?? "no-solution");
  if (trimMode === "no-trim") {
    return {
      ...geometry,
      firstEntity: polylineFirst ? structuredClone(polyline) : structuredClone(other),
      secondEntity: polylineFirst ? structuredClone(other) : structuredClone(polyline),
    };
  }
  const trimmedSegment = polylineOutput;
  const tangent = polylineFirst ? geometry.tangentPoints[0] : geometry.tangentPoints[1];
  if (trimmedSegment.kind !== curve.kind) return rejected("unsupported-target");
  const originalStart = trimPointAt(curve, 0); const originalEnd = trimPointAt(curve, 1);
  const trimmedStart = trimmedSegment.kind === "line" ? trimmedSegment.start : pointOnArc(trimmedSegment, true);
  const trimmedEnd = trimmedSegment.kind === "line" ? trimmedSegment.end : pointOnArc(trimmedSegment, false);
  const replacedStart = distance(originalStart, trimmedStart) > FILLET_EPSILON;
  const replacedEnd = distance(originalEnd, trimmedEnd) > FILLET_EPSILON;
  if (replacedStart === replacedEnd) return rejected("no-solution");
  const parameter = curveParameterAt(curve, segmentEntity, tangent, replacedStart ? 0 : 1, true);
  if (parameter === null || (replacedStart ? parameter >= 1 - FILLET_EPSILON : parameter <= FILLET_EPSILON)) return rejected("radius-too-large");
  const vertices = structuredClone(polyline.vertices);
  if (replacedStart) {
    vertices[segment] = vertexForCurvePiece(polyline, curve, parameter, 1);
  } else {
    vertices[segment] = vertexForCurvePiece(polyline, curve, 0, parameter);
    const nextVertex = (segment + 1) % vertices.length;
    vertices[nextVertex] = { ...vertices[nextVertex]!, ...cleanPoint(tangent) };
  }
  const output: CadPolyline = { ...structuredClone(polyline), vertices };
  let joinedPolyline: CadPolyline | undefined;
  if (!polyline.closed && other.kind === "line" && geometry.arc) {
    const lastSegment = segmentCount - 1;
    const joinsStart = segment === 0 && replacedStart;
    const joinsEnd = segment === lastSegment && replacedEnd;
    if (joinsStart || joinsEnd) {
      const joinedWidth = widthAt(polyline.vertices[segment]!, parameter);
      const joinedVertex = (point: CadPoint2, bulge?: number): CadPolylineVertex => ({
        ...cleanPoint(point),
        ...(bulge === undefined ? {} : { bulge }),
        ...(joinedWidth === undefined ? {} : { startWidth: joinedWidth, endWidth: joinedWidth }),
      });
      const trimmedOther = polylineFirst ? geometry.secondEntity : geometry.firstEntity;
      const otherTangent = polylineFirst ? geometry.tangentPoints[1] : geometry.tangentPoints[0];
      if (trimmedOther?.kind === "line") {
        const polylineToOtherBulge = polylineFirst
          ? filletBulge(geometry.arc, tangent, otherTangent)
          : -filletBulge(geometry.arc, otherTangent, tangent);
        const otherFar = distance(trimmedOther.start, otherTangent) > distance(trimmedOther.end, otherTangent)
          ? trimmedOther.start
          : trimmedOther.end;
        if (joinsEnd) {
          const joinedVertices = structuredClone(output.vertices);
          const last = joinedVertices.length - 1;
          joinedVertices[last] = joinedVertex(tangent, polylineToOtherBulge);
          joinedVertices.push(joinedVertex(otherTangent), joinedVertex(otherFar));
          joinedPolyline = { ...structuredClone(output), vertices: joinedVertices, closed: false };
        } else {
          const joinedVertices = [
            joinedVertex(otherFar),
            joinedVertex(otherTangent, -polylineToOtherBulge),
            ...structuredClone(output.vertices),
          ];
          joinedPolyline = { ...structuredClone(output), vertices: joinedVertices, closed: false };
        }
      }
    }
  }
  return {
    ...geometry,
    firstEntity: polylineFirst ? output : geometry.firstEntity,
    secondEntity: polylineFirst ? geometry.secondEntity : output,
    ...(joinedPolyline ? { joinedPolyline } : {}),
  };
}

interface PlannedPolylineCorner {
  vertex: number;
  incomingSegment: number;
  outgoingSegment: number;
  incomingParameter: number;
  outgoingParameter: number;
  before: CadPoint2;
  after: CadPoint2;
  arc: Omit<CadArc, "handle" | "layerId"> | null;
  bulge: number;
}

function pairEntityFromCurve(entity: CadPolyline, curve: TrimLineCurve | TrimArcCurve): PairEntity {
  const base = { handle: `${entity.handle}#${curve.segment}`, layerId: entity.layerId, ...(entity.appearance ? { appearance: structuredClone(entity.appearance) } : {}), ...(entity.extensionData ? { extensionData: structuredClone(entity.extensionData) } : {}) };
  if (curve.kind === "line") return { ...base, kind: "line", start: cleanPoint(curve.start), end: cleanPoint(curve.end) };
  return {
    ...base,
    kind: "arc",
    center: cleanPoint(curve.center),
    radius: clean(curve.radius),
    startAngleRad: clean(curve.startAngle),
    endAngleRad: clean(curve.startAngle + curve.sweep),
    counterClockwise: curve.sweep > 0,
  };
}

function widthAt(vertex: CadPolylineVertex, parameter: number): number | undefined {
  if (vertex.startWidth === undefined && vertex.endWidth === undefined) return undefined;
  const start = vertex.startWidth ?? 0;
  const end = vertex.endWidth ?? start;
  return clean(start + (end - start) * parameter);
}

function vertexForCurvePiece(entity: CadPolyline, curve: TrimCurve, from: number, to: number): CadPolylineVertex {
  const source = entity.vertices[curve.segment]!;
  const point = trimPointAt(curve, from);
  const sweep = curve.kind === "arc" ? curve.sweep * (to - from) : 0;
  const bulge = Math.abs(sweep) > 1e-12 ? clean(Math.tan(sweep / 4)) : undefined;
  const startWidth = widthAt(source, from);
  const endWidth = widthAt(source, to);
  return {
    ...cleanPoint(point),
    ...(bulge === undefined ? {} : { bulge }),
    ...(startWidth === undefined ? {} : { startWidth }),
    ...(endWidth === undefined ? {} : { endWidth }),
  };
}

function curveParameterAt(
  curve: TrimLineCurve | TrimArcCurve,
  entity: PairEntity,
  point: CadPoint2,
  reference: 0 | 1,
  allowExtension: boolean,
): number | null {
  if (!allowExtension) return trimClosestPoint(entity, point)?.parameter ?? null;
  if (curve.kind === "line") {
    const direction = subtract(curve.end, curve.start);
    const denominator = dot(direction, direction);
    return denominator > FILLET_EPSILON ? dot(subtract(point, curve.start), direction) / denominator : null;
  }
  if (Math.abs(curve.sweep) <= FILLET_EPSILON) return null;
  const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x);
  const raw = angle - curve.startAngle;
  return [-2, -1, 0, 1, 2]
    .map((turn) => (raw + turn * FULL_TURN) / curve.sweep)
    .sort((first, second) => Math.abs(first - reference) - Math.abs(second - reference))[0] ?? null;
}

function filletBulge(arc: Omit<CadArc, "handle" | "layerId">, from: CadPoint2, to: CadPoint2): number {
  const start = Math.atan2(from.y - arc.center.y, from.x - arc.center.x);
  const end = Math.atan2(to.y - arc.center.y, to.x - arc.center.x);
  const sweep = arc.counterClockwise ? normalizedAngle(end - start) : -normalizedAngle(start - end);
  return clean(Math.tan(sweep / 4));
}

function planPolylineCorner(
  entity: CadPolyline,
  curves: readonly TrimCurve[],
  vertex: number,
  radius: number,
  filletPolylineArc: 0 | 1,
): PlannedPolylineCorner | null {
  const segmentCount = curves.length;
  if (!entity.closed && (vertex === 0 || vertex === entity.vertices.length - 1)) return null;
  const incomingSegment = (vertex - 1 + segmentCount) % segmentCount;
  const outgoingSegment = vertex % segmentCount;
  const incoming = curves[incomingSegment]; const outgoing = curves[outgoingSegment];
  if (!incoming || !outgoing || !["line", "arc"].includes(incoming.kind) || !["line", "arc"].includes(outgoing.kind)) return null;
  if (filletPolylineArc === 0 && (incoming.kind === "arc" || outgoing.kind === "arc")) return null;
  const first = pairEntityFromCurve(entity, incoming as TrimLineCurve | TrimArcCurve);
  const second = pairEntityFromCurve(entity, outgoing as TrimLineCurve | TrimArcCurve);
  const firstPick = trimPointAt(incoming, 0.9); const secondPick = trimPointAt(outgoing, 0.1);
  const geometry = filletCadEntityPair(first, firstPick, second, secondPick, radius, "trim");
  if (geometry.reason || !geometry.tangentPoints) return null;
  const incomingClosest = trimClosestPoint(first, geometry.tangentPoints[0]);
  const outgoingClosest = trimClosestPoint(second, geometry.tangentPoints[1]);
  if (!incomingClosest || !outgoingClosest) return null;
  if (incomingClosest.parameter < -FILLET_EPSILON || incomingClosest.parameter > 1 + FILLET_EPSILON || outgoingClosest.parameter < -FILLET_EPSILON || outgoingClosest.parameter > 1 + FILLET_EPSILON) return null;
  const incomingParameter = Math.max(0, Math.min(1, incomingClosest.parameter));
  const outgoingParameter = Math.max(0, Math.min(1, outgoingClosest.parameter));
  if (incomingParameter <= FILLET_EPSILON || outgoingParameter >= 1 - FILLET_EPSILON) return null;
  const before = cleanPoint(geometry.tangentPoints[0]); const after = cleanPoint(geometry.tangentPoints[1]);
  return {
    vertex,
    incomingSegment,
    outgoingSegment,
    incomingParameter,
    outgoingParameter,
    before,
    after,
    arc: geometry.arc,
    bulge: geometry.arc ? filletBulge(geometry.arc, before, after) : 0,
  };
}

function removePolylineArcSegments(entity: CadPolyline): { entity: CadPolyline; removedCount: number } {
  let working = structuredClone(entity);
  let removedCount = 0;
  for (let attempt = 0; attempt < entity.vertices.length; attempt += 1) {
    const curves = trimCurvesOfEntity(working);
    const segmentCount = working.closed ? working.vertices.length : working.vertices.length - 1;
    let changed = false;
    for (let arcSegment = 0; arcSegment < segmentCount; arcSegment += 1) {
      if (curves[arcSegment]?.kind !== "arc") continue;
      const incoming = arcSegment - 1 >= 0 ? arcSegment - 1 : working.closed ? segmentCount - 1 : null;
      const outgoing = arcSegment + 1 < segmentCount ? arcSegment + 1 : working.closed ? 0 : null;
      if (incoming === null || outgoing === null || curves[incoming]?.kind !== "line" || curves[outgoing]?.kind !== "line") continue;
      const result = filletCadPolylineSegmentPair(
        working,
        incoming,
        trimPointAt(curves[incoming]!, 0.9),
        outgoing,
        trimPointAt(curves[outgoing]!, 0.1),
        0,
        "trim",
      );
      if (result.reason || result.firstEntity?.kind !== "polyline") continue;
      working = result.firstEntity;
      removedCount += 1;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return { entity: working, removedCount };
}

function replaceLegacyPolylineArcSegments(
  entity: CadPolyline,
  radius: number,
  trimMode: FilletTrimMode,
): { entity: CadPolyline; arcs: Array<Omit<CadArc, "handle" | "layerId">>; replacedCount: number } {
  let working = structuredClone(entity);
  const arcs: Array<Omit<CadArc, "handle" | "layerId">> = [];
  let replacedCount = 0;
  const originalCurves = trimCurvesOfEntity(entity);
  const originalArcSegments = originalCurves
    .flatMap((curve, segment) => curve.kind === "arc" ? [segment] : [])
    .sort((first: number, second: number) => second - first);

  for (const arcSegment of originalArcSegments) {
    const curves = trimCurvesOfEntity(working);
    const segmentCount = working.closed ? working.vertices.length : working.vertices.length - 1;
    const incoming = arcSegment - 1 >= 0 ? arcSegment - 1 : working.closed ? segmentCount - 1 : null;
    const outgoing = arcSegment + 1 < segmentCount ? arcSegment + 1 : working.closed ? 0 : null;
    if (incoming === null || outgoing === null || curves[arcSegment]?.kind !== "arc" || curves[incoming]?.kind !== "line" || curves[outgoing]?.kind !== "line") continue;
    const result = filletCadPolylineSegmentPair(
      working,
      incoming,
      trimPointAt(curves[incoming]!, 0.9),
      outgoing,
      trimPointAt(curves[outgoing]!, 0.1),
      radius,
      trimMode,
    );
    if (result.reason) continue;
    if (trimMode === "trim" && result.firstEntity?.kind === "polyline") working = result.firstEntity;
    if (trimMode === "no-trim" && result.arc) arcs.push(structuredClone(result.arc));
    replacedCount += 1;
  }
  return { entity: working, arcs, replacedCount };
}

/**
 * AutoCAD-style FILLET Polyline option. It preserves source segment bulges and
 * interpolated widths, honours FILLETPOLYARC, and emits separate arcs in No Trim.
 */
export function filletCadPolyline(entity: CadPolyline, radius: number, options: FilletPolylineOptions = {}): FilletPolylineGeometryResult {
  const rejected = (reason: FilletGeometryRejectReason, skippedVertices: number[] = []): FilletPolylineGeometryResult => ({ entity: null, arcs: [], filletCount: 0, skippedVertices, reason });
  if (!Number.isFinite(radius) || radius < 0 || entity.vertices.length < (entity.closed ? 3 : 2)) return rejected("degenerate-geometry");
  const trimMode = options.trimMode ?? "trim";
  const filletPolylineArc = options.filletPolylineArc ?? 1;
  if (radius <= FILLET_EPSILON) {
    if (trimMode === "no-trim") return { entity: structuredClone(entity), arcs: [], filletCount: 0, skippedVertices: [], reason: null };
    const sharp = removePolylineArcSegments(entity);
    return { entity: sharp.entity, arcs: [], filletCount: sharp.removedCount, skippedVertices: [], reason: null };
  }
  const legacy = filletPolylineArc === 0
    ? replaceLegacyPolylineArcSegments(entity, radius, trimMode)
    : { entity: structuredClone(entity), arcs: [] as Array<Omit<CadArc, "handle" | "layerId">>, replacedCount: 0 };
  const workingEntity = legacy.entity;
  const curves = trimCurvesOfEntity(workingEntity);
  const segmentCount = workingEntity.closed ? workingEntity.vertices.length : workingEntity.vertices.length - 1;
  if (curves.length !== segmentCount || curves.some((curve) => curve.kind !== "line" && curve.kind !== "arc")) return rejected("degenerate-geometry");
  const eligibleVertices = Array.from({ length: workingEntity.vertices.length }, (_, vertex) => {
    if (!workingEntity.closed && (vertex === 0 || vertex === workingEntity.vertices.length - 1)) return false;
    const incoming = curves[(vertex - 1 + segmentCount) % segmentCount];
    const outgoing = curves[vertex % segmentCount];
    return Boolean(incoming && outgoing && (filletPolylineArc === 1 || (incoming.kind === "line" && outgoing.kind === "line")));
  });
  const candidates = Array.from({ length: workingEntity.vertices.length }, (_, vertex) => planPolylineCorner(workingEntity, curves, vertex, radius, filletPolylineArc));
  const valid = candidates.map((candidate) => candidate !== null);
  let changed = true;
  while (changed) {
    changed = false;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const startVertex = segment;
      const endVertex = (segment + 1) % workingEntity.vertices.length;
      const from = valid[startVertex] ? candidates[startVertex]!.outgoingParameter : 0;
      const to = valid[endVertex] ? candidates[endVertex]!.incomingParameter : 1;
      if (to - from <= FILLET_EPSILON) {
        if (valid[startVertex]) { valid[startVertex] = false; changed = true; }
        if (valid[endVertex]) { valid[endVertex] = false; changed = true; }
      }
    }
  }
  const planned = candidates.filter((candidate, index): candidate is PlannedPolylineCorner => candidate !== null && valid[index] === true);
  const skippedVertices = eligibleVertices.flatMap((eligible, index) => eligible && valid[index] !== true ? [index] : []);
  if (planned.length === 0) {
    if (legacy.replacedCount > 0) return { entity: trimMode === "trim" ? workingEntity : structuredClone(entity), arcs: legacy.arcs, filletCount: legacy.replacedCount, skippedVertices, reason: null };
    return rejected(eligibleVertices.some(Boolean) ? "radius-too-large" : "no-solution", skippedVertices);
  }
  const arcs = [...legacy.arcs, ...planned.flatMap((candidate) => candidate.arc ? [structuredClone(candidate.arc)] : [])];
  if (trimMode === "no-trim") return { entity: structuredClone(entity), arcs, filletCount: legacy.replacedCount + planned.length, skippedVertices, reason: null };

  const byVertex = new Map(planned.map((candidate) => [candidate.vertex, candidate]));
  const vertices: CadPolylineVertex[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const curve = curves[segment]!;
    const startCorner = byVertex.get(segment);
    const endVertex = (segment + 1) % workingEntity.vertices.length;
    const endCorner = byVertex.get(endVertex);
    const from = startCorner?.outgoingParameter ?? 0;
    const to = endCorner?.incomingParameter ?? 1;
    vertices.push(vertexForCurvePiece(workingEntity, curve, from, to));
    if (endCorner?.arc) {
      const incomingWidth = widthAt(workingEntity.vertices[segment]!, endCorner.incomingParameter);
      const outgoingWidth = widthAt(workingEntity.vertices[endCorner.outgoingSegment]!, endCorner.outgoingParameter);
      vertices.push({
        ...endCorner.before,
        ...(Math.abs(endCorner.bulge) > 1e-12 ? { bulge: endCorner.bulge } : {}),
        ...(incomingWidth === undefined ? {} : { startWidth: incomingWidth }),
        ...(outgoingWidth === undefined ? {} : { endWidth: outgoingWidth }),
      });
    }
  }
  if (!workingEntity.closed) {
    const last = workingEntity.vertices.at(-1)!;
    vertices.push({ ...structuredClone(last), ...cleanPoint(last) });
  }
  return { entity: { ...structuredClone(workingEntity), vertices }, arcs: [], filletCount: legacy.replacedCount + planned.length, skippedVertices, reason: null };
}
