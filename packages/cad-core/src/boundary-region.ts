import type {
  CadAppearance,
  CadArc,
  CadCircle,
  CadEntity,
  CadPoint2,
  CadPolyline,
  CadPolylineVertex,
  CadProxyEntity,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const ARC_STEP = Math.PI / 32;

export type BoundaryRegionInputErrorCode =
  | "INVALID_INPUT"
  | "ENTITY_NOT_FOUND"
  | "LAYER_NOT_FOUND"
  | "LAYER_LOCKED"
  | "LAYER_HIDDEN"
  | "UNSUPPORTED_ENTITY"
  | "NON_FINITE_GEOMETRY"
  | "OPEN_BOUNDARY"
  | "SELF_INTERSECTION"
  | "CROSSING_INTERSECTION"
  | "AMBIGUOUS_TOPOLOGY"
  | "SEED_OUTSIDE"
  | "HANDLE_COLLISION";

export class BoundaryRegionInputError extends Error {
  constructor(public readonly code: BoundaryRegionInputErrorCode, message: string) {
    super(message);
    this.name = "BoundaryRegionInputError";
  }
}

export interface BoundaryLoop {
  vertices: CadPolylineVertex[];
  sourceHandles: string[];
  signedArea: number;
  nestingDepth: number;
  isIsland: boolean;
}

export interface BoundaryCommandInput {
  handle: string;
  layerId: string;
  seedPoint: CadPoint2;
  sourceHandles?: readonly string[];
  gapTolerance?: number;
  islandDetection?: boolean;
  output: "polyline" | "region";
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface PreparedBoundaryCommand {
  commandId: "BOUNDARY";
  changes: EntityChange[];
  targetHandles: string[];
  resultHandles: string[];
  loops: BoundaryLoop[];
  entity: CadPolyline | CadProxyEntity;
}

export interface RegionCommandInput {
  targetHandles: readonly string[];
  /** One deterministic result handle for every closed loop discovered. */
  resultHandles: readonly string[];
  /** AutoCAD REGION deletes source curves by default. */
  deleteSource?: boolean;
}

export interface PreparedRegionCommand {
  commandId: "REGION";
  changes: EntityChange[];
  targetHandles: string[];
  resultHandles: string[];
  entities: CadProxyEntity[];
  /** Retained for adapter compatibility. Fail-closed preparation never returns partial rejects. */
  rejected: [];
}

interface BoundaryEdge {
  start: CadPoint2;
  end: CadPoint2;
  bulge: number;
  handle: string;
}

interface RawLoop {
  vertices: CadPolylineVertex[];
  sourceHandles: string[];
}

interface CollectedGeometry {
  loops: RawLoop[];
  edges: BoundaryEdge[];
}

function fail(code: BoundaryRegionInputErrorCode, message: string): never {
  throw new BoundaryRegionInputError(code, message);
}

function finitePoint(point: CadPoint2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!finitePoint(point)) fail("NON_FINITE_GEOMETRY", `${label} must be finite.`);
}

function assertHandle(handle: string, label: string): void {
  if (handle.trim() === "") fail("INVALID_INPUT", `${label} is required.`);
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function compareNumber(first: number, second: number): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function comparePoint(first: CadPoint2, second: CadPoint2): number {
  return compareNumber(first.x, second.x) || compareNumber(first.y, second.y);
}

function normalizedAngle(angle: number): number {
  const turn = Math.PI * 2;
  const value = angle % turn;
  return value < 0 ? value + turn : value;
}

function arcSweep(arc: CadArc): number {
  return arc.counterClockwise
    ? normalizedAngle(arc.endAngleRad - arc.startAngleRad)
    : -normalizedAngle(arc.startAngleRad - arc.endAngleRad);
}

function arcEdge(arc: CadArc): BoundaryEdge {
  if (!finitePoint(arc.center) || !Number.isFinite(arc.radius) || arc.radius <= EPSILON
    || !Number.isFinite(arc.startAngleRad) || !Number.isFinite(arc.endAngleRad)) {
    fail("NON_FINITE_GEOMETRY", `REGION/BOUNDARY ARC ${arc.handle} has invalid geometry.`);
  }
  const sweep = arcSweep(arc);
  if (!Number.isFinite(sweep) || Math.abs(sweep) <= EPSILON || Math.abs(sweep) >= Math.PI * 2 - EPSILON) {
    fail("OPEN_BOUNDARY", `REGION/BOUNDARY ARC ${arc.handle} must be a non-degenerate open arc.`);
  }
  return {
    handle: arc.handle,
    start: { x: arc.center.x + arc.radius * Math.cos(arc.startAngleRad), y: arc.center.y + arc.radius * Math.sin(arc.startAngleRad) },
    end: { x: arc.center.x + arc.radius * Math.cos(arc.endAngleRad), y: arc.center.y + arc.radius * Math.sin(arc.endAngleRad) },
    bulge: Math.tan(sweep / 4),
  };
}

function circleLoop(circle: CadCircle): RawLoop {
  if (!finitePoint(circle.center) || !Number.isFinite(circle.radius) || circle.radius <= EPSILON) {
    fail("NON_FINITE_GEOMETRY", `REGION/BOUNDARY CIRCLE ${circle.handle} has invalid geometry.`);
  }
  const bulge = Math.tan(Math.PI / 8);
  return {
    sourceHandles: [circle.handle],
    vertices: [
      { x: circle.center.x + circle.radius, y: circle.center.y, bulge },
      { x: circle.center.x, y: circle.center.y + circle.radius, bulge },
      { x: circle.center.x - circle.radius, y: circle.center.y, bulge },
      { x: circle.center.x, y: circle.center.y - circle.radius, bulge },
    ],
  };
}

function validatePolyline(entity: CadPolyline): void {
  if (entity.vertices.length < 2) fail("OPEN_BOUNDARY", `REGION/BOUNDARY polyline ${entity.handle} has too few vertices.`);
  entity.vertices.forEach((vertex, index) => {
    if (!finitePoint(vertex) || (vertex.bulge !== undefined && !Number.isFinite(vertex.bulge))
      || (vertex.startWidth !== undefined && (!Number.isFinite(vertex.startWidth) || vertex.startWidth < 0))
      || (vertex.endWidth !== undefined && (!Number.isFinite(vertex.endWidth) || vertex.endWidth < 0))) {
      fail("NON_FINITE_GEOMETRY", `REGION/BOUNDARY polyline ${entity.handle} vertex ${index} is invalid.`);
    }
    const next = entity.vertices[(index + 1) % entity.vertices.length];
    if (next && (entity.closed || index < entity.vertices.length - 1) && distance(vertex, next) <= EPSILON) {
      fail("AMBIGUOUS_TOPOLOGY", `REGION/BOUNDARY polyline ${entity.handle} contains a collapsed segment.`);
    }
  });
  if (entity.closed && entity.vertices.length < 3
    && !(entity.vertices.length === 2 && entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > EPSILON))) {
    fail("OPEN_BOUNDARY", `REGION/BOUNDARY polyline ${entity.handle} is not a valid closed loop.`);
  }
}

function entityGeometry(entity: CadEntity): CollectedGeometry {
  if (entity.kind === "circle") return { loops: [circleLoop(entity)], edges: [] };
  if (entity.kind === "arc") return { loops: [], edges: [arcEdge(entity)] };
  if (entity.kind === "line") {
    if (!finitePoint(entity.start) || !finitePoint(entity.end)) fail("NON_FINITE_GEOMETRY", `REGION/BOUNDARY LINE ${entity.handle} has invalid geometry.`);
    if (distance(entity.start, entity.end) <= EPSILON) fail("AMBIGUOUS_TOPOLOGY", `REGION/BOUNDARY LINE ${entity.handle} is degenerate.`);
    return { loops: [], edges: [{ start: { ...entity.start }, end: { ...entity.end }, bulge: 0, handle: entity.handle }] };
  }
  if (entity.kind === "polyline") {
    validatePolyline(entity);
    if (entity.closed) {
      return {
        loops: [{
          vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, ...(Math.abs(vertex.bulge ?? 0) > EPSILON ? { bulge: vertex.bulge } : {}) })),
          sourceHandles: [entity.handle],
        }],
        edges: [],
      };
    }
    return {
      loops: [],
      edges: entity.vertices.slice(0, -1).map((vertex, index) => ({
        start: { x: vertex.x, y: vertex.y },
        end: { x: entity.vertices[index + 1]!.x, y: entity.vertices[index + 1]!.y },
        bulge: vertex.bulge ?? 0,
        handle: entity.handle,
      })),
    };
  }
  fail("UNSUPPORTED_ENTITY", `REGION/BOUNDARY does not support ${entity.kind} ${entity.handle} in this 2D lane.`);
}

