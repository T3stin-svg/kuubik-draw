import type { CadCircle, CadEllipse, CadEntity, CadPoint2, CadPolyline, CadProxyEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;

export class BoundaryRegionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundaryRegionInputError";
  }
}

interface BoundaryLoop {
  vertices: CadPoint2[];
  sourceHandles: string[];
}

export interface BoundaryCommandInput {
  handle: string;
  layerId: string;
  seedPoint: CadPoint2;
  sourceHandles?: readonly string[];
  gapTolerance?: number;
  islandDetection?: boolean;
  output: "polyline" | "region";
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
  resultHandles: readonly string[];
}

export interface PreparedRegionCommand {
  commandId: "REGION";
  changes: EntityChange[];
  targetHandles: string[];
  resultHandles: string[];
  entities: CadProxyEntity[];
  rejected: Array<{ handle: string; reason: "missing" | "locked-layer" | "not-closed-curve" }>;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new BoundaryRegionInputError(`${label} must be finite.`);
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function signedArea(vertices: readonly CadPoint2[]): number {
  return vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function pointInPolygon(point: CadPoint2, vertices: readonly CadPoint2[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const first = vertices[index]!; const second = vertices[previous]!;
    const intersects = (first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function circleLoop(circle: CadCircle): BoundaryLoop {
  return {
    sourceHandles: [circle.handle],
    vertices: Array.from({ length: 64 }, (_unused, index) => {
      const angle = index * Math.PI * 2 / 64;
      return { x: circle.center.x + circle.radius * Math.cos(angle), y: circle.center.y + circle.radius * Math.sin(angle) };
    }),
  };
}

function ellipseLoop(ellipse: CadEllipse): BoundaryLoop | null {
  const sweep = ellipse.endParameter - ellipse.startParameter;
  if (Math.abs(Math.abs(sweep) - Math.PI * 2) > 1e-6) return null;
  const minor = { x: -ellipse.majorAxis.y * ellipse.ratio, y: ellipse.majorAxis.x * ellipse.ratio };
  return {
    sourceHandles: [ellipse.handle],
    vertices: Array.from({ length: 64 }, (_unused, index) => {
      const angle = ellipse.startParameter + sweep * index / 64;
      return {
        x: ellipse.center.x + ellipse.majorAxis.x * Math.cos(angle) + minor.x * Math.sin(angle),
        y: ellipse.center.y + ellipse.majorAxis.y * Math.cos(angle) + minor.y * Math.sin(angle),
      };
    }),
  };
}

interface Segment {
  start: CadPoint2;
  end: CadPoint2;
  handle: string;
}

function sourceGeometry(entity: CadEntity): { loops: BoundaryLoop[]; segments: Segment[] } {
  if (entity.kind === "circle") return { loops: [circleLoop(entity)], segments: [] };
  if (entity.kind === "ellipse") {
    const loop = ellipseLoop(entity);
    return { loops: loop ? [loop] : [], segments: [] };
  }
  if (entity.kind === "line") return { loops: [], segments: [{ start: entity.start, end: entity.end, handle: entity.handle }] };
  if (entity.kind !== "polyline" || entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > EPSILON)) return { loops: [], segments: [] };
  if (entity.closed) return { loops: [{ vertices: entity.vertices.map(({ x, y }) => ({ x, y })), sourceHandles: [entity.handle] }], segments: [] };
  return {
    loops: [],
    segments: entity.vertices.slice(0, -1).map((vertex, index) => ({ start: vertex, end: entity.vertices[index + 1]!, handle: entity.handle })),
  };
}

function stitchLoops(segments: readonly Segment[], tolerance: number): BoundaryLoop[] {
  const unused = new Set(segments.map((_segment, index) => index));
  const loops: BoundaryLoop[] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);
    const first = segments[firstIndex]!;
    const vertices = [{ ...first.start }, { ...first.end }];
    const handles = new Set([first.handle]);
    let closed = false;
    while (unused.size > 0) {
      const end = vertices.at(-1)!;
      if (distance(end, vertices[0]!) <= tolerance + EPSILON) { vertices.pop(); closed = true; break; }
      let match: { index: number; point: CadPoint2; handle: string } | null = null;
      for (const index of unused) {
        const segment = segments[index]!;
        if (distance(end, segment.start) <= tolerance + EPSILON) { match = { index, point: segment.end, handle: segment.handle }; break; }
        if (distance(end, segment.end) <= tolerance + EPSILON) { match = { index, point: segment.start, handle: segment.handle }; break; }
      }
      if (!match) break;
      unused.delete(match.index); vertices.push({ ...match.point }); handles.add(match.handle);
    }
    if (!closed && distance(vertices.at(-1)!, vertices[0]!) <= tolerance + EPSILON) { vertices.pop(); closed = true; }
    if (closed && vertices.length >= 3 && Math.abs(signedArea(vertices)) > EPSILON) loops.push({ vertices, sourceHandles: [...handles] });
  }
  return loops;
}

function loopBounds(vertices: readonly CadPoint2[]): { min: CadPoint2; max: CadPoint2 } {
  return {
    min: { x: Math.min(...vertices.map((point) => point.x)), y: Math.min(...vertices.map((point) => point.y)) },
    max: { x: Math.max(...vertices.map((point) => point.x)), y: Math.max(...vertices.map((point) => point.y)) },
  };
}

function regionEntity(handle: string, layerId: string, loops: readonly BoundaryLoop[], sourceKind: string): CadProxyEntity {
  const all = loops.flatMap((loop) => loop.vertices);
  return {
    kind: "proxy", handle, layerId, originalType: "ACDBREGION",
    raw: { schema: "kuubik-region-v1", sourceKind, loops: structuredClone(loops.map((loop) => loop.vertices)) },
    bounds: loopBounds(all),
  };
}

export function prepareBoundaryCommand(document: KDrawDocumentV1, input: BoundaryCommandInput): PreparedBoundaryCommand {
  assertPoint(input.seedPoint, "BOUNDARY seed point");
  if (input.handle.trim() === "" || input.layerId.trim() === "") throw new BoundaryRegionInputError("BOUNDARY handle and layer are required.");
  const tolerance = input.gapTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new BoundaryRegionInputError("BOUNDARY gap tolerance must be finite and non-negative.");
  const requested = input.sourceHandles ? new Set(input.sourceHandles) : null;
  const candidates = document.entities.filter((entity) => {
    if (requested && !requested.has(entity.handle)) return false;
    const layer = document.layers.find((value) => value.id === entity.layerId);
    return !layer || (layer.visible && !layer.frozen);
  });
  const geometry = candidates.map(sourceGeometry);
  const loops = [...geometry.flatMap((item) => item.loops), ...stitchLoops(geometry.flatMap((item) => item.segments), tolerance)];
  const containing = loops.filter((loop) => pointInPolygon(input.seedPoint, loop.vertices)).sort((first, second) => Math.abs(signedArea(first.vertices)) - Math.abs(signedArea(second.vertices)));
  if (containing.length === 0) throw new BoundaryRegionInputError("BOUNDARY could not find a closed loop containing the seed point.");
  const outer = containing[0]!;
  const selectedLoops = input.islandDetection
    ? [outer, ...loops.filter((loop) => loop !== outer && pointInPolygon(loop.vertices[0]!, outer.vertices) && !pointInPolygon(input.seedPoint, loop.vertices))]
    : [outer];
  const entity: CadPolyline | CadProxyEntity = input.output === "polyline"
    ? { kind: "polyline", handle: input.handle, layerId: input.layerId, closed: true, vertices: outer.vertices.map((point) => ({ ...point })) }
    : regionEntity(input.handle, input.layerId, selectedLoops, "BOUNDARY");
  return {
    commandId: "BOUNDARY", changes: [{ type: "put", entity }],
    targetHandles: [...new Set(selectedLoops.flatMap((loop) => loop.sourceHandles))], resultHandles: [input.handle],
    loops: structuredClone(selectedLoops), entity: structuredClone(entity),
  };
}

function closedEntityLoop(entity: CadEntity): BoundaryLoop | null {
  if (entity.kind === "circle") return circleLoop(entity);
  if (entity.kind === "ellipse") return ellipseLoop(entity);
  if (entity.kind === "polyline" && entity.closed && entity.vertices.length >= 3) return { vertices: entity.vertices.map(({ x, y }) => ({ x, y })), sourceHandles: [entity.handle] };
  return null;
}

export function prepareRegionCommand(document: KDrawDocumentV1, input: RegionCommandInput): PreparedRegionCommand {
  const targets = [...new Set(input.targetHandles)];
  if (targets.length === 0 || input.resultHandles.length !== targets.length || new Set(input.resultHandles).size !== input.resultHandles.length) {
    throw new BoundaryRegionInputError("REGION requires one unique result handle per target.");
  }
  const entities: CadProxyEntity[] = [];
  const rejected: PreparedRegionCommand["rejected"] = [];
  const changes: EntityChange[] = [];
  targets.forEach((handle, index) => {
    const source = document.entities.find((entity) => entity.handle === handle);
    if (!source) { rejected.push({ handle, reason: "missing" }); return; }
    if (document.layers.find((layer) => layer.id === source.layerId)?.locked) { rejected.push({ handle, reason: "locked-layer" }); return; }
    const loop = closedEntityLoop(source);
    if (!loop) { rejected.push({ handle, reason: "not-closed-curve" }); return; }
    const entity = regionEntity(input.resultHandles[index]!, source.layerId, [loop], "REGION");
    entities.push(entity); changes.push({ type: "delete", handle }, { type: "put", entity });
  });
  return { commandId: "REGION", changes, targetHandles: targets, resultHandles: entities.map((entity) => entity.handle), entities, rejected };
}
