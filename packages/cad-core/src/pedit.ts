import type { CadEntity, CadPoint2, CadPolyline, CadPolylineVertex, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createControlVertexSpline, createFitPointSpline, splinePointAtParameter } from "./spline.js";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const PEDIT_CURVE_KEY = "kuubikPeditCurve";

export type PeditInputErrorCode =
  | "ENTITY_NOT_FOUND"
  | "LAYER_NOT_FOUND"
  | "LAYER_LOCKED"
  | "LAYER_HIDDEN"
  | "UNSUPPORTED_ENTITY"
  | "INVALID_INPUT"
  | "INVALID_VERTEX"
  | "INVALID_CURVE_STATE";

export class PeditInputError extends Error {
  constructor(public readonly code: PeditInputErrorCode, message: string) {
    super(message);
    this.name = "PeditInputError";
  }
}

export type PeditJoinType = "extend" | "add" | "both";
export type PeditCurveMode = "fit" | "spline";

export type PeditAction =
  | { type: "close" }
  | { type: "open" }
  | { type: "join"; handles: readonly string[]; tolerance: number; jointype?: PeditJoinType }
  | { type: "width"; width: number }
  | { type: "vertex-width"; index: number; startWidth: number; endWidth: number }
  | { type: "reverse" }
  | { type: "fit"; samplesPerSpan?: number }
  | { type: "spline"; degree?: 2 | 3; samplesPerSpan?: number }
  | { type: "decurve" }
  | { type: "linetype-generation"; enabled: boolean }
  | { type: "insert-vertex"; index: number; point: CadPoint2 }
  | { type: "delete-vertex"; index: number }
  | { type: "edit-vertex"; index: number; point: CadPoint2 }
  | { type: "move-vertex"; index: number; point: CadPoint2 }
  | { type: "straighten"; fromIndex: number; toIndex: number };

export interface PeditCommandInput {
  handle: string;
  actions: readonly PeditAction[];
}

export type PeditJoinRejectionReason =
  | "missing"
  | "missing-layer"
  | "locked-layer"
  | "hidden-layer"
  | "unsupported-entity"
  | "degenerate-geometry"
  | "not-contiguous";

export interface PreparedPeditCommand {
  commandId: "PEDIT";
  changes: EntityChange[];
  sourceHandles: string[];
  resultHandles: string[];
  joinedHandles: string[];
  rejectedJoins: Array<{ handle: string; reason: PeditJoinRejectionReason }>;
  entity: CadPolyline;
}

export interface PeditCurveDefinition {
  version: 1;
  mode: PeditCurveMode;
  frameVertices: CadPolylineVertex[];
  degree: 2 | 3;
  samplesPerSpan: number;
}

function assertPoint(point: CadPoint2): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new PeditInputError("INVALID_INPUT", "PEDIT vertex coordinates must be finite.");
  }
}

function assertWidth(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new PeditInputError("INVALID_INPUT", `${label} must be finite and non-negative.`);
}

function assertIndex(index: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(index) || index < minimum || index > maximum) {
    throw new PeditInputError("INVALID_VERTEX", `${label} is outside ${minimum}..${maximum}.`);
  }
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function vertexPoint(vertex: CadPolylineVertex): CadPolylineVertex {
  return { x: vertex.x, y: vertex.y };
}

function vertexWithoutCurve(vertex: CadPolylineVertex): CadPolylineVertex {
  const { bulge: _bulge, ...straight } = vertex;
  return structuredClone(straight);
}

function stripSegmentProperties(vertex: CadPolylineVertex): CadPolylineVertex {
  const { bulge: _bulge, startWidth: _startWidth, endWidth: _endWidth, ...point } = vertex;
  return structuredClone(point);
}

