import type {
  CadAppearance,
  CadEntity,
  CadPoint2,
  CadPolyline,
  CadPolylineVertex,
  CadSpline,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;
const REVISION_ARC_SWEEP_RAD = 110 * Math.PI / 180;
const REVISION_ARC_BULGE = Math.tan(REVISION_ARC_SWEEP_RAD / 4);
const REVISION_EXTENSION_KEY = "kuubikRevcloud";

export type RevcloudCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_POINT"
  | "INVALID_DIRECTION"
  | "INVALID_STYLE"
  | "INVALID_ARC_LENGTH"
  | "ARC_LENGTH_RATIO"
  | "HANDLE_CONFLICT"
  | "MISSING_LAYER"
  | "LOCKED_LAYER"
  | "MISSING_SOURCE"
  | "UNSUPPORTED_SOURCE"
  | "OPEN_SOURCE"
  | "DEGENERATE_OUTLINE"
  | "INCOMPLETE_COMMAND";

export class RevcloudCommandInputError extends Error {
  constructor(readonly code: RevcloudCommandErrorCode, message: string) {
    super(message);
    this.name = "RevcloudCommandInputError";
  }
}

export interface RevcloudArcLengths {
  minimum: number;
  maximum: number;
}

export type RevcloudStyle = "normal" | "calligraphy";
export type RevcloudArcDirection = "normal" | "reversed";

export type RevcloudConstruction =
  | { mode: "rectangular"; firstCorner: CadPoint2; oppositeCorner: CadPoint2 }
  | { mode: "polygonal"; points: readonly CadPoint2[] }
  | { mode: "freehand"; points: readonly CadPoint2[] }
  | { mode: "object"; sourceHandle: string };

export interface RevcloudCommandInput {
  command: "REVCLOUD";
  construction: RevcloudConstruction;
  arcLengths: RevcloudArcLengths;
  direction?: RevcloudArcDirection;
  style?: RevcloudStyle;
  /** Required for creation modes; object conversion preserves the source handle. */
  handle?: string;
  /** Required for creation modes; object conversion preserves the source layer. */
  layerId?: string;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface NormalizedRevcloudDefinition {
  mode: RevcloudConstruction["mode"];
  sourceHandle: string | null;
  arcLengthMinimum: number;
  arcLengthMaximum: number;
  generatedChordMinimum: number;
  generatedChordMaximum: number;
  direction: RevcloudArcDirection;
  style: RevcloudStyle;
  winding: "counter-clockwise" | "clockwise";
  vertexCount: number;
  closed: true;
}

export interface PreparedRevcloudCommand {
  commandId: "REVCLOUD";
  entity: CadPolyline;
  entities: [CadPolyline];
  changes: [EntityChange & { type: "put"; entity: CadPolyline }];
  targetHandles: string[];
  resultHandles: [string];
  normalized: NormalizedRevcloudDefinition;
}

export type InteractiveRevcloudMode = "rectangular" | "polygonal" | "freehand";

interface InteractiveRevcloudSnapshot {
  points: CadPoint2[];
  direction: RevcloudArcDirection;
  complete: boolean;
}

export interface InteractiveRevcloudState extends InteractiveRevcloudSnapshot {
  mode: InteractiveRevcloudMode;
  handle: string;
  layerId: string;
  arcLengths: RevcloudArcLengths;
  style: RevcloudStyle;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
  history: InteractiveRevcloudSnapshot[];
}

export type InteractiveRevcloudAction =
  | { type: "point"; point: CadPoint2 }
  | { type: "close" }
  | { type: "undo" }
  | { type: "reverse" };

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RevcloudCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function samePoint(first: CadPoint2, second: CadPoint2): boolean {
  return distance(first, second) <= EPSILON;
}

function validateArcLengths(value: RevcloudArcLengths): RevcloudArcLengths {
  if (!Number.isFinite(value.minimum) || !Number.isFinite(value.maximum) || value.minimum <= EPSILON || value.maximum <= EPSILON) {
    throw new RevcloudCommandInputError("INVALID_ARC_LENGTH", "REVCLOUD minimum and maximum arc lengths must be finite and positive.");
  }
  if (value.minimum > value.maximum) {
    throw new RevcloudCommandInputError("INVALID_ARC_LENGTH", "REVCLOUD minimum arc length must not exceed its maximum.");
  }
  if (value.maximum > value.minimum * 3 + EPSILON) {
    throw new RevcloudCommandInputError("ARC_LENGTH_RATIO", "REVCLOUD maximum arc length cannot exceed three times its minimum.");
  }
  return { minimum: value.minimum, maximum: value.maximum };
}

function validateDirection(value: RevcloudArcDirection | undefined): RevcloudArcDirection {
  const direction = value ?? "normal";
  if (direction !== "normal" && direction !== "reversed") {
    throw new RevcloudCommandInputError("INVALID_DIRECTION", "REVCLOUD direction must be normal or reversed.");
  }
  return direction;
}

function validateStyle(value: RevcloudStyle | undefined): RevcloudStyle {
  const style = value ?? "normal";
  if (style !== "normal" && style !== "calligraphy") {
    throw new RevcloudCommandInputError("INVALID_STYLE", "REVCLOUD style must be normal or calligraphy.");
  }
  return style;
}

function cloneSnapshot(state: InteractiveRevcloudSnapshot): InteractiveRevcloudSnapshot {
  return { points: structuredClone(state.points), direction: state.direction, complete: state.complete };
}

export function startInteractiveRevcloudCommand(input: {
  mode: InteractiveRevcloudMode;
  handle: string;
  layerId: string;
  arcLengths: RevcloudArcLengths;
  direction?: RevcloudArcDirection;
  style?: RevcloudStyle;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}): InteractiveRevcloudState {
  if (input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new RevcloudCommandInputError("INVALID_IDENTITY", "REVCLOUD handle and layer are required.");
  }
  return {
    mode: input.mode,
    handle: input.handle,
    layerId: input.layerId,
    arcLengths: validateArcLengths(input.arcLengths),
    direction: validateDirection(input.direction),
    style: validateStyle(input.style),
    ...(input.appearance ? { appearance: structuredClone(input.appearance) } : {}),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
    points: [],
    complete: false,
    history: [],
  };
}

export function applyInteractiveRevcloudAction(
  state: InteractiveRevcloudState,
  action: InteractiveRevcloudAction,
): InteractiveRevcloudState {
  const next = structuredClone(state);
  if (action.type === "undo") {
    const previous = next.history.pop();
    if (!previous) return next;
    next.points = previous.points;
    next.direction = previous.direction;
    next.complete = previous.complete;
    return next;
  }
  next.history.push(cloneSnapshot(next));
  if (action.type === "reverse") {
    next.direction = next.direction === "normal" ? "reversed" : "normal";
    return next;
  }
  if (next.complete) {
    throw new RevcloudCommandInputError("INCOMPLETE_COMMAND", "Completed REVCLOUD input must be undone before adding points.");
  }
  if (action.type === "point") {
    assertPoint(action.point, "REVCLOUD point");
    if (next.points.at(-1) && samePoint(next.points.at(-1)!, action.point)) {
      throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD consecutive points must differ.");
    }
    next.points.push({ ...action.point });
    if (next.mode === "rectangular" && next.points.length === 2) next.complete = true;
    if (next.mode === "rectangular" && next.points.length > 2) {
      throw new RevcloudCommandInputError("INCOMPLETE_COMMAND", "Rectangular REVCLOUD accepts exactly two corners.");
    }
    return next;
  }
  if (next.mode === "rectangular") {
    throw new RevcloudCommandInputError("INCOMPLETE_COMMAND", "Rectangular REVCLOUD closes after its opposite corner.");
  }
  if (next.points.length < 3) {
    throw new RevcloudCommandInputError("INCOMPLETE_COMMAND", "Polygonal and freehand REVCLOUD require at least three points before Close.");
  }
  next.complete = true;
  return next;
}

export function revcloudInputFromInteractiveState(state: InteractiveRevcloudState): RevcloudCommandInput {
  if (!state.complete) throw new RevcloudCommandInputError("INCOMPLETE_COMMAND", "REVCLOUD input must be closed before preparation.");
  const construction: RevcloudConstruction = state.mode === "rectangular"
    ? { mode: "rectangular", firstCorner: state.points[0]!, oppositeCorner: state.points[1]! }
    : { mode: state.mode, points: structuredClone(state.points) };
  return {
    command: "REVCLOUD",
    construction,
    handle: state.handle,
    layerId: state.layerId,
    arcLengths: structuredClone(state.arcLengths),
    direction: state.direction,
    style: state.style,
    ...(state.appearance ? { appearance: structuredClone(state.appearance) } : {}),
    ...(state.extensionData ? { extensionData: structuredClone(state.extensionData) } : {}),
  };
}

function normalizeClosedPoints(points: readonly CadPoint2[], label: string): CadPoint2[] {
  points.forEach((point, index) => assertPoint(point, `${label} point ${index + 1}`));
  const normalized = points.map((point) => ({ ...point }));
  if (normalized.length > 1 && samePoint(normalized[0]!, normalized.at(-1)!)) normalized.pop();
  if (normalized.length < 3) throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", `${label} requires at least three distinct points.`);
  for (let index = 0; index < normalized.length; index += 1) {
    if (samePoint(normalized[index]!, normalized[(index + 1) % normalized.length]!)) {
      throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", `${label} contains a zero-length segment.`);
    }
  }
  return normalized;
}

function signedArea(points: readonly CadPoint2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    twiceArea += start.x * end.y - end.x * start.y;
  }
  return twiceArea / 2;
}

function linearlySampleClosedPath(points: readonly CadPoint2[], arcLengths: RevcloudArcLengths): CadPoint2[] {
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]!));
  const perimeter = lengths.reduce((sum, value) => sum + value, 0);
  const minimumCount = Math.max(3, Math.ceil(perimeter / arcLengths.maximum));
  const maximumCount = Math.floor(perimeter / arcLengths.minimum);
  if (maximumCount < minimumCount) {
    throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD outline is too short for three arcs within the requested length range.");
  }
  const preferred = Math.round(perimeter / ((arcLengths.minimum + arcLengths.maximum) / 2));
  const count = Math.min(maximumCount, Math.max(minimumCount, preferred));
  const spacing = perimeter / count;
  const result: CadPoint2[] = [];
  let segmentIndex = 0;
  let segmentStartDistance = 0;
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const target = sampleIndex * spacing;
    while (segmentIndex < lengths.length - 1 && target > segmentStartDistance + lengths[segmentIndex]! - EPSILON) {
      segmentStartDistance += lengths[segmentIndex]!;
      segmentIndex += 1;
    }
    const start = points[segmentIndex]!;
    const end = points[(segmentIndex + 1) % points.length]!;
    const ratio = Math.min(1, Math.max(0, (target - segmentStartDistance) / lengths[segmentIndex]!));
    result.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
  }
  return result;
}