function assertEditableLayer(document: KDrawDocumentV1, entity: CadEntity): void {
  const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
  if (!layer) fail("LAYER_NOT_FOUND", `REGION/BOUNDARY source ${entity.handle} references missing layer ${entity.layerId}.`);
  if (layer.locked) fail("LAYER_LOCKED", `REGION/BOUNDARY source ${entity.handle} is on a locked layer.`);
  if (!layer.visible || layer.frozen) fail("LAYER_HIDDEN", `REGION/BOUNDARY source ${entity.handle} is on an off or frozen layer.`);
}

function collectExplicit(document: KDrawDocumentV1, handles: readonly string[]): { geometry: CollectedGeometry; entities: Map<string, CadEntity> } {
  const unique = [...new Set(handles)];
  if (unique.length === 0) fail("INVALID_INPUT", "REGION/BOUNDARY requires at least one source handle.");
  const geometry: CollectedGeometry = { loops: [], edges: [] };
  const entities = new Map<string, CadEntity>();
  for (const handle of unique) {
    assertHandle(handle, "REGION/BOUNDARY source handle");
    const entity = document.entities.find((candidate) => candidate.handle === handle);
    if (!entity) fail("ENTITY_NOT_FOUND", `REGION/BOUNDARY source ${handle} does not exist.`);
    assertEditableLayer(document, entity);
    const item = entityGeometry(entity);
    geometry.loops.push(...item.loops);
    geometry.edges.push(...item.edges);
    entities.set(handle, entity);
  }
  return { geometry, entities };
}

