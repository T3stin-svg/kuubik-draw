import type { CadEntity, CadPoint2, CadPolyline, CadPolylineVertex, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;

export class PeditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeditInputError";
  }
}

export type PeditAction =
  | { type: "close" }
  | { type: "open" }
  | { type: "join"; handles: readonly string[]; tolerance: number }
  | { type: "width"; width: number }
  | { type: "reverse" }
  | { type: "decurve" }
  | { type: "linetype-generation"; enabled: boolean }
  | { type: "insert-vertex"; index: number; point: CadPoint2 }
  | { type: "delete-vertex"; index: number }
  | { type: "edit-vertex"; index: number; point: CadPoint2 };

export interface PeditCommandInput {
  handle: string;
  actions: readonly PeditAction[];
}

export interface PreparedPeditCommand {
  commandId: "PEDIT";
  changes: EntityChange[];
  sourceHandles: string[];
  resultHandles: string[];
  joinedHandles: string[];
  rejectedJoins: Array<{ handle: string; reason: "missing" | "locked-layer" | "unsupported-entity" | "degenerate-geometry" | "not-contiguous" }>;
  entity: CadPolyline;
}

function assertPoint(point: CadPoint2): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new PeditInputError("PEDIT vertex coordinates must be finite.");
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function vertexWithoutCurve(vertex: CadPolylineVertex): CadPolylineVertex {
  const { bulge: _bulge, ...straight } = vertex;
  return structuredClone(straight);
}

function reversedPolylineVertices(vertices: readonly CadPolylineVertex[], closed: boolean): CadPolylineVertex[] {
  const reversed = [...vertices].reverse().map((vertex) => structuredClone(vertex));
  return reversed.map((vertex, index) => {
    const originalSegmentIndex = closed
      ? (vertices.length - 2 - index + vertices.length) % vertices.length
      : vertices.length - 2 - index;
    const segment = originalSegmentIndex >= 0 ? vertices[originalSegmentIndex] : undefined;
    const { bulge: _bulge, startWidth: _startWidth, endWidth: _endWidth, ...point } = vertex;
    return {
      ...point,
      ...(segment?.bulge !== undefined ? { bulge: -segment.bulge } : {}),
      ...(segment?.endWidth !== undefined ? { startWidth: segment.endWidth } : {}),
      ...(segment?.startWidth !== undefined ? { endWidth: segment.startWidth } : {}),
    };
  });
}

type JoinGeometry =
  | { vertices: CadPolylineVertex[]; closed: boolean; reason: null }
  | { vertices: null; closed: false; reason: "unsupported-entity" | "degenerate-geometry" };

function normalizedAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = angle % fullTurn;
  return normalized < 0 ? normalized + fullTurn : normalized;
}

function asJoinVertices(entity: CadEntity): JoinGeometry {
  if (entity.kind === "line") return { vertices: [{ ...entity.start }, { ...entity.end }], closed: false, reason: null };
  if (entity.kind === "polyline") return { vertices: structuredClone(entity.vertices), closed: entity.closed, reason: null };
  if (entity.kind === "arc") {
    if (!Number.isFinite(entity.radius) || entity.radius <= EPSILON) return { vertices: null, closed: false, reason: "degenerate-geometry" };
    const sweep = entity.counterClockwise
      ? normalizedAngle(entity.endAngleRad - entity.startAngleRad)
      : -normalizedAngle(entity.startAngleRad - entity.endAngleRad);
    if (!Number.isFinite(sweep) || Math.abs(sweep) <= EPSILON || Math.abs(sweep) >= Math.PI * 2 - EPSILON) {
      return { vertices: null, closed: false, reason: "degenerate-geometry" };
    }
    const start = {
      x: entity.center.x + entity.radius * Math.cos(entity.startAngleRad),
      y: entity.center.y + entity.radius * Math.sin(entity.startAngleRad),
      bulge: Math.tan(sweep / 4),
    };
    const end = {
      x: entity.center.x + entity.radius * Math.cos(entity.endAngleRad),
      y: entity.center.y + entity.radius * Math.sin(entity.endAngleRad),
    };
    if (![start.x, start.y, start.bulge, end.x, end.y].every(Number.isFinite)) return { vertices: null, closed: false, reason: "degenerate-geometry" };
    return { vertices: [start, end], closed: false, reason: null };
  }
  return { vertices: null, closed: false, reason: "unsupported-entity" };
}

function outgoingSegment(vertex: CadPolylineVertex): Pick<CadPolylineVertex, "bulge" | "startWidth" | "endWidth"> {
  return {
    ...(vertex.bulge !== undefined ? { bulge: vertex.bulge } : {}),
    ...(vertex.startWidth !== undefined ? { startWidth: vertex.startWidth } : {}),
    ...(vertex.endWidth !== undefined ? { endWidth: vertex.endWidth } : {}),
  };
}

function appendJoined(current: readonly CadPolylineVertex[], candidate: readonly CadPolylineVertex[]): CadPolylineVertex[] {
  const joined = current.map((vertex) => structuredClone(vertex));
  const last = joined.at(-1)!;
  const { bulge: _bulge, startWidth: _startWidth, endWidth: _endWidth, ...point } = last;
  joined[joined.length - 1] = { ...point, ...outgoingSegment(candidate[0]!) };
  joined.push(...candidate.slice(1).map((vertex) => structuredClone(vertex)));
  return joined;
}

