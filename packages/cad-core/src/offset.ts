import type { CadEntity, CadPoint2, CadPolyline, CadSpline } from "@kuubik/cad-schema";

const EPSILON = 1e-9;
const FULL_TURN = Math.PI * 2;

export type OffsetGeometryMode = "distance" | "through";
export type OffsetGeometryRejectReason =
  | "unsupported-entity"
  | "degenerate-geometry"
  | "side-on-source"
  | "invalid-offset"
  | "self-intersection";

export interface OffsetGeometryResult {
  entity: CadEntity | null;
  entities?: CadEntity[];
  signedDistance: number | null;
  reason?: OffsetGeometryRejectReason;
}

interface LineSegment {
  kind: "line";
  start: CadPoint2;
  end: CadPoint2;
}

interface ArcSegment {
  kind: "arc";
  start: CadPoint2;
  end: CadPoint2;
  center: CadPoint2;
  radius: number;
  startAngle: number;
  endAngle: number;
  counterClockwise: boolean;
}

type OffsetSegment = LineSegment | ArcSegment;

function finitePoint(point: CadPoint2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteOptionalNumber(value: number | undefined): boolean {
  return value === undefined || Number.isFinite(value);
}

function finiteCadEntityGeometry(entity: CadEntity): boolean {
  switch (entity.kind) {
    case "line":
      return finitePoint(entity.start) && finitePoint(entity.end);
    case "polyline":
      return entity.vertices.length >= 2 && entity.vertices.every((vertex) =>
        finitePoint(vertex)
        && finiteOptionalNumber(vertex.bulge)
        && finiteOptionalNumber(vertex.startWidth)
        && finiteOptionalNumber(vertex.endWidth));
    case "circle":
      return finitePoint(entity.center)
        && Number.isFinite(entity.radius)
        && entity.radius > EPSILON
        && Number.isFinite(entity.center.x - entity.radius)
        && Number.isFinite(entity.center.x + entity.radius)
        && Number.isFinite(entity.center.y - entity.radius)
        && Number.isFinite(entity.center.y + entity.radius);
    case "arc":
      return finitePoint(entity.center)
        && Number.isFinite(entity.radius)
        && entity.radius > EPSILON
        && Number.isFinite(entity.center.x - entity.radius)
        && Number.isFinite(entity.center.x + entity.radius)
        && Number.isFinite(entity.center.y - entity.radius)
        && Number.isFinite(entity.center.y + entity.radius)
        && Number.isFinite(entity.startAngleRad)
        && Number.isFinite(entity.endAngleRad);
    case "ellipse":
      return finitePoint(entity.center)
        && finitePoint(entity.majorAxis)
        && Number.isFinite(entity.center.x - Math.abs(entity.majorAxis.x))
        && Number.isFinite(entity.center.x + Math.abs(entity.majorAxis.x))
        && Number.isFinite(entity.center.y - Math.abs(entity.majorAxis.y))
        && Number.isFinite(entity.center.y + Math.abs(entity.majorAxis.y))
        && Number.isFinite(entity.ratio)
        && Number.isFinite(entity.startParameter)
        && Number.isFinite(entity.endParameter);
    case "spline":
      return Number.isInteger(entity.degree)
        && entity.degree > 0
        && entity.controlPoints.length > entity.degree
        && entity.controlPoints.every(finitePoint)
        && entity.knots.every(Number.isFinite)
        && (entity.weights === undefined || entity.weights.every(Number.isFinite));
    default:
      return false;
  }
}

function validatedOffsetResult(result: OffsetGeometryResult): OffsetGeometryResult {
  const entities = result.entities ?? (result.entity ? [result.entity] : []);
  if (!result.entity) return result;
  if (!Number.isFinite(result.signedDistance) || entities.length === 0 || entities.some((entity) => !finiteCadEntityGeometry(entity))) {
    return { entity: null, signedDistance: result.signedDistance, reason: "invalid-offset" };
  }
  return result;
}

function subtract(first: CadPoint2, second: CadPoint2): CadPoint2 {
  return { x: first.x - second.x, y: first.y - second.y };
}

function add(first: CadPoint2, second: CadPoint2): CadPoint2 {
  return { x: first.x + second.x, y: first.y + second.y };
}

function scaled(point: CadPoint2, factor: number): CadPoint2 {
  return { x: point.x * factor, y: point.y * factor };
}

function dot(first: CadPoint2, second: CadPoint2): number {
  return first.x * second.x + first.y * second.y;
}

function cross(first: CadPoint2, second: CadPoint2): number {
  return first.x * second.y - first.y * second.x;
}

function length(vector: CadPoint2): number {
  return Math.hypot(vector.x, vector.y);
}

function normalized(vector: CadPoint2): CadPoint2 | null {
  const magnitude = length(vector);
  return magnitude > EPSILON ? scaled(vector, 1 / magnitude) : null;
}

function leftNormal(vector: CadPoint2): CadPoint2 | null {
  const unit = normalized(vector);
  return unit ? { x: -unit.y, y: unit.x } : null;
}

function clean(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return Object.is(value, -0) ? 0 : value;
}

function cleanPoint(point: CadPoint2): CadPoint2 {
  return { x: clean(point.x), y: clean(point.y) };
}

function normalizedAngle(angle: number): number {
  const result = ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.abs(result - FULL_TURN) < 1e-12 ? 0 : result;
}

function ccwSweep(start: number, end: number): number {
  const sweep = normalizedAngle(end) - normalizedAngle(start);
  return sweep >= 0 ? sweep : sweep + FULL_TURN;
}

function travelSweep(segment: ArcSegment): number {
  const ccw = ccwSweep(segment.startAngle, segment.endAngle);
  return segment.counterClockwise ? ccw : ccw - FULL_TURN;
}

function pointOnArc(center: CadPoint2, radius: number, angle: number): CadPoint2 {
  return cleanPoint({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
}

function parameterOnArc(segment: ArcSegment, angle: number): boolean {
  const total = Math.abs(travelSweep(segment));
  const fromStart = segment.counterClockwise
    ? ccwSweep(segment.startAngle, angle)
    : ccwSweep(angle, segment.startAngle);
  return fromStart <= total + 1e-8;
}

function closestPointOnLine(segment: LineSegment, point: CadPoint2): { point: CadPoint2; distance: number; signedSide: number } | null {
  const vector = subtract(segment.end, segment.start);
  const magnitudeSquared = dot(vector, vector);
  const normal = leftNormal(vector);
  if (!normal || magnitudeSquared <= EPSILON * EPSILON) return null;
  const parameter = Math.max(0, Math.min(1, dot(subtract(point, segment.start), vector) / magnitudeSquared));
  const closest = add(segment.start, scaled(vector, parameter));
  return { point: closest, distance: length(subtract(point, closest)), signedSide: dot(subtract(point, closest), normal) };
}

function closestPointOnArc(segment: ArcSegment, point: CadPoint2): { point: CadPoint2; distance: number; signedSide: number } | null {
  const radial = subtract(point, segment.center);
  if (!(segment.radius > EPSILON) || length(radial) <= EPSILON) {
    const startDistance = length(subtract(point, segment.start));
    const endDistance = length(subtract(point, segment.end));
    const closest = startDistance <= endDistance ? segment.start : segment.end;
    const tangent = segment.counterClockwise
      ? { x: -(closest.y - segment.center.y), y: closest.x - segment.center.x }
      : { x: closest.y - segment.center.y, y: -(closest.x - segment.center.x) };
    const normal = leftNormal(tangent);
    return normal ? { point: closest, distance: Math.min(startDistance, endDistance), signedSide: dot(subtract(point, closest), normal) } : null;
  }
  const angle = Math.atan2(radial.y, radial.x);
  const radialPoint = pointOnArc(segment.center, segment.radius, angle);
  const candidates = parameterOnArc(segment, angle) ? [radialPoint] : [segment.start, segment.end];
  let closest = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (length(subtract(point, candidate)) < length(subtract(point, closest))) closest = candidate;
  }
  const travelTangent = segment.counterClockwise
    ? { x: -(closest.y - segment.center.y), y: closest.x - segment.center.x }
    : { x: closest.y - segment.center.y, y: -(closest.x - segment.center.x) };
  const normal = leftNormal(travelTangent);
  return normal ? { point: closest, distance: length(subtract(point, closest)), signedSide: dot(subtract(point, closest), normal) } : null;
}

function resolvedSignedDistance(mode: OffsetGeometryMode, distance: number | undefined, signedSide: number): number | null {
  if (!Number.isFinite(signedSide)) return null;
  if (Math.abs(signedSide) <= EPSILON) return null;
  if (mode === "through") return signedSide;
  if (!Number.isFinite(distance) || !(distance! > EPSILON)) return null;
  return Math.sign(signedSide) * distance!;
}

function offsetLineSegment(segment: LineSegment, signedDistance: number): LineSegment | null {
  const normal = leftNormal(subtract(segment.end, segment.start));
  if (!normal) return null;
  const delta = scaled(normal, signedDistance);
  return { kind: "line", start: cleanPoint(add(segment.start, delta)), end: cleanPoint(add(segment.end, delta)) };
}

function offsetArcSegment(segment: ArcSegment, signedDistance: number): ArcSegment | null {
  const direction = segment.counterClockwise ? 1 : -1;
  const radius = segment.radius - direction * signedDistance;
  if (!(radius > EPSILON) || !Number.isFinite(radius)) return null;
  return {
    ...segment,
    radius,
    start: pointOnArc(segment.center, radius, segment.startAngle),
    end: pointOnArc(segment.center, radius, segment.endAngle),
  };
}

function polylineSegments(entity: CadPolyline): OffsetSegment[] | null {
  const count = entity.vertices.length;
  const segmentCount = entity.closed ? count : count - 1;
  if (segmentCount < 1) return null;
  const segments: OffsetSegment[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = entity.vertices[index]!;
    const end = entity.vertices[(index + 1) % count]!;
    const chord = subtract(end, start);
    const chordLength = length(chord);
    if (!(chordLength > EPSILON)) return null;
    const bulge = start.bulge ?? 0;
    if (Math.abs(bulge) <= EPSILON) {
      segments.push({ kind: "line", start, end });
      continue;
    }
    const midpoint = scaled(add(start, end), 0.5);
    const normal = leftNormal(chord)!;
    const centerOffset = chordLength * (1 - bulge * bulge) / (4 * bulge);
    const center = add(midpoint, scaled(normal, centerOffset));
    const radius = chordLength * (1 + bulge * bulge) / (4 * Math.abs(bulge));
    segments.push({
      kind: "arc",
      start,
      end,
      center,
      radius,
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      endAngle: Math.atan2(end.y - center.y, end.x - center.x),
      counterClockwise: bulge > 0,
    });
  }
  return segments;
}

function lineLineIntersection(first: LineSegment, second: LineSegment): CadPoint2[] {
  const firstDirection = subtract(first.end, first.start);
  const secondDirection = subtract(second.end, second.start);
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= EPSILON) return [];
  const parameter = cross(subtract(second.start, first.start), secondDirection) / denominator;
  return [cleanPoint(add(first.start, scaled(firstDirection, parameter)))];
}

function lineCircleIntersections(line: LineSegment, arc: ArcSegment): CadPoint2[] {
  const direction = subtract(line.end, line.start);
  const relative = subtract(line.start, arc.center);
  const a = dot(direction, direction);
  if (!(a > EPSILON)) return [];
  const b = 2 * dot(relative, direction);
  const c = dot(relative, relative) - arc.radius * arc.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  const points = [cleanPoint(add(line.start, scaled(direction, first)))];
  if (Math.abs(second - first) > EPSILON) points.push(cleanPoint(add(line.start, scaled(direction, second))));
  return points;
}

function circleCircleIntersections(first: ArcSegment, second: ArcSegment): CadPoint2[] {
  const between = subtract(second.center, first.center);
  const d = length(between);
  if (!(d > EPSILON) || d > first.radius + second.radius + EPSILON || d < Math.abs(first.radius - second.radius) - EPSILON) return [];
  const along = (first.radius * first.radius - second.radius * second.radius + d * d) / (2 * d);
  const heightSquared = first.radius * first.radius - along * along;
  if (heightSquared < -EPSILON) return [];
  const unit = scaled(between, 1 / d);
  const base = add(first.center, scaled(unit, along));
  const normal = { x: -unit.y, y: unit.x };
  const height = Math.sqrt(Math.max(0, heightSquared));
  const points = [cleanPoint(add(base, scaled(normal, height)))];
  if (height > EPSILON) points.push(cleanPoint(add(base, scaled(normal, -height))));
  return points;
}

function supportIntersections(first: OffsetSegment, second: OffsetSegment): CadPoint2[] {
  if (first.kind === "line" && second.kind === "line") return lineLineIntersection(first, second);
  if (first.kind === "line" && second.kind === "arc") return lineCircleIntersections(first, second);
  if (first.kind === "arc" && second.kind === "line") return lineCircleIntersections(second, first);
  return circleCircleIntersections(first as ArcSegment, second as ArcSegment);
}

function joinedPoint(first: OffsetSegment, second: OffsetSegment): CadPoint2 | null {
  if (length(subtract(first.end, second.start)) <= 1e-7) return cleanPoint(scaled(add(first.end, second.start), 0.5));
  const candidates = supportIntersections(first, second);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, point) => {
    const cost = length(subtract(point, first.end)) + length(subtract(point, second.start));
    const bestCost = length(subtract(best, first.end)) + length(subtract(best, second.start));
    return cost < bestCost ? point : best;
  });
}

