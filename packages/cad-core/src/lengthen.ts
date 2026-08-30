import type { CadEntity, CadPoint2, CadPolyline, CadSpline } from "@kuubik/cad-schema";
import {
  TRIM_EPSILON,
  splineEndpointExtension,
  trimCurvePiece,
  trimCurvesOfEntity,
  trimPointAt,
  type TrimArcCurve,
  type TrimCurve,
  type TrimEllipseCurve,
  type TrimSplineCurve,
} from "./trim.js";

const FULL_TURN = Math.PI * 2;
const LENGTH_TOLERANCE = 1e-7;

export type LengthenMode = "delta" | "percent" | "total" | "dynamic";
export type LengthenMeasurement = "length" | "angle";

export type LengthenSpecification =
  | { mode: "delta"; value: number; measurement?: LengthenMeasurement }
  | { mode: "percent"; value: number }
  | { mode: "total"; value: number; measurement?: LengthenMeasurement }
  | { mode: "dynamic"; point: CadPoint2 };

export type LengthenGeometryRejectReason =
  | "unsupported-target"
  | "closed-target"
  | "invalid-point"
  | "invalid-value"
  | "degenerate-geometry"
  | "invalid-result"
  | "no-op";

export interface LengthenGeometryResult {
  entity: CadEntity | null;
  endpoint: "start" | "end" | null;
  oldLength: number | null;
  newLength: number | null;
  oldIncludedAngleRad: number | null;
  newIncludedAngleRad: number | null;
  reason: LengthenGeometryRejectReason | null;
}

const finitePoint = (point: CadPoint2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (first: CadPoint2, second: CadPoint2): number => Math.hypot(second.x - first.x, second.y - first.y);
const subtract = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x - second.x, y: first.y - second.y });
const add = (first: CadPoint2, second: CadPoint2): CadPoint2 => ({ x: first.x + second.x, y: first.y + second.y });
const scaled = (point: CadPoint2, factor: number): CadPoint2 => ({ x: point.x * factor, y: point.y * factor });
const dot = (first: CadPoint2, second: CadPoint2): number => first.x * second.x + first.y * second.y;
const clean = (value: number): number => Math.abs(value) <= 1e-12 ? 0 : Number(value.toFixed(12));
const cleanPoint = (point: CadPoint2): CadPoint2 => ({ x: clean(point.x), y: clean(point.y) });

function rejected(reason: LengthenGeometryRejectReason, endpoint: "start" | "end" | null = null, oldLength: number | null = null): LengthenGeometryResult {
  return { entity: null, endpoint, oldLength, newLength: null, oldIncludedAngleRad: null, newIncludedAngleRad: null, reason };
}

function curveSampleCount(curve: TrimCurve): number {
  if (curve.kind === "ellipse") return 2048;
  if (curve.kind === "spline") return Math.max(2048, curve.controlPoints.length * 256);
  return 1;
}

/** Deterministic same-kernel length used by command preview, commit and tests. */
export function lengthenCurveLength(curve: TrimCurve, from = 0, to = 1): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  if (curve.kind === "line") return distance(trimPointAt(curve, from), trimPointAt(curve, to));
  if (curve.kind === "arc") return Math.abs(to - from) * Math.abs(curve.sweep) * curve.radius;
  const samples = curveSampleCount(curve);
  let total = 0;
  let before = trimPointAt(curve, from);
  for (let index = 1; index <= samples; index += 1) {
    const parameter = from + (to - from) * (index / samples);
    const current = trimPointAt(curve, parameter);
    total += distance(before, current);
    before = current;
  }
  return total;
}

export function lengthenEntityLength(entity: CadEntity): number | null {
  const curves = trimCurvesOfEntity(entity);
  if (curves.length === 0) return null;
  const value = curves.reduce((sum, curve) => sum + lengthenCurveLength(curve), 0);
  return Number.isFinite(value) && value > TRIM_EPSILON ? value : null;
}

function endpoints(curves: readonly TrimCurve[]): readonly [CadPoint2, CadPoint2] | null {
  const first = curves[0]; const last = curves.at(-1);
  return first && last ? [trimPointAt(first, 0), trimPointAt(last, 1)] : null;
}

