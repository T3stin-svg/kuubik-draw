import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import {
  TRIM_EPSILON,
  trimClosestPoint,
  trimCurveIntersections,
  trimCurvesOfEntity,
  trimPointAt,
  type TrimLineCurve,
} from "@kuubik/cad-core";

export interface CadPickHit {
  handle: string;
  point: CadPoint2;
  distance: number;
  segment: number;
  parameter: number;
}

export interface CadPathSelectionHit {
  handle: string;
  pickPoint: CadPoint2;
}

export function pickCadEntity(entity: CadEntity, point: CadPoint2, tolerance: number): CadPickHit | null {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new TypeError("Pick tolerance must be a finite non-negative distance.");
  const closest = trimClosestPoint(entity, point);
  if (!closest || closest.distance > tolerance) return null;
  return { handle: entity.handle, ...closest };
}

function lineCurve(start: CadPoint2, end: CadPoint2, segment: number): TrimLineCurve | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new TypeError("Selection path points must be finite.");
  if (Math.hypot(end.x - start.x, end.y - start.y) <= TRIM_EPSILON) return null;
  return { kind: "line", start, end, segment };
}

function pathCurves(points: readonly CadPoint2[], closed: boolean): TrimLineCurve[] {
  const count = closed ? points.length : points.length - 1;
  const curves: TrimLineCurve[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!start || !end) continue;
    const curve = lineCurve(start, end, index);
    if (curve) curves.push(curve);
  }
  return curves;
}

function pointOnSegment(point: CadPoint2, start: CadPoint2, end: CadPoint2): boolean {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const relative = { x: point.x - start.x, y: point.y - start.y };
  const area = Math.abs(segment.x * relative.y - segment.y * relative.x);
  if (area > TRIM_EPSILON * Math.max(1, Math.hypot(segment.x, segment.y))) return false;
  const projection = relative.x * segment.x + relative.y * segment.y;
  return projection >= -TRIM_EPSILON && projection <= segment.x * segment.x + segment.y * segment.y + TRIM_EPSILON;
}

function pointInPolygon(point: CadPoint2, polygon: readonly CadPoint2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const first = polygon[previous]!;
    const second = polygon[index]!;
    if (pointOnSegment(point, first, second)) return true;
    const crosses = (first.y > point.y) !== (second.y > point.y)
      && point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function firstEntityPathIntersection(entity: CadEntity, path: readonly TrimLineCurve[]): CadPoint2 | null {
  const intersections = trimCurvesOfEntity(entity).flatMap((curve) => path.flatMap((edge) =>
    trimCurveIntersections(curve, edge).map((intersection) => ({
      point: intersection.point,
      pathParameter: edge.segment + intersection.second,
    })),
  ));
  intersections.sort((first, second) => first.pathParameter - second.pathParameter);
  return intersections[0]?.point ?? null;
}

/** Fence selects only entities whose geometry intersects at least one finite fence segment. */
export function selectCadEntitiesByFence(entities: readonly CadEntity[], fence: readonly CadPoint2[]): string[] {
  return selectCadEntityHitsByFence(entities, fence).map((hit) => hit.handle);
}

export function selectCadEntityHitsByFence(entities: readonly CadEntity[], fence: readonly CadPoint2[]): CadPathSelectionHit[] {
  if (fence.length < 2) throw new TypeError("Fence selection requires at least two points.");
  const fenceCurves = pathCurves(fence, false);
  if (fenceCurves.length === 0) throw new TypeError("Fence selection requires at least one non-degenerate segment.");
  return entities.flatMap((entity) => {
    const pickPoint = firstEntityPathIntersection(entity, fenceCurves);
    return pickPoint ? [{ handle: entity.handle, pickPoint }] : [];
  });
}

/**
 * Crossing selects geometry that crosses the polygon boundary or has a connected curve inside it.
 * A curve that surrounds the polygon without entering it is correctly excluded.
 */
export function selectCadEntitiesByCrossingPolygon(entities: readonly CadEntity[], polygon: readonly CadPoint2[]): string[] {
  return selectCadEntityHitsByCrossingPolygon(entities, polygon).map((hit) => hit.handle);
}

export function selectCadEntityHitsByCrossingPolygon(entities: readonly CadEntity[], polygon: readonly CadPoint2[]): CadPathSelectionHit[] {
  if (polygon.length < 2) throw new TypeError("Crossing selection requires two rectangle corners or at least three polygon points.");
  const resolvedPolygon = polygon.length === 2
    ? [polygon[0]!, { x: polygon[1]!.x, y: polygon[0]!.y }, polygon[1]!, { x: polygon[0]!.x, y: polygon[1]!.y }]
    : [...polygon];
  const polygonEdges = pathCurves(resolvedPolygon, true);
  if (polygonEdges.length < 3) throw new TypeError("Crossing selection polygon is degenerate.");
  const center = resolvedPolygon.reduce((sum, point) => ({ x: sum.x + point.x / resolvedPolygon.length, y: sum.y + point.y / resolvedPolygon.length }), { x: 0, y: 0 });
  return entities.flatMap((entity) => {
    const curves = trimCurvesOfEntity(entity);
    if (curves.length === 0) return [];
    const crossingPoint = firstEntityPathIntersection(entity, polygonEdges);
    if (crossingPoint) return [{ handle: entity.handle, pickPoint: crossingPoint }];
    if (!curves.some((curve) => pointInPolygon(trimPointAt(curve, 0), resolvedPolygon))) return [];
    const closest = trimClosestPoint(entity, center);
    return closest ? [{ handle: entity.handle, pickPoint: closest.point }] : [];
  });
}