function segmentWithEnds(segment: OffsetSegment, start: CadPoint2, end: CadPoint2): OffsetSegment {
  if (segment.kind === "line") return { ...segment, start, end };
  return {
    ...segment,
    start,
    end,
    startAngle: Math.atan2(start.y - segment.center.y, start.x - segment.center.x),
    endAngle: Math.atan2(end.y - segment.center.y, end.x - segment.center.x),
  };
}

function sampledSegment(segment: OffsetSegment, count = 16): CadPoint2[] {
  if (segment.kind === "line") return [segment.start, segment.end];
  const sweep = travelSweep(segment);
  return Array.from({ length: count + 1 }, (_, index) => pointOnArc(segment.center, segment.radius, segment.startAngle + sweep * index / count));
}

function orientation(a: CadPoint2, b: CadPoint2, c: CadPoint2): number {
  return cross(subtract(b, a), subtract(c, a));
}

function properLineIntersection(a: CadPoint2, b: CadPoint2, c: CadPoint2, d: CadPoint2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -EPSILON && cdA * cdB < -EPSILON;
}

function segmentsSelfIntersect(segments: readonly OffsetSegment[], closed: boolean): boolean {
  const lines = segments.flatMap((segment, segmentIndex) => {
    const points = sampledSegment(segment);
    return points.slice(0, -1).map((point, sampleIndex) => ({
      a: point,
      b: points[sampleIndex + 1]!,
      segmentIndex,
    }));
  });
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const a = lines[first]!;
      const b = lines[second]!;
      const adjacent = Math.abs(a.segmentIndex - b.segmentIndex) <= 1 || (closed && Math.abs(a.segmentIndex - b.segmentIndex) === segments.length - 1);
      if (!adjacent && properLineIntersection(a.a, a.b, b.a, b.b)) return true;
    }
  }
  return false;
}