function collectImplicit(document: KDrawDocumentV1): { geometry: CollectedGeometry; entities: Map<string, CadEntity> } {
  const supported = document.entities.filter((entity) => entity.kind === "line" || entity.kind === "arc" || entity.kind === "circle" || entity.kind === "polyline");
  const eligible = supported.filter((entity) => {
    const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
    return Boolean(layer && layer.visible && !layer.frozen && !layer.locked);
  });
  const geometry: CollectedGeometry = { loops: [], edges: [] };
  const entities = new Map<string, CadEntity>();
  for (const entity of eligible) {
    const item = entityGeometry(entity);
    geometry.loops.push(...item.loops);
    geometry.edges.push(...item.edges);
    entities.set(entity.handle, entity);
  }
  return { geometry, entities };
}

function reverseEdge(edge: BoundaryEdge): BoundaryEdge {
  return { ...edge, start: { ...edge.end }, end: { ...edge.start }, bulge: -edge.bulge };
}

function edgeKey(edge: BoundaryEdge): string {
  const [first, second] = comparePoint(edge.start, edge.end) <= 0 ? [edge.start, edge.end] : [edge.end, edge.start];
  return [first.x, first.y, second.x, second.y, edge.handle, Math.abs(edge.bulge)].map((value) => typeof value === "number" ? value.toPrecision(17) : value).join("|");
}

