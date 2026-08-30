import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import {
  TRIM_EPSILON,
  trimCurveIntersections,
  trimCurvesOfEntity,
  trimPointAt,
  type TrimLineCurve,
} from "./trim.js";

export interface StretchRegion {
  kind: "crossing-window" | "crossing-polygon";
  points: readonly CadPoint2[];
}

export type StretchGeometryRejectReason =
  | "not-selected"
  | "unsupported-target"
  | "degenerate-geometry"
  | "no-op";

export interface StretchGeometryResult {
  entity: CadEntity | null;
  mode: "move" | "stretch" | null;
  movedPointCount: number;
  selected: boolean;
  reason: StretchGeometryRejectReason | null;
}

const finitePoint = (point: CadPoint2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const movedPoint = (point: CadPoint2, delta: CadPoint2): CadPoint2 => ({ x: point.x + delta.x, y: point.y + delta.y });
const samePoint = (first: CadPoint2, second: CadPoint2): boolean => Math.hypot(second.x - first.x, second.y - first.y) <= TRIM_EPSILON;
const normalizedAngle = (value: number): number => {
  const fullTurn = Math.PI * 2;
  const result = value % fullTurn;
  return result < 0 ? result + fullTurn : result;
};

function resolvedPolygon(region: StretchRegion): CadPoint2[] {
  if (!region.points.every(finitePoint)) throw new TypeError("STRETCH selection points must be finite.");
  if (region.kind === "crossing-window") {
    if (region.points.length !== 2 || samePoint(region.points[0]!, region.points[1]!)) {
      throw new TypeError("STRETCH crossing-window requires two distinct corners.");
    }
    const first = region.points[0]!;
    const second = region.points[1]!;
    return [first, { x: second.x, y: first.y }, second, { x: first.x, y: second.y }];
  }
  if (region.points.length < 3) throw new TypeError("STRETCH crossing-polygon requires at least three points.");
  const polygon = [...region.points];
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  if (Math.abs(area) <= TRIM_EPSILON) throw new TypeError("STRETCH crossing-polygon is degenerate.");
  return polygon;
}

export function validateStretchRegions(regions: readonly StretchRegion[]): void {
  regions.forEach(resolvedPolygon);
}

function pointOnSegment(point: CadPoint2, start: CadPoint2, end: CadPoint2): boolean {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const relative = { x: point.x - start.x, y: point.y - start.y };
  const segmentLength = Math.hypot(segment.x, segment.y);
  if (segmentLength <= TRIM_EPSILON) return samePoint(point, start);
  const area = Math.abs(segment.x * relative.y - segment.y * relative.x);
  if (area > TRIM_EPSILON * segmentLength) return false;
  const projection = relative.x * segment.x + relative.y * segment.y;
  const projectionTolerance = TRIM_EPSILON * segmentLength;
  return projection >= -projectionTolerance && projection <= segmentLength * segmentLength + projectionTolerance;
}

export function stretchPointInPolygon(point: CadPoint2, polygon: readonly CadPoint2[]): boolean {
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

function polygonEdges(polygon: readonly CadPoint2[]): TrimLineCurve[] {
  return polygon.map((start, index) => ({
    kind: "line" as const,
    start,
    end: polygon[(index + 1) % polygon.length]!,
    segment: index,
  }));
}

function curveGeometryFullyInside(entity: CadEntity, polygon: readonly CadPoint2[]): boolean {
  const curves = trimCurvesOfEntity(entity);
  if (curves.length === 0) return false;
  const edges = polygonEdges(polygon);
  if (curves.some((curve) => edges.some((edge) => trimCurveIntersections(curve, edge).length > 0))) return false;
  return curves.every((curve) => stretchPointInPolygon(trimPointAt(curve, 0), polygon));
}

function translateEntity(entity: CadEntity, delta: CadPoint2): CadEntity | null {
  switch (entity.kind) {
    case "line": return { ...entity, start: movedPoint(entity.start, delta), end: movedPoint(entity.end, delta) };
    case "ray":
    case "xline": return { ...entity, basePoint: movedPoint(entity.basePoint, delta) };
    case "polyline": return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...movedPoint(vertex, delta) })) };
    case "circle":
    case "arc":
    case "ellipse": return { ...entity, center: movedPoint(entity.center, delta) };
    case "spline": return { ...entity, controlPoints: entity.controlPoints.map((point) => movedPoint(point, delta)) };
    case "text":
    case "mtext": return { ...entity, position: movedPoint(entity.position, delta) };
    case "leader": return { ...entity, vertices: entity.vertices.map((point) => movedPoint(point, delta)) };
    case "dimension": return { ...entity, definitionPoints: entity.definitionPoints.map((point) => movedPoint(point, delta)) };
    case "hatch": return { ...entity, loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => movedPoint(point, delta)) })) };
    case "blockRef": return { ...entity, insertion: movedPoint(entity.insertion, delta) };
    case "proxy": return null;
  }
}