function bulgeForArc(segment: ArcSegment): number {
  return clean(Math.tan(travelSweep(segment) / 4));
}

function offsetPolyline(entity: CadPolyline, mode: OffsetGeometryMode, distance: number | undefined, sidePoint: CadPoint2): OffsetGeometryResult {
  const original = polylineSegments(entity);
  if (!original) return { entity: null, signedDistance: null, reason: "degenerate-geometry" };
  const closest = original
    .map((segment) => segment.kind === "line" ? closestPointOnLine(segment, sidePoint) : closestPointOnArc(segment, sidePoint))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((first, second) => first.distance - second.distance)[0];
  if (!closest) return { entity: null, signedDistance: null, reason: "degenerate-geometry" };
  const signedDistance = resolvedSignedDistance(mode, distance, closest.signedSide);
  if (signedDistance === null) return { entity: null, signedDistance: null, reason: "side-on-source" };
  const raw = original.map((segment) => segment.kind === "line"
    ? offsetLineSegment(segment, signedDistance)
    : offsetArcSegment(segment, signedDistance));
  if (raw.some((segment) => segment === null)) return { entity: null, signedDistance, reason: "invalid-offset" };
  const offset = raw as OffsetSegment[];
  const starts = offset.map((segment) => segment.start);
  const ends = offset.map((segment) => segment.end);
  for (let index = 0; index < offset.length - 1; index += 1) {
    const join = joinedPoint(offset[index]!, offset[index + 1]!);
    if (!join) return { entity: null, signedDistance, reason: "invalid-offset" };
    ends[index] = join;
    starts[index + 1] = join;
  }
  if (entity.closed) {
    const join = joinedPoint(offset[offset.length - 1]!, offset[0]!);
    if (!join) return { entity: null, signedDistance, reason: "invalid-offset" };
    ends[offset.length - 1] = join;
    starts[0] = join;
  }
  const joined = offset.map((segment, index) => segmentWithEnds(segment, starts[index]!, ends[index]!));
  if (segmentsSelfIntersect(joined, entity.closed)) return { entity: null, signedDistance, reason: "self-intersection" };
  const vertices: CadPolyline["vertices"] = joined.map((segment, index) => ({
    ...entity.vertices[index],
    ...cleanPoint(segment.start),
    ...(segment.kind === "arc" ? { bulge: bulgeForArc(segment) } : { bulge: 0 }),
  }));
  if (!entity.closed) {
    vertices.push({ ...entity.vertices[entity.vertices.length - 1], ...cleanPoint(joined[joined.length - 1]!.end) });
  }
  return { entity: { ...entity, vertices }, signedDistance };
}