function loopFromEdges(edges: readonly BoundaryEdge[]): RawLoop {
  return {
    sourceHandles: [...new Set(edges.map((edge) => edge.handle))].sort(),
    vertices: edges.map((edge, index) => ({
      ...(index === 0 ? edge.start : edges[index - 1]!.end),
      ...(Math.abs(edge.bulge) > EPSILON ? { bulge: edge.bulge } : {}),
    })),
  };
}

function stitchLoops(edges: readonly BoundaryEdge[], tolerance: number, failOnOpen: boolean): RawLoop[] {
  const ordered = edges.map((edge) => structuredClone(edge)).sort((first, second) => edgeKey(first).localeCompare(edgeKey(second), "en-US"));
  const unused = new Set(ordered.map((_edge, index) => index));
  const loops: RawLoop[] = [];
  while (unused.size > 0) {
    const firstIndex = [...unused].sort((first, second) => first - second)[0]!;
    unused.delete(firstIndex);
    const seed = ordered[firstIndex]!;
    const chain = [comparePoint(seed.start, seed.end) <= 0 ? seed : reverseEdge(seed)];
    let closed = false;
    for (let guard = 0; guard <= ordered.length; guard += 1) {
      const end = chain.at(-1)!.end;
      const closes = distance(end, chain[0]!.start) <= tolerance + EPSILON;
      const matches = [...unused].flatMap((index) => {
        const candidate = ordered[index]!;
        const result: Array<{ index: number; edge: BoundaryEdge; gap: number }> = [];
        const startGap = distance(end, candidate.start);
        const endGap = distance(end, candidate.end);
        if (startGap <= tolerance + EPSILON) result.push({ index, edge: candidate, gap: startGap });
        if (endGap <= tolerance + EPSILON) result.push({ index, edge: reverseEdge(candidate), gap: endGap });
        return result;
      }).sort((first, second) => first.gap - second.gap || edgeKey(first.edge).localeCompare(edgeKey(second.edge), "en-US"));
      const distinct = matches.filter((match, index) => index === 0 || match.index !== matches[index - 1]!.index);
      if (closes) {
        if (distinct.length > 0) fail("AMBIGUOUS_TOPOLOGY", "REGION/BOUNDARY has more than two curves sharing a loop endpoint.");
        closed = true;
        break;
      }
      if (distinct.length === 0) break;
      if (distinct.length > 1) fail("AMBIGUOUS_TOPOLOGY", "REGION/BOUNDARY has an ambiguous branching endpoint.");
      const next = distinct[0]!;
      unused.delete(next.index);
      chain.push(next.edge);
    }
    if (!closed) {
      if (failOnOpen) fail("OPEN_BOUNDARY", `REGION/BOUNDARY source chain containing ${chain.map((edge) => edge.handle).join(", ")} is open.`);
      continue;
    }
    const loop = loopFromEdges(chain);
    if (loop.vertices.length < 2) fail("OPEN_BOUNDARY", "REGION/BOUNDARY produced an invalid loop.");
    loops.push(loop);
  }
  return loops;
}

function bulgeArc(start: CadPoint2, end: CadPoint2, bulge: number): { center: CadPoint2; radius: number; startAngle: number; sweep: number } {
  const chord = distance(start, end);
  if (chord <= EPSILON || !Number.isFinite(bulge) || Math.abs(bulge) <= EPSILON) fail("AMBIGUOUS_TOPOLOGY", "REGION/BOUNDARY has an invalid bulged segment.");
  const offset = chord * (1 - bulge * bulge) / (4 * bulge);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const center = { x: (start.x + end.x) / 2 - dy / chord * offset, y: (start.y + end.y) / 2 + dx / chord * offset };
  return {
    center,
    radius: chord * (1 + bulge * bulge) / (4 * Math.abs(bulge)),
    startAngle: Math.atan2(start.y - center.y, start.x - center.x),
    sweep: 4 * Math.atan(bulge),
  };
}