function bulgedPolylineBoundary(entity: CadPolyline): CadPoint2[] {
  if (!entity.closed) throw new RevcloudCommandInputError("OPEN_SOURCE", "REVCLOUD Object requires a closed polyline.");
  const vertices = normalizeClosedPoints(entity.vertices, "REVCLOUD source polyline");
  const result: CadPoint2[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    result.push({ x: start.x, y: start.y });
    const bulge = entity.vertices[index]?.bulge ?? 0;
    if (Math.abs(bulge) <= EPSILON) continue;
    const chord = distance(start, end);
    const sweep = 4 * Math.atan(bulge);
    const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
    const center = {
      x: (start.x + end.x) / 2 - (end.y - start.y) / chord * centerOffset,
      y: (start.y + end.y) / 2 + (end.x - start.x) / chord * centerOffset,
    };
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const subdivisions = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
    for (let part = 1; part < subdivisions; part += 1) {
      const angle = startAngle + sweep * part / subdivisions;
      const radius = distance(center, start);
      result.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    }
  }
  return result;
}

function circleBoundary(entity: Extract<CadEntity, { kind: "circle" }>): CadPoint2[] {
  if (!(Number.isFinite(entity.radius) && entity.radius > EPSILON)) {
    throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD source circle must have a positive finite radius.");
  }
  return Array.from({ length: 256 }, (_unused, index) => {
    const angle = TWO_PI * index / 256;
    return { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) };
  });
}