function arcEndpoint(entity: Extract<CadEntity, { kind: "arc" }>, start: boolean): CadPoint2 {
  const angle = start ? entity.startAngleRad : entity.endAngleRad;
  return { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) };
}

function midpoint(first: CadPoint2, second: CadPoint2): CadPoint2 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function cross(first: CadPoint2, second: CadPoint2): number {
  return first.x * second.y - first.y * second.x;
}

function transportedChordPoint(
  originalStart: CadPoint2,
  originalPoint: CadPoint2,
  originalEnd: CadPoint2,
  newStart: CadPoint2,
  newEnd: CadPoint2,
): CadPoint2 | null {
  const originalChord = { x: originalEnd.x - originalStart.x, y: originalEnd.y - originalStart.y };
  const originalChordLength = Math.hypot(originalChord.x, originalChord.y);
  const newChord = { x: newEnd.x - newStart.x, y: newEnd.y - newStart.y };
  const newChordLength = Math.hypot(newChord.x, newChord.y);
  if (originalChordLength <= TRIM_EPSILON || newChordLength <= TRIM_EPSILON) return null;
  const originalUnit = { x: originalChord.x / originalChordLength, y: originalChord.y / originalChordLength };
  const originalNormal = { x: -originalUnit.y, y: originalUnit.x };
  const offset = { x: originalPoint.x - originalStart.x, y: originalPoint.y - originalStart.y };
  const chordFraction = (offset.x * originalUnit.x + offset.y * originalUnit.y) / originalChordLength;
  const normalDistance = offset.x * originalNormal.x + offset.y * originalNormal.y;
  const newUnit = { x: newChord.x / newChordLength, y: newChord.y / newChordLength };
  const newNormal = { x: -newUnit.y, y: newUnit.x };
  return {
    x: newStart.x + newUnit.x * chordFraction * newChordLength + newNormal.x * normalDistance,
    y: newStart.y + newUnit.y * chordFraction * newChordLength + newNormal.y * normalDistance,
  };
}

function circleThrough(first: CadPoint2, middle: CadPoint2, last: CadPoint2): { center: CadPoint2; radius: number } | null {
  const determinant = 2 * (first.x * (middle.y - last.y) + middle.x * (last.y - first.y) + last.x * (first.y - middle.y));
  if (Math.abs(determinant) <= TRIM_EPSILON) return null;
  const firstSquared = first.x * first.x + first.y * first.y;
  const middleSquared = middle.x * middle.x + middle.y * middle.y;
  const lastSquared = last.x * last.x + last.y * last.y;
  const center = {
    x: (firstSquared * (middle.y - last.y) + middleSquared * (last.y - first.y) + lastSquared * (first.y - middle.y)) / determinant,
    y: (firstSquared * (last.x - middle.x) + middleSquared * (first.x - last.x) + lastSquared * (middle.x - first.x)) / determinant,
  };
  const radius = Math.hypot(first.x - center.x, first.y - center.y);
  return Number.isFinite(radius) && radius > TRIM_EPSILON ? { center, radius } : null;
}

function stretchedArc(
  entity: Extract<CadEntity, { kind: "arc" }>,
  inside: (point: CadPoint2) => boolean,
  delta: CadPoint2,
): { entity: CadEntity; count: number } | null {
  const curves = trimCurvesOfEntity(entity);
  const curve = curves[0];
  if (!curve) return null;
  const originalStart = arcEndpoint(entity, true);
  const originalEnd = arcEndpoint(entity, false);
  const moveStart = inside(originalStart);
  const moveEnd = inside(originalEnd);
  if (!moveStart && !moveEnd) return null;
  const start = moveStart ? movedPoint(originalStart, delta) : originalStart;
  const end = moveEnd ? movedPoint(originalEnd, delta) : originalEnd;
  // AutoCAD 2024 transports the original arc sagitta to the new chord instead
  // of keeping the old midpoint fixed. This is observable in AcDbArc's two
  // stretch points and its resulting DXF center/radius after STRETCH.
  const middle = transportedChordPoint(originalStart, trimPointAt(curve, 0.5), originalEnd, start, end);
  if (!middle) return null;
  const circle = circleThrough(start, middle, end);
  if (!circle) return null;
  const startAngle = Math.atan2(start.y - circle.center.y, start.x - circle.center.x);
  const middleAngle = Math.atan2(middle.y - circle.center.y, middle.x - circle.center.x);
  const endAngle = Math.atan2(end.y - circle.center.y, end.x - circle.center.x);
  const ccwSweep = normalizedAngle(endAngle - startAngle);
  const ccwToMiddle = normalizedAngle(middleAngle - startAngle);
  const counterClockwise = ccwToMiddle <= ccwSweep + TRIM_EPSILON;
  return {
    entity: { ...entity, center: circle.center, radius: circle.radius, startAngleRad: startAngle, endAngleRad: endAngle, counterClockwise },
    count: Number(moveStart) + Number(moveEnd),
  };
}

