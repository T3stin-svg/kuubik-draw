import type { CadEntity, CadHatch, CadHatchLoop, CadPoint2, CadPolyline, CadPolylineVertex, KDrawDocumentV1 } from "@kuubik/cad-schema";
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

type HatchVertex = CadPoint2 & { bulge?: number };

interface BoundaryPath {
  vertices: HatchVertex[];
  sampled: CadPoint2[];
}

function tessellate(vertices: readonly HatchVertex[]): CadPoint2[] {
  const sampled: CadPoint2[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    sampled.push({ x: start.x, y: start.y });
    const bulge = start.bulge ?? 0;
    if (Math.abs(bulge) <= EPSILON) continue;
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    if (chord <= EPSILON) return [];
    const sweep = 4 * Math.atan(bulge);
    const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
    const center = {
      x: (start.x + end.x) / 2 - (end.y - start.y) / chord * centerOffset,
      y: (start.y + end.y) / 2 + (end.x - start.x) / chord * centerOffset,
    };
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const parts = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
    for (let part = 1; part < parts; part += 1) {
      const angle = startAngle + sweep * part / parts;
      sampled.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    }
  }
  return sampled;
}

function boundaryVertices(entity: CadEntity): BoundaryPath | null {
  if (entity.kind !== "polyline" || !entity.closed || entity.vertices.length < 3) return null;
  const vertices: HatchVertex[] = entity.vertices.map(({ x, y, bulge }) => ({ x, y, ...(bulge !== undefined && Math.abs(bulge) > EPSILON ? { bulge } : {}) }));
  if (vertices.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || vertex.bulge !== undefined && !Number.isFinite(vertex.bulge))) return null;
  if (samePoint(vertices[0]!, vertices.at(-1)!)) vertices.pop();
  const sampled = tessellate(vertices);
  if (vertices.length < 3 || sampled.length < 3 || Math.abs(polygonArea(sampled)) <= EPSILON) return null;
  return { vertices, sampled };
}

export type HatchIslandDetection = "normal" | "outer" | "ignore";

function classifyLoops(paths: BoundaryPath[], islandDetection: HatchIslandDetection): { loops: CadHatchLoop[]; depths: number[] } {
  const classified = paths.map((path, index) => {
    const sample = path.sampled[0]!;
    const depth = paths.reduce((count, other, otherIndex) => otherIndex !== index && pointInPolygon(sample, other.sampled) ? count + 1 : count, 0);
    return { vertices: structuredClone(path.vertices), depth };
  });
  const selected = islandDetection === "ignore" ? classified.filter((loop) => loop.depth === 0)
    : islandDetection === "outer" ? classified.filter((loop) => loop.depth <= 1) : classified;
  return {
    loops: selected.map(({ vertices, depth }) => ({ vertices, isHole: islandDetection === "ignore" ? false : depth % 2 === 1 })),
    depths: classified.map(({ depth }) => depth),
  };
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
  islandDetection?: HatchIslandDetection;
}

export interface HatchEditPatch {
  boundaryHandles?: string[];
  pattern?: string;
  angleRad?: number;
  scale?: number;
  origin?: CadPoint2;
  associative?: boolean;
  islandDetection?: HatchIslandDetection;
}

export type HatchCapability =
  | { executable: true; code: "ready" }
  | { executable: false; code: "missing-hatch" | "locked-layer" | "off-layer" | "frozen-layer" | "orphan-boundary"; handle: string };

function normalizedHandle(handle: string): string { return handle.toLocaleUpperCase("en-US"); }