interface EllipseBasis {
  major: CadPoint2;
  minor: CadPoint2;
}

function ellipseBasis(entity: Extract<CadEntity, { kind: "ellipse" }>): EllipseBasis | null {
  const majorLength = length(entity.majorAxis);
  if (!(majorLength > EPSILON) || !(entity.ratio > EPSILON)) return null;
  const majorUnit = scaled(entity.majorAxis, 1 / majorLength);
  return { major: entity.majorAxis, minor: { x: -majorUnit.y * majorLength * entity.ratio, y: majorUnit.x * majorLength * entity.ratio } };
}

function ellipsePoint(entity: Extract<CadEntity, { kind: "ellipse" }>, basis: EllipseBasis, parameter: number): CadPoint2 {
  return add(entity.center, add(scaled(basis.major, Math.cos(parameter)), scaled(basis.minor, Math.sin(parameter))));
}

function ellipseDerivative(basis: EllipseBasis, parameter: number): CadPoint2 {
  return add(scaled(basis.major, -Math.sin(parameter)), scaled(basis.minor, Math.cos(parameter)));
}

function ellipseSecondDerivative(basis: EllipseBasis, parameter: number): CadPoint2 {
  return add(scaled(basis.major, -Math.cos(parameter)), scaled(basis.minor, -Math.sin(parameter)));
}