function solveEllipseBasis(
  start: CadPoint2,
  middle: CadPoint2,
  end: CadPoint2,
  startParameter: number,
  sweep: number,
): { center: CadPoint2; first: CadPoint2; second: CadPoint2 } | null {
  const middleParameter = startParameter + sweep / 2;
  const endParameter = startParameter + sweep;
  const firstCosine = Math.cos(middleParameter) - Math.cos(startParameter);
  const firstSine = Math.sin(middleParameter) - Math.sin(startParameter);
  const secondCosine = Math.cos(endParameter) - Math.cos(startParameter);
  const secondSine = Math.sin(endParameter) - Math.sin(startParameter);
  const determinant = firstCosine * secondSine - firstSine * secondCosine;
  if (Math.abs(determinant) <= 1e-12) return null;
  const middleOffset = { x: middle.x - start.x, y: middle.y - start.y };
  const endOffset = { x: end.x - start.x, y: end.y - start.y };
  const first = {
    x: (middleOffset.x * secondSine - endOffset.x * firstSine) / determinant,
    y: (middleOffset.y * secondSine - endOffset.y * firstSine) / determinant,
  };
  const second = {
    x: (firstCosine * endOffset.x - secondCosine * middleOffset.x) / determinant,
    y: (firstCosine * endOffset.y - secondCosine * middleOffset.y) / determinant,
  };
  const center = {
    x: start.x - first.x * Math.cos(startParameter) - second.x * Math.sin(startParameter),
    y: start.y - first.y * Math.cos(startParameter) - second.y * Math.sin(startParameter),
  };
  return [center, first, second].every(finitePoint) ? { center, first, second } : null;
}

function canonicalEllipse(
  basis: { center: CadPoint2; first: CadPoint2; second: CadPoint2 },
  startParameter: number,
  sweep: number,
): { center: CadPoint2; majorAxis: CadPoint2; ratio: number; startParameter: number; endParameter: number } | null {
  const firstLengthSquared = basis.first.x * basis.first.x + basis.first.y * basis.first.y;
  const secondLengthSquared = basis.second.x * basis.second.x + basis.second.y * basis.second.y;
  const basisDot = basis.first.x * basis.second.x + basis.first.y * basis.second.y;
  let phase = 0.5 * Math.atan2(2 * basisDot, firstLengthSquared - secondLengthSquared);
  const cosine = Math.cos(phase);
  const sine = Math.sin(phase);
  let majorAxis = {
    x: basis.first.x * cosine + basis.second.x * sine,
    y: basis.first.y * cosine + basis.second.y * sine,
  };
  let minorAxis = {
    x: -basis.first.x * sine + basis.second.x * cosine,
    y: -basis.first.y * sine + basis.second.y * cosine,
  };
  let majorLength = Math.hypot(majorAxis.x, majorAxis.y);
  let minorLength = Math.hypot(minorAxis.x, minorAxis.y);
  if (minorLength > majorLength) {
    const previousMajor = majorAxis;
    majorAxis = minorAxis;
    minorAxis = { x: -previousMajor.x, y: -previousMajor.y };
    [majorLength, minorLength] = [minorLength, majorLength];
    phase += Math.PI / 2;
  }
  const normalizedOrientation = cross(majorAxis, minorAxis) / (majorLength * minorLength);
  if (
    majorLength <= TRIM_EPSILON
    || minorLength <= TRIM_EPSILON
    || !Number.isFinite(normalizedOrientation)
    || normalizedOrientation <= 1e-12
  ) return null;
  const canonicalStart = normalizedAngle(startParameter - phase);
  return {
    center: basis.center,
    majorAxis,
    ratio: minorLength / majorLength,
    startParameter: canonicalStart,
    endParameter: canonicalStart + sweep,
  };
}

