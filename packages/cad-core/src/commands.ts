import type { CadEntity, CadPoint2, CadPolyline, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

export interface RectangleCommandArgs {
  handle: string;
  layerId: string;
  firstCorner: CadPoint2;
  otherCorner: CadPoint2;
}

export interface RectangleCommandDefinition {
  id: "RECTANGLE";
  aliases: readonly string[];
  execute(args: RectangleCommandArgs): EntityChange[];
}

export interface EraseCommandArgs {
  targetHandles: readonly string[];
}

export interface EraseRejectedTarget {
  handle: string;
  reason: "missing" | "locked-layer";
}

export interface EraseCommandResult {
  changes: EntityChange[];
  erasedHandles: string[];
  rejected: EraseRejectedTarget[];
}

export interface EraseCommandDefinition {
  id: "ERASE";
  aliases: readonly string[];
  execute(document: KDrawDocumentV1, args: EraseCommandArgs): EraseCommandResult;
}

export interface MoveCommandArgs {
  targetHandles: readonly string[];
  basePoint: CadPoint2;
  destinationPoint: CadPoint2;
}

export interface MoveRejectedTarget {
  handle: string;
  reason: "missing" | "locked-layer" | "unsupported-entity";
}

export interface MoveCommandResult {
  changes: EntityChange[];
  movedHandles: string[];
  rejected: MoveRejectedTarget[];
  delta: CadPoint2;
}

export interface MoveCommandDefinition {
  id: "MOVE";
  aliases: readonly string[];
  execute(document: KDrawDocumentV1, args: MoveCommandArgs): MoveCommandResult;
}

export interface CopyCommandArgs {
  targetHandles: readonly string[];
  basePoint: CadPoint2;
  destinationPoints: readonly CadPoint2[];
}

export interface CopyRejectedTarget {
  handle: string;
  reason: "missing" | "locked-layer" | "unsupported-entity";
}

export interface CopyCommandResult {
  changes: EntityChange[];
  sourceHandles: string[];
  copiedHandles: string[];
  rejected: CopyRejectedTarget[];
  deltas: CadPoint2[];
}

export interface CopyCommandDefinition {
  id: "COPY";
  aliases: readonly string[];
  execute(document: KDrawDocumentV1, args: CopyCommandArgs): CopyCommandResult;
}

export type RotateAngleSpec =
  | { mode: "relative"; angleDeg: number }
  | { mode: "reference"; referenceAngleDeg: number; newAngleDeg: number };

export interface RotateCommandArgs {
  targetHandles: readonly string[];
  basePoint: CadPoint2;
  angle: RotateAngleSpec;
}

export interface RotateRejectedTarget {
  handle: string;
  reason: "missing" | "locked-layer" | "unsupported-entity";
}

export interface RotateCommandResult {
  changes: EntityChange[];
  rotatedHandles: string[];
  rejected: RotateRejectedTarget[];
  deltaAngleDeg: number;
}

export interface RotateCommandDefinition {
  id: "ROTATE";
  aliases: readonly string[];
  execute(document: KDrawDocumentV1, args: RotateCommandArgs): RotateCommandResult;
}

export type ScaleFactorSpec =
  | { mode: "factor"; factor: number }
  | { mode: "reference"; referenceLength: number; newLength: number };

export interface ScaleCommandArgs {
  targetHandles: readonly string[];
  basePoint: CadPoint2;
  scale: ScaleFactorSpec;
  copy: boolean;
}

export interface ScaleRejectedTarget {
  handle: string;
  reason: "missing" | "locked-layer" | "unsupported-entity";
}

export interface ScaleCommandResult {
  changes: EntityChange[];
  sourceHandles: string[];
  scaledHandles: string[];
  createdHandles: string[];
  rejected: ScaleRejectedTarget[];
  factor: number;
  copy: boolean;
}

export interface ScaleCommandDefinition {
  id: "SCALE";
  aliases: readonly string[];
  execute(document: KDrawDocumentV1, args: ScaleCommandArgs): ScaleCommandResult;
}

export class CadCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadCommandInputError";
  }
}