function ellipseParameterRange(entity: Extract<CadEntity, { kind: "ellipse" }>): { start: number; end: number; closed: boolean } {
  let span = entity.endParameter - entity.startParameter;
  if (span <= 0) span += FULL_TURN;
  const closed = Math.abs(span - FULL_TURN) <= 1e-8;
  return { start: entity.startParameter, end: entity.startParameter + span, closed };
}

function closestEllipseParameter(entity: Extract<CadEntity, { kind: "ellipse" }>, basis: EllipseBasis, sidePoint: CadPoint2): number {
  const range = ellipseParameterRange(entity);
  const samples = 256;
  let parameter = range.start;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= samples; index += 1) {
    const candidate = range.start + (range.end - range.start) * index / samples;
    const distance = length(subtract(ellipsePoint(entity, basis, candidate), sidePoint));
    if (distance < bestDistance) {
      bestDistance = distance;
      parameter = candidate;
    }
  }
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const point = ellipsePoint(entity, basis, parameter);
    const first = ellipseDerivative(basis, parameter);
    const second = ellipseSecondDerivative(basis, parameter);
    const relative = subtract(point, sidePoint);
    const numerator = dot(relative, first);
    const denominator = dot(first, first) + dot(relative, second);
    if (Math.abs(denominator) <= EPSILON) break;
    parameter = Math.max(range.start, Math.min(range.end, parameter - numerator / denominator));
  }
  return parameter;
}