function stretchedEllipseArc(
  entity: Extract<CadEntity, { kind: "ellipse" }>,
  inside: (point: CadPoint2) => boolean,
  delta: CadPoint2,
): { entity: CadEntity; count: number } | null {
  const curve = trimCurvesOfEntity(entity)[0];
  if (!curve || curve.kind !== "ellipse" || curve.sweep >= Math.PI * 2 - 1e-8) return null;
  const originalStart = trimPointAt(curve, 0);
  const originalEnd = trimPointAt(curve, 1);
  const moveStart = inside(originalStart);
  const moveEnd = inside(originalEnd);
  if (!moveStart && !moveEnd) return null;
  const start = moveStart ? movedPoint(originalStart, delta) : originalStart;
  const end = moveEnd ? movedPoint(originalEnd, delta) : originalEnd;
  const arcMiddle = transportedChordPoint(originalStart, trimPointAt(curve, 0.5), originalEnd, start, end);
  if (!arcMiddle) return null;
  if (Math.abs(curve.sweep - Math.PI) > 1e-8) {
    const basis = solveEllipseBasis(start, arcMiddle, end, curve.startParameter, curve.sweep);
    const canonical = basis ? canonicalEllipse(basis, curve.startParameter, curve.sweep) : null;
    return canonical ? { entity: { ...entity, ...canonical }, count: Number(moveStart) + Number(moveEnd) } : null;
  }
  // AutoCAD emits the opposite major-axis direction for an exact half ellipse.
  // Keep this representation special case because DXF read-back compares the
  // canonical fields, not only the coincident geometric locus.
  const center = midpoint(start, end);
  const halfChord = { x: end.x - center.x, y: end.y - center.y };
  const sagitta = { x: arcMiddle.x - center.x, y: arcMiddle.y - center.y };
  const chordRadius = Math.hypot(halfChord.x, halfChord.y);
  const sagittaRadius = Math.hypot(sagitta.x, sagitta.y);
  if (chordRadius <= TRIM_EPSILON || sagittaRadius <= TRIM_EPSILON) return null;
  if (chordRadius >= sagittaRadius) {
    return {
      entity: {
        ...entity,
        center,
        majorAxis: halfChord,
        ratio: sagittaRadius / chordRadius,
        startParameter: Math.PI,
        endParameter: Math.PI * 2,
      },
      count: Number(moveStart) + Number(moveEnd),
    };
  }
  return {
    entity: {
      ...entity,
      center,
      majorAxis: sagitta,
      ratio: chordRadius / sagittaRadius,
      startParameter: Math.PI * 1.5,
      endParameter: Math.PI * 2.5,
    },
    count: Number(moveStart) + Number(moveEnd),
  };
}

function pointsSelected(points: readonly CadPoint2[], inside: (point: CadPoint2) => boolean): boolean {
  return points.some(inside);
}

/**
 * Clean-room 2D STRETCH predicate based on Autodesk's crossing contract. A whole
 * object moves when individually selected or completely enclosed. Otherwise
 * only endpoints, vertices, control points, centers, or insertion points inside
 * the union of crossing selections move; polyline widths/bulges and spline data
 * are preserved byte-for-byte.
 */