function assertFinitePoint(name: string, point: CadPoint2): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CadCommandInputError(`${name} must contain finite coordinates.`);
  }
}

export function parseCartesianPoint(input: string): CadPoint2 {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new CadCommandInputError("Point must use x,y Cartesian format.");
  }
  const point = { x: Number(parts[0]), y: Number(parts[1]) };
  assertFinitePoint("point", point);
  return point;
}

export function parseMoveDestination(input: string, basePoint: CadPoint2): CadPoint2 {
  assertFinitePoint("basePoint", basePoint);
  const trimmed = input.trim();
  if (!trimmed.startsWith("@")) return parseCartesianPoint(trimmed);
  const delta = parseCartesianPoint(trimmed.slice(1));
  return { x: basePoint.x + delta.x, y: basePoint.y + delta.y };
}

export function parseCopyDestinations(input: string, basePoint: CadPoint2): CadPoint2[] {
  assertFinitePoint("basePoint", basePoint);
  const tokens = input.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) throw new CadCommandInputError("COPY requires at least one destination point.");
  return tokens.map((token) => parseMoveDestination(token, basePoint));
}

export function parseAngleDegrees(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) throw new CadCommandInputError("Angle is required.");
  const angle = Number(trimmed);
  if (!Number.isFinite(angle)) throw new CadCommandInputError("Angle must be a finite number in degrees.");
  return Object.is(angle, -0) ? 0 : angle;
}

export function angleBetweenPointsDegrees(start: CadPoint2, end: CadPoint2): number {
  assertFinitePoint("angle start", start);
  assertFinitePoint("angle end", end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) throw new CadCommandInputError("Angle points must not coincide.");
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return Object.is(angle, -0) ? 0 : angle;
}

export function parseRotationAngleInput(input: string, basePoint: CadPoint2): number {
  assertFinitePoint("basePoint", basePoint);
  const trimmed = input.trim();
  if (!trimmed.includes(",")) return parseAngleDegrees(trimmed);
  return angleBetweenPointsDegrees(basePoint, parseCartesianPoint(trimmed));
}

export function parseReferenceAngleInput(input: string, basePoint: CadPoint2): number {
  assertFinitePoint("basePoint", basePoint);
  const tokens = input.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 1 && !tokens[0]!.includes(",")) return parseAngleDegrees(tokens[0]!);
  if (tokens.length === 1) return angleBetweenPointsDegrees(basePoint, parseCartesianPoint(tokens[0]!));
  if (tokens.length === 2) return angleBetweenPointsDegrees(parseCartesianPoint(tokens[0]!), parseCartesianPoint(tokens[1]!));
  throw new CadCommandInputError("Reference angle must be a number, one point from the base, or two points separated by a semicolon.");
}

export function distanceBetweenPoints(start: CadPoint2, end: CadPoint2): number {
  assertFinitePoint("distance start", start);
  assertFinitePoint("distance end", end);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(distance > 0)) throw new CadCommandInputError("Scale length points must not coincide.");
  return distance;
}

function positiveScaleNumber(input: string, name: string): number {
  const trimmed = input.trim();
  if (!trimmed) throw new CadCommandInputError(`${name} is required.`);
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) throw new CadCommandInputError(`${name} must be greater than zero.`);
  return value;
}

export function parseScaleFactorInput(input: string, basePoint: CadPoint2): number {
  assertFinitePoint("basePoint", basePoint);
  return positiveScaleNumber(input, "Scale factor");
}

export function parseScaleLengthInput(input: string, basePoint: CadPoint2): number {
  assertFinitePoint("basePoint", basePoint);
  const tokens = input.split(/[;\r\n]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 1 && !tokens[0]!.includes(",")) return positiveScaleNumber(tokens[0]!, "Scale length");
  if (tokens.length === 1) return distanceBetweenPoints(basePoint, parseCartesianPoint(tokens[0]!));
  if (tokens.length === 2) return distanceBetweenPoints(parseCartesianPoint(tokens[0]!), parseCartesianPoint(tokens[1]!));
  throw new CadCommandInputError("Scale length must be a positive number, one point from the base, or two points separated by a semicolon.");
}

