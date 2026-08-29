import type { CadEntity, CadPoint2, CadPolyline, CadPolylineVertex, CadSpline } from "@kuubik/cad-schema";

/** Fixed model-space tolerance. Screen-pick tolerance must stay in the caller. */
export const TRIM_EPSILON = 1e-6;
const FULL_TURN = Math.PI * 2;

export type TrimEdgeMode = "extend" | "no-extend";
export type TrimProjectMode = "none" | "ucs" | "view";
export type TrimGeometryRejectReason = "unsupported-target" | "degenerate-geometry" | "no-intersection" | "ambiguous-tangent";

export interface TrimGeometryResult {
  entities: CadEntity[];
  intersectionPoints: CadPoint2[];
  removedInterval: { start: number; end: number; wraps: boolean } | null;
  reason: TrimGeometryRejectReason | null;
}

export interface ExtendGeometryResult {
  entity: CadEntity | null;
  intersectionPoint: CadPoint2 | null;
  endpoint: "start" | "end" | null;
  reason: TrimGeometryRejectReason | null;
}

interface CurveBase { segment: number; }
export interface TrimLineCurve extends CurveBase { kind: "line"; start: CadPoint2; end: CadPoint2; }
export interface TrimArcCurve extends CurveBase { kind: "arc"; center: CadPoint2; radius: number; startAngle: number; sweep: number; }
export interface TrimEllipseCurve extends CurveBase { kind: "ellipse"; center: CadPoint2; major: CadPoint2; minor: CadPoint2; startParameter: number; sweep: number; }
export interface TrimSplineCurve extends CurveBase {
  kind: "spline";
  degree: number;
  controlPoints: CadPoint2[];
  knots: number[];
  weights?: number[];
  startParameter: number;
  endParameter: number;
  closed: boolean;
}
export type TrimCurve = TrimLineCurve | TrimArcCurve | TrimEllipseCurve | TrimSplineCurve;

export interface TrimCurveIntersection { point: CadPoint2; first: number; second: number; }

const add = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x + second.x, y: first.y + second.y });
const subtract = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x - second.x, y: first.y - second.y });
const scaled = (point: CadPoint2, factor: number): CadPoint2 => ({ x: point.x * factor, y: point.y * factor });
const dot = (first: CadPoint2, second: CadPoint2): number => first.x * second.x + first.y * second.y;
const cross = (first: CadPoint2, second: CadPoint2): number => first.x * second.y - first.y * second.x;
const length = (point: CadPoint2): number => Math.hypot(point.x, point.y);
const distance = (first: CadPoint2, second: CadPoint2): number => length(subtract(second, first));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const normalizedAngle = (value: number): number => ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
const clean = (value: number): number => Math.abs(value) <= 1e-12 ? 0 : Number(value.toFixed(12));
const cleanPoint = (point: CadPoint2): CadPoint2 => ({ x: clean(point.x), y: clean(point.y) });
const finitePoint = (point: CadPoint2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

function validSpline(entity: CadSpline): boolean {
  const last = entity.controlPoints.length - 1;
  return Number.isInteger(entity.degree) && entity.degree > 0 && last >= entity.degree
    && entity.knots.length === last + entity.degree + 2
    && entity.controlPoints.every(finitePoint) && entity.knots.every(Number.isFinite)
    && (entity.weights === undefined || (entity.weights.length === entity.controlPoints.length && entity.weights.every((weight) => Number.isFinite(weight) && weight > 0)))
    && entity.knots.every((knot, index) => index === 0 || knot >= entity.knots[index - 1]!)
    && entity.knots[last + 1]! - entity.knots[entity.degree]! > TRIM_EPSILON;
}

function nurbsPointRaw(curve: TrimSplineCurve, parameter: number): CadPoint2 | null {
  const degree = curve.degree;
  const last = curve.controlPoints.length - 1;
  const domainParameter = curve.startParameter + (curve.endParameter - curve.startParameter) * parameter;
  const u = Math.max(curve.startParameter, Math.min(curve.endParameter, domainParameter));
  let span = last;
  if (u < curve.endParameter - TRIM_EPSILON) {
    span = degree;
    while (span < last && !(u >= curve.knots[span]! && u < curve.knots[span + 1]!)) span += 1;
  }
  const values = Array.from({ length: degree + 1 }, (_, index) => {
    const sourceIndex = span - degree + index;
    const point = curve.controlPoints[sourceIndex]!;
    const weight = curve.weights?.[sourceIndex] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const sourceIndex = span - degree + index;
      const denominator = curve.knots[sourceIndex + degree - level + 1]! - curve.knots[sourceIndex]!;
      const alpha = Math.abs(denominator) <= TRIM_EPSILON ? 0 : (u - curve.knots[sourceIndex]!) / denominator;
      const before = values[index - 1]!; const current = values[index]!;
      values[index] = {
        x: before.x * (1 - alpha) + current.x * alpha,
        y: before.y * (1 - alpha) + current.y * alpha,
        weight: before.weight * (1 - alpha) + current.weight * alpha,
      };
    }
  }
  const result = values[degree]!;
  return Math.abs(result.weight) <= TRIM_EPSILON ? null : { x: result.x / result.weight, y: result.y / result.weight };
}

function directedSweep(start: number, end: number, counterClockwise: boolean): number {
  return counterClockwise ? normalizedAngle(end - start) : -normalizedAngle(start - end);
}

function ellipseSweep(start: number, end: number): number {
  const raw = end - start;
  if (Math.abs(raw) >= FULL_TURN - 1e-9) return FULL_TURN;
  return raw > 0 ? raw : raw + FULL_TURN;
}

function arcFromBulge(start: CadPoint2, end: CadPoint2, bulge: number, segment: number): TrimLineCurve | TrimArcCurve | null {
  if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(bulge)) return null;
  const chord = subtract(end, start);
  const chordLength = length(chord);
  if (!(chordLength > TRIM_EPSILON)) return null;
  if (Math.abs(bulge) <= 1e-12) return { kind: "line", start, end, segment };
  const midpoint = scaled(add(start, end), 0.5);
  const normal = { x: -chord.y / chordLength, y: chord.x / chordLength };
  const centerOffset = chordLength * (1 - bulge * bulge) / (4 * bulge);
  const center = add(midpoint, scaled(normal, centerOffset));
  const radius = distance(center, start);
  const sweep = 4 * Math.atan(bulge);
  if (!(radius > TRIM_EPSILON) || !Number.isFinite(sweep)) return null;
  return { kind: "arc", center: cleanPoint(center), radius: clean(radius), startAngle: Math.atan2(start.y - center.y, start.x - center.x), sweep, segment };
}

export function trimCurvesOfEntity(entity: CadEntity): TrimCurve[] {
  if (entity.kind === "line") return distance(entity.start, entity.end) > TRIM_EPSILON ? [{ kind: "line", start: entity.start, end: entity.end, segment: 0 }] : [];
  if (entity.kind === "circle") return entity.radius > TRIM_EPSILON ? [{ kind: "arc", center: entity.center, radius: entity.radius, startAngle: 0, sweep: FULL_TURN, segment: 0 }] : [];
  if (entity.kind === "arc") {
    const sweep = directedSweep(entity.startAngleRad, entity.endAngleRad, entity.counterClockwise);
    return entity.radius > TRIM_EPSILON && Math.abs(sweep) > TRIM_EPSILON ? [{ kind: "arc", center: entity.center, radius: entity.radius, startAngle: entity.startAngleRad, sweep, segment: 0 }] : [];
  }
  if (entity.kind === "ellipse") {
    const majorLength = length(entity.majorAxis);
    if (!(majorLength > TRIM_EPSILON) || !(entity.ratio > TRIM_EPSILON)) return [];
    const majorUnit = scaled(entity.majorAxis, 1 / majorLength);
    return [{
      kind: "ellipse", center: entity.center, major: entity.majorAxis,
      minor: { x: -majorUnit.y * majorLength * entity.ratio, y: majorUnit.x * majorLength * entity.ratio },
      startParameter: entity.startParameter, sweep: ellipseSweep(entity.startParameter, entity.endParameter), segment: 0,
    }];
  }
  if (entity.kind === "spline") {
    if (!validSpline(entity)) return [];
    const last = entity.controlPoints.length - 1;
    return [{
      kind: "spline",
      degree: entity.degree,
      controlPoints: structuredClone(entity.controlPoints),
      knots: [...entity.knots],
      ...(entity.weights ? { weights: [...entity.weights] } : {}),
      startParameter: entity.knots[entity.degree]!,
      endParameter: entity.knots[last + 1]!,
      closed: entity.closed,
      segment: 0,
    }];
  }
  if (entity.kind !== "polyline") return [];
  const count = entity.closed ? entity.vertices.length : entity.vertices.length - 1;
  const curves: TrimCurve[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = entity.vertices[index]; const end = entity.vertices[(index + 1) % entity.vertices.length];
    if (!start || !end) return [];
    const curve = arcFromBulge(start, end, start.bulge ?? 0, index);
    if (!curve) return [];
    curves.push(curve);
  }
  return curves;
}