function reversedPolylineVertices(vertices: readonly CadPolylineVertex[], closed: boolean): CadPolylineVertex[] {
  const reversed = [...vertices].reverse().map((vertex) => structuredClone(vertex));
  return reversed.map((vertex, index) => {
    const originalSegmentIndex = closed
      ? (vertices.length - 2 - index + vertices.length) % vertices.length
      : vertices.length - 2 - index;
    const segment = originalSegmentIndex >= 0 ? vertices[originalSegmentIndex] : undefined;
    return {
      ...vertexPoint(vertex),
      ...(segment?.bulge !== undefined ? { bulge: -segment.bulge } : {}),
      ...(segment?.endWidth !== undefined ? { startWidth: segment.endWidth } : {}),
      ...(segment?.startWidth !== undefined ? { endWidth: segment.startWidth } : {}),
    };
  });
}

function normalizedAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = angle % fullTurn;
  return normalized < 0 ? normalized + fullTurn : normalized;
}

type JoinGeometry =
  | { vertices: CadPolylineVertex[]; closed: boolean; reason: null }
  | { vertices: null; closed: false; reason: "unsupported-entity" | "degenerate-geometry" };

function extensionWithoutCurve(entity: CadPolyline): CadPolyline["extensionData"] {
  if (!entity.extensionData) return undefined;
  const { [PEDIT_CURVE_KEY]: _curve, ...rest } = entity.extensionData;
  return Object.keys(rest).length > 0 ? structuredClone(rest) : undefined;
}