function flattenLoop(vertices: readonly CadPolylineVertex[]): CadPoint2[] {
  const points: CadPoint2[] = [];
  vertices.forEach((start, index) => {
    const end = vertices[(index + 1) % vertices.length]!;
    points.push({ x: start.x, y: start.y });
    const bulge = start.bulge ?? 0;
    if (Math.abs(bulge) <= EPSILON) return;
    const arc = bulgeArc(start, end, bulge);
    const steps = Math.max(2, Math.ceil(Math.abs(arc.sweep) / ARC_STEP));
    for (let step = 1; step < steps; step += 1) {
      const angle = arc.startAngle + arc.sweep * step / steps;
      points.push({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });
    }
  });
  return points;
}

function signedArea(vertices: readonly CadPolylineVertex[]): number {
  let area = 0;
  vertices.forEach((start, index) => {
    const end = vertices[(index + 1) % vertices.length]!;
    area += (start.x * end.y - end.x * start.y) / 2;
    const bulge = start.bulge ?? 0;
    if (Math.abs(bulge) > EPSILON) {
      const arc = bulgeArc(start, end, bulge);
      area += arc.radius * arc.radius * (arc.sweep - Math.sin(arc.sweep)) / 2;
    }
  });
  return area;
}

function orientation(first: CadPoint2, second: CadPoint2, third: CadPoint2): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function onSegment(first: CadPoint2, second: CadPoint2, point: CadPoint2): boolean {
  return Math.abs(orientation(first, second, point)) <= EPSILON
    && point.x >= Math.min(first.x, second.x) - EPSILON && point.x <= Math.max(first.x, second.x) + EPSILON
    && point.y >= Math.min(first.y, second.y) - EPSILON && point.y <= Math.max(first.y, second.y) + EPSILON;
}

function segmentsIntersect(firstStart: CadPoint2, firstEnd: CadPoint2, secondStart: CadPoint2, secondEnd: CadPoint2): boolean {
  const a = orientation(firstStart, firstEnd, secondStart);
  const b = orientation(firstStart, firstEnd, secondEnd);
  const c = orientation(secondStart, secondEnd, firstStart);
  const d = orientation(secondStart, secondEnd, firstEnd);
  if (((a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON))
    && ((c > EPSILON && d < -EPSILON) || (c < -EPSILON && d > EPSILON))) return true;
  return (Math.abs(a) <= EPSILON && onSegment(firstStart, firstEnd, secondStart))
    || (Math.abs(b) <= EPSILON && onSegment(firstStart, firstEnd, secondEnd))
    || (Math.abs(c) <= EPSILON && onSegment(secondStart, secondEnd, firstStart))
    || (Math.abs(d) <= EPSILON && onSegment(secondStart, secondEnd, firstEnd));
}

function loopSelfIntersects(vertices: readonly CadPolylineVertex[]): boolean {
  const points = flattenLoop(vertices);
  for (let first = 0; first < points.length; first += 1) {
    const firstEnd = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondEnd = (second + 1) % points.length;
      if (first === second || firstEnd === second || secondEnd === first) continue;
      if (segmentsIntersect(points[first]!, points[firstEnd]!, points[second]!, points[secondEnd]!)) return true;
    }
  }
  return false;
}

function loopsIntersect(first: readonly CadPolylineVertex[], second: readonly CadPolylineVertex[]): boolean {
  const firstPoints = flattenLoop(first);
  const secondPoints = flattenLoop(second);
  return firstPoints.some((start, firstIndex) => secondPoints.some((other, secondIndex) => (
    segmentsIntersect(start, firstPoints[(firstIndex + 1) % firstPoints.length]!, other, secondPoints[(secondIndex + 1) % secondPoints.length]!)
  )));
}