function ellipseBoundary(entity: Extract<CadEntity, { kind: "ellipse" }>): CadPoint2[] {
  const span = entity.endParameter - entity.startParameter;
  if (!(Math.hypot(entity.majorAxis.x, entity.majorAxis.y) > EPSILON && entity.ratio > 0 && Math.abs(span) >= TWO_PI - EPSILON)) {
    throw new RevcloudCommandInputError("OPEN_SOURCE", "REVCLOUD Object requires a closed full ellipse.");
  }
  const minorAxis = { x: -entity.majorAxis.y * entity.ratio, y: entity.majorAxis.x * entity.ratio };
  return Array.from({ length: 512 }, (_unused, index) => {
    const parameter = entity.startParameter + span * index / 512;
    return {
      x: entity.center.x + entity.majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
      y: entity.center.y + entity.majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter),
    };
  });
}

function splineBasis(parameter: number, spline: CadSpline): number[] {
  const count = spline.controlPoints.length;
  const last = count - 1;
  let span = spline.degree;
  if (parameter >= spline.knots[last + 1]! - EPSILON) span = last;
  else {
    let low = spline.degree;
    let high = last + 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (parameter < spline.knots[middle]!) high = middle;
      else low = middle;
    }
    span = low;
  }
  const local = Array.from({ length: spline.degree + 1 }, () => 0);
  const left = Array.from({ length: spline.degree + 1 }, () => 0);
  const right = Array.from({ length: spline.degree + 1 }, () => 0);
  local[0] = 1;
  for (let order = 1; order <= spline.degree; order += 1) {
    left[order] = parameter - spline.knots[span + 1 - order]!;
    right[order] = spline.knots[span + order]! - parameter;
    let saved = 0;
    for (let index = 0; index < order; index += 1) {
      const denominator = right[index + 1]! + left[order - index]!;
      const term = Math.abs(denominator) <= EPSILON ? 0 : local[index]! / denominator;
      local[index] = saved + right[index + 1]! * term;
      saved = left[order - index]! * term;
    }
    local[order] = saved;
  }
  const basis = Array.from({ length: count }, () => 0);
  for (let index = 0; index <= spline.degree; index += 1) basis[span - spline.degree + index] = local[index]!;
  return basis;
}

