import type { CadEntity, CadPoint2, CadPolyline } from "@kuubik/cad-schema";
import {
  TRIM_EPSILON,
  trimClosestPoint,
  trimCurvePiece,
  trimCurvesOfEntity,
  trimPointAt,
  trimPolylinePiece,
  type TrimCurve,
} from "./trim.js";

export type BreakMode = "two-point" | "at-point";
export type BreakGeometryRejectReason =
  | "unsupported-target"
  | "closed-at-point"
  | "degenerate-geometry"
  | "invalid-point"
  | "coincident-points"
  | "no-op";

export interface BreakGeometryResult {
  entities: CadEntity[];
  breakPoints: readonly [CadPoint2, CadPoint2] | null;
  parameters: readonly [number, number] | null;
  removedInterval: { start: number; end: number; wraps: boolean } | null;
  mode: BreakMode;
  reason: BreakGeometryRejectReason | null;
}

const finitePoint = (point: CadPoint2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (first: CadPoint2, second: CadPoint2): number => Math.hypot(second.x - first.x, second.y - first.y);

function rejected(mode: BreakMode, reason: BreakGeometryRejectReason): BreakGeometryResult {
  return { entities: [], breakPoints: null, parameters: null, removedInterval: null, mode, reason };
}

function openPieces(entity: CadEntity, curve: TrimCurve, first: number, second: number, atPoint: boolean): CadEntity[] {
  const lower = Math.min(first, second);
  const upper = Math.max(first, second);
  if (atPoint) {
    return [trimCurvePiece(entity, curve, 0, lower), trimCurvePiece(entity, curve, lower, 1)]
      .filter((piece): piece is CadEntity => piece !== null);
  }
  return [trimCurvePiece(entity, curve, 0, lower), trimCurvePiece(entity, curve, upper, 1)]
    .filter((piece): piece is CadEntity => piece !== null);
}

function openPolylinePieces(entity: CadPolyline, curves: readonly TrimCurve[], first: number, second: number, atPoint: boolean): CadPolyline[] {
  const lower = Math.min(first, second);
  const upper = Math.max(first, second);
  const end = curves.length;
  if (atPoint) {
    return [trimPolylinePiece(entity, curves, 0, lower), trimPolylinePiece(entity, curves, lower, end)]
      .filter((piece): piece is CadPolyline => piece !== null);
  }
  return [trimPolylinePiece(entity, curves, 0, lower), trimPolylinePiece(entity, curves, upper, end)]
    .filter((piece): piece is CadPolyline => piece !== null);
}

/**
 * AutoCAD-style BREAK geometry. Input points are projected onto the selected
 * curve. Open curves remove the undirected interval; closed curves remove the
 * directed first-to-second interval and keep the complementary open path.
 * A zero-gap break is limited to open curves; AutoCAD rejects closed objects
 * such as circles and full ellipses at a single point.
 */
export function breakCadEntity(
  entity: CadEntity,
  firstPoint: CadPoint2,
  secondPoint: CadPoint2 = firstPoint,
  mode: BreakMode = "two-point",
): BreakGeometryResult {
  if (!finitePoint(firstPoint) || !finitePoint(secondPoint)) return rejected(mode, "invalid-point");
  if (!["line", "arc", "circle", "ellipse", "polyline", "spline"].includes(entity.kind)) {
    return rejected(mode, "unsupported-target");
  }
  // AutoCAD 2024 accepts a zero-gap BREAK/BREAKATPOINT on an open ellipse,
  // but leaves an open SPLINE unchanged. Two-point BREAK remains valid for a
  // spline. Keep the capability check ahead of curve subdivision so preview
  // and commit cannot silently create a non-native single-point spline split.
  if (mode === "at-point" && entity.kind === "spline") return rejected(mode, "unsupported-target");
  const curves = trimCurvesOfEntity(entity);
  if (curves.length === 0) return rejected(mode, "degenerate-geometry");
  const firstHit = trimClosestPoint(entity, firstPoint);
  const secondHit = mode === "at-point" ? firstHit : trimClosestPoint(entity, secondPoint);
  if (!firstHit || !secondHit) return rejected(mode, "degenerate-geometry");
  const first = entity.kind === "polyline" ? firstHit.segment + firstHit.parameter : firstHit.parameter;
  const second = entity.kind === "polyline" ? secondHit.segment + secondHit.parameter : secondHit.parameter;
  const projectedFirst = firstHit.point;
  const projectedSecond = secondHit.point;
  const atPoint = mode === "at-point";
  if (!atPoint && Math.abs(first - second) <= TRIM_EPSILON) return rejected(mode, "coincident-points");

  let entities: CadEntity[];
  let removedInterval: BreakGeometryResult["removedInterval"];
  if (entity.kind === "polyline") {
    const period = curves.length;
    if (entity.closed) {
      if (atPoint) return rejected(mode, "closed-at-point");
      const end = second > first ? second : second + period;
      const kept = trimPolylinePiece(entity, curves, end, first + period);
      entities = kept ? [kept] : [];
      removedInterval = { start: first / period, end: (end % period) / period, wraps: second <= first };
    } else {
      if (atPoint && (first <= TRIM_EPSILON || first >= period - TRIM_EPSILON)) return rejected(mode, "no-op");
      entities = openPolylinePieces(entity, curves, first, second, atPoint);
      removedInterval = atPoint ? null : { start: Math.min(first, second) / period, end: Math.max(first, second) / period, wraps: false };
    }
  } else {
    const curve = curves[0]!;
    const closed = entity.kind === "circle" || (entity.kind === "spline" && entity.closed)
      || distance(trimPointAt(curve, 0), trimPointAt(curve, 1)) <= TRIM_EPSILON;
    if (closed) {
      if (atPoint) return rejected(mode, "closed-at-point");
      const end = second > first ? second : second + 1;
      const kept = trimCurvePiece(entity, curve, end, first + 1);
      entities = kept ? [kept] : [];
      removedInterval = { start: first, end: end % 1, wraps: second <= first };
    } else {
      if (atPoint && (first <= TRIM_EPSILON || first >= 1 - TRIM_EPSILON)) return rejected(mode, "no-op");
      entities = openPieces(entity, curve, first, second, atPoint);
      removedInterval = atPoint ? null : { start: Math.min(first, second), end: Math.max(first, second), wraps: false };
    }
  }
  if (entities.length === 0) return rejected(mode, "degenerate-geometry");
  if (entities.length === 1 && JSON.stringify(entities[0]) === JSON.stringify(entity)) return rejected(mode, "no-op");
  return {
    entities,
    breakPoints: [projectedFirst, projectedSecond],
    parameters: [first, second],
    removedInterval,
    mode,
    reason: null,
  };
}