function pointOnLoop(point: CadPoint2, vertices: readonly CadPolylineVertex[]): boolean {
  const flattened = flattenLoop(vertices);
  return flattened.some((start, index) => onSegment(start, flattened[(index + 1) % flattened.length]!, point));
}

function pointInLoop(point: CadPoint2, vertices: readonly CadPolylineVertex[]): boolean {
  if (pointOnLoop(point, vertices)) return false;
  const flattened = flattenLoop(vertices);
  let inside = false;
  for (let index = 0, previous = flattened.length - 1; index < flattened.length; previous = index, index += 1) {
    const first = flattened[index]!;
    const second = flattened[previous]!;
    if ((first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x) inside = !inside;
  }
  return inside;
}

function reverseClosed(vertices: readonly CadPolylineVertex[]): CadPolylineVertex[] {
  const reversed = [...vertices].reverse();
  return reversed.map((vertex, index) => {
    const sourceSegment = vertices[(vertices.length - 2 - index + vertices.length) % vertices.length]!;
    return { x: vertex.x, y: vertex.y, ...(Math.abs(sourceSegment.bulge ?? 0) > EPSILON ? { bulge: -(sourceSegment.bulge ?? 0) } : {}) };
  });
}

function canonicalRotation(vertices: readonly CadPolylineVertex[]): CadPolylineVertex[] {
  let best = 0;
  for (let index = 1; index < vertices.length; index += 1) {
    const pointOrder = comparePoint(vertices[index]!, vertices[best]!);
    if (pointOrder < 0 || (pointOrder === 0 && compareNumber(vertices[index]!.bulge ?? 0, vertices[best]!.bulge ?? 0) < 0)) best = index;
  }
  return [...vertices.slice(best), ...vertices.slice(0, best)].map((vertex) => structuredClone(vertex));
}

function normalizeLoop(loop: RawLoop, clockwise: boolean): RawLoop {
  const area = signedArea(loop.vertices);
  if (!Number.isFinite(area) || Math.abs(area) <= EPSILON) fail("AMBIGUOUS_TOPOLOGY", `REGION/BOUNDARY loop ${loop.sourceHandles.join(", ")} has zero area.`);
  const vertices = (clockwise ? area > 0 : area < 0) ? reverseClosed(loop.vertices) : loop.vertices;
  return { vertices: canonicalRotation(vertices), sourceHandles: [...new Set(loop.sourceHandles)].sort() };
}

function classifyLoops(rawLoops: readonly RawLoop[]): BoundaryLoop[] {
  rawLoops.forEach((loop) => {
    if (loopSelfIntersects(loop.vertices)) fail("SELF_INTERSECTION", `REGION/BOUNDARY loop ${loop.sourceHandles.join(", ")} self-intersects.`);
  });
  const checked = rawLoops.map((loop) => normalizeLoop(loop, false));
  for (let first = 0; first < checked.length; first += 1) {
    for (let second = first + 1; second < checked.length; second += 1) {
      if (loopsIntersect(checked[first]!.vertices, checked[second]!.vertices)) {
        fail("CROSSING_INTERSECTION", `REGION/BOUNDARY loops ${checked[first]!.sourceHandles.join(", ")} and ${checked[second]!.sourceHandles.join(", ")} intersect.`);
      }
    }
  }
  const withDepth = checked.map((loop) => {
    const probe = loop.vertices[0]!;
    const nestingDepth = checked.filter((candidate) => candidate !== loop && Math.abs(signedArea(candidate.vertices)) > Math.abs(signedArea(loop.vertices))
      && pointInLoop(probe, candidate.vertices)).length;
    const normalized = normalizeLoop(loop, nestingDepth % 2 === 1);
    const area = signedArea(normalized.vertices);
    return { ...normalized, signedArea: area, nestingDepth, isIsland: nestingDepth % 2 === 1 };
  });
  return withDepth.sort((first, second) => first.nestingDepth - second.nestingDepth
    || Math.abs(second.signedArea) - Math.abs(first.signedArea)
    || first.sourceHandles.join("|").localeCompare(second.sourceHandles.join("|"), "en-US")
    || JSON.stringify(first.vertices).localeCompare(JSON.stringify(second.vertices), "en-US"));
}

function relativeBoundaryLoops(loops: readonly BoundaryLoop[], outer: BoundaryLoop): BoundaryLoop[] {
  const selected = loops.filter((loop) => loop === outer || pointInLoop(loop.vertices[0]!, outer.vertices));
  return classifyLoops(selected.map((loop) => ({ vertices: loop.vertices, sourceHandles: loop.sourceHandles })));
}

function loopBounds(loops: readonly BoundaryLoop[]): { min: CadPoint2; max: CadPoint2 } {
  const points = loops.flatMap((loop) => flattenLoop(loop.vertices));
  return {
    min: { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)) },
    max: { x: Math.max(...points.map((point) => point.x)), y: Math.max(...points.map((point) => point.y)) },
  };
}

