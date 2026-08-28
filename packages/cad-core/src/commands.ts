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

export const cadCommandRegistry = Object.freeze([rectangleCommand, eraseCommand, moveCommand, copyCommand]);

export function resolveCadCommand(token: string): RectangleCommandDefinition | EraseCommandDefinition | MoveCommandDefinition | CopyCommandDefinition | null {
  const normalized = token.trim().toUpperCase();
  return cadCommandRegistry.find((command) => command.aliases.includes(normalized)) ?? null;
}