export function stretchCadEntity(
  entity: CadEntity,
  regions: readonly StretchRegion[],
  delta: CadPoint2,
  individuallySelected = false,
): StretchGeometryResult {
  if (!finitePoint(delta)) throw new TypeError("STRETCH displacement must be finite.");
  if (regions.length === 0 && !individuallySelected) throw new TypeError("STRETCH requires a crossing selection or an individual selection.");
  const polygons = regions.map(resolvedPolygon);
  const inside = (point: CadPoint2): boolean => polygons.some((polygon) => stretchPointInPolygon(point, polygon));
  const fullyInside = individuallySelected || polygons.some((polygon) => curveGeometryFullyInside(entity, polygon));
  const zeroDelta = delta.x === 0 && delta.y === 0;
  const noOp = (): StretchGeometryResult => ({ entity: null, mode: null, movedPointCount: 0, selected: true, reason: "no-op" });
  if (fullyInside && zeroDelta) return noOp();
  if (fullyInside) {
    const moved = translateEntity(entity, delta);
    return moved
      ? { entity: moved, mode: "move", movedPointCount: 1, selected: true, reason: null }
      : { entity: null, mode: null, movedPointCount: 0, selected: true, reason: "unsupported-target" };
  }

  if (entity.kind === "line") {
    const selected = inside(entity.start) || inside(entity.end);
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return {
      entity: { ...entity, start: inside(entity.start) ? movedPoint(entity.start, delta) : entity.start, end: inside(entity.end) ? movedPoint(entity.end, delta) : entity.end },
      mode: "stretch", movedPointCount: Number(inside(entity.start)) + Number(inside(entity.end)), selected: true, reason: null,
    };
  }
  if (entity.kind === "polyline") {
    const selected = pointsSelected(entity.vertices, inside);
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return {
      entity: { ...entity, vertices: entity.vertices.map((vertex) => inside(vertex) ? ({ ...vertex, ...movedPoint(vertex, delta) }) : vertex) },
      mode: "stretch", movedPointCount: entity.vertices.filter(inside).length, selected: true, reason: null,
    };
  }
  if (entity.kind === "arc") {
    if (zeroDelta && (inside(entity.center) || inside(arcEndpoint(entity, true)) || inside(arcEndpoint(entity, false)))) return noOp();
    if (inside(entity.center)) {
      return { entity: translateEntity(entity, delta), mode: "move", movedPointCount: 1, selected: true, reason: null };
    }
    const result = stretchedArc(entity, inside, delta);
    return result
      ? { entity: result.entity, mode: "stretch", movedPointCount: result.count, selected: true, reason: null }
      : { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
  }
  if (entity.kind === "ellipse") {
    const curve = trimCurvesOfEntity(entity)[0];
    const start = curve?.kind === "ellipse" ? trimPointAt(curve, 0) : null;
    const end = curve?.kind === "ellipse" ? trimPointAt(curve, 1) : null;
    const selected = inside(entity.center) || Boolean(start && inside(start)) || Boolean(end && inside(end));
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    if (inside(entity.center)) {
      return { entity: translateEntity(entity, delta), mode: "move", movedPointCount: 1, selected: true, reason: null };
    }
    const result = stretchedEllipseArc(entity, inside, delta);
    return result
      ? { entity: result.entity, mode: "stretch", movedPointCount: result.count, selected: true, reason: null }
      : { entity: null, mode: null, movedPointCount: 0, selected: true, reason: "unsupported-target" };
  }
  if (entity.kind === "spline") {
    const selected = pointsSelected(entity.controlPoints, inside);
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return {
      entity: { ...entity, controlPoints: entity.controlPoints.map((point) => inside(point) ? movedPoint(point, delta) : point) },
      mode: "stretch", movedPointCount: entity.controlPoints.filter(inside).length, selected: true, reason: null,
    };
  }
  if (entity.kind === "leader") {
    const selected = pointsSelected(entity.vertices, inside);
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return { entity: { ...entity, vertices: entity.vertices.map((point) => inside(point) ? movedPoint(point, delta) : point) }, mode: "stretch", movedPointCount: entity.vertices.filter(inside).length, selected: true, reason: null };
  }
  if (entity.kind === "dimension") {
    const selected = pointsSelected(entity.definitionPoints, inside);
    if (!selected) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return { entity: { ...entity, definitionPoints: entity.definitionPoints.map((point) => inside(point) ? movedPoint(point, delta) : point) }, mode: "stretch", movedPointCount: entity.definitionPoints.filter(inside).length, selected: true, reason: null };
  }
  if (entity.kind === "hatch") {
    const points = entity.loops.flatMap((loop) => loop.vertices);
    if (!pointsSelected(points, inside)) return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
    if (zeroDelta) return noOp();
    return {
      entity: { ...entity, loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => inside(point) ? movedPoint(point, delta) : point) })) },
      mode: "stretch", movedPointCount: points.filter(inside).length, selected: true, reason: null,
    };
  }

  const anchor = entity.kind === "circle" ? entity.center
    : entity.kind === "ray" || entity.kind === "xline" ? entity.basePoint
      : entity.kind === "text" || entity.kind === "mtext" ? entity.position
        : entity.kind === "blockRef" ? entity.insertion
          : null;
  if (anchor && inside(anchor)) {
    if (zeroDelta) return noOp();
    const moved = translateEntity(entity, delta);
    return moved
      ? { entity: moved, mode: "move", movedPointCount: 1, selected: true, reason: null }
      : { entity: null, mode: null, movedPointCount: 0, selected: true, reason: "unsupported-target" };
  }
  if (entity.kind === "proxy") {
    const selected = entity.bounds ? inside(entity.bounds.min) || inside(entity.bounds.max) : false;
    if (selected && zeroDelta) return noOp();
    return { entity: null, mode: null, movedPointCount: 0, selected, reason: selected ? "unsupported-target" : "not-selected" };
  }
  return { entity: null, mode: null, movedPointCount: 0, selected: false, reason: "not-selected" };
}