function splineBoundary(entity: CadSpline): CadPoint2[] {
  if (!entity.closed) throw new RevcloudCommandInputError("OPEN_SOURCE", "REVCLOUD Object requires a closed spline.");
  const start = entity.knots[entity.degree];
  const end = entity.knots[entity.controlPoints.length];
  if (start === undefined || end === undefined || !(end > start)) {
    throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD source spline has an invalid parameter domain.");
  }
  return Array.from({ length: 512 }, (_unused, sample) => {
    const parameter = start + (end - start) * sample / 512;
    const basis = splineBasis(parameter, entity);
    let x = 0;
    let y = 0;
    let denominator = 0;
    for (let index = 0; index < entity.controlPoints.length; index += 1) {
      const weighted = basis[index]! * (entity.weights?.[index] ?? 1);
      x += entity.controlPoints[index]!.x * weighted;
      y += entity.controlPoints[index]!.y * weighted;
      denominator += weighted;
    }
    if (!(denominator > EPSILON)) throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD source spline cannot be evaluated.");
    return { x: x / denominator, y: y / denominator };
  });
}

function constructionBoundary(document: KDrawDocumentV1, construction: RevcloudConstruction): { points: CadPoint2[]; source: CadEntity | null } {
  if (construction.mode === "rectangular") {
    assertPoint(construction.firstCorner, "REVCLOUD first corner");
    assertPoint(construction.oppositeCorner, "REVCLOUD opposite corner");
    if (Math.abs(construction.oppositeCorner.x - construction.firstCorner.x) <= EPSILON
      || Math.abs(construction.oppositeCorner.y - construction.firstCorner.y) <= EPSILON) {
      throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "Rectangular REVCLOUD corners must define positive width and height.");
    }
    return {
      source: null,
      points: [
        { ...construction.firstCorner },
        { x: construction.oppositeCorner.x, y: construction.firstCorner.y },
        { ...construction.oppositeCorner },
        { x: construction.firstCorner.x, y: construction.oppositeCorner.y },
      ],
    };
  }
  if (construction.mode === "polygonal" || construction.mode === "freehand") {
    return { source: null, points: normalizeClosedPoints(construction.points, `REVCLOUD ${construction.mode}`) };
  }
  const source = document.entities.find((entity) => entity.handle === construction.sourceHandle);
  if (!source) throw new RevcloudCommandInputError("MISSING_SOURCE", `REVCLOUD source ${construction.sourceHandle} does not exist.`);
  switch (source.kind) {
    case "polyline": return { source, points: bulgedPolylineBoundary(source) };
    case "circle": return { source, points: circleBoundary(source) };
    case "ellipse": return { source, points: ellipseBoundary(source) };
    case "spline": return { source, points: splineBoundary(source) };
    default: throw new RevcloudCommandInputError("UNSUPPORTED_SOURCE", `REVCLOUD cannot convert ${source.kind} ${source.handle}.`);
  }
}