function joinVertices(
  current: CadPolylineVertex[],
  candidate: CadPolylineVertex[],
  tolerance: number,
): CadPolylineVertex[] | null {
  const currentStart = current[0]!;
  const currentEnd = current.at(-1)!;
  const candidateStart = candidate[0]!;
  const candidateEnd = candidate.at(-1)!;
  if (distance(currentEnd, candidateStart) <= tolerance) return appendJoined(current, candidate);
  if (distance(currentEnd, candidateEnd) <= tolerance) return appendJoined(current, reversedPolylineVertices(candidate, false));
  if (distance(currentStart, candidateEnd) <= tolerance) return [...candidate.slice(0, -1), ...current];
  if (distance(currentStart, candidateStart) <= tolerance) {
    const reversed = reversedPolylineVertices(candidate, false);
    return [...reversed.slice(0, -1), ...current];
  }
  return null;
}

function requireEditablePolyline(document: KDrawDocumentV1, handle: string): CadPolyline {
  const source = document.entities.find((entity) => entity.handle === handle);
  if (!source) throw new PeditInputError(`PEDIT source ${handle} does not exist.`);
  if (document.layers.find((layer) => layer.id === source.layerId)?.locked) throw new PeditInputError(`PEDIT source ${handle} is on a locked layer.`);
  if (source.kind === "polyline") return structuredClone(source);
  if (source.kind === "line") return {
    kind: "polyline",
    handle: source.handle,
    layerId: source.layerId,
    ...(source.appearance ? { appearance: structuredClone(source.appearance) } : {}),
    vertices: [{ ...source.start }, { ...source.end }],
    closed: false,
  };
  throw new PeditInputError(`PEDIT source ${handle} is not a line or polyline.`);
}

export function preparePeditCommand(document: KDrawDocumentV1, input: PeditCommandInput): PreparedPeditCommand {
  if (input.actions.length === 0) throw new PeditInputError("PEDIT requires at least one action.");
  let entity = requireEditablePolyline(document, input.handle);
  const joinedHandles: string[] = [];
  const rejectedJoins: PreparedPeditCommand["rejectedJoins"] = [];
  const byHandle = new Map(document.entities.map((candidate) => [candidate.handle, candidate]));

  for (const action of input.actions) {
    if (action.type === "close") {
      if (entity.vertices.length < 3) throw new PeditInputError("PEDIT Close requires at least three vertices.");
      entity = { ...entity, closed: true };
    } else if (action.type === "open") {
      entity = { ...entity, closed: false };
    } else if (action.type === "width") {
      if (!Number.isFinite(action.width) || action.width < 0) throw new PeditInputError("PEDIT width must be finite and non-negative.");
      entity = { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, startWidth: action.width, endWidth: action.width })) };
    } else if (action.type === "reverse") {
      entity = { ...entity, vertices: reversedPolylineVertices(entity.vertices, entity.closed) };
    } else if (action.type === "decurve") {
      entity = { ...entity, vertices: entity.vertices.map(vertexWithoutCurve) };
    } else if (action.type === "linetype-generation") {
      entity = {
        ...entity,
        extensionData: {
          ...(entity.extensionData ?? {}),
          pedit: { linetypeGeneration: action.enabled },
        },
      };
    } else if (action.type === "insert-vertex") {
      assertPoint(action.point);
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > entity.vertices.length) throw new PeditInputError("PEDIT insert index is outside the vertex list.");
      const vertices = [...entity.vertices];
      vertices.splice(action.index, 0, { ...action.point });
      entity = { ...entity, vertices };
    } else if (action.type === "delete-vertex") {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= entity.vertices.length) throw new PeditInputError("PEDIT delete index is outside the vertex list.");
      const minimum = entity.closed ? 4 : 3;
      if (entity.vertices.length < minimum) throw new PeditInputError("PEDIT cannot delete below the minimum vertex count.");
      const vertices = [...entity.vertices];
      vertices.splice(action.index, 1);
      entity = { ...entity, vertices };
    } else if (action.type === "edit-vertex") {
      assertPoint(action.point);
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= entity.vertices.length) throw new PeditInputError("PEDIT edit index is outside the vertex list.");
      entity = { ...entity, vertices: entity.vertices.map((vertex, index) => index === action.index ? { ...vertex, ...action.point } : vertex) };
    } else {
      if (!Number.isFinite(action.tolerance) || action.tolerance < 0) throw new PeditInputError("PEDIT Join tolerance must be finite and non-negative.");
      for (const handle of [...new Set(action.handles)]) {
        if (handle === entity.handle || joinedHandles.includes(handle)) continue;
        const candidate = byHandle.get(handle);
        if (!candidate) { rejectedJoins.push({ handle, reason: "missing" }); continue; }
        if (document.layers.find((layer) => layer.id === candidate.layerId)?.locked) { rejectedJoins.push({ handle, reason: "locked-layer" }); continue; }
        const joinable = asJoinVertices(candidate);
        if (!joinable.vertices) { rejectedJoins.push({ handle, reason: joinable.reason }); continue; }
        if (joinable.closed) { rejectedJoins.push({ handle, reason: "unsupported-entity" }); continue; }
        const vertices = joinVertices(entity.vertices, joinable.vertices, action.tolerance + EPSILON);
        if (!vertices) { rejectedJoins.push({ handle, reason: "not-contiguous" }); continue; }
        entity = { ...entity, vertices };
        joinedHandles.push(handle);
      }
    }
  }

  const changes: EntityChange[] = [
    { type: "put", entity },
    ...joinedHandles.map((handle): EntityChange => ({ type: "delete", handle })),
  ];
  return {
    commandId: "PEDIT",
    changes,
    sourceHandles: [input.handle, ...joinedHandles],
    resultHandles: [input.handle],
    joinedHandles,
    rejectedJoins,
    entity: structuredClone(entity),
  };
}