export function allocateEntityHandles(document: KDrawDocumentV1, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new CadCommandInputError("Handle count must be a non-negative safe integer.");
  const used = new Set([
    ...document.entities.map((entity) => entity.handle.toUpperCase()),
    ...document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle.toUpperCase())),
  ]);
  let maximum = 0xfn;
  for (const handle of used) {
    if (!/^[0-9A-F]+$/.test(handle)) continue;
    const value = BigInt(`0x${handle}`);
    if (value > maximum) maximum = value;
  }
  const handles: string[] = [];
  let candidate = maximum + 1n;
  while (handles.length < count) {
    const handle = candidate.toString(16).toUpperCase();
    if (!used.has(handle)) {
      handles.push(handle);
      used.add(handle);
    }
    candidate += 1n;
  }
  return handles;
}

export function executeRectangle(args: RectangleCommandArgs): EntityChange[] {
  assertFinitePoint("firstCorner", args.firstCorner);
  assertFinitePoint("otherCorner", args.otherCorner);
  if (!args.handle || !args.layerId) throw new CadCommandInputError("Rectangle handle and layer are required.");
  if (args.firstCorner.x === args.otherCorner.x || args.firstCorner.y === args.otherCorner.y) {
    throw new CadCommandInputError("Rectangle corners must define non-zero width and height.");
  }
  const entity: CadPolyline = {
    kind: "polyline",
    handle: args.handle,
    layerId: args.layerId,
    closed: true,
    vertices: [
      { x: args.firstCorner.x, y: args.firstCorner.y },
      { x: args.otherCorner.x, y: args.firstCorner.y },
      { x: args.otherCorner.x, y: args.otherCorner.y },
      { x: args.firstCorner.x, y: args.otherCorner.y },
    ],
  };
  return [{ type: "put", entity }];
}

export function executeErase(document: KDrawDocumentV1, args: EraseCommandArgs): EraseCommandResult {
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const erasedHandles: string[] = [];
  const rejected: EraseRejectedTarget[] = [];
  for (const handle of requested) {
    const entity = entities.get(handle);
    if (!entity) {
      rejected.push({ handle, reason: "missing" });
    } else if (lockedLayers.has(entity.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
    } else {
      erasedHandles.push(handle);
    }
  }
  return {
    changes: erasedHandles.map((handle) => ({ type: "delete", handle })),
    erasedHandles,
    rejected,
  };
}

function movedPoint(point: CadPoint2, delta: CadPoint2): CadPoint2 {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

export function translateCadEntity(entity: CadEntity, delta: CadPoint2): CadEntity | null {
  assertFinitePoint("delta", delta);
  switch (entity.kind) {
    case "line": return { ...entity, start: movedPoint(entity.start, delta), end: movedPoint(entity.end, delta) };
    case "polyline": return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...movedPoint(vertex, delta) })) };
    case "circle":
    case "arc":
    case "ellipse": return { ...entity, center: movedPoint(entity.center, delta) };
    case "spline": return { ...entity, controlPoints: entity.controlPoints.map((point) => movedPoint(point, delta)) };
    case "text":
    case "mtext": return { ...entity, position: movedPoint(entity.position, delta) };
    case "leader": return { ...entity, vertices: entity.vertices.map((point) => movedPoint(point, delta)) };
    case "dimension": return { ...entity, definitionPoints: entity.definitionPoints.map((point) => movedPoint(point, delta)) };
    case "hatch": return {
      ...entity,
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => movedPoint(point, delta)) })),
    };
    case "blockRef": return { ...entity, insertion: movedPoint(entity.insertion, delta) };
    case "proxy": return null;
  }
}

