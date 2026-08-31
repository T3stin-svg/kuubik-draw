import type { CadEntity, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateEntityHandles, rotateCadEntity, translateCadEntity } from "./commands.js";
import type { EntityChange } from "./transaction.js";
import { trimCurvesOfEntity, trimPointAt, type TrimCurve } from "./trim.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;
const ARRAY_PATH_EXTENSION_KEY = "kuubikArrayPath";

export type ArrayCommandInputErrorCode =
  | "EMPTY_SELECTION"
  | "ENTITY_NOT_FOUND"
  | "LAYER_NOT_FOUND"
  | "LAYER_LOCKED"
  | "LAYER_HIDDEN"
  | "INVALID_INPUT"
  | "UNSUPPORTED_ENTITY"
  | "PATH_COLLISION";

export class ArrayCommandInputError extends Error {
  constructor(public readonly code: ArrayCommandInputErrorCode, message: string) {
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
  /** Legacy exact vector input. Prefer row/column spacing plus array angle. */
  rowVector?: CadPoint2;
  columnVector?: CadPoint2;
  rowSpacing?: number;
  columnSpacing?: number;
  arrayAngleRad?: number;
}

export interface PolarArrayInput extends BaseArrayInput {
  command: "ARRAYPOLAR";
  center: CadPoint2;
  items: number;
  fillAngleRad?: number;
  angleBetweenRad?: number;
  rotateItems: boolean;
  rows?: number;
  rowSpacing?: number;
}

export interface PathArrayInput extends BaseArrayInput {
  command: "ARRAYPATH";
  pathHandle: string;
  method: "divide" | "measure";
  items?: number;
  spacing?: number;
  startOffset?: number;
  alignItems: boolean;
  fillEntirePath?: boolean;
  tangentDirectionRad?: number;
  pathDirection?: "forward" | "reverse";
  rows?: number;
  rowSpacing?: number;
  associative?: boolean;
  associationId?: string;
}

export type ArrayCommandInput = RectangularArrayInput | PolarArrayInput | PathArrayInput;

export interface PreparedArrayCommand {
  commandId: ArrayCommandInput["command"];
  changes: EntityChange[];
  sourceHandles: string[];
  resultHandles: string[];
  createdHandles: string[];
  itemCount: number;
  associative: boolean;
  associationId?: string;
}

export interface ArrayPathAssociation {
  version: 1;
  associationId: string;
  sourceHandle: string;
  pathHandle: string;
  childKey: string;
  input: Omit<PathArrayInput, "targetHandles" | "associationId">;
}

interface ArrayPlacement {
  itemIndex: number;
  rowIndex: number;
  delta: CadPoint2;
  rotation: { center: CadPoint2; angle: number } | null;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new ArrayCommandInputError("INVALID_INPUT", `${label} must be finite.`);
}

function editableEntity(document: KDrawDocumentV1, handle: string, role: "source" | "path"): CadEntity {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity) throw new ArrayCommandInputError("ENTITY_NOT_FOUND", `ARRAY ${role} ${handle} does not exist.`);
  const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
  if (!layer) throw new ArrayCommandInputError("LAYER_NOT_FOUND", `ARRAY ${role} ${handle} references missing layer ${entity.layerId}.`);
  if (layer.locked) throw new ArrayCommandInputError("LAYER_LOCKED", `ARRAY ${role} ${handle} is on a locked layer.`);
  if (!layer.visible || layer.frozen) throw new ArrayCommandInputError("LAYER_HIDDEN", `ARRAY ${role} ${handle} is on an off or frozen layer.`);
  return entity;
}

function selectedEntities(document: KDrawDocumentV1, handles: readonly string[]): CadEntity[] {
  const unique = [...new Set(handles.map((handle) => handle.trim()).filter(Boolean))];
  if (unique.length === 0) throw new ArrayCommandInputError("EMPTY_SELECTION", "ARRAY requires at least one source entity.");
  return unique.map((handle) => editableEntity(document, handle, "source"));
}

