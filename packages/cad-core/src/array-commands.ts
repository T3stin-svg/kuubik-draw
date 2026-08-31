import type { CadEntity, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateEntityHandles, rotateCadEntity, translateCadEntity } from "./commands.js";
import type { EntityChange } from "./transaction.js";
import { trimCurvesOfEntity, trimPointAt, type TrimCurve } from "./trim.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export class ArrayCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArrayCommandInputError";
  }
}

interface BaseArrayInput {
  targetHandles: readonly string[];
  basePoint: CadPoint2;
}

export interface RectangularArrayInput extends BaseArrayInput {
  command: "ARRAYRECT";
  rows: number;
  columns: number;
  rowVector: CadPoint2;
  columnVector: CadPoint2;
}

export interface PolarArrayInput extends BaseArrayInput {
  command: "ARRAYPOLAR";
  center: CadPoint2;
  items: number;
  fillAngleRad: number;
  rotateItems: boolean;
}

export interface PathArrayInput extends BaseArrayInput {
  command: "ARRAYPATH";
  pathHandle: string;
  method: "divide" | "measure";
  items?: number;
  spacing?: number;
  startOffset?: number;
  alignItems: boolean;
}

export type ArrayCommandInput = RectangularArrayInput | PolarArrayInput | PathArrayInput;

export interface PreparedArrayCommand {
  commandId: ArrayCommandInput["command"];
  changes: EntityChange[];
  sourceHandles: string[];
  resultHandles: string[];
  createdHandles: string[];
  itemCount: number;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new ArrayCommandInputError(`${label} must be finite.`);
}

function selectedEntities(document: KDrawDocumentV1, handles: readonly string[]): CadEntity[] {
  const unique = [...new Set(handles.map((handle) => handle.trim()).filter(Boolean))];
  if (unique.length === 0) throw new ArrayCommandInputError("ARRAY requires at least one source entity.");
  const byHandle = new Map(document.entities.map((entity) => [entity.handle, entity]));
  return unique.map((handle) => {
    const entity = byHandle.get(handle);
    if (!entity) throw new ArrayCommandInputError(`ARRAY source ${handle} does not exist.`);
    if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) throw new ArrayCommandInputError(`ARRAY source ${handle} is on a locked layer.`);
    return entity;
  });
}

function transformedCopy(entity: CadEntity, handle: string, delta: CadPoint2, rotation: { center: CadPoint2; angle: number } | null): CadEntity {
  const translated = translateCadEntity(entity, delta);
  if (!translated) throw new ArrayCommandInputError(`ARRAY does not support ${entity.kind} source ${entity.handle}.`);
  const transformed = rotation ? rotateCadEntity(translated, rotation.center, rotation.angle) : translated;
  if (!transformed) throw new ArrayCommandInputError(`ARRAY cannot rotate ${entity.kind} source ${entity.handle}.`);
  return { ...transformed, handle } as CadEntity;
}

export interface ArrayPathSample {
  point: CadPoint2;
  tangentAngle: number;
}

interface PathNode {
  parameter: number;
  point: CadPoint2;
  distance: number;
}

interface CurveMetric {
  curve: TrimCurve;
  length: number;
  nodes: PathNode[] | null;
}

function pointDistance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointToChordDistance(point: CadPoint2, start: CadPoint2, end: CadPoint2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (squared <= EPSILON) return pointDistance(point, start);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared));
  return Math.hypot(point.x - start.x - dx * ratio, point.y - start.y - dy * ratio);
}