export function executeMove(document: KDrawDocumentV1, args: MoveCommandArgs): MoveCommandResult {
  assertFinitePoint("basePoint", args.basePoint);
  assertFinitePoint("destinationPoint", args.destinationPoint);
  const delta = {
    x: args.destinationPoint.x - args.basePoint.x,
    y: args.destinationPoint.y - args.basePoint.y,
  };
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const changes: EntityChange[] = [];
  const movedHandles: string[] = [];
  const rejected: MoveRejectedTarget[] = [];
  if (delta.x === 0 && delta.y === 0) return { changes, movedHandles, rejected, delta };
  for (const handle of requested) {
    const entity = entities.get(handle);
    if (!entity) {
      rejected.push({ handle, reason: "missing" });
      continue;
    }
    if (lockedLayers.has(entity.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
      continue;
    }
    const moved = translateCadEntity(entity, delta);
    if (!moved) {
      rejected.push({ handle, reason: "unsupported-entity" });
      continue;
    }
    changes.push({ type: "put", entity: moved });
    movedHandles.push(handle);
  }
  return { changes, movedHandles, rejected, delta };
}

export function executeCopy(document: KDrawDocumentV1, args: CopyCommandArgs): CopyCommandResult {
  assertFinitePoint("basePoint", args.basePoint);
  if (args.destinationPoints.length === 0) throw new CadCommandInputError("COPY requires at least one destination point.");
  const deltas = args.destinationPoints.map((destinationPoint) => {
    assertFinitePoint("destinationPoint", destinationPoint);
    return {
      x: destinationPoint.x - args.basePoint.x,
      y: destinationPoint.y - args.basePoint.y,
    };
  });
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const sources: CadEntity[] = [];
  const rejected: CopyRejectedTarget[] = [];
  for (const handle of requested) {
    const entity = entities.get(handle);
    if (!entity) {
      rejected.push({ handle, reason: "missing" });
      continue;
    }
    if (lockedLayers.has(entity.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
      continue;
    }
    if (entity.kind === "proxy") {
      rejected.push({ handle, reason: "unsupported-entity" });
      continue;
    }
    sources.push(entity);
  }

  const newHandles = allocateEntityHandles(document, sources.length * deltas.length);
  const changes: EntityChange[] = [];
  const copiedHandles: string[] = [];
  let handleIndex = 0;
  for (const delta of deltas) {
    for (const source of sources) {
      const translated = translateCadEntity(source, delta);
      if (!translated) throw new Error(`COPY capability changed while copying ${source.handle}.`);
      const handle = newHandles[handleIndex++]!;
      changes.push({ type: "put", entity: { ...translated, handle } as CadEntity });
      copiedHandles.push(handle);
    }
  }
  return {
    changes,
    sourceHandles: sources.map((entity) => entity.handle),
    copiedHandles,
    rejected,
    deltas,
  };
}

function cleanTrig(value: number): number {
  if (Math.abs(value) < 1e-15) return 0;
  if (Math.abs(value - 1) < 1e-15) return 1;
  if (Math.abs(value + 1) < 1e-15) return -1;
  return value;
}

function normalizedRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = ((value % fullTurn) + fullTurn) % fullTurn;
  if (Math.abs(normalized) < 1e-15 || Math.abs(normalized - fullTurn) < 1e-15) return 0;
  return normalized;
}

export function rotateCadPoint(point: CadPoint2, basePoint: CadPoint2, angleRad: number): CadPoint2 {
  assertFinitePoint("point", point);
  assertFinitePoint("basePoint", basePoint);
  if (!Number.isFinite(angleRad)) throw new CadCommandInputError("Rotation angle must be finite.");
  const cosine = cleanTrig(Math.cos(angleRad));
  const sine = cleanTrig(Math.sin(angleRad));
  const dx = point.x - basePoint.x;
  const dy = point.y - basePoint.y;
  const x = basePoint.x + dx * cosine - dy * sine;
  const y = basePoint.y + dx * sine + dy * cosine;
  return { x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y };
}

function rotateCadVector(vector: CadPoint2, angleRad: number): CadPoint2 {
  return rotateCadPoint(vector, { x: 0, y: 0 }, angleRad);
}

export function rotateCadEntity(entity: CadEntity, basePoint: CadPoint2, angleRad: number): CadEntity | null {
  assertFinitePoint("basePoint", basePoint);
  if (!Number.isFinite(angleRad)) throw new CadCommandInputError("Rotation angle must be finite.");
  switch (entity.kind) {
    case "line": return { ...entity, start: rotateCadPoint(entity.start, basePoint, angleRad), end: rotateCadPoint(entity.end, basePoint, angleRad) };
    case "polyline": return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, ...rotateCadPoint(vertex, basePoint, angleRad) })) };
    case "circle": return { ...entity, center: rotateCadPoint(entity.center, basePoint, angleRad) };
    case "arc": return {
      ...entity,
      center: rotateCadPoint(entity.center, basePoint, angleRad),
      startAngleRad: normalizedRadians(entity.startAngleRad + angleRad),
      endAngleRad: normalizedRadians(entity.endAngleRad + angleRad),
    };
    case "ellipse": return {
      ...entity,
      center: rotateCadPoint(entity.center, basePoint, angleRad),
      majorAxis: rotateCadVector(entity.majorAxis, angleRad),
    };
    case "spline": return { ...entity, controlPoints: entity.controlPoints.map((point) => rotateCadPoint(point, basePoint, angleRad)) };
    case "text":
    case "mtext": return {
      ...entity,
      position: rotateCadPoint(entity.position, basePoint, angleRad),
      rotationRad: normalizedRadians(entity.rotationRad + angleRad),
    };
    case "leader": return { ...entity, vertices: entity.vertices.map((point) => rotateCadPoint(point, basePoint, angleRad)) };
    case "dimension": return { ...entity, definitionPoints: entity.definitionPoints.map((point) => rotateCadPoint(point, basePoint, angleRad)) };
    case "hatch": return {
      ...entity,
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => rotateCadPoint(point, basePoint, angleRad)) })),
    };
    case "blockRef": return {
      ...entity,
      insertion: rotateCadPoint(entity.insertion, basePoint, angleRad),
      rotationRad: normalizedRadians(entity.rotationRad + angleRad),
    };
    case "proxy": return null;
  }
}