function pickedEndpoint(entity: CadEntity, pickPoint: CadPoint2, curves: readonly TrimCurve[]): "start" | "end" | null {
  const points = endpoints(curves);
  if (!points) return null;
  return distance(pickPoint, points[0]) <= distance(pickPoint, points[1]) ? "start" : "end";
}

function includedArcAngle(entity: CadEntity, curves: readonly TrimCurve[]): number | null {
  return entity.kind === "arc" && curves[0]?.kind === "arc" ? Math.abs(curves[0].sweep) : null;
}

function targetLength(
  entity: CadEntity,
  curves: readonly TrimCurve[],
  endpoint: "start" | "end",
  currentLength: number,
  specification: LengthenSpecification,
): { length: number; angleRad: number | null } | null {
  const currentAngle = includedArcAngle(entity, curves);
  if (specification.mode === "dynamic") {
    if (!finitePoint(specification.point)) return null;
    const start = trimPointAt(curves[0]!, 0); const end = trimPointAt(curves.at(-1)!, 1);
    if (entity.kind === "line") {
      const fixed = endpoint === "start" ? end : start;
      const moving = endpoint === "start" ? start : end;
      const direction = subtract(moving, fixed); const magnitude = Math.hypot(direction.x, direction.y);
      if (!(magnitude > TRIM_EPSILON)) return null;
      return { length: dot(subtract(specification.point, fixed), scaled(direction, 1 / magnitude)), angleRad: null };
    }
    if (entity.kind === "polyline") {
      const terminal = endpoint === "start" ? curves[0]! : curves.at(-1)!;
      const fixedLength = currentLength - lengthenCurveLength(terminal);
      if (terminal.kind === "line") {
        const fixed = endpoint === "start" ? terminal.end : terminal.start;
        const moving = endpoint === "start" ? terminal.start : terminal.end;
        const direction = subtract(moving, fixed); const magnitude = Math.hypot(direction.x, direction.y);
        if (!(magnitude > TRIM_EPSILON)) return null;
        return { length: fixedLength + dot(subtract(specification.point, fixed), scaled(direction, 1 / magnitude)), angleRad: null };
      }
      if (terminal.kind === "arc") {
        const target = arcDynamicLength(terminal, endpoint, specification.point);
        return target === null ? null : { length: fixedLength + target, angleRad: null };
      }
      return null;
    }
    if (entity.kind === "arc" && curves[0]?.kind === "arc") {
      const angle = arcDynamicAngle(curves[0], endpoint, specification.point);
      return angle === null ? null : { length: angle * curves[0].radius, angleRad: angle };
    }
    if (entity.kind === "ellipse" && curves[0]?.kind === "ellipse") {
      const length = ellipseDynamicLength(curves[0], endpoint, specification.point);
      return length === null ? null : { length, angleRad: null };
    }
    if (entity.kind === "spline" && curves[0]?.kind === "spline") {
      const moving = endpoint === "start" ? trimPointAt(curves[0], 0) : trimPointAt(curves[0], 1);
      const neighbor = endpoint === "start" ? trimPointAt(curves[0], 1 / 4096) : trimPointAt(curves[0], 1 - 1 / 4096);
      const tangent = subtract(moving, neighbor);
      const magnitude = Math.hypot(tangent.x, tangent.y);
      if (!(magnitude > TRIM_EPSILON)) return null;
      const extension = dot(subtract(specification.point, moving), scaled(tangent, 1 / magnitude));
      return { length: Math.max(0, currentLength + extension), angleRad: null };
    }
    return null;
  }

  const measurement = specification.mode === "percent" ? "length" : (specification.measurement ?? "length");
  if (!Number.isFinite(specification.value)) return null;
  if (measurement === "angle") {
    if (entity.kind !== "arc" || currentAngle === null || specification.mode === "percent") return null;
    const radians = specification.value * Math.PI / 180;
    const angleRad = specification.mode === "delta" ? currentAngle + radians : radians;
    return { length: angleRad * entity.radius, angleRad };
  }
  const length = specification.mode === "delta"
    ? currentLength + specification.value
    : specification.mode === "percent"
      ? currentLength * specification.value / 100
      : specification.value;
  return { length, angleRad: entity.kind === "arc" ? length / entity.radius : null };
}

function normalizedPositiveAngle(value: number): number {
  const normalized = ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return normalized <= LENGTH_TOLERANCE ? FULL_TURN : normalized;
}