function transformedCopy(entity: CadEntity, handle: string, delta: CadPoint2, rotation: { center: CadPoint2; angle: number } | null): CadEntity {
  const translated = translateCadEntity(entity, delta);
  if (!translated) throw new ArrayCommandInputError("UNSUPPORTED_ENTITY", `ARRAY does not support ${entity.kind} source ${entity.handle}.`);
  const transformed = rotation ? rotateCadEntity(translated, rotation.center, rotation.angle) : translated;
  if (!transformed) throw new ArrayCommandInputError("UNSUPPORTED_ENTITY", `ARRAY cannot rotate ${entity.kind} source ${entity.handle}.`);
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
  if (metrics.length === 0) throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH requires a supported non-degenerate path.");
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
  if (!Number.isFinite(distanceAlong)) throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH sample distance must be finite.");
  const metrics = metricsForPath(entity);
  const total = metrics.reduce((sum, metric) => sum + metric.length, 0);
  let remaining = Math.max(0, Math.min(distanceAlong, total));
  for (const metric of metrics) {
    if (remaining <= metric.length + EPSILON) return sampleMetric(metric, remaining);
    remaining -= metric.length;
  }
  return sampleMetric(metrics.at(-1)!, metrics.at(-1)!.length);
}

function requireInteger(value: number | undefined, minimum: number, label: string): number {
  if (!Number.isInteger(value) || value! < minimum) throw new ArrayCommandInputError("INVALID_INPUT", `${label} must be an integer of at least ${minimum}.`);
  return value!;
}

function requireFinite(value: number | undefined, label: string): number {
  if (!Number.isFinite(value)) throw new ArrayCommandInputError("INVALID_INPUT", `${label} must be finite.`);
  return value!;
}

function rotateVector(vector: CadPoint2, angle: number): CadPoint2 {
  return {
    x: vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
    y: vector.x * Math.sin(angle) + vector.y * Math.cos(angle),
  };
}

function rectangularPlacements(input: RectangularArrayInput): ArrayPlacement[] {
  const rows = requireInteger(input.rows, 1, "Rectangular ARRAY row count");
  const columns = requireInteger(input.columns, 1, "Rectangular ARRAY column count");
  if (rows * columns < 2) throw new ArrayCommandInputError("INVALID_INPUT", "Rectangular ARRAY requires at least two items.");
  let rowVector: CadPoint2;
  let columnVector: CadPoint2;
  if (input.rowVector || input.columnVector) {
    if (!input.rowVector || !input.columnVector) throw new ArrayCommandInputError("INVALID_INPUT", "Rectangular ARRAY legacy input requires both row and column vectors.");
    assertPoint(input.rowVector, "ARRAY row vector");
    assertPoint(input.columnVector, "ARRAY column vector");
    rowVector = input.rowVector;
    columnVector = input.columnVector;
  } else {
    const rowSpacing = requireFinite(input.rowSpacing, "Rectangular ARRAY row spacing");
    const columnSpacing = requireFinite(input.columnSpacing, "Rectangular ARRAY column spacing");
    const angle = input.arrayAngleRad ?? 0;
    if (!Number.isFinite(angle)) throw new ArrayCommandInputError("INVALID_INPUT", "Rectangular ARRAY angle must be finite.");
    if (rows > 1 && Math.abs(rowSpacing) <= EPSILON) throw new ArrayCommandInputError("INVALID_INPUT", "Rectangular ARRAY row spacing must be non-zero when rows exceed one.");
    if (columns > 1 && Math.abs(columnSpacing) <= EPSILON) throw new ArrayCommandInputError("INVALID_INPUT", "Rectangular ARRAY column spacing must be non-zero when columns exceed one.");
    columnVector = rotateVector({ x: columnSpacing, y: 0 }, angle);
    rowVector = rotateVector({ x: 0, y: rowSpacing }, angle);
  }
  const placements: ArrayPlacement[] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    if (row === 0 && column === 0) continue;
    placements.push({
      itemIndex: column,
      rowIndex: row,
      delta: { x: row * rowVector.x + column * columnVector.x, y: row * rowVector.y + column * columnVector.y },
      rotation: null,
    });
  }
  return placements;
}