function styleSource(entities: ReadonlyMap<string, CadEntity>, loop: BoundaryLoop): CadEntity | undefined {
  return loop.sourceHandles.map((handle) => entities.get(handle)).filter((entity): entity is CadEntity => Boolean(entity))
    .sort((first, second) => first.handle.localeCompare(second.handle, "en-US"))[0];
}

function regionEntity(handle: string, layerId: string, loops: readonly BoundaryLoop[], sourceKind: "BOUNDARY" | "REGION", source?: CadEntity, appearance?: CadAppearance, extensionData?: Record<string, unknown>): CadProxyEntity {
  const resolvedAppearance = appearance ?? source?.appearance;
  const resolvedExtensionData = extensionData ?? source?.extensionData;
  return {
    kind: "proxy",
    handle,
    layerId,
    originalType: "ACDBREGION",
    ...(resolvedAppearance ? { appearance: structuredClone(resolvedAppearance) } : {}),
    ...(resolvedExtensionData ? { extensionData: structuredClone(resolvedExtensionData) } : {}),
    raw: {
      schema: "kuubik-region-v2",
      sourceKind,
      loops: structuredClone(loops.map((loop) => ({
        vertices: loop.vertices,
        sourceHandles: loop.sourceHandles,
        signedArea: loop.signedArea,
        nestingDepth: loop.nestingDepth,
        isIsland: loop.isIsland,
      }))),
    },
    bounds: loopBounds(loops),
  };
}

function assertTargetLayer(document: KDrawDocumentV1, layerId: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) fail("LAYER_NOT_FOUND", `REGION/BOUNDARY result layer ${layerId} does not exist.`);
  if (layer.locked) fail("LAYER_LOCKED", `REGION/BOUNDARY result layer ${layerId} is locked.`);
  if (!layer.visible || layer.frozen) fail("LAYER_HIDDEN", `REGION/BOUNDARY result layer ${layerId} is off or frozen.`);
}

function assertAvailableResultHandles(document: KDrawDocumentV1, handles: readonly string[], replaceable: ReadonlySet<string> = new Set()): void {
  if (handles.length === 0 || new Set(handles).size !== handles.length) fail("INVALID_INPUT", "REGION/BOUNDARY result handles must be present and unique.");
  handles.forEach((handle) => {
    assertHandle(handle, "REGION/BOUNDARY result handle");
    if (document.entities.some((entity) => entity.handle === handle) && !replaceable.has(handle)) {
      fail("HANDLE_COLLISION", `REGION/BOUNDARY result handle ${handle} already exists.`);
    }
  });
}