/** Only AutoCAD-selectable cutting curves contribute geometry; HATCH display loops are not edges. */
export function trimBoundaryCurvesOfEntity(entity: CadEntity): TrimCurve[] {
  return trimCurvesOfEntity(entity);
}

function trimPointAtRaw(curve: TrimCurve, parameter: number): CadPoint2 {
  if (curve.kind === "line") return add(curve.start, scaled(subtract(curve.end, curve.start), parameter));
  if (curve.kind === "spline") return nurbsPointRaw(curve, parameter) ?? { x: Number.NaN, y: Number.NaN };
  const angle = curve.kind === "arc" ? curve.startAngle + curve.sweep * parameter : curve.startParameter + curve.sweep * parameter;
  if (curve.kind === "arc") return { x: curve.center.x + curve.radius * Math.cos(angle), y: curve.center.y + curve.radius * Math.sin(angle) };
  return add(curve.center, add(scaled(curve.major, Math.cos(angle)), scaled(curve.minor, Math.sin(angle))));
}

export function trimPointAt(curve: TrimCurve, parameter: number): CadPoint2 {
  return cleanPoint(trimPointAtRaw(curve, parameter));
}

function parameterAt(curve: TrimCurve, point: CadPoint2): number {
  if (curve.kind === "line") {
    const direction = subtract(curve.end, curve.start);
    const denominator = dot(direction, direction);
    return denominator > TRIM_EPSILON ? dot(subtract(point, curve.start), direction) / denominator : 0;
  }
  if (curve.kind === "arc") {
    const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x);
    const travelled = curve.sweep >= 0 ? normalizedAngle(angle - curve.startAngle) : normalizedAngle(curve.startAngle - angle);
    return travelled / Math.abs(curve.sweep);
  }
  if (curve.kind === "spline") return closestParameter(curve, point);
  const relative = subtract(point, curve.center);
  const majorLengthSquared = dot(curve.major, curve.major);
  const minorLengthSquared = dot(curve.minor, curve.minor);
  const angle = Math.atan2(dot(relative, curve.minor) / minorLengthSquared, dot(relative, curve.major) / majorLengthSquared);
  return normalizedAngle(angle - curve.startParameter) / curve.sweep;
}

function closestParameter(curve: TrimCurve, point: CadPoint2): number {
  if (curve.kind === "line") return clamp01(parameterAt(curve, point));
  if (curve.kind === "arc") return clamp01(parameterAt(curve, point));
  let best = 0; let bestDistance = Number.POSITIVE_INFINITY;
  const samples = curve.kind === "spline" ? Math.max(1024, curve.controlPoints.length * 128) : 1024;
  for (let index = 0; index <= samples; index += 1) {
    const parameter = index / samples;
    const candidate = distance(trimPointAt(curve, parameter), point);
    if (candidate < bestDistance) { best = parameter; bestDistance = candidate; }
  }
  let span = 1 / samples;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const left = Math.max(0, best - span); const right = Math.min(1, best + span);
    const leftDistance = distance(trimPointAt(curve, left), point); const rightDistance = distance(trimPointAt(curve, right), point);
    if (leftDistance < bestDistance) { best = left; bestDistance = leftDistance; }
    if (rightDistance < bestDistance) { best = right; bestDistance = rightDistance; }
    span *= 0.5;
  }
  return best;
}

function lineLine(first: TrimLineCurve, second: TrimLineCurve): TrimCurveIntersection[] {
  const firstDirection = subtract(first.end, first.start); const secondDirection = subtract(second.end, second.start);
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= TRIM_EPSILON) return [];
  const delta = subtract(second.start, first.start);
  const firstParameter = cross(delta, secondDirection) / denominator;
  const secondParameter = cross(delta, firstDirection) / denominator;
  return [{ point: trimPointAt(first, firstParameter), first: firstParameter, second: secondParameter }];
}