function editableLayer(document: KDrawDocumentV1, layerId: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RevcloudCommandInputError("MISSING_LAYER", `REVCLOUD layer ${layerId} does not exist.`);
  if (layer.locked) throw new RevcloudCommandInputError("LOCKED_LAYER", `REVCLOUD refuses to edit locked layer ${layer.name}.`);
}

export function prepareRevcloudCommand(document: KDrawDocumentV1, input: RevcloudCommandInput): PreparedRevcloudCommand {
  if (input.command !== "REVCLOUD") throw new RevcloudCommandInputError("INVALID_IDENTITY", "REVCLOUD command id is required.");
  const arcLengths = validateArcLengths(input.arcLengths);
  const { points: rawBoundary, source } = constructionBoundary(document, input.construction);
  const handle = source?.handle ?? input.handle;
  const layerId = source?.layerId ?? input.layerId;
  if (!handle?.trim() || !layerId?.trim()) {
    throw new RevcloudCommandInputError("INVALID_IDENTITY", "REVCLOUD creation requires a handle and layer.");
  }
  if (!source && document.entities.some((entity) => entity.handle === handle)) {
    throw new RevcloudCommandInputError("HANDLE_CONFLICT", `REVCLOUD handle ${handle} already exists.`);
  }
  editableLayer(document, layerId);
  const boundary = normalizeClosedPoints(rawBoundary, "REVCLOUD outline");
  const area = signedArea(boundary);
  if (!Number.isFinite(area) || Math.abs(area) <= EPSILON) {
    throw new RevcloudCommandInputError("DEGENERATE_OUTLINE", "REVCLOUD outline must enclose a finite non-zero area.");
  }
  const sampled = linearlySampleClosedPath(boundary, arcLengths);
  const direction = validateDirection(input.direction);
  const style = validateStyle(input.style);
  const outwardSign = area > 0 ? 1 : -1;
  const signedBulge = REVISION_ARC_BULGE * outwardSign * (direction === "reversed" ? -1 : 1);
  const chordLengths = sampled.map((point, index) => distance(point, sampled[(index + 1) % sampled.length]!));
  const vertices: CadPolylineVertex[] = sampled.map((point, index) => {
    const width = style === "calligraphy" ? chordLengths[index]! * 0.08 : 0;
    return {
      ...point,
      bulge: signedBulge,
      ...(width > 0 ? { startWidth: width, endWidth: width * 0.2 } : {}),
    };
  });
  const priorExtension = source?.extensionData ?? input.extensionData ?? {};
  const revisionMetadata = {
    version: 1,
    mode: input.construction.mode,
    arcLengthMinimum: arcLengths.minimum,
    arcLengthMaximum: arcLengths.maximum,
    approximateChordLength: (arcLengths.minimum + arcLengths.maximum) / 2,
    direction,
    style,
  };
  const entity: CadPolyline = {
    kind: "polyline",
    handle,
    layerId,
    vertices,
    closed: true,
    ...((source?.appearance ?? input.appearance) ? { appearance: structuredClone(source?.appearance ?? input.appearance) } : {}),
    extensionData: { ...structuredClone(priorExtension), [REVISION_EXTENSION_KEY]: revisionMetadata },
  };
  const committed = structuredClone(entity);
  return {
    commandId: "REVCLOUD",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: committed }],
    targetHandles: source ? [source.handle] : [],
    resultHandles: [handle],
    normalized: {
      mode: input.construction.mode,
      sourceHandle: source?.handle ?? null,
      arcLengthMinimum: arcLengths.minimum,
      arcLengthMaximum: arcLengths.maximum,
      generatedChordMinimum: Math.min(...chordLengths),
      generatedChordMaximum: Math.max(...chordLengths),
      direction,
      style,
      winding: area > 0 ? "counter-clockwise" : "clockwise",
      vertexCount: vertices.length,
      closed: true,
    },
  };
}