function clampedPiecewiseBezierKnots(segmentCount: number): number[] {
  const knots = [0, 0, 0, 0];
  for (let index = 1; index < segmentCount; index += 1) knots.push(index, index, index);
  knots.push(segmentCount, segmentCount, segmentCount, segmentCount);
  return knots;
}

function minimumEllipseCurvatureRadius(basis: EllipseBasis, start: number, end: number): number | null {
  let minimum = Number.POSITIVE_INFINITY;
  const samples = 1024;
  for (let index = 0; index <= samples; index += 1) {
    const parameter = start + (end - start) * index / samples;
    const first = ellipseDerivative(basis, parameter);
    const second = ellipseSecondDerivative(basis, parameter);
    const speed = length(first);
    const denominator = Math.abs(cross(first, second));
    const radius = speed ** 3 / denominator;
    if (!Number.isFinite(radius) || !(radius > EPSILON)) return null;
    minimum = Math.min(minimum, radius);
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function sampledCurveSelfIntersects(points: readonly CadPoint2[], closed: boolean): boolean {
  const segmentCount = points.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      const adjacent = second === first + 1 || (closed && first === 0 && second === segmentCount - 1);
      if (!adjacent && properLineIntersection(points[first]!, points[first + 1]!, points[second]!, points[second + 1]!)) {
        return true;
      }
    }
  }
  return false;
}