function lineArc(line: TrimLineCurve, arc: TrimArcCurve): TrimCurveIntersection[] {
  const direction = subtract(line.end, line.start); const relative = subtract(line.start, arc.center);
  const a = dot(direction, direction); if (!(a > TRIM_EPSILON)) return [];
  const b = 2 * dot(relative, direction); const c = dot(relative, relative) - arc.radius * arc.radius;
  const discriminant = b * b - 4 * a * c; if (discriminant < -TRIM_EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const parameters = root <= TRIM_EPSILON ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  return parameters.map((first) => { const point = trimPointAt(line, first); return { point, first, second: parameterAt(arc, point) }; });
}

function arcArc(first: TrimArcCurve, second: TrimArcCurve): TrimCurveIntersection[] {
  const delta = subtract(second.center, first.center); const centers = length(delta);
  if (!(centers > TRIM_EPSILON) || centers > first.radius + second.radius + TRIM_EPSILON || centers < Math.abs(first.radius - second.radius) - TRIM_EPSILON) return [];
  const along = (first.radius ** 2 - second.radius ** 2 + centers ** 2) / (2 * centers);
  const heightSquared = first.radius ** 2 - along ** 2; if (heightSquared < -TRIM_EPSILON) return [];
  const base = add(first.center, scaled(delta, along / centers)); const normal = { x: -delta.y / centers, y: delta.x / centers };
  const height = Math.sqrt(Math.max(0, heightSquared)); const points = height <= TRIM_EPSILON ? [base] : [add(base, scaled(normal, height)), add(base, scaled(normal, -height))];
  return points.map((point) => ({ point: cleanPoint(point), first: parameterAt(first, point), second: parameterAt(second, point) }));
}

function lineEllipse(line: TrimLineCurve, ellipse: TrimEllipseCurve): TrimCurveIntersection[] {
  const relative = subtract(line.start, ellipse.center); const direction = subtract(line.end, line.start);
  const major2 = dot(ellipse.major, ellipse.major); const minor2 = dot(ellipse.minor, ellipse.minor);
  const u0 = dot(relative, ellipse.major) / major2; const v0 = dot(relative, ellipse.minor) / minor2;
  const ud = dot(direction, ellipse.major) / major2; const vd = dot(direction, ellipse.minor) / minor2;
  const a = ud * ud + vd * vd; const b = 2 * (u0 * ud + v0 * vd); const c = u0 * u0 + v0 * v0 - 1;
  if (!(a > TRIM_EPSILON)) return [];
  const discriminant = b * b - 4 * a * c; if (discriminant < -TRIM_EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const parameters = root <= TRIM_EPSILON ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  return parameters.map((first) => { const point = trimPointAt(line, first); return { point, first, second: parameterAt(ellipse, point) }; });
}

function normalizedResidual(boundary: TrimArcCurve | TrimEllipseCurve, point: CadPoint2): number {
  const relative = subtract(point, boundary.center);
  if (boundary.kind === "arc") return dot(relative, relative) / (boundary.radius * boundary.radius) - 1;
  return (dot(relative, boundary.major) ** 2) / (dot(boundary.major, boundary.major) ** 2) + (dot(relative, boundary.minor) ** 2) / (dot(boundary.minor, boundary.minor) ** 2) - 1;
}

function numericCurveIntersections(first: TrimArcCurve | TrimEllipseCurve, second: TrimArcCurve | TrimEllipseCurve): TrimCurveIntersection[] {
  const samples = 4096; const roots: number[] = []; const tolerance = 1e-8;
  const residual = (parameter: number): number => normalizedResidual(second, trimPointAtRaw(first, parameter));
  const parameters = Array.from({ length: samples + 1 }, (_, index) => index / samples);
  const values = parameters.map(residual);
  for (let index = 0; index <= samples; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    if ((index === 0 || index === samples) && Math.abs(value) <= tolerance) roots.push(parameters[index]!);
    if (index === 0) continue;
    const previous = values[index - 1]!;
    if (!Number.isFinite(previous) || previous * value >= 0) continue;
    let low = parameters[index - 1]!; let high = parameters[index]!; let lowValue = previous;
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (low + high) / 2; const middleValue = residual(middle);
      if (Math.abs(middleValue) <= tolerance * 0.01) { low = middle; high = middle; break; }
      if (lowValue * middleValue <= 0) high = middle;
      else { low = middle; lowValue = middleValue; }
    }
    roots.push((low + high) / 2);
  }
  const golden = (Math.sqrt(5) - 1) / 2;
  for (let index = 1; index < samples; index += 1) {
    const previous = Math.abs(values[index - 1]!); const current = Math.abs(values[index]!); const next = Math.abs(values[index + 1]!);
    if (!Number.isFinite(current) || current > previous || current > next) continue;
    let low = parameters[index - 1]!; let high = parameters[index + 1]!;
    let left = high - golden * (high - low); let right = low + golden * (high - low);
    let leftValue = Math.abs(residual(left)); let rightValue = Math.abs(residual(right));
    for (let iteration = 0; iteration < 60; iteration += 1) {
      if (leftValue <= rightValue) {
        high = right; right = left; rightValue = leftValue;
        left = high - golden * (high - low); leftValue = Math.abs(residual(left));
      } else {
        low = left; left = right; leftValue = rightValue;
        right = low + golden * (high - low); rightValue = Math.abs(residual(right));
      }
    }
    const candidate = (low + high) / 2;
    if (Math.abs(residual(candidate)) <= tolerance) roots.push(candidate);
  }
  return roots.map((firstParameter) => {
    const point = trimPointAt(first, firstParameter);
    return { point, first: firstParameter, second: parameterAt(second, point), residual: Math.abs(normalizedResidual(second, point)) };
  }).sort((left, right) => left.residual - right.residual)
    .filter((item, index, all) => all.slice(0, index).every((known) => distance(item.point, known.point) > TRIM_EPSILON * 10))
    .sort((left, right) => left.first - right.first)
    .map(({ point, first: firstParameter, second: secondParameter }) => ({ point, first: firstParameter, second: secondParameter }));
}

function implicitResidual(boundary: TrimLineCurve | TrimArcCurve | TrimEllipseCurve, point: CadPoint2): number {
  if (boundary.kind === "line") {
    const direction = subtract(boundary.end, boundary.start);
    const magnitude = length(direction);
    return magnitude > TRIM_EPSILON ? cross(subtract(point, boundary.start), direction) / magnitude : Number.NaN;
  }
  return normalizedResidual(boundary, point);
}

/**
 * Finds both crossing and even-multiplicity (tangent) roots for a spline against an
 * implicit line/circle/ellipse support. The generic tessellated curve/curve solver
 * cannot see a tangency that falls between two tessellation samples because neither
 * chord crosses the boundary.
 */
function numericSplineImplicitIntersections(
  spline: TrimSplineCurve,
  boundary: TrimLineCurve | TrimArcCurve | TrimEllipseCurve,
): TrimCurveIntersection[] {
  const samples = Math.max(2048, spline.controlPoints.length * 256);
  const residual = (parameter: number): number => {
    const point = nurbsPointRaw(spline, parameter);
    return point ? implicitResidual(boundary, point) : Number.NaN;
  };
  const parameters = Array.from({ length: samples + 1 }, (_, index) => index / samples);
  const values = parameters.map(residual);
  const roots: number[] = [];
  const tolerance = boundary.kind === "line" ? TRIM_EPSILON * 10 : 1e-8;

  for (let index = 0; index <= samples; index += 1) {
    const current = values[index]!;
    if (!Number.isFinite(current)) continue;
    if ((index === 0 || index === samples) && Math.abs(current) <= tolerance) roots.push(parameters[index]!);
    if (index === 0) continue;
    const previous = values[index - 1]!;
    if (!Number.isFinite(previous) || previous * current >= 0) continue;
    let low = parameters[index - 1]!; let high = parameters[index]!; let lowValue = previous;
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const middle = (low + high) / 2; const middleValue = residual(middle);
      if (Math.abs(middleValue) <= tolerance * 0.01) { low = middle; high = middle; break; }
      if (lowValue * middleValue <= 0) high = middle;
      else { low = middle; lowValue = middleValue; }
    }
    roots.push((low + high) / 2);
  }

  // Search each sampled local minimum of |residual|. This is the missing branch
  // for a double root: the residual touches zero but never changes sign.
  const golden = (Math.sqrt(5) - 1) / 2;
  for (let index = 1; index < samples; index += 1) {
    const previous = Math.abs(values[index - 1]!); const current = Math.abs(values[index]!); const next = Math.abs(values[index + 1]!);
    if (!Number.isFinite(current) || current > previous || current > next) continue;
    let low = parameters[index - 1]!; let high = parameters[index + 1]!;
    let left = high - golden * (high - low); let right = low + golden * (high - low);
    let leftValue = Math.abs(residual(left)); let rightValue = Math.abs(residual(right));
    for (let iteration = 0; iteration < 64; iteration += 1) {
      if (leftValue <= rightValue) {
        high = right; right = left; rightValue = leftValue;
        left = high - golden * (high - low); leftValue = Math.abs(residual(left));
      } else {
        low = left; left = right; leftValue = rightValue;
        right = low + golden * (high - low); rightValue = Math.abs(residual(right));
      }
    }
    const candidate = (low + high) / 2;
    if (Math.abs(residual(candidate)) <= tolerance) roots.push(candidate);
  }

  return roots
    .map(clean)
    .map((first) => {
      const point = trimPointAt(spline, first);
      return { point, first, second: parameterAt(boundary, point), residual: Math.abs(implicitResidual(boundary, point)) };
    })
    .sort((left, right) => left.residual - right.residual)
    .filter((item, index, all) => all.slice(0, index).every((known) => distance(item.point, known.point) > TRIM_EPSILON * 10))
    .sort((left, right) => left.first - right.first)
    .map(({ point, first, second }) => ({ point, first, second }));
}