function layerFailure(document: KDrawDocumentV1, layerId: string): Exclude<HatchCapability, { executable: true }> | null {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${layerId}.`);
  if (layer.locked) return { executable: false, code: "locked-layer", handle: layerId };
  if (!layer.visible) return { executable: false, code: "off-layer", handle: layerId };
  if (layer.frozen) return { executable: false, code: "frozen-layer", handle: layerId };
  return null;
}

function assertParticipatingLayer(document: KDrawDocumentV1, layerId: string, label: string): void {
  const failure = layerFailure(document, layerId);
  if (failure) throw new RangeError(`${label} is on ${failure.code.replace("-layer", "")} layer: ${layerId}.`);
}

function canonicalBoundaryHandles(document: KDrawDocumentV1, handles: readonly string[]): string[] {
  const normalized = new Set<string>();
  const result: string[] = [];
  for (const rawHandle of handles) {
    if (typeof rawHandle !== "string" || !rawHandle.trim()) throw new TypeError("HATCH boundary handles must be non-empty strings.");
    const key = normalizedHandle(rawHandle.trim());
    if (normalized.has(key)) continue;
    const boundary = document.entities.find((entity) => normalizedHandle(entity.handle) === key);
    if (!boundary) throw new RangeError(`HATCH boundary must be a closed non-degenerate polyline: ${rawHandle}.`);
    normalized.add(key);
    result.push(boundary.handle);
  }
  return result;
}

function validateIslandDetection(value: HatchIslandDetection): HatchIslandDetection {
  if (!(["normal", "outer", "ignore"] as const).includes(value)) throw new RangeError("HATCH island detection is unsupported.");
  return value;
}

export function createHatch(document: KDrawDocumentV1, args: HatchArgs): CadHatch {
  if (typeof args.handle !== "string" || !args.handle.trim() || [...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => normalizedHandle(entity.handle) === normalizedHandle(args.handle))) throw new RangeError(`Invalid or duplicate hatch handle: ${args.handle}.`);
  assertParticipatingLayer(document, args.layerId, "HATCH target");
  if (!Array.isArray(args.boundaryHandles)) throw new TypeError("HATCH boundary handles are required.");
  const boundaryHandles = canonicalBoundaryHandles(document, args.boundaryHandles);
  if (!boundaryHandles.length) throw new RangeError("HATCH requires at least one boundary.");
  const paths = boundaryHandles.map((handle) => {
    const boundary = document.entities.find((entity) => entity.handle === handle)!;
    assertParticipatingLayer(document, boundary.layerId, `HATCH boundary ${handle}`);
    const vertices = boundary ? boundaryVertices(boundary) : null;
    if (!vertices) throw new RangeError(`HATCH boundary must be a closed non-degenerate polyline: ${handle}.`);
    return vertices;
  });
  const scale = args.scale === undefined ? 1 : args.scale;
  const angleRad = args.angleRad === undefined ? 0 : args.angleRad;
  const origin = args.origin === undefined ? { x: 0, y: 0 } : args.origin;
  const associative = args.associative === undefined ? true : args.associative;
  const islandDetection = validateIslandDetection(args.islandDetection === undefined ? "normal" : args.islandDetection);
  if (typeof args.pattern !== "string" || !args.pattern.trim() || !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(angleRad) || typeof associative !== "boolean" || typeof origin !== "object" || origin === null || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw new RangeError("HATCH pattern settings must be finite and valid.");
  const classified = classifyLoops(paths, islandDetection);
  const entity: CadHatch = {
    kind: "hatch", handle: args.handle, layerId: args.layerId, pattern: args.pattern,
    associative, loops: classified.loops,
  };
  return withAnnotationExtension(entity, {
    kind: "hatch",
    version: 2,
    islandDetection,
    pattern: { type: args.pattern.trim().toUpperCase() === "SOLID" ? "solid" : "line", angleRad, scale, origin: structuredClone(origin) },
    boundaryHandles,
    boundaryDepths: classified.depths,
    boundaryVertices: paths.map((path) => structuredClone(path.vertices) as CadPolylineVertex[]),
  });
}

export function editHatch(document: KDrawDocumentV1, handle: string, patch: HatchEditPatch): EntityChange {
  const entity = document.entities.find((candidate) => normalizedHandle(candidate.handle) === normalizedHandle(handle));
  if (!entity || entity.kind !== "hatch") throw new RangeError(`Unknown HATCH: ${handle}.`);
  assertParticipatingLayer(document, entity.layerId, `HATCH ${entity.handle}`);
  const contract = readHatchAssociation(entity);
  if (!contract) throw new TypeError(`Malformed HATCH contract: ${entity.handle}.`);
  const without = { ...document, entities: document.entities.filter((candidate) => candidate !== entity) };
  const replacement = createHatch(without, {
    handle: entity.handle,
    layerId: entity.layerId,
    boundaryHandles: patch.boundaryHandles === undefined ? contract.boundaryHandles : patch.boundaryHandles,
    pattern: patch.pattern === undefined ? entity.pattern : patch.pattern,
    angleRad: patch.angleRad === undefined ? contract.pattern.angleRad : patch.angleRad,
    scale: patch.scale === undefined ? contract.pattern.scale : patch.scale,
    origin: patch.origin === undefined ? contract.pattern.origin : patch.origin,
    associative: patch.associative === undefined ? entity.associative : patch.associative,
    islandDetection: patch.islandDetection === undefined ? contract.islandDetection : patch.islandDetection,
  });
  return { type: "put", entity: {
    ...replacement,
    ...(entity.appearance ? { appearance: structuredClone(entity.appearance) } : {}),
    extensionData: { ...structuredClone(entity.extensionData ?? {}), ...structuredClone(replacement.extensionData ?? {}) },
  } };
}

export interface HatchUpdateResult {
  changes: EntityChange[];
  updatedHandles: string[];
  broken: Array<{ hatchHandle: string; boundaryHandle: string; reason: "missing-boundary" | "invalid-boundary" }>;
}

export function updateAssociativeHatches(document: KDrawDocumentV1, changedHandles: readonly string[]): HatchUpdateResult {
  const changed = new Set(changedHandles.map(normalizedHandle));
  const changes: EntityChange[] = [];
  const updatedHandles: string[] = [];
  const broken: HatchUpdateResult["broken"] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "hatch" || !entity.associative) continue;
    const association = readHatchAssociation(entity);
    if (!association) throw new TypeError(`Malformed associative HATCH contract: ${entity.handle}.`);
    if (!association.boundaryHandles.some((handle) => changed.has(normalizedHandle(handle)))) continue;
    assertParticipatingLayer(document, entity.layerId, `Associative HATCH ${entity.handle}`);
    const paths: BoundaryPath[] = [];
    for (const handle of association.boundaryHandles) {
      const boundary = document.entities.find((candidate) => normalizedHandle(candidate.handle) === normalizedHandle(handle));
      if (boundary) assertParticipatingLayer(document, boundary.layerId, `HATCH boundary ${boundary.handle}`);
      const vertices = boundary ? boundaryVertices(boundary) : null;
      if (!vertices) broken.push({ hatchHandle: entity.handle, boundaryHandle: handle, reason: boundary ? "invalid-boundary" : "missing-boundary" });
      else paths.push(vertices);
    }
    if (paths.length !== association.boundaryHandles.length) continue;
    const classified = classifyLoops(paths, association.islandDetection);
    const loops = classified.loops;
    const snapshotBoundaryVertices = paths.map((path) => structuredClone(path.vertices) as CadPolylineVertex[]);
    const topologyChanged = JSON.stringify(classified.depths) !== JSON.stringify(association.boundaryDepths)
      || JSON.stringify(snapshotBoundaryVertices) !== JSON.stringify(association.boundaryVertices);
    if (JSON.stringify(loops) !== JSON.stringify(entity.loops) || topologyChanged) {
      changes.push({ type: "put", entity: withAnnotationExtension({ ...structuredClone(entity), loops }, {
        ...association,
        version: 2,
        boundaryDepths: classified.depths,
        boundaryVertices: snapshotBoundaryVertices,
      }) });
      updatedHandles.push(entity.handle);
    }
  }
  return { changes, updatedHandles, broken };
}

export function evaluateHatchCapability(document: KDrawDocumentV1, hatchHandle: string): HatchCapability {
  const entity = document.entities.find((candidate) => normalizedHandle(candidate.handle) === normalizedHandle(hatchHandle));
  if (!entity || entity.kind !== "hatch") return { executable: false, code: "missing-hatch", handle: hatchHandle };
  const targetLayerFailure = layerFailure(document, entity.layerId);
  if (targetLayerFailure) return targetLayerFailure;
  const association = readHatchAssociation(entity);
  if (entity.associative && !association) return { executable: false, code: "orphan-boundary", handle: "$association" };
  if (entity.associative && association) {
    for (const handle of association.boundaryHandles) {
      const boundary = document.entities.find((candidate) => normalizedHandle(candidate.handle) === normalizedHandle(handle));
      if (!boundary || boundaryVertices(boundary) === null) return { executable: false, code: "orphan-boundary", handle };
      const boundaryLayerFailure = layerFailure(document, boundary.layerId);
      if (boundaryLayerFailure) return boundaryLayerFailure;
    }
  }
  return { executable: true, code: "ready" };
}

export function hatchBoundaryPolyline(handle: string, layerId: string, vertices: CadPolylineVertex[]): CadPolyline {
  if (vertices.length < 3) throw new RangeError("Boundary requires at least three vertices.");
  return { kind: "polyline", handle, layerId, closed: true, vertices: vertices.map((point) => ({ ...point })) };
}

export * from "./table.js";