function arcDynamicAngle(curve: TrimArcCurve, endpoint: "start" | "end", point: CadPoint2): number | null {
  const angle = Math.atan2(point.y - curve.center.y, point.x - curve.center.x);
  const direction = Math.sign(curve.sweep) || 1;
  const fixed = endpoint === "start" ? curve.startAngle + curve.sweep : curve.startAngle;
  const value = endpoint === "start"
    ? direction > 0 ? normalizedPositiveAngle(fixed - angle) : normalizedPositiveAngle(angle - fixed)
    : direction > 0 ? normalizedPositiveAngle(angle - fixed) : normalizedPositiveAngle(fixed - angle);
  return value < FULL_TURN - LENGTH_TOLERANCE ? value : null;
}

function arcDynamicLength(curve: TrimArcCurve, endpoint: "start" | "end", point: CadPoint2): number | null {
  const angle = arcDynamicAngle(curve, endpoint, point);
  return angle === null ? null : angle * curve.radius;
}

function ellipsePointParameter(curve: TrimEllipseCurve, point: CadPoint2): number {
  const relative = subtract(point, curve.center);
  const major2 = dot(curve.major, curve.major); const minor2 = dot(curve.minor, curve.minor);
  return Math.atan2(dot(relative, curve.minor) / minor2, dot(relative, curve.major) / major2);
}

function ellipseActualLength(curve: TrimEllipseCurve, fromAngle: number, toAngle: number): number {
  const normalized: TrimEllipseCurve = { ...curve, startParameter: fromAngle, sweep: toAngle - fromAngle };
  return lengthenCurveLength(normalized);
}

function ellipseDynamicLength(curve: TrimEllipseCurve, endpoint: "start" | "end", point: CadPoint2): number | null {
  const moving = ellipsePointParameter(curve, point);
  const fixed = endpoint === "start" ? curve.startParameter + curve.sweep : curve.startParameter;
  const sweep = endpoint === "start" ? normalizedPositiveAngle(fixed - moving) : normalizedPositiveAngle(moving - fixed);
  return sweep < FULL_TURN - LENGTH_TOLERANCE
    ? endpoint === "start"
      ? ellipseActualLength(curve, fixed - sweep, fixed)
      : ellipseActualLength(curve, fixed, fixed + sweep)
    : null;
}

function solveEllipseSweep(curve: TrimEllipseCurve, fixedAngle: number, target: number, backwards: boolean): number | null {
  const full = ellipseActualLength(curve, fixedAngle, fixedAngle + FULL_TURN);
  if (!(target > TRIM_EPSILON) || target >= full - LENGTH_TOLERANCE) return null;
  let lower = 0; let upper = FULL_TURN;
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const middle = (lower + upper) / 2;
    const value = backwards
      ? ellipseActualLength(curve, fixedAngle - middle, fixedAngle)
      : ellipseActualLength(curve, fixedAngle, fixedAngle + middle);
    if (value < target) lower = middle; else upper = middle;
  }
  return (lower + upper) / 2;
}

function replaceSimpleCurve(entity: CadEntity, curve: TrimCurve, endpoint: "start" | "end", target: number): CadEntity | null {
  if (entity.kind === "line" && curve.kind === "line") {
    const fixed = endpoint === "start" ? curve.end : curve.start;
    const moving = endpoint === "start" ? curve.start : curve.end;
    const direction = subtract(moving, fixed); const magnitude = Math.hypot(direction.x, direction.y);
    if (!(magnitude > TRIM_EPSILON)) return null;
    const point = cleanPoint(add(fixed, scaled(direction, target / magnitude)));
    return { ...structuredClone(entity), ...(endpoint === "start" ? { start: point } : { end: point }) };
  }
  if (entity.kind === "arc" && curve.kind === "arc") {
    const sweep = Math.sign(curve.sweep) * target / curve.radius;
    if (!(Math.abs(sweep) > TRIM_EPSILON) || Math.abs(sweep) >= FULL_TURN - LENGTH_TOLERANCE) return null;
    const fixed = endpoint === "start" ? curve.startAngle + curve.sweep : curve.startAngle;
    const moving = endpoint === "start" ? fixed - sweep : fixed + sweep;
    return {
      ...structuredClone(entity),
      ...(endpoint === "start" ? { startAngleRad: clean(moving) } : { endAngleRad: clean(moving) }),
    };
  }
  if (entity.kind === "ellipse" && curve.kind === "ellipse") {
    const fixed = endpoint === "start" ? curve.startParameter + curve.sweep : curve.startParameter;
    const sweep = solveEllipseSweep(curve, fixed, target, endpoint === "start");
    if (sweep === null) return null;
    return {
      ...structuredClone(entity),
      ...(endpoint === "start" ? { startParameter: clean(fixed - sweep) } : { endParameter: clean(fixed + sweep) }),
    };
  }
  return null;
}