export function prepareBoundaryCommand(document: KDrawDocumentV1, input: BoundaryCommandInput): PreparedBoundaryCommand {
  assertPoint(input.seedPoint, "BOUNDARY seed point");
  assertHandle(input.handle, "BOUNDARY result handle");
  assertHandle(input.layerId, "BOUNDARY result layer");
  assertTargetLayer(document, input.layerId);
  assertAvailableResultHandles(document, [input.handle]);
  const tolerance = input.gapTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) fail("INVALID_INPUT", "BOUNDARY gap tolerance must be finite and non-negative.");
  const explicit = input.sourceHandles !== undefined;
  const collected = explicit ? collectExplicit(document, input.sourceHandles!) : collectImplicit(document);
  const rawLoops = [...collected.geometry.loops, ...stitchLoops(collected.geometry.edges, tolerance, explicit)];
  const loops = classifyLoops(rawLoops);
  const containing = loops.filter((loop) => pointInLoop(input.seedPoint, loop.vertices))
    .sort((first, second) => Math.abs(first.signedArea) - Math.abs(second.signedArea)
      || first.sourceHandles.join("|").localeCompare(second.sourceHandles.join("|"), "en-US"));
  if (containing.length === 0) fail("SEED_OUTSIDE", "BOUNDARY could not find a closed loop strictly containing the seed point.");
  const outer = containing[0]!;
  const selectedLoops = input.islandDetection ? relativeBoundaryLoops(loops, outer) : classifyLoops([{ vertices: outer.vertices, sourceHandles: outer.sourceHandles }]);
  const source = styleSource(collected.entities, selectedLoops[0]!);
  const resolvedAppearance = input.appearance ?? source?.appearance;
  const resolvedExtensionData = input.extensionData ?? source?.extensionData;
  const entity: CadPolyline | CadProxyEntity = input.output === "polyline"
    ? {
      kind: "polyline",
      handle: input.handle,
      layerId: input.layerId,
      closed: true,
      vertices: structuredClone(selectedLoops[0]!.vertices),
      ...(resolvedAppearance ? { appearance: structuredClone(resolvedAppearance) } : {}),
      ...(resolvedExtensionData ? { extensionData: structuredClone(resolvedExtensionData) } : {}),
    }
    : regionEntity(input.handle, input.layerId, selectedLoops, "BOUNDARY", source, input.appearance, input.extensionData);
  return {
    commandId: "BOUNDARY",
    changes: [{ type: "put", entity }],
    targetHandles: [...new Set(selectedLoops.flatMap((loop) => loop.sourceHandles))].sort(),
    resultHandles: [input.handle],
    loops: structuredClone(selectedLoops),
    entity: structuredClone(entity),
  };
}

export function prepareRegionCommand(document: KDrawDocumentV1, input: RegionCommandInput): PreparedRegionCommand {
  const targets = [...new Set(input.targetHandles)].sort((first, second) => first.localeCompare(second, "en-US"));
  const collected = collectExplicit(document, targets);
  const rawLoops = [...collected.geometry.loops, ...stitchLoops(collected.geometry.edges, 0, true)];
  const loops = classifyLoops(rawLoops);
  if (loops.length !== input.resultHandles.length) {
    fail("INVALID_INPUT", `REGION found ${loops.length} closed loop(s) but received ${input.resultHandles.length} result handle(s).`);
  }
  const deleteSource = input.deleteSource ?? true;
  assertAvailableResultHandles(document, input.resultHandles, deleteSource ? new Set(targets) : new Set());
  const entities = loops.map((loop, index) => {
    const source = styleSource(collected.entities, loop);
    if (!source) fail("ENTITY_NOT_FOUND", `REGION loop ${index + 1} has no source entity.`);
    return regionEntity(input.resultHandles[index]!, source.layerId, [loop], "REGION", source);
  });
  const changes: EntityChange[] = [
    ...(deleteSource ? targets.map((handle): EntityChange => ({ type: "delete", handle })) : []),
    ...entities.map((entity): EntityChange => ({ type: "put", entity })),
  ];
  return {
    commandId: "REGION",
    changes,
    targetHandles: targets,
    resultHandles: entities.map((entity) => entity.handle),
    entities: structuredClone(entities),
    rejected: [],
  };
}
