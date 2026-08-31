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

function curvePolyline(curve: TrimCurve, samples = 96): CadPoint2[] {
  if (curve.kind === "line") return [curve.start, curve.end];
  return Array.from({ length: samples + 1 }, (_, index) => trimPointAt(curve, index / samples));
}

interface PathSample {
  point: CadPoint2;
  tangentAngle: number;
}

function samplePath(entity: CadEntity, distanceAlong: number): PathSample {
  const points = trimCurvesOfEntity(entity).flatMap((curve, index) => {
    const sampled = curvePolyline(curve);
    return index === 0 ? sampled : sampled.slice(1);
  });
  if (points.length < 2) throw new ArrayCommandInputError("ARRAYPATH requires a supported non-degenerate path.");
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  }).filter((segment) => segment.length > EPSILON);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= EPSILON) throw new ArrayCommandInputError("ARRAYPATH path length must be positive.");
  let remaining = Math.max(0, Math.min(distanceAlong, total));
  for (const segment of segments) {
    if (remaining <= segment.length + EPSILON) {
      const ratio = Math.min(1, remaining / segment.length);
      return {
        point: { x: segment.start.x + (segment.end.x - segment.start.x) * ratio, y: segment.start.y + (segment.end.y - segment.start.y) * ratio },
        tangentAngle: Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x),
      };
    }
    remaining -= segment.length;
  }
  const last = segments.at(-1)!;
  return { point: { ...last.end }, tangentAngle: Math.atan2(last.end.y - last.start.y, last.end.x - last.start.x) };
}

function pathLength(entity: CadEntity): number {
  const curves = trimCurvesOfEntity(entity);
  return curves.reduce((total, curve) => {
    const points = curvePolyline(curve);
    return total + points.slice(0, -1).reduce((sum, point, index) => sum + Math.hypot(points[index + 1]!.x - point.x, points[index + 1]!.y - point.y), 0);
  }, 0);
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
    const total = pathLength(path);
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
      const sampled = samplePath(path, along);
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