function replacePolylineTerminal(entity: CadPolyline, curves: readonly TrimCurve[], endpoint: "start" | "end", targetTotal: number): CadPolyline | null {
  const terminal = endpoint === "start" ? curves[0] : curves.at(-1);
  if (!terminal || (terminal.kind !== "line" && terminal.kind !== "arc")) return null;
  const terminalLength = lengthenCurveLength(terminal);
  const fixedLength = curves.reduce((sum, curve) => sum + lengthenCurveLength(curve), 0) - terminalLength;
  const terminalTarget = targetTotal - fixedLength;
  if (!(terminalLength > TRIM_EPSILON) || !(terminalTarget > TRIM_EPSILON)) return null;
  const vertices = structuredClone(entity.vertices);
  const widthVertex = endpoint === "start" ? vertices[0] : vertices.at(-2);
  if (!widthVertex) return null;
  if (widthVertex.startWidth !== undefined || widthVertex.endWidth !== undefined) {
    const startWidth = widthVertex.startWidth ?? 0;
    const endWidth = widthVertex.endWidth ?? startWidth;
    const ratio = terminalTarget / terminalLength;
    if (endpoint === "start") widthVertex.startWidth = clean(endWidth + (startWidth - endWidth) * ratio);
    else widthVertex.endWidth = clean(startWidth + (endWidth - startWidth) * ratio);
  }
  if (terminal.kind === "line") {
    const fixed = endpoint === "start" ? terminal.end : terminal.start;
    const moving = endpoint === "start" ? terminal.start : terminal.end;
    const direction = subtract(moving, fixed); const magnitude = Math.hypot(direction.x, direction.y);
    if (!(magnitude > TRIM_EPSILON)) return null;
    const next = cleanPoint(add(fixed, scaled(direction, terminalTarget / magnitude)));
    const vertex = endpoint === "start" ? vertices[0] : vertices.at(-1);
    if (!vertex) return null;
    vertex.x = next.x; vertex.y = next.y;
  } else {
    const sweep = Math.sign(terminal.sweep) * terminalTarget / terminal.radius;
    if (!(Math.abs(sweep) > TRIM_EPSILON) || Math.abs(sweep) >= FULL_TURN - LENGTH_TOLERANCE) return null;
    if (endpoint === "start") {
      const first = vertices[0]; if (!first) return null;
      const fixedAngle = terminal.startAngle + terminal.sweep;
      const angle = fixedAngle - sweep;
      first.x = clean(terminal.center.x + terminal.radius * Math.cos(angle));
      first.y = clean(terminal.center.y + terminal.radius * Math.sin(angle));
      const bulge = clean(Math.tan(sweep / 4));
      if (Math.abs(bulge) > 1e-12) first.bulge = bulge; else delete first.bulge;
    } else {
      const before = vertices.at(-2); const last = vertices.at(-1); if (!before || !last) return null;
      const angle = terminal.startAngle + sweep;
      last.x = clean(terminal.center.x + terminal.radius * Math.cos(angle));
      last.y = clean(terminal.center.y + terminal.radius * Math.sin(angle));
      const bulge = clean(Math.tan(sweep / 4));
      if (Math.abs(bulge) > 1e-12) before.bulge = bulge; else delete before.bulge;
    }
  }
  return { ...structuredClone(entity), vertices };
}

function solveSplineParameter(curve: TrimSplineCurve, target: number, endpoint: "start" | "end"): number | null {
  const full = lengthenCurveLength(curve);
  if (!(target > TRIM_EPSILON) || target >= full - LENGTH_TOLERANCE) return null;
  let lower = 0; let upper = 1;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2;
    const value = endpoint === "start" ? lengthenCurveLength(curve, middle, 1) : lengthenCurveLength(curve, 0, middle);
    if (endpoint === "start" ? value > target : value < target) lower = middle; else upper = middle;
  }
  return (lower + upper) / 2;
}