function polarPlacements(input: PolarArrayInput): ArrayPlacement[] {
  assertPoint(input.center, "ARRAY polar center");
  const items = requireInteger(input.items, 2, "Polar ARRAY item count");
  const rows = requireInteger(input.rows ?? 1, 1, "Polar ARRAY row count");
  const rowSpacing = requireFinite(input.rowSpacing ?? 0, "Polar ARRAY row spacing");
  if (rows > 1 && Math.abs(rowSpacing) <= EPSILON) throw new ArrayCommandInputError("INVALID_INPUT", "Polar ARRAY row spacing must be non-zero when rows exceed one.");
  if (input.fillAngleRad !== undefined && input.angleBetweenRad !== undefined) {
    throw new ArrayCommandInputError("INVALID_INPUT", "Polar ARRAY accepts either fill angle or angle between items, not both.");
  }
  const fillAngle = input.angleBetweenRad === undefined
    ? requireFinite(input.fillAngleRad, "Polar ARRAY fill angle")
    : requireFinite(input.angleBetweenRad, "Polar ARRAY angle between items") * (items - 1);
  if (Math.abs(fillAngle) <= EPSILON || Math.abs(fillAngle) > TWO_PI + EPSILON) {
    throw new ArrayCommandInputError("INVALID_INPUT", "Polar ARRAY fill angle must be non-zero and at most 2π.");
  }
  const angleStep = input.angleBetweenRad ?? (fillAngle / (Math.abs(Math.abs(fillAngle) - TWO_PI) <= EPSILON ? items : items - 1));
  const baseVector = { x: input.basePoint.x - input.center.x, y: input.basePoint.y - input.center.y };
  const radius = Math.hypot(baseVector.x, baseVector.y);
  const unit = radius <= EPSILON ? { x: 1, y: 0 } : { x: baseVector.x / radius, y: baseVector.y / radius };
  const placements: ArrayPlacement[] = [];
  for (let row = 0; row < rows; row += 1) for (let item = 0; item < items; item += 1) {
    if (row === 0 && item === 0) continue;
    const angle = angleStep * item;
    const targetVector = rotateVector({ x: unit.x * (radius + row * rowSpacing), y: unit.y * (radius + row * rowSpacing) }, angle);
    const target = { x: input.center.x + targetVector.x, y: input.center.y + targetVector.y };
    placements.push({
      itemIndex: item,
      rowIndex: row,
      delta: { x: target.x - input.basePoint.x, y: target.y - input.basePoint.y },
      rotation: input.rotateItems ? { center: target, angle } : null,
    });
  }
  return placements;
}

function isClosedPath(path: CadEntity): boolean {
  return path.kind === "circle" || path.kind === "ellipse"
    || ((path.kind === "polyline" || path.kind === "spline") && path.closed);
}