export function readPeditCurveDefinition(entity: CadPolyline): PeditCurveDefinition | null {
  const value = entity.extensionData?.[PEDIT_CURVE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PeditCurveDefinition>;
  if (candidate.version !== 1 || (candidate.mode !== "fit" && candidate.mode !== "spline")
    || (candidate.degree !== 2 && candidate.degree !== 3)
    || !Number.isInteger(candidate.samplesPerSpan) || candidate.samplesPerSpan! < 2 || candidate.samplesPerSpan! > 64
    || !Array.isArray(candidate.frameVertices) || candidate.frameVertices.length < 2) return null;
  if (candidate.frameVertices.some((vertex) => !vertex || typeof vertex !== "object"
    || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) return null;
  return structuredClone(candidate as PeditCurveDefinition);
}

function decurvedPolyline(entity: CadPolyline): CadPolyline {
  const definition = readPeditCurveDefinition(entity);
  const vertices = (definition?.frameVertices ?? entity.vertices).map(vertexWithoutCurve);
  const extensionData = extensionWithoutCurve(entity);
  const { extensionData: _oldExtensionData, ...base } = entity;
  return {
    ...base,
    vertices,
    ...(extensionData ? { extensionData } : {}),
  };
}

function asJoinVertices(entity: CadEntity): JoinGeometry {
  if (entity.kind === "line") return { vertices: [{ ...entity.start }, { ...entity.end }], closed: false, reason: null };
  if (entity.kind === "polyline") {
    const definition = readPeditCurveDefinition(entity);
    return { vertices: structuredClone(definition?.frameVertices ?? entity.vertices), closed: entity.closed, reason: null };
  }
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

function editableSource(document: KDrawDocumentV1, handle: string): CadEntity {
  const source = document.entities.find((entity) => entity.handle === handle);
  if (!source) throw new PeditInputError("ENTITY_NOT_FOUND", `PEDIT source ${handle} does not exist.`);
  const layer = document.layers.find((candidate) => candidate.id === source.layerId);
  if (!layer) throw new PeditInputError("LAYER_NOT_FOUND", `PEDIT source ${handle} references missing layer ${source.layerId}.`);
  if (layer.locked) throw new PeditInputError("LAYER_LOCKED", `PEDIT source ${handle} is on a locked layer.`);
  if (!layer.visible || layer.frozen) throw new PeditInputError("LAYER_HIDDEN", `PEDIT source ${handle} is on an off or frozen layer.`);
  return source;
}

function requireEditablePolyline(document: KDrawDocumentV1, handle: string): CadPolyline {
  const source = editableSource(document, handle);
  if (source.kind === "polyline") return structuredClone(source);
  const joinGeometry = asJoinVertices(source);
  if (!joinGeometry.vertices) {
    throw new PeditInputError("UNSUPPORTED_ENTITY", `PEDIT source ${handle} is not a supported line, arc, or polyline.`);
  }
  return {
    kind: "polyline",
    handle: source.handle,
    layerId: source.layerId,
    ...(source.appearance ? { appearance: structuredClone(source.appearance) } : {}),
    ...(source.extensionData ? { extensionData: structuredClone(source.extensionData) } : {}),
    vertices: joinGeometry.vertices,
    closed: false,
  };
}

function outgoingSegment(vertex: CadPolylineVertex): Pick<CadPolylineVertex, "bulge" | "startWidth" | "endWidth"> {
  return {
    ...(vertex.bulge !== undefined ? { bulge: vertex.bulge } : {}),
    ...(vertex.startWidth !== undefined ? { startWidth: vertex.startWidth } : {}),
    ...(vertex.endWidth !== undefined ? { endWidth: vertex.endWidth } : {}),
  };
}

function appendSnapped(current: readonly CadPolylineVertex[], candidate: readonly CadPolylineVertex[]): CadPolylineVertex[] {
  const joined = current.map((vertex) => structuredClone(vertex));
  joined[joined.length - 1] = { ...vertexPoint(joined.at(-1)!), ...outgoingSegment(candidate[0]!) };
  joined.push(...candidate.slice(1).map((vertex) => structuredClone(vertex)));
  return joined;
}

function appendBridge(current: readonly CadPolylineVertex[], candidate: readonly CadPolylineVertex[]): CadPolylineVertex[] {
  const joined = current.map((vertex) => structuredClone(vertex));
  joined[joined.length - 1] = stripSegmentProperties(joined.at(-1)!);
  joined.push(...candidate.map((vertex) => structuredClone(vertex)));
  return joined;
}

function appendJoined(current: readonly CadPolylineVertex[], candidate: readonly CadPolylineVertex[], gap: number, tolerance: number, jointype: PeditJoinType): CadPolylineVertex[] | null {
  if (gap > tolerance + EPSILON) return null;
  if (gap <= EPSILON || jointype !== "add") return appendSnapped(current, candidate);
  return appendBridge(current, candidate);
}

function joinVertices(current: CadPolylineVertex[], candidate: CadPolylineVertex[], tolerance: number, jointype: PeditJoinType): CadPolylineVertex[] | null {
  const currentStart = current[0]!;
  const currentEnd = current.at(-1)!;
  const candidateStart = candidate[0]!;
  const candidateEnd = candidate.at(-1)!;
  const attempts = [
    { gap: distance(currentEnd, candidateStart), left: current, right: candidate },
    { gap: distance(currentEnd, candidateEnd), left: current, right: reversedPolylineVertices(candidate, false) },
  ].sort((first, second) => first.gap - second.gap);
  const appended = appendJoined(attempts[0]!.left, attempts[0]!.right, attempts[0]!.gap, tolerance, jointype);
  if (appended) return appended;
  const prependAttempts = [
    { gap: distance(currentStart, candidateEnd), candidate },
    { gap: distance(currentStart, candidateStart), candidate: reversedPolylineVertices(candidate, false) },
  ].sort((first, second) => first.gap - second.gap);
  const prepended = appendJoined(prependAttempts[0]!.candidate, current, prependAttempts[0]!.gap, tolerance, jointype);
  return prepended;
}

function curveDefinition(entity: CadPolyline, mode: PeditCurveMode, degree: 2 | 3, samplesPerSpan: number, frameVertices: CadPolylineVertex[]): PeditCurveDefinition {
  return { version: 1, mode, degree, samplesPerSpan, frameVertices: structuredClone(frameVertices) };
}

function sampledWidths(frame: readonly CadPolylineVertex[], ratio: number): Pick<CadPolylineVertex, "startWidth" | "endWidth"> {
  const segmentCount = Math.max(1, frame.length - 1);
  const position = Math.min(segmentCount - EPSILON, Math.max(0, ratio * segmentCount));
  const index = Math.min(frame.length - 2, Math.floor(position));
  const local = position - index;
  const source = frame[index]!;
  const start = source.startWidth;
  const end = source.endWidth;
  if (start === undefined && end === undefined) return {};
  const from = start ?? end ?? 0;
  const to = end ?? start ?? 0;
  const width = from + (to - from) * local;
  return { startWidth: width, endWidth: width };
}

function fitPolyline(entity: CadPolyline, definition: PeditCurveDefinition): CadPolyline {
  const frame = definition.frameVertices;
  if (frame.length < 3) throw new PeditInputError("INVALID_CURVE_STATE", `PEDIT ${definition.mode} requires at least three frame vertices.`);
  let spline;
  try {
    spline = definition.mode === "fit"
      ? createFitPointSpline({ handle: entity.handle, layerId: entity.layerId, fitPoints: frame, closed: entity.closed })
      : createControlVertexSpline({
        handle: entity.handle,
        layerId: entity.layerId,
        controlPoints: frame,
        degree: Math.min(definition.degree, frame.length - 1),
        closed: entity.closed,
      });
  } catch (error) {
    throw new PeditInputError("INVALID_CURVE_STATE", error instanceof Error ? error.message : "PEDIT curve fitting failed.");
  }
  const start = spline.knots[spline.degree]!;
  const end = spline.knots[spline.controlPoints.length]!;
  const spanCount = Math.max(1, frame.length - (entity.closed ? 0 : 1));
  const sampleCount = Math.max(2, spanCount * definition.samplesPerSpan);
  const vertices = Array.from({ length: entity.closed ? sampleCount : sampleCount + 1 }, (_unused, index) => {
    const ratio = index / sampleCount;
    const point = splinePointAtParameter(spline, start + (end - start) * ratio);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new PeditInputError("INVALID_CURVE_STATE", "PEDIT curve sampling produced an invalid vertex.");
    }
    return { ...point, ...sampledWidths(frame, ratio) };
  });
  return {
    ...entity,
    vertices,
    extensionData: {
      ...(extensionWithoutCurve(entity) ?? {}),
      [PEDIT_CURVE_KEY]: structuredClone(definition),
    },
  };
}

function editFrame(entity: CadPolyline, editor: (frame: CadPolylineVertex[]) => CadPolylineVertex[]): CadPolyline {
  const definition = readPeditCurveDefinition(entity);
  const frame = editor(structuredClone(definition?.frameVertices ?? entity.vertices));
  if (!definition) return { ...entity, vertices: frame };
  return fitPolyline(entity, { ...definition, frameVertices: frame });
}

function withClosed(entity: CadPolyline, closed: boolean): CadPolyline {
  const updated = { ...entity, closed };
  const definition = readPeditCurveDefinition(entity);
  return definition ? fitPolyline(updated, definition) : updated;
}

function splitBulgedSegment(start: CadPolylineVertex, end: CadPolylineVertex, point: CadPoint2): [CadPolylineVertex, CadPolylineVertex] {
  const bulge = start.bulge;
  if (bulge === undefined || Math.abs(bulge) <= EPSILON) return [structuredClone(start), { ...point }];
  const chord = distance(start, end);
  if (chord <= EPSILON) throw new PeditInputError("INVALID_CURVE_STATE", "PEDIT cannot insert into a degenerate bulged segment.");
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const center = {
    x: (start.x + end.x) / 2 - dy / chord * centerOffset,
    y: (start.y + end.y) / 2 + dx / chord * centerOffset,
  };
  const radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
  if (Math.abs(distance(center, point) - radius) > Math.max(1e-7, radius * 1e-7)) {
    throw new PeditInputError("INVALID_VERTEX", "PEDIT inserted vertex must lie on the selected arc segment.");
  }
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const pointAngle = Math.atan2(point.y - center.y, point.x - center.x);
  const sweep = 4 * Math.atan(bulge);
  const partial = sweep > 0 ? normalizedAngle(pointAngle - startAngle) : -normalizedAngle(startAngle - pointAngle);
  const ratio = partial / sweep;
  if (!(ratio > EPSILON && ratio < 1 - EPSILON)) throw new PeditInputError("INVALID_VERTEX", "PEDIT inserted vertex must be inside the selected arc segment.");
  const startWidth = start.startWidth ?? start.endWidth;
  const endWidth = start.endWidth ?? start.startWidth;
  const middleWidth = startWidth === undefined || endWidth === undefined ? undefined : startWidth + (endWidth - startWidth) * ratio;
  return [
    {
      ...vertexPoint(start), bulge: Math.tan(partial / 4),
      ...(startWidth !== undefined ? { startWidth } : {}), ...(middleWidth !== undefined ? { endWidth: middleWidth } : {}),
    },
    {
      ...point, bulge: Math.tan((sweep - partial) / 4),
      ...(middleWidth !== undefined ? { startWidth: middleWidth } : {}), ...(endWidth !== undefined ? { endWidth } : {}),
    },
  ];
}

function insertVertex(entity: CadPolyline, index: number, point: CadPoint2): CadPolyline {
  return editFrame(entity, (frame) => {
    assertIndex(index, 0, frame.length, "PEDIT insert index");
    if (index > 0 && index < frame.length) {
      const [before, inserted] = splitBulgedSegment(frame[index - 1]!, frame[index]!, point);
      frame[index - 1] = before;
      frame.splice(index, 0, inserted);
    } else frame.splice(index, 0, { ...point });
    return frame;
  });
}

function deleteVertex(entity: CadPolyline, index: number): CadPolyline {
  return editFrame(entity, (frame) => {
    assertIndex(index, 0, frame.length - 1, "PEDIT delete index");
    const minimumBeforeDelete = entity.closed ? 4 : 3;
    if (frame.length < minimumBeforeDelete) throw new PeditInputError("INVALID_VERTEX", "PEDIT cannot delete below the minimum vertex count.");
    frame.splice(index, 1);
    if (index > 0 && index < frame.length) frame[index - 1] = stripSegmentProperties(frame[index - 1]!);
    return frame;
  });
}

function straightenVertices(entity: CadPolyline, fromIndex: number, toIndex: number): CadPolyline {
  return editFrame(entity, (frame) => {
    assertIndex(fromIndex, 0, frame.length - 2, "PEDIT straighten start index");
    assertIndex(toIndex, fromIndex + 1, frame.length - 1, "PEDIT straighten end index");
    frame[fromIndex] = stripSegmentProperties(frame[fromIndex]!);
    frame.splice(fromIndex + 1, toIndex - fromIndex - 1);
    return frame;
  });
}

function refit(entity: CadPolyline, mode: PeditCurveMode, degree: 2 | 3, samplesPerSpan: number): CadPolyline {
  if (!Number.isInteger(samplesPerSpan) || samplesPerSpan < 2 || samplesPerSpan > 64) {
    throw new PeditInputError("INVALID_INPUT", "PEDIT curve samples per span must be an integer from 2 through 64.");
  }
  const existing = readPeditCurveDefinition(entity);
  const frame = structuredClone(existing?.frameVertices ?? entity.vertices);
  return fitPolyline(decurvedPolyline(entity), curveDefinition(entity, mode, degree, samplesPerSpan, frame));
}

function joinLayerReason(document: KDrawDocumentV1, entity: CadEntity): PeditJoinRejectionReason | null {
  const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
  if (!layer) return "missing-layer";
  if (layer.locked) return "locked-layer";
  if (!layer.visible || layer.frozen) return "hidden-layer";
  return null;
}

export function preparePeditCommand(document: KDrawDocumentV1, input: PeditCommandInput): PreparedPeditCommand {
  if (input.actions.length === 0) throw new PeditInputError("INVALID_INPUT", "PEDIT requires at least one action.");
  let entity = requireEditablePolyline(document, input.handle);
  const joinedHandles: string[] = [];
  const rejectedJoins: PreparedPeditCommand["rejectedJoins"] = [];
  const byHandle = new Map(document.entities.map((candidate) => [candidate.handle, candidate]));

  for (const action of input.actions) {
    if (action.type === "close") {
      const frame = readPeditCurveDefinition(entity)?.frameVertices ?? entity.vertices;
      if (frame.length < 3) throw new PeditInputError("INVALID_VERTEX", "PEDIT Close requires at least three vertices.");
      entity = withClosed(entity, true);
    } else if (action.type === "open") {
      entity = withClosed(entity, false);
      if (!readPeditCurveDefinition(entity)) {
        const vertices = [...entity.vertices];
        vertices[vertices.length - 1] = stripSegmentProperties(vertices.at(-1)!);
        entity = { ...entity, vertices };
      }
    } else if (action.type === "width") {
      assertWidth(action.width, "PEDIT width");
      entity = editFrame(entity, (frame) => frame.map((vertex) => ({ ...vertex, startWidth: action.width, endWidth: action.width })));
    } else if (action.type === "vertex-width") {
      assertWidth(action.startWidth, "PEDIT vertex start width");
      assertWidth(action.endWidth, "PEDIT vertex end width");
      entity = editFrame(entity, (frame) => {
        assertIndex(action.index, 0, frame.length - 1, "PEDIT vertex width index");
        return frame.map((vertex, index) => index === action.index
          ? { ...vertex, startWidth: action.startWidth, endWidth: action.endWidth }
          : vertex);
      });
    } else if (action.type === "reverse") {
      entity = editFrame(entity, (frame) => reversedPolylineVertices(frame, entity.closed));
    } else if (action.type === "fit") {
      entity = refit(entity, "fit", 3, action.samplesPerSpan ?? 8);
    } else if (action.type === "spline") {
      entity = refit(entity, "spline", action.degree ?? 3, action.samplesPerSpan ?? 8);
    } else if (action.type === "decurve") {
      entity = decurvedPolyline(entity);
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
      entity = insertVertex(entity, action.index, action.point);
    } else if (action.type === "delete-vertex") {
      entity = deleteVertex(entity, action.index);
    } else if (action.type === "edit-vertex" || action.type === "move-vertex") {
      assertPoint(action.point);
      entity = editFrame(entity, (frame) => {
        assertIndex(action.index, 0, frame.length - 1, "PEDIT edit index");
        return frame.map((vertex, index) => index === action.index ? { ...vertex, ...action.point } : vertex);
      });
    } else if (action.type === "straighten") {
      entity = straightenVertices(entity, action.fromIndex, action.toIndex);
    } else if (action.type === "join") {
      if (entity.closed) throw new PeditInputError("INVALID_CURVE_STATE", "PEDIT Join requires an open source polyline.");
      if (!Number.isFinite(action.tolerance) || action.tolerance < 0) {
        throw new PeditInputError("INVALID_INPUT", "PEDIT Join tolerance must be finite and non-negative.");
      }
      const jointype = action.jointype ?? "extend";
      if (!(["extend", "add", "both"] as const).includes(jointype)) throw new PeditInputError("INVALID_INPUT", "PEDIT Join type is invalid.");
      entity = decurvedPolyline(entity);
      for (const handle of [...new Set(action.handles)]) {
        if (handle === entity.handle || joinedHandles.includes(handle)) continue;
        const candidate = byHandle.get(handle);
        if (!candidate) { rejectedJoins.push({ handle, reason: "missing" }); continue; }
        const layerReason = joinLayerReason(document, candidate);
        if (layerReason) { rejectedJoins.push({ handle, reason: layerReason }); continue; }
        const joinable = asJoinVertices(candidate);
        if (!joinable.vertices) { rejectedJoins.push({ handle, reason: joinable.reason }); continue; }
        if (joinable.closed) { rejectedJoins.push({ handle, reason: "unsupported-entity" }); continue; }
        const vertices = joinVertices(entity.vertices, joinable.vertices, action.tolerance, jointype);
        if (!vertices) { rejectedJoins.push({ handle, reason: "not-contiguous" }); continue; }
        entity = { ...entity, vertices };
        joinedHandles.push(handle);
      }
    } else {
      const exhaustive: never = action;
      throw new PeditInputError("INVALID_INPUT", `Unsupported PEDIT action: ${JSON.stringify(exhaustive)}`);
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