function offsetEllipse(entity: Extract<CadEntity, { kind: "ellipse" }>, mode: OffsetGeometryMode, distance: number | undefined, sidePoint: CadPoint2): OffsetGeometryResult {
  const basis = ellipseBasis(entity);
  if (!basis) return { entity: null, signedDistance: null, reason: "degenerate-geometry" };
  const nearestParameter = closestEllipseParameter(entity, basis, sidePoint);
  const nearest = ellipsePoint(entity, basis, nearestParameter);
  const normal = leftNormal(ellipseDerivative(basis, nearestParameter));
  if (!normal) return { entity: null, signedDistance: null, reason: "degenerate-geometry" };
  const signedSide = dot(subtract(sidePoint, nearest), normal);
  const signedDistance = resolvedSignedDistance(mode, distance, signedSide);
  if (signedDistance === null) return { entity: null, signedDistance: null, reason: "side-on-source" };
  const range = ellipseParameterRange(entity);
  const minimumCurvatureRadius = minimumEllipseCurvatureRadius(basis, range.start, range.end);
  if (minimumCurvatureRadius === null) return { entity: null, signedDistance, reason: "invalid-offset" };
  const curvatureTolerance = Math.max(EPSILON, minimumCurvatureRadius * 1e-10);
  const offsetPoint = (parameter: number): CadPoint2 | null => {
    const localNormal = leftNormal(ellipseDerivative(basis, parameter));
    return localNormal ? add(ellipsePoint(entity, basis, parameter), scaled(localNormal, signedDistance)) : null;
  };
  const derivative = (parameter: number): CadPoint2 | null => {
    const step = 1e-5;
    const before = offsetPoint(parameter - step);
    const after = offsetPoint(parameter + step);
    return before && after ? scaled(subtract(after, before), 1 / (2 * step)) : null;
  };
  const ellipseAppearance = entity.appearance === undefined
    ? undefined
    : Object.fromEntries(Object.entries(entity.appearance).filter(([key]) => key !== "lineweightMm"));
  const buildSpline = (startParameter: number, endParameter: number, closed: boolean): CadSpline | null => {
    const validationPoints: CadPoint2[] = [];
    const validationSamples = closed ? 256 : Math.max(32, Math.ceil(256 * (endParameter - startParameter) / FULL_TURN));
    for (let index = 0; index <= validationSamples; index += 1) {
      const parameter = startParameter + (endParameter - startParameter) * index / validationSamples;
      const point = offsetPoint(parameter);
      const tangent = derivative(parameter);
      if (!point || !tangent || !finitePoint(point) || !finitePoint(tangent) || length(tangent) <= EPSILON) return null;
      validationPoints.push(point);
    }
    if (sampledCurveSelfIntersects(validationPoints, closed)) return null;
    const segmentCount = closed ? 128 : Math.max(16, Math.ceil(128 * (endParameter - startParameter) / FULL_TURN));
    const controlPoints: CadPoint2[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const start = startParameter + (endParameter - startParameter) * index / segmentCount;
      const end = startParameter + (endParameter - startParameter) * (index + 1) / segmentCount;
      const span = end - start;
      const startPoint = offsetPoint(start);
      const endPoint = offsetPoint(end);
      const startDerivative = derivative(start);
      const endDerivative = derivative(end);
      if (!startPoint || !endPoint || !startDerivative || !endDerivative) return null;
      if (index === 0) controlPoints.push(cleanPoint(startPoint));
      controlPoints.push(
        cleanPoint(add(startPoint, scaled(startDerivative, span / 3))),
        cleanPoint(add(endPoint, scaled(endDerivative, -span / 3))),
        cleanPoint(endPoint),
      );
    }
    return {
      kind: "spline",
      handle: entity.handle,
      layerId: entity.layerId,
      ...(ellipseAppearance === undefined || Object.keys(ellipseAppearance).length === 0 ? {} : { appearance: ellipseAppearance }),
      extensionData: {
        ...entity.extensionData,
        kuubikOffsetSourceKind: "ellipse",
        kuubikOffsetApproximation: "piecewise-cubic-128",
      },
      degree: 3,
      controlPoints,
      knots: clampedPiecewiseBezierKnots(segmentCount),
      closed,
      periodic: false,
    };
  };

  let outputRanges = [{ start: range.start, end: range.end, closed: range.closed }];
  if (signedDistance > 0 && signedDistance >= minimumCurvatureRadius - curvatureTolerance) {
    const majorLength = length(basis.major);
    const minorLength = length(basis.minor);
    if (!range.closed || !(signedDistance < minorLength) || !(majorLength > minorLength + EPSILON)) {
      return { entity: null, signedDistance, reason: "self-intersection" };
    }
    const targetSpeed = signedDistance * majorLength / minorLength;
    const sineSquared = (targetSpeed * targetSpeed - minorLength * minorLength)
      / (majorLength * majorLength - minorLength * minorLength);
    if (!(sineSquared > 0 && sineSquared < 1)) return { entity: null, signedDistance, reason: "self-intersection" };
    const crossingParameter = Math.asin(Math.sqrt(sineSquared));
    outputRanges = [
      { start: range.start + Math.PI + crossingParameter, end: range.start + FULL_TURN - crossingParameter, closed: false },
      { start: range.start + crossingParameter, end: range.start + Math.PI - crossingParameter, closed: false },
    ];
  }
  const splines = outputRanges.map(({ start, end, closed }) => buildSpline(start, end, closed));
  if (splines.some((spline) => spline === null)) return { entity: null, signedDistance, reason: "self-intersection" };
  const entities = splines as CadSpline[];
  return validatedOffsetResult({ entity: entities[0]!, ...(entities.length > 1 ? { entities } : {}), signedDistance });
}