function pathPlacements(document: KDrawDocumentV1, input: PathArrayInput): ArrayPlacement[] {
  if (input.targetHandles.includes(input.pathHandle)) throw new ArrayCommandInputError("PATH_COLLISION", "ARRAYPATH path cannot also be a source entity.");
  const path = editableEntity(document, input.pathHandle, "path");
  const total = arrayPathLength(path);
  const startOffset = input.startOffset ?? 0;
  if (!Number.isFinite(startOffset) || startOffset < 0 || startOffset > total + EPSILON) {
    throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH start offset is outside the path.");
  }
  const direction = input.pathDirection ?? "forward";
  const fillEntirePath = input.fillEntirePath ?? true;
  let distances: number[];
  if (input.method === "divide") {
    const items = requireInteger(input.items, 2, "ARRAYPATH Divide item count");
    const available = total - startOffset;
    const closedWithoutOffset = isClosedPath(path) && startOffset <= EPSILON;
    const divisor = closedWithoutOffset ? items : items - 1;
    distances = Array.from({ length: items }, (_, index) => startOffset + available * index / divisor);
  } else {
    const spacing = requireFinite(input.spacing, "ARRAYPATH Measure spacing");
    if (spacing <= EPSILON) throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH Measure spacing must be positive.");
    const countCap = fillEntirePath ? Number.POSITIVE_INFINITY : requireInteger(input.items, 1, "ARRAYPATH Measure item count");
    distances = [];
    for (let along = startOffset; along <= total + EPSILON && distances.length < countCap; along += spacing) distances.push(Math.min(along, total));
    if (!fillEntirePath && Number.isFinite(countCap) && distances.length < countCap) {
      throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH requested item count does not fit at the given spacing.");
    }
    if (distances.length < 1) throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH spacing produced no items.");
  }
  const rows = requireInteger(input.rows ?? 1, 1, "ARRAYPATH row count");
  const rowSpacing = requireFinite(input.rowSpacing ?? 0, "ARRAYPATH row spacing");
  const tangentDirection = requireFinite(input.tangentDirectionRad ?? 0, "ARRAYPATH tangent direction");
  if (rows > 1 && Math.abs(rowSpacing) <= EPSILON) throw new ArrayCommandInputError("INVALID_INPUT", "ARRAYPATH row spacing must be non-zero when rows exceed one.");
  const placements: ArrayPlacement[] = [];
  for (let itemIndex = 0; itemIndex < distances.length; itemIndex += 1) {
    const along = direction === "reverse" ? total - distances[itemIndex]! : distances[itemIndex]!;
    const sampled = arrayPathSample(path, along);
    const pathAngle = sampled.tangentAngle + (direction === "reverse" ? Math.PI : 0);
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const normalOffset = rowIndex * rowSpacing;
      const target = {
        x: sampled.point.x - Math.sin(pathAngle) * normalOffset,
        y: sampled.point.y + Math.cos(pathAngle) * normalOffset,
      };
      placements.push({
        itemIndex,
        rowIndex,
        delta: { x: target.x - input.basePoint.x, y: target.y - input.basePoint.y },
        rotation: input.alignItems ? { center: target, angle: pathAngle + tangentDirection } : null,
      });
    }
  }
  return placements;
}

function associationInput(input: PathArrayInput): ArrayPathAssociation["input"] {
  const { targetHandles: _targetHandles, associationId: _associationId, ...definition } = input;
  return JSON.parse(JSON.stringify(definition)) as ArrayPathAssociation["input"];
}

function childKey(sourceHandle: string, placement: ArrayPlacement): string {
  return `${sourceHandle}:${placement.itemIndex}:${placement.rowIndex}`;
}