function numericParametricIntersections(first: TrimCurve, second: TrimCurve): TrimCurveIntersection[] {
  const firstSamples = first.kind === "spline" ? Math.max(512, first.controlPoints.length * 64) : first.kind === "line" ? 1 : 256;
  const secondSamples = second.kind === "spline" ? Math.max(512, second.controlPoints.length * 64) : second.kind === "line" ? 1 : 256;
  const firstPoints = Array.from({ length: firstSamples + 1 }, (_, index) => trimPointAt(first, index / firstSamples));
  const secondPoints = Array.from({ length: secondSamples + 1 }, (_, index) => trimPointAt(second, index / secondSamples));
  const seeds: Array<{ first: number; second: number }> = [];
  for (let firstIndex = 0; firstIndex < firstSamples; firstIndex += 1) {
    const firstSegment: TrimLineCurve = { kind: "line", start: firstPoints[firstIndex]!, end: firstPoints[firstIndex + 1]!, segment: 0 };
    if (!finitePoint(firstSegment.start) || !finitePoint(firstSegment.end)) continue;
    const firstMinX = Math.min(firstSegment.start.x, firstSegment.end.x) - TRIM_EPSILON;
    const firstMaxX = Math.max(firstSegment.start.x, firstSegment.end.x) + TRIM_EPSILON;
    const firstMinY = Math.min(firstSegment.start.y, firstSegment.end.y) - TRIM_EPSILON;
    const firstMaxY = Math.max(firstSegment.start.y, firstSegment.end.y) + TRIM_EPSILON;
    for (let secondIndex = 0; secondIndex < secondSamples; secondIndex += 1) {
      const secondStart = secondPoints[secondIndex]!; const secondEnd = secondPoints[secondIndex + 1]!;
      if (!finitePoint(secondStart) || !finitePoint(secondEnd)) continue;
      if (
        Math.max(secondStart.x, secondEnd.x) < firstMinX || Math.min(secondStart.x, secondEnd.x) > firstMaxX
        || Math.max(secondStart.y, secondEnd.y) < firstMinY || Math.min(secondStart.y, secondEnd.y) > firstMaxY
      ) continue;
      const hits = lineLine(firstSegment, { kind: "line", start: secondStart, end: secondEnd, segment: 0 });
      for (const hit of hits) {
        if (hit.first < -TRIM_EPSILON || hit.first > 1 + TRIM_EPSILON || hit.second < -TRIM_EPSILON || hit.second > 1 + TRIM_EPSILON) continue;
        seeds.push({ first: (firstIndex + hit.first) / firstSamples, second: (secondIndex + hit.second) / secondSamples });
      }
    }
  }

  // Polyline crossings seed ordinary roots, but a tangent pair has no chord
  // crossing. Add strict local minima of sampled curve-to-curve distance as
  // seeds for the same two-parameter Newton refinement below. Requiring a
  // strict minimum avoids turning coincident/overlapping curves into hundreds
  // of artificial point intersections.
  const addProximitySeeds = (
    sourcePoints: readonly CadPoint2[],
    targetPoints: readonly CadPoint2[],
    sourceSamples: number,
    targetSamples: number,
    reverse: boolean,
  ): void => {
    const nearest = sourcePoints.map((sourcePoint) => {
      let targetIndex = 0;
      let distanceSquared = Number.POSITIVE_INFINITY;
      for (let index = 0; index < targetPoints.length; index += 1) {
        const delta = subtract(sourcePoint, targetPoints[index]!);
        const candidate = dot(delta, delta);
        if (candidate < distanceSquared) {
          targetIndex = index;
          distanceSquared = candidate;
        }
      }
      return { targetIndex, distanceSquared };
    });
    for (let sourceIndex = 0; sourceIndex <= sourceSamples; sourceIndex += 1) {
      const current = nearest[sourceIndex]!;
      const previous = sourceIndex > 0 ? nearest[sourceIndex - 1]!.distanceSquared : Number.POSITIVE_INFINITY;
      const next = sourceIndex < sourceSamples ? nearest[sourceIndex + 1]!.distanceSquared : Number.POSITIVE_INFINITY;
      if (current.distanceSquared > previous || current.distanceSquared > next
        || !(current.distanceSquared < previous || current.distanceSquared < next)) continue;
      const sourceChord = Math.max(
        sourceIndex > 0 ? distance(sourcePoints[sourceIndex - 1]!, sourcePoints[sourceIndex]!) : 0,
        sourceIndex < sourceSamples ? distance(sourcePoints[sourceIndex]!, sourcePoints[sourceIndex + 1]!) : 0,
      );
      const targetChord = Math.max(
        current.targetIndex > 0 ? distance(targetPoints[current.targetIndex - 1]!, targetPoints[current.targetIndex]!) : 0,
        current.targetIndex < targetSamples ? distance(targetPoints[current.targetIndex]!, targetPoints[current.targetIndex + 1]!) : 0,
      );
      const searchRadius = Math.max(TRIM_EPSILON * 100, sourceChord + targetChord);
      if (current.distanceSquared > searchRadius * searchRadius) continue;
      const sourceParameter = sourceIndex / sourceSamples;
      const targetParameter = current.targetIndex / targetSamples;
      seeds.push(reverse
        ? { first: targetParameter, second: sourceParameter }
        : { first: sourceParameter, second: targetParameter });
    }
  };
  addProximitySeeds(firstPoints, secondPoints, firstSamples, secondSamples, false);
  addProximitySeeds(secondPoints, firstPoints, secondSamples, firstSamples, true);

  const derivative = (curve: TrimCurve, parameter: number): CadPoint2 => {
    const step = 1e-6;
    const before = trimPointAtRaw(curve, Math.max(0, parameter - step));
    const after = trimPointAtRaw(curve, Math.min(1, parameter + step));
    const denominator = Math.min(1, parameter + step) - Math.max(0, parameter - step);
    return denominator > 0 ? scaled(subtract(after, before), 1 / denominator) : { x: 0, y: 0 };
  };
  const refined = seeds.map((seed) => {
    let firstParameter = clamp01(seed.first); let secondParameter = clamp01(seed.second);
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const firstPoint = trimPointAtRaw(first, firstParameter); const secondPoint = trimPointAtRaw(second, secondParameter);
      const residual = subtract(firstPoint, secondPoint);
      // A tangent root has an even-multiplicity residual: stopping at the
      // ordinary model tolerance would accept a visible fan of near misses.
      // Continue until machine precision (or the singular exact-root Jacobian)
      // and only apply the model tolerance after refinement.
      if (length(residual) <= Number.EPSILON) break;
      const firstDerivative = derivative(first, firstParameter); const secondDerivative = derivative(second, secondParameter);
      const determinant = cross(firstDerivative, scaled(secondDerivative, -1));
      if (Math.abs(determinant) <= 1e-12) break;
      const deltaFirst = (residual.x * secondDerivative.y - secondDerivative.x * residual.y) / determinant;
      const deltaSecond = (residual.x * firstDerivative.y - firstDerivative.x * residual.y) / determinant;
      firstParameter = clamp01(firstParameter + deltaFirst);
      secondParameter = clamp01(secondParameter + deltaSecond);
    }
    const firstPoint = trimPointAtRaw(first, firstParameter); const secondPoint = trimPointAtRaw(second, secondParameter);
    if (distance(firstPoint, secondPoint) > TRIM_EPSILON * 0.1) return null;
    return { point: cleanPoint(scaled(add(firstPoint, secondPoint), 0.5)), first: firstParameter, second: secondParameter };
  }).filter((item): item is TrimCurveIntersection => item !== null);
  return refined
    .sort((left, right) => left.first - right.first)
    .filter((item, index, all) => index === 0 || distance(item.point, all[index - 1]!.point) > TRIM_EPSILON * 10);
}

function rawIntersections(first: TrimCurve, second: TrimCurve): TrimCurveIntersection[] {
  if (first.kind === "spline" && second.kind !== "spline") return numericSplineImplicitIntersections(first, second);
  if (second.kind === "spline" && first.kind !== "spline") return numericSplineImplicitIntersections(second, first)
    .map((item) => ({ point: item.point, first: item.second, second: item.first }));
  if (first.kind === "spline" && second.kind === "spline") return numericParametricIntersections(first, second);
  if (first.kind === "line" && second.kind === "line") return lineLine(first, second);
  if (first.kind === "line" && second.kind === "arc") return lineArc(first, second);
  if (first.kind === "arc" && second.kind === "line") return lineArc(second, first).map((item) => ({ point: item.point, first: item.second, second: item.first }));
  if (first.kind === "arc" && second.kind === "arc") return arcArc(first, second);
  if (first.kind === "line" && second.kind === "ellipse") return lineEllipse(first, second);
  if (first.kind === "ellipse" && second.kind === "line") return lineEllipse(second, first).map((item) => ({ point: item.point, first: item.second, second: item.first }));
  return numericCurveIntersections(first as TrimArcCurve | TrimEllipseCurve, second as TrimArcCurve | TrimEllipseCurve);
}

function fullCurve(curve: TrimCurve): boolean {
  return curve.kind === "spline" ? curve.closed : (curve.kind === "arc" || curve.kind === "ellipse") && Math.abs(curve.sweep - FULL_TURN) <= 1e-8;
}

function finiteParameter(curve: TrimCurve, parameter: number): boolean {
  return fullCurve(curve) || (parameter >= -TRIM_EPSILON && parameter <= 1 + TRIM_EPSILON);
}

export function trimCurveIntersections(first: TrimCurve, second: TrimCurve, extendSecond = false, extendFirst = false): TrimCurveIntersection[] {
  const unique: TrimCurveIntersection[] = [];
  for (const intersection of rawIntersections(first, second)) {
    if ((!extendFirst && !finiteParameter(first, intersection.first)) || (!extendSecond && !finiteParameter(second, intersection.second))) continue;
    if (unique.some((known) => distance(known.point, intersection.point) <= TRIM_EPSILON)) continue;
    unique.push(intersection);
  }
  return unique;
}

function extendedParameter(curve: TrimCurve, parameter: number, endpoint: "start" | "end"): number {
  if (curve.kind === "line" || curve.kind === "spline") return parameter;
  const period = FULL_TURN / Math.abs(curve.sweep);
  if (endpoint === "start") return parameter >= -TRIM_EPSILON ? parameter - period : parameter;
  return parameter <= 1 + TRIM_EPSILON ? parameter + period : parameter;
}

