import type { CadEntity, CadHatch, CadHatchLoop, CadPoint2, CadPolyline, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "../transaction.js";
import { readHatchAssociation, withAnnotationExtension } from "./contracts.js";

const EPSILON = 1e-9;

function samePoint(first: CadPoint2, second: CadPoint2): boolean {
  return Math.abs(first.x - second.x) <= EPSILON && Math.abs(first.y - second.y) <= EPSILON;
}

function polygonArea(vertices: readonly CadPoint2[]): number {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInPolygon(point: CadPoint2, vertices: readonly CadPoint2[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const a = vertices[index]!;
    const b = vertices[previous]!;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function boundaryVertices(entity: CadEntity): CadPoint2[] | null {
  if (entity.kind !== "polyline" || !entity.closed || entity.vertices.length < 3) return null;
  const vertices = entity.vertices.map(({ x, y }) => ({ x, y }));
  if (samePoint(vertices[0]!, vertices.at(-1)!)) vertices.pop();
  if (vertices.length < 3 || Math.abs(polygonArea(vertices)) <= EPSILON) return null;
  return vertices;
}

function classifyLoops(polygons: CadPoint2[][]): CadHatchLoop[] {
  return polygons.map((vertices, index) => {
    const sample = vertices[0]!;
    const depth = polygons.reduce((count, other, otherIndex) => otherIndex !== index && pointInPolygon(sample, other) ? count + 1 : count, 0);
    return { vertices: structuredClone(vertices), isHole: depth % 2 === 1 };
  });
}

export interface HatchArgs {
  handle: string;
  layerId: string;
  boundaryHandles: string[];
  pattern: "SOLID" | string;
  angleRad?: number;
  scale?: number;
  origin?: CadPoint2;
  associative?: boolean;
}

export type HatchCapability =
  | { executable: true; code: "ready" }
  | { executable: false; code: "missing-hatch" | "locked-layer" | "orphan-boundary"; handle: string };

export function createHatch(document: KDrawDocumentV1, args: HatchArgs): CadHatch {
  if (!args.handle.trim() || [...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle === args.handle)) throw new RangeError(`Invalid or duplicate hatch handle: ${args.handle}.`);
  const layer = document.layers.find((candidate) => candidate.id === args.layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${args.layerId}.`);
  if (layer.locked) throw new RangeError(`Layer is locked: ${args.layerId}.`);
  const boundaryHandles = [...new Set(args.boundaryHandles)];
  if (!boundaryHandles.length) throw new RangeError("HATCH requires at least one boundary.");
  const polygons = boundaryHandles.map((handle) => {
    const boundary = document.entities.find((entity) => entity.handle === handle);
    const vertices = boundary ? boundaryVertices(boundary) : null;
    if (!vertices) throw new RangeError(`HATCH boundary must be a closed non-degenerate polyline: ${handle}.`);
    return vertices;
  });
  const scale = args.scale ?? 1;
  const angleRad = args.angleRad ?? 0;
  const origin = args.origin ?? { x: 0, y: 0 };
  if (!args.pattern.trim() || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(angleRad) || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw new RangeError("HATCH pattern settings must be finite and valid.");
  const entity: CadHatch = {
    kind: "hatch", handle: args.handle, layerId: args.layerId, pattern: args.pattern,
    associative: args.associative ?? true, loops: classifyLoops(polygons),
  };
  return withAnnotationExtension(entity, {
    kind: "hatch",
    pattern: { type: args.pattern.trim().toUpperCase() === "SOLID" ? "solid" : "line", angleRad, scale, origin: structuredClone(origin) },
    boundaryHandles,
  });
}

export interface HatchUpdateResult {
  changes: EntityChange[];
  updatedHandles: string[];
  broken: Array<{ hatchHandle: string; boundaryHandle: string }>;
}

export function updateAssociativeHatches(document: KDrawDocumentV1, changedHandles: readonly string[]): HatchUpdateResult {
  const changed = new Set(changedHandles);
  const changes: EntityChange[] = [];
  const updatedHandles: string[] = [];
  const broken: HatchUpdateResult["broken"] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "hatch" || !entity.associative) continue;
    const association = readHatchAssociation(entity);
    if (!association || !association.boundaryHandles.some((handle) => changed.has(handle))) continue;
    if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) throw new RangeError(`Associative hatch ${entity.handle} is on locked layer ${entity.layerId}.`);
    const polygons: CadPoint2[][] = [];
    for (const handle of association.boundaryHandles) {
      const boundary = document.entities.find((candidate) => candidate.handle === handle);
      const vertices = boundary ? boundaryVertices(boundary) : null;
      if (!vertices) broken.push({ hatchHandle: entity.handle, boundaryHandle: handle });
      else polygons.push(vertices);
    }
    if (polygons.length !== association.boundaryHandles.length) continue;
    const loops = classifyLoops(polygons);
    if (JSON.stringify(loops) !== JSON.stringify(entity.loops)) {
      changes.push({ type: "put", entity: { ...structuredClone(entity), loops } });
      updatedHandles.push(entity.handle);
    }
  }
  return { changes, updatedHandles, broken };
}

export function evaluateHatchCapability(document: KDrawDocumentV1, hatchHandle: string): HatchCapability {
  const entity = document.entities.find((candidate) => candidate.handle === hatchHandle);
  if (!entity || entity.kind !== "hatch") return { executable: false, code: "missing-hatch", handle: hatchHandle };
  if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) return { executable: false, code: "locked-layer", handle: entity.layerId };
  const association = readHatchAssociation(entity);
  if (entity.associative && !association) return { executable: false, code: "orphan-boundary", handle: "$association" };
  if (entity.associative && association) {
    const orphan = association.boundaryHandles.find((handle) => {
      const boundary = document.entities.find((candidate) => candidate.handle === handle);
      return !boundary || boundaryVertices(boundary) === null;
    });
    if (orphan) return { executable: false, code: "orphan-boundary", handle: orphan };
  }
  return { executable: true, code: "ready" };
}

export function hatchBoundaryPolyline(handle: string, layerId: string, vertices: CadPoint2[]): CadPolyline {
  if (vertices.length < 3) throw new RangeError("Boundary requires at least three vertices.");
  return { kind: "polyline", handle, layerId, closed: true, vertices: vertices.map((point) => ({ ...point })) };
}

export * from "./table.js";