function curveScale(curve: TrimCurve): number {
  if (curve.kind === "line") return pointDistance(curve.start, curve.end);
  if (curve.kind === "arc") return curve.radius;
  if (curve.kind === "ellipse") return Math.max(Math.hypot(curve.major.x, curve.major.y), Math.hypot(curve.minor.x, curve.minor.y));
  const xs = curve.controlPoints.map((point) => point.x);
  const ys = curve.controlPoints.map((point) => point.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function adaptiveCurveNodes(curve: TrimCurve): PathNode[] {
  const tolerance = Math.max(curveScale(curve) * 1e-8, 1e-8);
  const nodes: Array<{ parameter: number; point: CadPoint2 }> = [{ parameter: 0, point: trimPointAt(curve, 0) }];
  const subdivide = (from: number, fromPoint: CadPoint2, to: number, toPoint: CadPoint2, depth: number): void => {
    const quarter = from + (to - from) * 0.25;
    const middle = (from + to) / 2;
    const threeQuarter = from + (to - from) * 0.75;
    const quarterPoint = trimPointAt(curve, quarter);
    const middlePoint = trimPointAt(curve, middle);
    const threeQuarterPoint = trimPointAt(curve, threeQuarter);
    const chord = pointDistance(fromPoint, toPoint);
    const polygon = pointDistance(fromPoint, quarterPoint) + pointDistance(quarterPoint, middlePoint)
      + pointDistance(middlePoint, threeQuarterPoint) + pointDistance(threeQuarterPoint, toPoint);
    const error = Math.max(
      pointToChordDistance(quarterPoint, fromPoint, toPoint),
      pointToChordDistance(middlePoint, fromPoint, toPoint),
      pointToChordDistance(threeQuarterPoint, fromPoint, toPoint),
      polygon - chord,
    );
    if (error <= tolerance || depth >= 20) {
      nodes.push({ parameter: to, point: toPoint });
      return;
    }
    subdivide(from, fromPoint, middle, middlePoint, depth + 1);
    subdivide(middle, middlePoint, to, toPoint, depth + 1);
  };
  subdivide(0, nodes[0]!.point, 1, trimPointAt(curve, 1), 0);
  let distance = 0;
  return nodes.map((node, index) => {
    if (index > 0) distance += pointDistance(nodes[index - 1]!.point, node.point);
    return { ...node, distance };
  });
}

function metricForCurve(curve: TrimCurve): CurveMetric | null {
  if (curve.kind === "line") {
    const length = pointDistance(curve.start, curve.end);
    return length > EPSILON ? { curve, length, nodes: null } : null;
  }
  if (curve.kind === "arc") {
    const length = curve.radius * Math.abs(curve.sweep);
    return length > EPSILON ? { curve, length, nodes: null } : null;
  }
  const nodes = adaptiveCurveNodes(curve);
  const length = nodes.at(-1)?.distance ?? 0;
  return length > EPSILON ? { curve, length, nodes } : null;
}

function metricsForPath(entity: CadEntity): CurveMetric[] {
  const metrics = trimCurvesOfEntity(entity).map(metricForCurve).filter((metric): metric is CurveMetric => metric !== null);
  if (metrics.length === 0) throw new ArrayCommandInputError("ARRAYPATH requires a supported non-degenerate path.");
  return metrics;
}

function tangentAt(curve: TrimCurve, parameter: number): number {
  if (curve.kind === "line") return Math.atan2(curve.end.y - curve.start.y, curve.end.x - curve.start.x);
  if (curve.kind === "arc") {
    const angle = curve.startAngle + curve.sweep * parameter;
    return angle + (curve.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  const delta = 1e-6;
  const from = trimPointAt(curve, Math.max(0, parameter - delta));
  const to = trimPointAt(curve, Math.min(1, parameter + delta));
  if (pointDistance(from, to) <= EPSILON) {
    const fallbackFrom = trimPointAt(curve, Math.max(0, parameter - 1e-4));
    const fallbackTo = trimPointAt(curve, Math.min(1, parameter + 1e-4));
    return Math.atan2(fallbackTo.y - fallbackFrom.y, fallbackTo.x - fallbackFrom.x);
  }
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function sampleMetric(metric: CurveMetric, distanceAlong: number): ArrayPathSample {
  const distance = Math.max(0, Math.min(distanceAlong, metric.length));
  if (metric.curve.kind === "line" || metric.curve.kind === "arc") {
    const parameter = metric.length <= EPSILON ? 0 : distance / metric.length;
    return { point: trimPointAt(metric.curve, parameter), tangentAngle: tangentAt(metric.curve, parameter) };
  }
  const nodes = metric.nodes!;
  let upperIndex = nodes.findIndex((node) => node.distance >= distance - EPSILON);
  if (upperIndex <= 0) upperIndex = Math.min(1, nodes.length - 1);
  const before = nodes[upperIndex - 1]!;
  const after = nodes[upperIndex]!;
  const span = after.distance - before.distance;
  const ratio = span <= EPSILON ? 0 : (distance - before.distance) / span;
  const parameter = before.parameter + (after.parameter - before.parameter) * Math.max(0, Math.min(1, ratio));
  return { point: trimPointAt(metric.curve, parameter), tangentAngle: tangentAt(metric.curve, parameter) };
}

export function arrayPathLength(entity: CadEntity): number {
  return metricsForPath(entity).reduce((total, metric) => total + metric.length, 0);
}

export function arrayPathSample(entity: CadEntity, distanceAlong: number): ArrayPathSample {
  if (!Number.isFinite(distanceAlong)) throw new ArrayCommandInputError("ARRAYPATH sample distance must be finite.");
  const metrics = metricsForPath(entity);
  const total = metrics.reduce((sum, metric) => sum + metric.length, 0);
  let remaining = Math.max(0, Math.min(distanceAlong, total));
  for (const metric of metrics) {
    if (remaining <= metric.length + EPSILON) return sampleMetric(metric, remaining);
    remaining -= metric.length;
  }
  return sampleMetric(metrics.at(-1)!, metrics.at(-1)!.length);
}

export function prepareArrayCommand(document: KDrawDocumentV1, input: ArrayCommandInput): PreparedArrayCommand {
  assertPoint(input.basePoint, "ARRAY base point");
  const sources = selectedEntities(document, input.targetHandles);
  const placements: Array<{ delta: CadPoint2; rotation: { center: CadPoint2; angle: number } | null }> = [];

  if (input.command === "ARRAYRECT") {
    if (!Number.isInteger(input.rows) || input.rows < 1 || !Number.isInteger(input.columns) || input.columns < 1 || input.rows * input.columns < 2) {
      throw new ArrayCommandInputError("Rectangular ARRAY requires positive integer rows/columns and at least two items.");
    }
    assertPoint(input.rowVector, "ARRAY row vector");
    assertPoint(input.columnVector, "ARRAY column vector");
    for (let row = 0; row < input.rows; row += 1) for (let column = 0; column < input.columns; column += 1) {
      if (row === 0 && column === 0) continue;
      placements.push({
        delta: { x: row * input.rowVector.x + column * input.columnVector.x, y: row * input.rowVector.y + column * input.columnVector.y },
        rotation: null,
      });
    }
  } else if (input.command === "ARRAYPOLAR") {
    assertPoint(input.center, "ARRAY polar center");
    if (!Number.isInteger(input.items) || input.items < 2) throw new ArrayCommandInputError("Polar ARRAY requires at least two items.");
    if (!Number.isFinite(input.fillAngleRad) || Math.abs(input.fillAngleRad) <= EPSILON || Math.abs(input.fillAngleRad) > TWO_PI + EPSILON) {
      throw new ArrayCommandInputError("Polar ARRAY fill angle must be non-zero and at most 2π.");
    }
    const divisor = Math.abs(Math.abs(input.fillAngleRad) - TWO_PI) <= EPSILON ? input.items : input.items - 1;
    for (let index = 1; index < input.items; index += 1) {
      const angle = input.fillAngleRad * index / divisor;
      const baseRotated = {
        x: input.center.x + (input.basePoint.x - input.center.x) * Math.cos(angle) - (input.basePoint.y - input.center.y) * Math.sin(angle),
        y: input.center.y + (input.basePoint.x - input.center.x) * Math.sin(angle) + (input.basePoint.y - input.center.y) * Math.cos(angle),
      };
      placements.push({
        delta: { x: baseRotated.x - input.basePoint.x, y: baseRotated.y - input.basePoint.y },
        rotation: input.rotateItems ? { center: baseRotated, angle } : null,
      });
    }
  } else {
    const path = document.entities.find((entity) => entity.handle === input.pathHandle);
    if (!path) throw new ArrayCommandInputError(`ARRAYPATH path ${input.pathHandle} does not exist.`);
    const total = arrayPathLength(path);
    const startOffset = input.startOffset ?? 0;
    if (!Number.isFinite(startOffset) || startOffset < 0 || startOffset > total + EPSILON) throw new ArrayCommandInputError("ARRAYPATH start offset is outside the path.");
    let distances: number[];
    if (input.method === "divide") {
      if (!Number.isInteger(input.items) || input.items! < 2) throw new ArrayCommandInputError("ARRAYPATH Divide requires at least two items.");
      const available = total - startOffset;
      distances = Array.from({ length: input.items! }, (_, index) => startOffset + available * index / (input.items! - 1));
    } else {
      if (!Number.isFinite(input.spacing) || input.spacing! <= EPSILON) throw new ArrayCommandInputError("ARRAYPATH Measure requires positive spacing.");
      distances = [];
      for (let along = startOffset; along <= total + EPSILON; along += input.spacing!) distances.push(Math.min(along, total));
      if (distances.length < 1) throw new ArrayCommandInputError("ARRAYPATH spacing produced no items.");
    }
    placements.push(...distances.map((along) => {
      const sampled = arrayPathSample(path, along);
      return {
        delta: { x: sampled.point.x - input.basePoint.x, y: sampled.point.y - input.basePoint.y },
        rotation: input.alignItems ? { center: sampled.point, angle: sampled.tangentAngle } : null,
      };
    }));
  }

  const handleCount = placements.length * sources.length;
  const handles = allocateEntityHandles(document, handleCount);
  const entities: CadEntity[] = [];
  let handleIndex = 0;
  for (const placement of placements) for (const source of sources) {
    entities.push(transformedCopy(source, handles[handleIndex++]!, placement.delta, placement.rotation));
  }
  return {
    commandId: input.command,
    changes: entities.map((entity) => ({ type: "put", entity })),
    sourceHandles: sources.map((entity) => entity.handle),
    resultHandles: entities.map((entity) => entity.handle),
    createdHandles: entities.map((entity) => entity.handle),
    itemCount: placements.length + (input.command === "ARRAYPATH" ? 0 : 1),
  };
}