function withPathAssociation(entity: CadEntity, association: ArrayPathAssociation): CadEntity {
  return {
    ...entity,
    extensionData: { ...(entity.extensionData ?? {}), [ARRAY_PATH_EXTENSION_KEY]: association },
  } as CadEntity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readArrayPathAssociation(entity: CadEntity): ArrayPathAssociation | null {
  const value = entity.extensionData?.[ARRAY_PATH_EXTENSION_KEY];
  if (!isRecord(value) || value.version !== 1 || typeof value.associationId !== "string"
    || typeof value.sourceHandle !== "string" || typeof value.pathHandle !== "string"
    || typeof value.childKey !== "string" || !isRecord(value.input)) return null;
  const input = value.input;
  if (input.command !== "ARRAYPATH" || typeof input.pathHandle !== "string" || !isRecord(input.basePoint)
    || typeof input.basePoint.x !== "number" || typeof input.basePoint.y !== "number"
    || (input.method !== "divide" && input.method !== "measure") || typeof input.alignItems !== "boolean") return null;
  return value as unknown as ArrayPathAssociation;
}

function planArray(document: KDrawDocumentV1, input: ArrayCommandInput): { sources: CadEntity[]; placements: ArrayPlacement[] } {
  assertPoint(input.basePoint, "ARRAY base point");
  const sources = selectedEntities(document, input.targetHandles);
  if (input.command === "ARRAYRECT") return { sources, placements: rectangularPlacements(input) };
  if (input.command === "ARRAYPOLAR") return { sources, placements: polarPlacements(input) };
  return { sources, placements: pathPlacements(document, input) };
}

export function prepareArrayCommand(document: KDrawDocumentV1, input: ArrayCommandInput): PreparedArrayCommand {
  const { sources, placements } = planArray(document, input);
  const handles = allocateEntityHandles(document, placements.length * sources.length);
  const associative = input.command === "ARRAYPATH" && (input.associative ?? true);
  const requestedAssociationId = input.command === "ARRAYPATH" ? input.associationId?.trim() : undefined;
  if (associative && requestedAssociationId && document.entities.some((entity) => readArrayPathAssociation(entity)?.associationId === requestedAssociationId)) {
    throw new ArrayCommandInputError("INVALID_INPUT", `Associative ARRAYPATH ${requestedAssociationId} already exists.`);
  }
  const associationId = associative ? (requestedAssociationId || `ARRAYPATH-${handles[0]!}`) : undefined;
  const entities: CadEntity[] = [];
  let handleIndex = 0;
  for (const placement of placements) for (const source of sources) {
    let entity = transformedCopy(source, handles[handleIndex++]!, placement.delta, placement.rotation);
    if (input.command === "ARRAYPATH" && associationId) {
      entity = withPathAssociation(entity, {
        version: 1,
        associationId,
        sourceHandle: source.handle,
        pathHandle: input.pathHandle,
        childKey: childKey(source.handle, placement),
        input: associationInput(input),
      });
    }
    entities.push(entity);
  }
  const itemCount = input.command === "ARRAYRECT" ? input.rows * input.columns
    : input.command === "ARRAYPOLAR" ? input.items * (input.rows ?? 1)
      : placements.length;
  return {
    commandId: input.command,
    changes: entities.map((entity) => ({ type: "put", entity })),
    sourceHandles: sources.map((entity) => entity.handle),
    resultHandles: entities.map((entity) => entity.handle),
    createdHandles: entities.map((entity) => entity.handle),
    itemCount,
    associative,
    ...(associationId ? { associationId } : {}),
  };
}

export interface RefreshedArrayPathCommand {
  commandId: "ARRAYPATH_REFRESH";
  changes: EntityChange[];
  associationIds: string[];
  resultHandles: string[];
  createdHandles: string[];
  deletedHandles: string[];
}

export type ArrayPathPropertyPatch = Partial<Omit<PathArrayInput, "command" | "targetHandles" | "associationId">>;

/** Rebuilds one associative ARRAYPATH after a Properties edit while retaining every still-addressable child handle. */
export function prepareArrayPathPropertyUpdate(
  document: KDrawDocumentV1,
  associationId: string,
  patch: ArrayPathPropertyPatch,
): RefreshedArrayPathCommand {
  const group = document.entities.flatMap((entity) => {
    const association = readArrayPathAssociation(entity);
    return association?.associationId === associationId ? [{ entity, association }] : [];
  });
  if (group.length === 0) throw new ArrayCommandInputError("ENTITY_NOT_FOUND", `Associative ARRAYPATH ${associationId} does not exist.`);
  const first = group[0]!.association;
  const sourceHandles = [...new Set(group.map(({ association }) => association.sourceHandle))].sort();
  const input: PathArrayInput = {
    ...first.input,
    ...structuredClone(patch),
    command: "ARRAYPATH",
    targetHandles: sourceHandles,
    associationId,
    associative: true,
  };
  const { sources, placements } = planArray(document, input);
  const existing = new Map(group.map(({ entity, association }) => [association.childKey, entity]));
  const desired = placements.flatMap((placement) => sources.map((source) => ({ placement, source, key: childKey(source.handle, placement) })));
  const allocated = allocateEntityHandles(document, desired.filter(({ key }) => !existing.has(key)).length);
  const changes: EntityChange[] = [];
  const resultHandles: string[] = [];
  const createdHandles: string[] = [];
  const deletedHandles: string[] = [];
  let allocatedIndex = 0;
  for (const { placement, source, key } of desired) {
    const prior = existing.get(key);
    const handle = prior?.handle ?? allocated[allocatedIndex++]!;
    const entity = withPathAssociation(transformedCopy(source, handle, placement.delta, placement.rotation), {
      version: 1,
      associationId,
      sourceHandle: source.handle,
      pathHandle: input.pathHandle,
      childKey: key,
      input: associationInput(input),
    });
    changes.push({ type: "put", entity });
    resultHandles.push(handle);
    if (!prior) createdHandles.push(handle);
    existing.delete(key);
  }
  for (const stale of existing.values()) {
    changes.push({ type: "delete", handle: stale.handle });
    deletedHandles.push(stale.handle);
  }
  return { commandId: "ARRAYPATH_REFRESH", changes, associationIds: [associationId], resultHandles, createdHandles, deletedHandles };
}

export function refreshAssociativePathArrays(document: KDrawDocumentV1, changedHandles: readonly string[]): RefreshedArrayPathCommand {
  const changed = new Set(changedHandles);
  const groups = new Map<string, Array<{ entity: CadEntity; association: ArrayPathAssociation }>>();
  for (const entity of document.entities) {
    const association = readArrayPathAssociation(entity);
    if (!association || (!changed.has(association.sourceHandle) && !changed.has(association.pathHandle))) continue;
    const group = groups.get(association.associationId) ?? [];
    group.push({ entity, association });
    groups.set(association.associationId, group);
  }
  const changes: EntityChange[] = [];
  const resultHandles: string[] = [];
  const createdHandles: string[] = [];
  const deletedHandles: string[] = [];
  const associationIds = [...groups.keys()].sort();
  let allocationDocument = document;
  for (const associationId of associationIds) {
    const group = groups.get(associationId)!;
    const first = group[0]!.association;
    const sourceHandles = [...new Set(group.map(({ association }) => association.sourceHandle))].sort();
    const input: PathArrayInput = { ...first.input, targetHandles: sourceHandles, associationId, associative: true };
    const { sources, placements } = planArray(document, input);
    const existing = new Map(group.map(({ entity, association }) => [association.childKey, entity]));
    const desired = placements.flatMap((placement) => sources.map((source) => ({ placement, source, key: childKey(source.handle, placement) })));
    const missingCount = desired.filter(({ key }) => !existing.has(key)).length;
    const allocated = allocateEntityHandles(allocationDocument, missingCount);
    let allocatedIndex = 0;
    for (const { placement, source, key } of desired) {
      const prior = existing.get(key);
      const handle = prior?.handle ?? allocated[allocatedIndex++]!;
      let entity = transformedCopy(source, handle, placement.delta, placement.rotation);
      entity = withPathAssociation(entity, {
        version: 1,
        associationId,
        sourceHandle: source.handle,
        pathHandle: input.pathHandle,
        childKey: key,
        input: associationInput(input),
      });
      changes.push({ type: "put", entity });
      resultHandles.push(handle);
      if (!prior) createdHandles.push(handle);
      existing.delete(key);
    }
    for (const stale of existing.values()) {
      changes.push({ type: "delete", handle: stale.handle });
      deletedHandles.push(stale.handle);
    }
    if (allocated.length > 0) {
      const reservationSource = group[0]!.entity;
      allocationDocument = {
        ...allocationDocument,
        entities: [...allocationDocument.entities, ...allocated.map((handle) => ({ ...reservationSource, handle }) as CadEntity)],
      };
    }
  }
  return { commandId: "ARRAYPATH_REFRESH", changes, associationIds, resultHandles, createdHandles, deletedHandles };
}