function replaceSpline(entity: CadSpline, curve: TrimSplineCurve, endpoint: "start" | "end", current: number, target: number): CadSpline | null {
  if (target < current - LENGTH_TOLERANCE) {
    const parameter = solveSplineParameter(curve, target, endpoint);
    if (parameter === null) return null;
    const piece = endpoint === "start"
      ? trimCurvePiece(entity, curve, parameter, 1)
      : trimCurvePiece(entity, curve, 0, parameter);
    return piece?.kind === "spline" ? piece : null;
  }
  if (entity.degree !== 3) return null;
  const wanted = target - current;
  let lower = 0; let upper = Math.max(1, wanted);
  const addedLength = (span: number): { entity: CadSpline | null; value: number } => {
    const extended = splineEndpointExtension(entity, endpoint, span);
    const value = extended ? lengthenEntityLength(extended) : null;
    return { entity: extended, value: value === null ? Number.NaN : value - current };
  };
  let upperResult = addedLength(upper);
  for (let iteration = 0; iteration < 24 && (!(upperResult.value >= wanted) || !Number.isFinite(upperResult.value)); iteration += 1) {
    upper *= 2;
    upperResult = addedLength(upper);
  }
  if (!(upperResult.value >= wanted)) return null;
  let best = upperResult.entity;
  for (let iteration = 0; iteration < 44; iteration += 1) {
    const middle = (lower + upper) / 2;
    const result = addedLength(middle);
    if (!result.entity || !Number.isFinite(result.value)) return null;
    best = result.entity;
    if (result.value < wanted) lower = middle; else upper = middle;
  }
  return best;
}

/**
 * Pure AutoCAD-style LENGTHEN predicate. The picked endpoint moves while the
 * opposite endpoint remains fixed. Closed objects fail closed.
 */
export function lengthenCadEntity(entity: CadEntity, pickPoint: CadPoint2, specification: LengthenSpecification): LengthenGeometryResult {
  if (!finitePoint(pickPoint)) return rejected("invalid-point");
  if (!["line", "arc", "ellipse", "polyline", "spline"].includes(entity.kind)) return rejected("unsupported-target");
  // AutoCAD 2024.1.2 rejected the audited rational control-point SPLINE for
  // both numeric and Dynamic LENGTHEN. Fit-point SPLINE support requires a
  // distinct schema representation; fail closed until F-012 owns that data.
  if (entity.kind === "spline") return rejected("unsupported-target");
  if (entity.kind === "polyline" && entity.closed) return rejected("closed-target");
  const curves = trimCurvesOfEntity(entity);
  if (curves.length === 0) return rejected("degenerate-geometry");
  if (entity.kind === "ellipse" && curves[0]?.kind === "ellipse" && curves[0].sweep >= FULL_TURN - LENGTH_TOLERANCE) {
    return rejected("closed-target");
  }
  const endpoint = pickedEndpoint(entity, pickPoint, curves);
  const oldLength = lengthenEntityLength(entity);
  if (!endpoint || oldLength === null) return rejected("degenerate-geometry", endpoint, oldLength);
  const target = targetLength(entity, curves, endpoint, oldLength, specification);
  if (!target || !Number.isFinite(target.length) || !(target.length > TRIM_EPSILON)) return rejected("invalid-value", endpoint, oldLength);
  if (Math.abs(target.length - oldLength) <= LENGTH_TOLERANCE) return rejected("no-op", endpoint, oldLength);

  let output: CadEntity | null = null;
  if (entity.kind === "polyline") output = replacePolylineTerminal(entity, curves, endpoint, target.length);
  else output = replaceSimpleCurve(entity, curves[0]!, endpoint, target.length);
  if (!output) return rejected("invalid-result", endpoint, oldLength);
  const newLength = lengthenEntityLength(output);
  if (newLength === null || Math.abs(newLength - target.length) > Math.max(1e-5, target.length * 2e-6)) {
    return rejected("invalid-result", endpoint, oldLength);
  }
  const oldIncludedAngleRad = includedArcAngle(entity, curves);
  const newCurves = trimCurvesOfEntity(output);
  return {
    entity: output,
    endpoint,
    oldLength,
    newLength,
    oldIncludedAngleRad,
    newIncludedAngleRad: includedArcAngle(output, newCurves),
    reason: null,
  };
}