export function executeRotate(document: KDrawDocumentV1, args: RotateCommandArgs): RotateCommandResult {
  assertFinitePoint("basePoint", args.basePoint);
  const deltaAngleDeg = args.angle.mode === "relative"
    ? args.angle.angleDeg
    : args.angle.newAngleDeg - args.angle.referenceAngleDeg;
  if (!Number.isFinite(deltaAngleDeg)) throw new CadCommandInputError("Rotation angle must be finite.");
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const changes: EntityChange[] = [];
  const rotatedHandles: string[] = [];
  const rejected: RotateRejectedTarget[] = [];
  if (deltaAngleDeg % 360 === 0) return { changes, rotatedHandles, rejected, deltaAngleDeg };
  const angleRad = deltaAngleDeg * Math.PI / 180;
  for (const handle of requested) {
    const entity = entities.get(handle);
    if (!entity) {
      rejected.push({ handle, reason: "missing" });
      continue;
    }
    if (lockedLayers.has(entity.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
      continue;
    }
    const rotated = rotateCadEntity(entity, args.basePoint, angleRad);
    if (!rotated) {
      rejected.push({ handle, reason: "unsupported-entity" });
      continue;
    }
    changes.push({ type: "put", entity: rotated });
    rotatedHandles.push(handle);
  }
  return { changes, rotatedHandles, rejected, deltaAngleDeg };
}

export function scaleCadPoint(point: CadPoint2, basePoint: CadPoint2, factor: number): CadPoint2 {
  assertFinitePoint("point", point);
  assertFinitePoint("basePoint", basePoint);
  if (!Number.isFinite(factor) || factor <= 0) throw new CadCommandInputError("Scale factor must be greater than zero.");
  const scaledCoordinate = (coordinate: number, baseCoordinate: number, axis: "x" | "y") => {
    const delta = coordinate - baseCoordinate;
    if (!Number.isFinite(delta)) throw new CadCommandInputError(`Scaled ${axis}-coordinate must remain finite.`);
    const scaledDelta = scaleFiniteScalar(delta, factor, `${axis}-coordinate delta`);
    const result = baseCoordinate + scaledDelta;
    if (!Number.isFinite(result) || (delta !== 0 && result === baseCoordinate)) {
      throw new CadCommandInputError(`Scaled ${axis}-coordinate must remain finite and distinct from the base point.`);
    }
    return Object.is(result, -0) ? 0 : result;
  };
  const x = scaledCoordinate(point.x, basePoint.x, "x");
  const y = scaledCoordinate(point.y, basePoint.y, "y");
  return { x, y };
}

function scaleFiniteScalar(value: number, factor: number, name: string): number {
  if (!Number.isFinite(value)) throw new CadCommandInputError(`${name} must be finite.`);
  const scaled = value * factor;
  if (!Number.isFinite(scaled) || (value !== 0 && scaled === 0)) {
    throw new CadCommandInputError(`Scaled ${name} must remain finite and non-collapsed.`);
  }
  return Object.is(scaled, -0) ? 0 : scaled;
}

function scaledPolylineVertex<T extends { x: number; y: number; startWidth?: number; endWidth?: number }>(
  vertex: T,
  basePoint: CadPoint2,
  factor: number,
): T {
  const result = { ...vertex, ...scaleCadPoint(vertex, basePoint, factor) };
  if (vertex.startWidth !== undefined) result.startWidth = scaleFiniteScalar(vertex.startWidth, factor, "polyline start width");
  if (vertex.endWidth !== undefined) result.endWidth = scaleFiniteScalar(vertex.endWidth, factor, "polyline end width");
  return result;
}

export function scaleCadEntity(entity: CadEntity, basePoint: CadPoint2, factor: number): CadEntity | null {
  assertFinitePoint("basePoint", basePoint);
  if (!Number.isFinite(factor) || factor <= 0) throw new CadCommandInputError("Scale factor must be greater than zero.");
  switch (entity.kind) {
    case "line": return { ...entity, start: scaleCadPoint(entity.start, basePoint, factor), end: scaleCadPoint(entity.end, basePoint, factor) };
    case "polyline": return { ...entity, vertices: entity.vertices.map((vertex) => scaledPolylineVertex(vertex, basePoint, factor)) };
    case "circle": return { ...entity, center: scaleCadPoint(entity.center, basePoint, factor), radius: scaleFiniteScalar(entity.radius, factor, "circle radius") };
    case "arc": return { ...entity, center: scaleCadPoint(entity.center, basePoint, factor), radius: scaleFiniteScalar(entity.radius, factor, "arc radius") };
    case "ellipse": return {
      ...entity,
      center: scaleCadPoint(entity.center, basePoint, factor),
      majorAxis: {
        x: scaleFiniteScalar(entity.majorAxis.x, factor, "ellipse major-axis x"),
        y: scaleFiniteScalar(entity.majorAxis.y, factor, "ellipse major-axis y"),
      },
    };
    case "spline": return { ...entity, controlPoints: entity.controlPoints.map((point) => scaleCadPoint(point, basePoint, factor)) };
    case "text":
    case "mtext": return {
      ...entity,
      position: scaleCadPoint(entity.position, basePoint, factor),
      height: scaleFiniteScalar(entity.height, factor, `${entity.kind} height`),
    };
    case "leader": return { ...entity, vertices: entity.vertices.map((point) => scaleCadPoint(point, basePoint, factor)) };
    case "dimension": return { ...entity, definitionPoints: entity.definitionPoints.map((point) => scaleCadPoint(point, basePoint, factor)) };
    case "hatch": return {
      ...entity,
      loops: entity.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => scaleCadPoint(point, basePoint, factor)) })),
    };
    case "blockRef": return {
      ...entity,
      insertion: scaleCadPoint(entity.insertion, basePoint, factor),
      scale: {
        x: scaleFiniteScalar(entity.scale.x, factor, "block x scale"),
        y: scaleFiniteScalar(entity.scale.y, factor, "block y scale"),
      },
    };
    case "proxy": return null;
  }
}

