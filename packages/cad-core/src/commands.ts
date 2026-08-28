import type { CadPoint2, CadPolyline, KDrawDocumentV1 } from "@kuubik/cad-schema";
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

export const cadCommandRegistry = Object.freeze([rectangleCommand, eraseCommand]);

export function resolveCadCommand(token: string): RectangleCommandDefinition | EraseCommandDefinition | null {
  const normalized = token.trim().toUpperCase();
  return cadCommandRegistry.find((command) => command.aliases.includes(normalized)) ?? null;
}