interface SplineEndpointJet {
  point: CadPoint2;
  first: CadPoint2;
  second: CadPoint2;
  third: CadPoint2;
  referenceSpan: number;
  endpointWeight: number;
}

interface HomogeneousPoint { x: number; y: number; weight: number; }

/**
 * AutoCAD 2024 extends a clamped cubic control-point SPLINE with a polynomial
 * cubic span. Native measurements show that the span preserves C, C' and C''
 * and uses -normalize(C'') for C''' (zero when C'' is zero). Rational input is
 * differentiated in homogeneous form before conversion to Euclidean jets.
 */
function splineEndpointJet(entity: CadSpline, endpoint: "start" | "end"): SplineEndpointJet | null {
  if (!validSpline(entity) || entity.closed || entity.periodic || entity.degree !== 3) return null;
  const domainStart = entity.knots[entity.degree]!;
  const domainEnd = entity.knots[entity.controlPoints.length]!;
  const startClamp = entity.knots.slice(0, entity.degree + 1);
  const endClamp = entity.knots.slice(-(entity.degree + 1));
  if (
    !startClamp.every((knot) => Math.abs(knot - domainStart) <= 1e-10) ||
    !endClamp.every((knot) => Math.abs(knot - domainEnd) <= 1e-10) ||
    !(domainEnd - domainStart > 1e-14)
  ) return null;

  const homogeneous = entity.controlPoints.map((point, index): HomogeneousPoint => {
    const weight = entity.weights?.[index] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  const endpointValue = <T>(values: readonly T[]): T | undefined => endpoint === "start" ? values[0] : values.at(-1);
  const derivatives: HomogeneousPoint[] = [];
  let derivativePoints = homogeneous;
  let derivativeKnots = [...entity.knots];
  let derivativeDegree = entity.degree;
  for (let order = 1; order <= 2; order += 1) {
    const next: HomogeneousPoint[] = [];
    for (let index = 0; index + 1 < derivativePoints.length; index += 1) {
      const denominator = derivativeKnots[index + derivativeDegree + 1]! - derivativeKnots[index + 1]!;
      if (!(Math.abs(denominator) > 1e-14)) return null;
      const factor = derivativeDegree / denominator;
      const before = derivativePoints[index]!; const after = derivativePoints[index + 1]!;
      next.push({
        x: (after.x - before.x) * factor,
        y: (after.y - before.y) * factor,
        weight: (after.weight - before.weight) * factor,
      });
    }
    const endpointDerivative = endpointValue(next);
    if (!endpointDerivative) return null;
    derivatives.push(endpointDerivative);
    derivativePoints = next;
    derivativeKnots = derivativeKnots.slice(1, -1);
    derivativeDegree -= 1;
  }

  const value = endpointValue(homogeneous); const firstHomogeneous = derivatives[0]; const secondHomogeneous = derivatives[1];
  if (!value || !firstHomogeneous || !secondHomogeneous || !(Math.abs(value.weight) > 1e-14)) return null;
  const point = { x: value.x / value.weight, y: value.y / value.weight };
  const parameterFirst = {
    x: (firstHomogeneous.x - firstHomogeneous.weight * point.x) / value.weight,
    y: (firstHomogeneous.y - firstHomogeneous.weight * point.y) / value.weight,
  };
  const parameterSecond = {
    x: (secondHomogeneous.x - 2 * firstHomogeneous.weight * parameterFirst.x - secondHomogeneous.weight * point.x) / value.weight,
    y: (secondHomogeneous.y - 2 * firstHomogeneous.weight * parameterFirst.y - secondHomogeneous.weight * point.y) / value.weight,
  };
  const first = endpoint === "start" ? scaled(parameterFirst, -1) : parameterFirst;
  if (!(length(first) > TRIM_EPSILON)) return null;
  const secondMagnitude = length(parameterSecond);
  const third = secondMagnitude > TRIM_EPSILON ? scaled(parameterSecond, -1 / secondMagnitude) : { x: 0, y: 0 };
  let neighboringKnot: number | undefined;
  if (endpoint === "start") neighboringKnot = entity.knots.find((knot) => knot > domainStart + TRIM_EPSILON);
  else {
    for (let index = entity.knots.length - 1; index >= 0; index -= 1) {
      const knot = entity.knots[index]!;
      if (knot < domainEnd - TRIM_EPSILON) { neighboringKnot = knot; break; }
    }
  }
  if (neighboringKnot === undefined) return null;
  const referenceSpan = endpoint === "start" ? neighboringKnot - domainStart : domainEnd - neighboringKnot;
  if (!(referenceSpan > TRIM_EPSILON)) return null;
  return {
    point: cleanPoint(point), first, second: parameterSecond, third, referenceSpan,
    endpointWeight: entity.weights?.[endpoint === "start" ? 0 : entity.controlPoints.length - 1] ?? 1,
  };
}

function splineExtensionBezier(jet: SplineEndpointJet, span: number): [CadPoint2, CadPoint2, CadPoint2, CadPoint2] | null {
  if (!(span > TRIM_EPSILON) || !Number.isFinite(span)) return null;
  const spanSquared = span * span; const spanCubed = spanSquared * span;
  const firstControl = add(jet.point, scaled(jet.first, span / 3));
  const secondControl = add(add(jet.point, scaled(jet.first, 2 * span / 3)), scaled(jet.second, spanSquared / 6));
  const endPoint = add(add(add(jet.point, scaled(jet.first, span)), scaled(jet.second, spanSquared / 2)), scaled(jet.third, spanCubed / 6));
  if (![firstControl, secondControl, endPoint].every(finitePoint)) return null;
  return [cleanPoint(jet.point), cleanPoint(firstControl), cleanPoint(secondControl), cleanPoint(endPoint)];
}

function splineExtensionCurve(jet: SplineEndpointJet, span: number): TrimSplineCurve | null {
  const controlPoints = splineExtensionBezier(jet, span);
  return controlPoints ? {
    kind: "spline", degree: 3, controlPoints, knots: [0, 0, 0, 0, 1, 1, 1, 1],
    startParameter: 0, endParameter: 1, closed: false, segment: 0,
  } : null;
}

function splineEndpointExtension(entity: CadSpline, endpoint: "start" | "end", span: number): CadSpline | null {
  const jet = splineEndpointJet(entity, endpoint); const bezier = jet ? splineExtensionBezier(jet, span) : null;
  if (!jet || !bezier) return null;
  const domainStart = entity.knots[entity.degree]!; const domainEnd = entity.knots[entity.controlPoints.length]!;
  const endpointWeights = Array.from({ length: entity.degree }, () => jet.endpointWeight);
  const output: CadSpline = endpoint === "end" ? {
    ...structuredClone(entity),
    controlPoints: [...structuredClone(entity.controlPoints), ...bezier.slice(1)],
    knots: [...entity.knots.slice(0, -1), ...Array.from({ length: entity.degree + 1 }, () => clean(domainEnd + span))],
    ...(entity.weights ? { weights: [...entity.weights, ...endpointWeights] } : {}),
  } : {
    ...structuredClone(entity),
    controlPoints: [...bezier.slice(1).reverse(), ...structuredClone(entity.controlPoints)],
    knots: [...Array.from({ length: entity.degree + 1 }, () => clean(domainStart - span)), ...entity.knots.slice(1)],
    ...(entity.weights ? { weights: [...endpointWeights, ...entity.weights] } : {}),
  };
  return validSpline(output) ? output : null;
}

function splineExtensionIntersections(
  entity: CadSpline,
  endpoint: "start" | "end",
  boundaries: readonly TrimCurve[],
  edgeMode: TrimEdgeMode,
): Array<{ point: CadPoint2; span: number }> {
  const jet = splineEndpointJet(entity, endpoint);
  if (!jet) return [];
  let probeSpan = jet.referenceSpan;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const extension = splineExtensionCurve(jet, probeSpan);
    if (!extension) return [];
    const candidates = boundaries.flatMap((boundary) =>
      trimCurveIntersections(extension, boundary, edgeMode === "extend", false)
        .filter((intersection) => intersection.first > TRIM_EPSILON && intersection.first <= 1 + TRIM_EPSILON)
        .map((intersection) => ({ point: intersection.point, span: intersection.first * probeSpan })),
    ).sort((left, right) => left.span - right.span)
      .filter((candidate, index, all) => index === 0 || Math.abs(candidate.span - all[index - 1]!.span) > TRIM_EPSILON);
    if (candidates.length > 0) return candidates;
    probeSpan *= 2;
    if (!Number.isFinite(probeSpan)) break;
  }
  return [];
}

function extendedCurveEntity(entity: CadEntity, curve: TrimCurve, parameter: number, endpoint: "start" | "end"): CadEntity | null {
  const point = trimPointAt(curve, parameter);
  if (!finitePoint(point)) return null;
  if (entity.kind === "line" && curve.kind === "line") {
    return { ...structuredClone(entity), [endpoint]: point };
  }
  if (entity.kind === "arc" && curve.kind === "arc") {
    const angle = clean(curve.startAngle + curve.sweep * parameter);
    return { ...structuredClone(entity), ...(endpoint === "start" ? { startAngleRad: angle } : { endAngleRad: angle }) };
  }
  if (entity.kind === "ellipse" && curve.kind === "ellipse") {
    const ellipseParameter = clean(curve.startParameter + curve.sweep * parameter);
    return { ...structuredClone(entity), ...(endpoint === "start" ? { startParameter: ellipseParameter } : { endParameter: ellipseParameter }) };
  }
  if (entity.kind === "spline") return null;
  if (entity.kind !== "polyline" || entity.closed) return null;
  const vertices = structuredClone(entity.vertices);
  if (endpoint === "start") {
    const first = vertices[0];
    if (!first) return null;
    first.x = point.x;
    first.y = point.y;
    if (curve.kind === "arc") {
      const bulge = clean(Math.tan((curve.sweep * (1 - parameter)) / 4));
      if (Math.abs(bulge) > 1e-12) first.bulge = bulge;
      else delete first.bulge;
    }
  } else {
    const last = vertices.at(-1);
    const segmentStart = vertices.at(-2);
    if (!last || !segmentStart) return null;
    last.x = point.x;
    last.y = point.y;
    if (curve.kind === "arc") {
      const bulge = clean(Math.tan((curve.sweep * parameter) / 4));
      if (Math.abs(bulge) > 1e-12) segmentStart.bulge = bulge;
      else delete segmentStart.bulge;
    }
  }
  return { ...structuredClone(entity), vertices };
}

/** Pure Shift-Extend predicate sharing the same intersection support as TRIM preview and commit. */
export function extendCadEntity(
  entity: CadEntity,
  pickPoint: CadPoint2,
  boundaries: readonly CadEntity[],
  options: { edgeMode?: TrimEdgeMode; projectMode?: TrimProjectMode } = {},
): ExtendGeometryResult {
  if (!finitePoint(pickPoint)) return { entity: null, intersectionPoint: null, endpoint: null, reason: "degenerate-geometry" };
  const curves = trimCurvesOfEntity(entity);
  if (
    curves.length === 0 || entity.kind === "circle" ||
    (entity.kind === "ellipse" && fullCurve(curves[0]!)) ||
    (entity.kind === "polyline" && entity.closed)
  ) return { entity: null, intersectionPoint: null, endpoint: null, reason: "unsupported-target" };
  const startPoint = trimPointAt(curves[0]!, 0);
  const endPoint = trimPointAt(curves.at(-1)!, 1);
  const endpoint = distance(pickPoint, startPoint) <= distance(pickPoint, endPoint) ? "start" : "end";
  if (entity.kind === "spline" && !splineEndpointJet(entity, endpoint)) {
    return { entity: null, intersectionPoint: null, endpoint, reason: "unsupported-target" };
  }
  const targetCurve = endpoint === "start" ? curves[0]! : curves.at(-1)!;
  if (!targetCurve) return { entity: null, intersectionPoint: null, endpoint, reason: "unsupported-target" };
  const boundaryCurves = boundaries.flatMap(trimBoundaryCurvesOfEntity);
  const candidates = entity.kind === "spline"
    ? splineExtensionIntersections(entity, endpoint, boundaryCurves, options.edgeMode ?? "no-extend")
      .map((intersection) => ({ point: intersection.point, parameter: intersection.span }))
    : boundaryCurves.flatMap((boundary) =>
      trimCurveIntersections(targetCurve, boundary, options.edgeMode === "extend", true)
      .map((intersection) => ({
        point: intersection.point,
        parameter: extendedParameter(targetCurve, intersection.first, endpoint),
      })),
    ).filter((candidate) => endpoint === "start" ? candidate.parameter < -TRIM_EPSILON : candidate.parameter > 1 + TRIM_EPSILON);
  candidates.sort((first, second) => entity.kind === "spline" || endpoint === "end"
    ? first.parameter - second.parameter : second.parameter - first.parameter);
  const selected = candidates[0];
  if (!selected) return { entity: null, intersectionPoint: null, endpoint, reason: "no-intersection" };
  const extended = entity.kind === "spline"
    ? splineEndpointExtension(entity, endpoint, selected.parameter)
    : extendedCurveEntity(entity, targetCurve, selected.parameter, endpoint);
  return extended
    ? { entity: extended, intersectionPoint: cleanPoint(selected.point), endpoint, reason: null }
    : { entity: null, intersectionPoint: null, endpoint, reason: "degenerate-geometry" };
}

export interface TrimClosestPoint {
  segment: number;
  parameter: number;
  point: CadPoint2;
  distance: number;
}

export function trimClosestPoint(entity: CadEntity, point: CadPoint2): TrimClosestPoint | null {
  if (!finitePoint(point)) return null;
  const curves = trimCurvesOfEntity(entity);
  let closest: TrimClosestPoint | null = null;
  curves.forEach((curve, segment) => {
    const parameter = closestParameter(curve, point);
    const candidatePoint = trimPointAt(curve, parameter);
    const candidateDistance = distance(candidatePoint, point);
    if (!closest || candidateDistance < closest.distance) {
      closest = { segment, parameter, point: candidatePoint, distance: candidateDistance };
    }
  });
  return closest;
}

function entityBase(entity: CadEntity): Omit<CadEntity, "kind"> {
  return { handle: entity.handle, layerId: entity.layerId, ...(entity.appearance ? { appearance: structuredClone(entity.appearance) } : {}), ...(entity.extensionData ? { extensionData: structuredClone(entity.extensionData) } : {}) } as Omit<CadEntity, "kind">;
}

function splineSpan(entity: CadSpline, parameter: number): number {
  const last = entity.controlPoints.length - 1;
  const end = entity.knots[last + 1]!;
  if (parameter >= end - TRIM_EPSILON) return last;
  let span = entity.degree;
  while (span < last && !(parameter >= entity.knots[span]! && parameter < entity.knots[span + 1]!)) span += 1;
  return span;
}

function splineKnotMultiplicity(entity: CadSpline, parameter: number): number {
  return entity.knots.filter((knot) => Math.abs(knot - parameter) <= 1e-10).length;
}

function insertSplineKnotOnce(entity: CadSpline, parameter: number): CadSpline {
  const degree = entity.degree;
  const last = entity.controlPoints.length - 1;
  const span = splineSpan(entity, parameter);
  const multiplicity = splineKnotMultiplicity(entity, parameter);
  if (multiplicity >= degree + 1) return structuredClone(entity);
  const source = entity.controlPoints.map((point, index): HomogeneousPoint => {
    const weight = entity.weights?.[index] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  const output = Array.from({ length: source.length + 1 }, (): HomogeneousPoint => ({ x: 0, y: 0, weight: 0 }));
  for (let index = 0; index <= span - degree; index += 1) output[index] = source[index]!;
  for (let index = span - multiplicity; index <= last; index += 1) output[index + 1] = source[index]!;
  for (let index = span - degree + 1; index <= span - multiplicity; index += 1) {
    const denominator = entity.knots[index + degree]! - entity.knots[index]!;
    const alpha = Math.abs(denominator) <= 1e-14 ? 0 : (parameter - entity.knots[index]!) / denominator;
    const before = source[index - 1]!; const current = source[index]!;
    output[index] = {
      x: before.x * (1 - alpha) + current.x * alpha,
      y: before.y * (1 - alpha) + current.y * alpha,
      weight: before.weight * (1 - alpha) + current.weight * alpha,
    };
  }
  const controlPoints = output.map((point) => {
    if (!(Math.abs(point.weight) > 1e-14)) throw new RangeError("Spline knot insertion produced a zero homogeneous weight.");
    return cleanPoint({ x: point.x / point.weight, y: point.y / point.weight });
  });
  const weights = output.map((point) => clean(point.weight));
  return {
    ...structuredClone(entity),
    controlPoints,
    knots: [...entity.knots.slice(0, span + 1), parameter, ...entity.knots.slice(span + 1)],
    ...(entity.weights ? { weights } : {}),
  };
}

function splitSplineAt(entity: CadSpline, parameter: number): [CadSpline, CadSpline] | null {
  const domainStart = entity.knots[entity.degree]!;
  const domainEnd = entity.knots[entity.controlPoints.length]!;
  if (!(parameter > domainStart + TRIM_EPSILON && parameter < domainEnd - TRIM_EPSILON)) return null;
  let refined = structuredClone(entity);
  while (splineKnotMultiplicity(refined, parameter) < refined.degree) refined = insertSplineKnotOnce(refined, parameter);
  const splitIndex = splineSpan(refined, parameter) - refined.degree;
  const leftControlPoints = refined.controlPoints.slice(0, splitIndex + 1);
  const rightControlPoints = refined.controlPoints.slice(splitIndex);
  const leftKnots = [...refined.knots.slice(0, splitIndex + refined.degree + 1), parameter];
  const rightKnots = [parameter, ...refined.knots.slice(splitIndex + 1)];
  const left: CadSpline = {
    ...structuredClone(refined), controlPoints: leftControlPoints, knots: leftKnots,
    ...(refined.weights ? { weights: refined.weights.slice(0, splitIndex + 1) } : {}), closed: false, periodic: false,
  };
  const right: CadSpline = {
    ...structuredClone(refined), controlPoints: rightControlPoints, knots: rightKnots,
    ...(refined.weights ? { weights: refined.weights.slice(splitIndex) } : {}), closed: false, periodic: false,
  };
  return validSpline(left) && validSpline(right) ? [left, right] : null;
}

function splineInterval(entity: CadSpline, from: number, to: number): CadSpline | null {
  if (!(to - from > TRIM_EPSILON) || from < -TRIM_EPSILON || to > 1 + TRIM_EPSILON || !validSpline(entity)) return null;
  const start = entity.knots[entity.degree]!;
  const end = entity.knots[entity.controlPoints.length]!;
  const fromParameter = start + (end - start) * Math.max(0, from);
  const toParameter = start + (end - start) * Math.min(1, to);
  let output = { ...structuredClone(entity), closed: false, periodic: false };
  if (from > TRIM_EPSILON) {
    const split = splitSplineAt(output, fromParameter);
    if (!split) return null;
    output = split[1];
  }
  if (to < 1 - TRIM_EPSILON) {
    const split = splitSplineAt(output, toParameter);
    if (!split) return null;
    output = split[0];
  }
  return validSpline(output) ? output : null;
}

function joinSplineIntervals(first: CadSpline, second: CadSpline): CadSpline | null {
  if (first.degree !== second.degree || !validSpline(first) || !validSpline(second)) return null;
  const firstEndPoint = first.controlPoints.at(-1); const secondStartPoint = second.controlPoints[0];
  if (!firstEndPoint || !secondStartPoint || distance(firstEndPoint, secondStartPoint) > TRIM_EPSILON * 10) return null;
  const firstEnd = first.knots[first.controlPoints.length]!;
  const secondStart = second.knots[second.degree]!;
  const shift = firstEnd - secondStart;
  const controlPoints = [...structuredClone(first.controlPoints), ...structuredClone(second.controlPoints.slice(1))];
  const firstWeights = first.weights ?? Array.from({ length: first.controlPoints.length }, () => 1);
  const secondWeights = second.weights ?? Array.from({ length: second.controlPoints.length }, () => 1);
  const weights = [...firstWeights, ...secondWeights.slice(1)];
  const result: CadSpline = {
    ...structuredClone(first),
    controlPoints,
    knots: [...first.knots.slice(0, -1), ...second.knots.slice(second.degree + 1).map((knot) => knot + shift)],
    ...(first.weights || second.weights ? { weights } : {}),
    closed: false,
    periodic: false,
  };
  return validSpline(result) ? result : null;
}

function curvePiece(entity: CadEntity, curve: TrimCurve, from: number, to: number): CadEntity | null {
  if (!(to - from > TRIM_EPSILON)) return null;
  if (curve.kind === "spline" && entity.kind === "spline") {
    if (to <= 1 + TRIM_EPSILON) return splineInterval(entity, Math.max(0, from), Math.min(1, to));
    const first = splineInterval(entity, Math.max(0, from), 1);
    const second = splineInterval(entity, 0, Math.min(1, to - 1));
    return first && second ? joinSplineIntervals(first, second) : null;
  }
  const start = trimPointAt(curve, from); const end = trimPointAt(curve, to);
  if (distance(start, end) <= TRIM_EPSILON) return null;
  const base = entityBase(entity);
  if (curve.kind === "line") return { ...base, kind: "line", start, end } as CadEntity;
  if (curve.kind === "arc") {
    const startAngleRad = curve.startAngle + curve.sweep * from; const endAngleRad = curve.startAngle + curve.sweep * to;
    return { ...base, kind: "arc", center: cleanPoint(curve.center), radius: clean(curve.radius), startAngleRad: clean(startAngleRad), endAngleRad: clean(endAngleRad), counterClockwise: curve.sweep > 0 } as CadEntity;
  }
  if (curve.kind !== "ellipse") return null;
  return {
    ...base, kind: "ellipse", center: cleanPoint(curve.center), majorAxis: cleanPoint(curve.major), ratio: clean(length(curve.minor) / length(curve.major)),
    startParameter: clean(curve.startParameter + curve.sweep * from), endParameter: clean(curve.startParameter + curve.sweep * to),
  } as CadEntity;
}

function interpolateWidth(start: CadPolylineVertex, parameter: number): number | undefined {
  const first = start.startWidth; const second = start.endWidth;
  if (first === undefined && second === undefined) return undefined;
  const from = first ?? 0; const to = second ?? from;
  const value = from + (to - from) * parameter;
  return clean(value);
}

function polylinePiece(entity: CadPolyline, curves: readonly TrimCurve[], from: number, to: number): CadPolyline | null {
  if (!(to - from > TRIM_EPSILON)) return null;
  const count = curves.length; const vertices: CadPolylineVertex[] = [];
  let cursor = from;
  while (cursor < to - TRIM_EPSILON) {
    const unwrappedSegment = Math.min(Math.floor(cursor + TRIM_EPSILON), Math.ceil(to) - 1);
    const segment = ((unwrappedSegment % count) + count) % count;
    const curve = curves[segment]!;
    const localStart = cursor - Math.floor(cursor);
    const segmentEnd = Math.min(to, Math.floor(cursor) + 1);
    const localEnd = segmentEnd - Math.floor(cursor);
    const sourceVertex = entity.vertices[segment]!;
    const point = trimPointAt(curve, localStart);
    const partialSweep = curve.kind === "arc" ? curve.sweep * (localEnd - localStart) : 0;
    const bulge = Math.abs(partialSweep) > 1e-12 ? clean(Math.tan(partialSweep / 4)) : 0;
    const startWidth = interpolateWidth(sourceVertex, localStart);
    const endWidth = interpolateWidth(sourceVertex, localEnd);
    vertices.push({ ...point, ...(Math.abs(bulge) > 1e-12 ? { bulge } : {}), ...(startWidth !== undefined ? { startWidth } : {}), ...(endWidth !== undefined ? { endWidth } : {}) });
    cursor = segmentEnd;
    if (Math.abs(cursor - Math.round(cursor)) <= TRIM_EPSILON) cursor = Math.round(cursor);
  }
  const finalSegment = ((Math.min(Math.floor(to - TRIM_EPSILON), Math.ceil(to) - 1) % count) + count) % count;
  const finalLocal = to - Math.floor(to);
  const finalVertex = trimPointAt(curves[finalSegment]!, finalLocal <= TRIM_EPSILON && to > from ? 1 : finalLocal);
  const finalSegmentWidths = vertices.at(-1);
  vertices.push({
    ...finalVertex,
    ...(finalSegmentWidths?.startWidth !== undefined ? { startWidth: finalSegmentWidths.startWidth } : {}),
    ...(finalSegmentWidths?.endWidth !== undefined ? { endWidth: finalSegmentWidths.endWidth } : {}),
  });
  if (vertices.length < 2 || vertices.some((vertex) => !finitePoint(vertex))) return null;
  return { ...structuredClone(entity), vertices, closed: false };
}

function intersectionParameters(curve: TrimCurve, boundaries: readonly TrimCurve[], extendBoundaries: boolean): { parameters: number[]; points: CadPoint2[] } {
  const isClosed = fullCurve(curve);
  const intersections = boundaries.flatMap((boundary) => trimCurveIntersections(curve, boundary, extendBoundaries))
    .map((item) => isClosed ? { ...item, first: ((item.first % 1) + 1) % 1 } : item);
  const filtered = intersections
    .filter((item) => isClosed || (item.first > TRIM_EPSILON && item.first < 1 - TRIM_EPSILON))
    .sort((first, second) => first.first - second.first)
    .filter((item, index, all) => index === 0 || Math.abs(item.first - all[index - 1]!.first) > TRIM_EPSILON);
  return { parameters: filtered.map((item) => item.first), points: filtered.map((item) => item.point) };
}

function trimSimple(entity: CadEntity, curve: TrimCurve, pick: number, boundaries: readonly TrimCurve[], extendBoundaries: boolean): TrimGeometryResult {
  const { parameters, points } = intersectionParameters(curve, boundaries, extendBoundaries);
  if (fullCurve(curve)) {
    if (parameters.length < 2) return { entities: [], intersectionPoints: points, removedInterval: null, reason: parameters.length === 1 ? "ambiguous-tangent" : "no-intersection" };
    let lower = parameters.at(-1)!; let upper = parameters[0]! + 1;
    for (let index = 0; index < parameters.length; index += 1) {
      const current = parameters[index]!; const next = index + 1 < parameters.length ? parameters[index + 1]! : parameters[0]! + 1;
      const probe = pick < current ? pick + 1 : pick;
      if (probe >= current - TRIM_EPSILON && probe <= next + TRIM_EPSILON) { lower = current; upper = next; break; }
    }
    const keptStart = upper % 1; const keptLength = 1 - (upper - lower);
    const piece = curvePiece(entity, curve, keptStart, keptStart + keptLength);
    return piece ? { entities: [piece], intersectionPoints: points, removedInterval: { start: lower, end: upper % 1, wraps: upper > 1 }, reason: null } : { entities: [], intersectionPoints: points, removedInterval: null, reason: "degenerate-geometry" };
  }
  if (parameters.length === 0) return { entities: [], intersectionPoints: points, removedInterval: null, reason: "no-intersection" };
  const cuts = [0, ...parameters, 1]; let removeIndex = -1;
  for (let index = 0; index < cuts.length - 1; index += 1) if (pick >= cuts[index]! - TRIM_EPSILON && pick <= cuts[index + 1]! + TRIM_EPSILON) { removeIndex = index; break; }
  if (removeIndex < 0) return { entities: [], intersectionPoints: points, removedInterval: null, reason: "no-intersection" };
  const pieces = [curvePiece(entity, curve, 0, cuts[removeIndex]!), curvePiece(entity, curve, cuts[removeIndex + 1]!, 1)].filter((piece): piece is CadEntity => piece !== null);
  return { entities: pieces, intersectionPoints: points, removedInterval: { start: cuts[removeIndex]!, end: cuts[removeIndex + 1]!, wraps: false }, reason: pieces.length ? null : "degenerate-geometry" };
}

function trimPolyline(entity: CadPolyline, curves: readonly TrimCurve[], pickedSegment: number, pickedParameter: number, boundaries: readonly TrimCurve[], extendBoundaries: boolean): TrimGeometryResult {
  const count = curves.length;
  const intersections = curves.flatMap((curve, segment) =>
    boundaries.flatMap((boundary) =>
      trimCurveIntersections(curve, boundary, extendBoundaries)
        .map((item) => ({ point: item.point, parameter: segment + item.first })),
    ),
  );
  const unique = intersections
    .filter((item) => item.parameter > TRIM_EPSILON && item.parameter < count - TRIM_EPSILON)
    .sort((first, second) => first.parameter - second.parameter)
    .filter((item, index, all) => index === 0 || Math.abs(item.parameter - all[index - 1]!.parameter) > TRIM_EPSILON);
  const parameters = unique.map((item) => item.parameter); const points = unique.map((item) => item.point); const pick = pickedSegment + pickedParameter;
  if (entity.closed) {
    const closedIntersections = intersections.sort((first, second) => first.parameter - second.parameter).filter((item, index, all) => index === 0 || Math.abs(item.parameter - all[index - 1]!.parameter) > TRIM_EPSILON);
    const closedParameters = closedIntersections.map((item) => item.parameter);
    if (closedParameters.length < 2) return { entities: [], intersectionPoints: closedIntersections.map((item) => item.point), removedInterval: null, reason: closedParameters.length === 1 ? "ambiguous-tangent" : "no-intersection" };
    let lower = closedParameters.at(-1)!; let upper = closedParameters[0]! + count;
    for (let index = 0; index < closedParameters.length; index += 1) {
      const current = closedParameters[index]!; const next = index + 1 < closedParameters.length ? closedParameters[index + 1]! : closedParameters[0]! + count;
      const probe = pick < current ? pick + count : pick;
      if (probe >= current - TRIM_EPSILON && probe <= next + TRIM_EPSILON) { lower = current; upper = next; break; }
    }
    const kept = polylinePiece(entity, curves, upper, lower + count);
    return kept ? { entities: [kept], intersectionPoints: closedIntersections.map((item) => item.point), removedInterval: { start: lower / count, end: (upper % count) / count, wraps: upper > count }, reason: null } : { entities: [], intersectionPoints: points, removedInterval: null, reason: "degenerate-geometry" };
  }
  if (parameters.length === 0) return { entities: [], intersectionPoints: points, removedInterval: null, reason: "no-intersection" };
  const cuts = [0, ...parameters, count]; let removeIndex = -1;
  for (let index = 0; index < cuts.length - 1; index += 1) if (pick >= cuts[index]! - TRIM_EPSILON && pick <= cuts[index + 1]! + TRIM_EPSILON) { removeIndex = index; break; }
  const pieces = removeIndex < 0 ? [] : [polylinePiece(entity, curves, 0, cuts[removeIndex]!), polylinePiece(entity, curves, cuts[removeIndex + 1]!, count)].filter((piece): piece is CadPolyline => piece !== null);
  return { entities: pieces, intersectionPoints: points, removedInterval: removeIndex < 0 ? null : { start: cuts[removeIndex]! / count, end: cuts[removeIndex + 1]! / count, wraps: false }, reason: pieces.length ? null : "degenerate-geometry" };
}

/**
 * Pure TRIM predicate used by both preview and commit. Project modes are explicit but equivalent in
 * this fixed 2D document model. Boundary extrapolation follows the natural line/arc/ellipse support.
 */
export function trimCadEntity(
  entity: CadEntity,
  pickPoint: CadPoint2,
  boundaries: readonly CadEntity[],
  options: { edgeMode?: TrimEdgeMode; projectMode?: TrimProjectMode } = {},
): TrimGeometryResult {
  if (!finitePoint(pickPoint)) return { entities: [], intersectionPoints: [], removedInterval: null, reason: "degenerate-geometry" };
  const curves = trimCurvesOfEntity(entity);
  if (curves.length === 0) return { entities: [], intersectionPoints: [], removedInterval: null, reason: "unsupported-target" };
  const boundaryCurves = boundaries.flatMap(trimBoundaryCurvesOfEntity);
  if (boundaryCurves.length === 0) return { entities: [], intersectionPoints: [], removedInterval: null, reason: "no-intersection" };
  const picked = trimClosestPoint(entity, pickPoint);
  if (!picked) return { entities: [], intersectionPoints: [], removedInterval: null, reason: "degenerate-geometry" };
  const extendBoundaries = options.edgeMode === "extend";
  return entity.kind === "polyline"
    ? trimPolyline(entity, curves, picked.segment, picked.parameter, boundaryCurves, extendBoundaries)
    : trimSimple(entity, curves[0]!, picked.parameter, boundaryCurves, extendBoundaries);
}