export function executeScale(document: KDrawDocumentV1, args: ScaleCommandArgs): ScaleCommandResult {
  assertFinitePoint("basePoint", args.basePoint);
  const factor = args.scale.mode === "factor"
    ? args.scale.factor
    : args.scale.newLength / args.scale.referenceLength;
  if (!Number.isFinite(factor) || factor <= 0) throw new CadCommandInputError("Scale factor must be greater than zero.");
  const changes: EntityChange[] = [];
  const sourceHandles: string[] = [];
  const scaledHandles: string[] = [];
  const createdHandles: string[] = [];
  const rejected: ScaleRejectedTarget[] = [];
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const sources: CadEntity[] = [];
  for (const handle of requested) {
    const entity = entities.get(handle);
    if (!entity) {
      rejected.push({ handle, reason: "missing" });
      continue;
    }
    if (lockedLayers.has(entity.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
      continue;
    }
    if (entity.kind === "proxy") {
      rejected.push({ handle, reason: "unsupported-entity" });
      continue;
    }
    sources.push(entity);
    sourceHandles.push(handle);
  }

  if (factor === 1 && !args.copy) {
    return { changes, sourceHandles, scaledHandles, createdHandles, rejected, factor, copy: false };
  }

  const handles = args.copy ? allocateEntityHandles(document, sources.length) : [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    const scaled = scaleCadEntity(source, args.basePoint, factor);
    if (!scaled) throw new Error(`SCALE capability changed while scaling ${source.handle}.`);
    if (args.copy) {
      const handle = handles[index]!;
      changes.push({ type: "put", entity: { ...scaled, handle } as CadEntity });
      createdHandles.push(handle);
    } else {
      changes.push({ type: "put", entity: scaled });
      scaledHandles.push(source.handle);
    }
  }
  return { changes, sourceHandles, scaledHandles, createdHandles, rejected, factor, copy: args.copy };
}

const rectangleCommand: RectangleCommandDefinition = Object.freeze({
  id: "RECTANGLE",
  aliases: Object.freeze(["RECTANG", "RECTANGLE", "REC"]),
  execute: executeRectangle,
});

const eraseCommand: EraseCommandDefinition = Object.freeze({
  id: "ERASE",
  aliases: Object.freeze(["E", "DEL", "ERASE", "DELETE"]),
  execute: executeErase,
});

const moveCommand: MoveCommandDefinition = Object.freeze({
  id: "MOVE",
  aliases: Object.freeze(["M", "MOVE"]),
  execute: executeMove,
});

const copyCommand: CopyCommandDefinition = Object.freeze({
  id: "COPY",
  aliases: Object.freeze(["CO", "CP", "COPY"]),
  execute: executeCopy,
});

const rotateCommand: RotateCommandDefinition = Object.freeze({
  id: "ROTATE",
  aliases: Object.freeze(["RO", "ROTATE"]),
  execute: executeRotate,
});

const scaleCommand: ScaleCommandDefinition = Object.freeze({
  id: "SCALE",
  aliases: Object.freeze(["SC", "SCALE"]),
  execute: executeScale,
});

export const cadCommandRegistry = Object.freeze([rectangleCommand, eraseCommand, moveCommand, copyCommand, rotateCommand, scaleCommand]);

export function resolveCadCommand(token: string): RectangleCommandDefinition | EraseCommandDefinition | MoveCommandDefinition | CopyCommandDefinition | RotateCommandDefinition | ScaleCommandDefinition | null {
  const normalized = token.trim().toUpperCase();
  return cadCommandRegistry.find((command) => command.aliases.includes(normalized)) ?? null;
}