export function offsetCadEntity(
  entity: CadEntity,
  mode: OffsetGeometryMode,
  distance: number | undefined,
  sidePoint: CadPoint2,
): OffsetGeometryResult {
  if (!finitePoint(sidePoint)) return { entity: null, signedDistance: null, reason: "invalid-offset" };
  if (mode === "distance" && (!Number.isFinite(distance) || !(distance! > EPSILON))) {
    return { entity: null, signedDistance: null, reason: "invalid-offset" };
  }
  if (entity.kind === "line") {
    const closest = closestPointOnLine({ kind: "line", start: entity.start, end: entity.end }, sidePoint);
    if (!closest) return { entity: null, signedDistance: null, reason: "degenerate-geometry" };
    const signedDistance = resolvedSignedDistance(mode, distance, closest.signedSide);
    if (signedDistance === null) return { entity: null, signedDistance: null, reason: "side-on-source" };
    const offset = offsetLineSegment({ kind: "line", start: entity.start, end: entity.end }, signedDistance);
    return offset
      ? validatedOffsetResult({ entity: { ...entity, start: offset.start, end: offset.end }, signedDistance })
      : { entity: null, signedDistance, reason: "degenerate-geometry" };
  }
  if (entity.kind === "circle") {
    const radialDistance = length(subtract(sidePoint, entity.center)) - entity.radius;
    const signedDistance = resolvedSignedDistance(mode, distance, -radialDistance);
    if (signedDistance === null) return { entity: null, signedDistance: null, reason: "side-on-source" };
    const radius = entity.radius - signedDistance;
    if (!(radius > EPSILON) || !Number.isFinite(radius)) return { entity: null, signedDistance, reason: "invalid-offset" };
    return validatedOffsetResult({ entity: { ...entity, radius: clean(radius) }, signedDistance });
  }
  if (entity.kind === "arc") {
    const radialDistance = length(subtract(sidePoint, entity.center)) - entity.radius;
    const direction = entity.counterClockwise ? 1 : -1;
    const signedDistance = resolvedSignedDistance(mode, distance, -direction * radialDistance);
    if (signedDistance === null) return { entity: null, signedDistance: null, reason: "side-on-source" };
    const radius = entity.radius - direction * signedDistance;
    if (!(radius > EPSILON) || !Number.isFinite(radius)) return { entity: null, signedDistance, reason: "invalid-offset" };
    return validatedOffsetResult({ entity: { ...entity, radius: clean(radius) }, signedDistance });
  }
  if (entity.kind === "polyline") return validatedOffsetResult(offsetPolyline(entity, mode, distance, sidePoint));
  if (entity.kind === "ellipse") return offsetEllipse(entity, mode, distance, sidePoint);
  return { entity: null, signedDistance: null, reason: "unsupported-entity" };
}
