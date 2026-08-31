import type { CadAppearance, CadPoint2, CadPolyline } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export type PolygonCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_SIDE_COUNT"
  | "INVALID_POINT"
  | "INVALID_SIZE"
  | "INVALID_ROTATION"
  | "INVALID_ROTATION_INPUT"
  | "INVALID_ORIENTATION"
  | "DEGENERATE_EDGE"
  | "NUMERIC_OVERFLOW";

export class PolygonCommandInputError extends Error {
  constructor(readonly code: PolygonCommandErrorCode, message: string) {
    super(message);
    this.name = "PolygonCommandInputError";
  }
}

export type PolygonOrientation = "counter-clockwise" | "clockwise";
export type PolygonRotationInput = "radius-point" | "numeric";

export type CompletePolygonConstruction =
  | {
    mode: "center-inscribed";
    center: CadPoint2;
    radius: number;
    rotationRad?: number;
    rotationInput?: PolygonRotationInput;
    orientation?: PolygonOrientation;
  }
  | {
    mode: "center-circumscribed";
    center: CadPoint2;
    apothem: number;
    rotationRad?: number;
    rotationInput?: PolygonRotationInput;
    orientation?: PolygonOrientation;
  }
  | {
    mode: "edge";
    first: CadPoint2;
    second: CadPoint2;
    orientation?: PolygonOrientation;
  };

export interface CompletePolygonCommandInput {
  command: "POLYGON";
  handle: string;
  layerId: string;
  sides: number;
  construction: CompletePolygonConstruction;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface NormalizedPolygonDefinition {
  sides: number;
  mode: CompletePolygonConstruction["mode"];
  center: CadPoint2;
  radius: number;
  apothem: number;
  sideLength: number;
  rotationRad: number;
  rotationInput: PolygonRotationInput | "edge";
  orientation: PolygonOrientation;
  signedArea: number;
}

export interface PreparedCompletePolygonCommand {
  commandId: "POLYGON";
  entity: CadPolyline;
  entities: [CadPolyline];
  changes: [EntityChange & { type: "put"; entity: CadPolyline }];
  resultHandles: [string];
  normalized: NormalizedPolygonDefinition;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new PolygonCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function assertSize(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= EPSILON) {
    throw new PolygonCommandInputError("INVALID_SIZE", `${label} must be finite and greater than ${EPSILON}.`);
  }
  return value;
}

function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) {
    throw new PolygonCommandInputError("INVALID_ROTATION", "POLYGON rotation must be finite.");
  }
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function resolveOrientation(value: PolygonOrientation | undefined): PolygonOrientation {
  const orientation = value ?? "counter-clockwise";
  if (orientation !== "counter-clockwise" && orientation !== "clockwise") {
    throw new PolygonCommandInputError("INVALID_ORIENTATION", "POLYGON orientation must be counter-clockwise or clockwise.");
  }
  return orientation;
}

function resolveRotationInput(value: PolygonRotationInput | undefined): PolygonRotationInput {
  const input = value ?? "radius-point";
  if (input !== "radius-point" && input !== "numeric") {
    throw new PolygonCommandInputError("INVALID_ROTATION_INPUT", "POLYGON rotation input must be radius-point or numeric.");
  }
  return input;
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function polygonSignedArea(vertices: readonly CadPoint2[]): number {
  const origin = vertices[0]!;
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const currentX = current.x - origin.x;
    const currentY = current.y - origin.y;
    const nextX = next.x - origin.x;
    const nextY = next.y - origin.y;
    twiceArea += currentX * nextY - nextX * currentY;
  }
  return twiceArea / 2;
}

function regularVertices(
  center: CadPoint2,
  radius: number,
  sides: number,
  firstVertexAngleRad: number,
  orientation: PolygonOrientation,
): CadPoint2[] {
  const direction = orientation === "counter-clockwise" ? 1 : -1;
  const step = direction * TWO_PI / sides;
  return Array.from({ length: sides }, (_, index) => {
    const angle = firstVertexAngleRad + index * step;
    const point = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new PolygonCommandInputError("NUMERIC_OVERFLOW", "POLYGON vertex calculation exceeded finite numeric range.");
    }
    return point;
  });
}

function resolveGeometry(input: CompletePolygonCommandInput): {
  vertices: CadPoint2[];
  normalized: Omit<NormalizedPolygonDefinition, "signedArea">;
} {
  if (!Number.isInteger(input.sides) || input.sides < 3 || input.sides > 1024) {
    throw new PolygonCommandInputError("INVALID_SIDE_COUNT", "POLYGON side count must be an integer from 3 through 1024.");
  }
  const { construction } = input;
  const orientation = resolveOrientation(construction.orientation);
  const direction = orientation === "counter-clockwise" ? 1 : -1;
  let center: CadPoint2;
  let radius: number;
  let apothem: number;
  let firstVertexAngleRad: number;
  let rotationRad: number;

  if (construction.mode === "edge") {
    assertPoint(construction.first, "POLYGON first edge point");
    assertPoint(construction.second, "POLYGON second edge point");
    const sideLength = distance(construction.first, construction.second);
    if (!(sideLength > EPSILON)) {
      throw new PolygonCommandInputError("DEGENERATE_EDGE", "POLYGON edge points must differ by more than numeric tolerance.");
    }
    const dx = construction.second.x - construction.first.x;
    const dy = construction.second.y - construction.first.y;
    apothem = sideLength / (2 * Math.tan(Math.PI / input.sides));
    radius = sideLength / (2 * Math.sin(Math.PI / input.sides));
    const interiorNormal = { x: direction * -dy / sideLength, y: direction * dx / sideLength };
    center = {
      x: (construction.first.x + construction.second.x) / 2 + interiorNormal.x * apothem,
      y: (construction.first.y + construction.second.y) / 2 + interiorNormal.y * apothem,
    };
    firstVertexAngleRad = Math.atan2(construction.first.y - center.y, construction.first.x - center.x);
    rotationRad = normalizeAngle(firstVertexAngleRad);
    const vertices = regularVertices(center, radius, input.sides, firstVertexAngleRad, orientation);
    // Preserve the two authoritative edge picks exactly rather than returning trigonometric approximations.
    vertices[0] = { ...construction.first };
    vertices[1] = { ...construction.second };
    return {
      vertices,
      normalized: {
        sides: input.sides,
        mode: construction.mode,
        center: { ...center },
        radius,
        apothem,
        sideLength,
        rotationRad,
        rotationInput: "edge",
        orientation,
      },
    };
  }

  assertPoint(construction.center, "POLYGON center");
  center = { ...construction.center };
  rotationRad = normalizeAngle(construction.rotationRad ?? 0);
  const rotationInput = resolveRotationInput(construction.rotationInput);
  if (construction.mode === "center-inscribed") {
    radius = assertSize(construction.radius, "POLYGON inscribed radius");
    apothem = radius * Math.cos(Math.PI / input.sides);
    firstVertexAngleRad = rotationInput === "radius-point"
      ? rotationRad
      : rotationRad - Math.PI / 2 - direction * Math.PI / input.sides;
  } else {
    apothem = assertSize(construction.apothem, "POLYGON circumscribed apothem");
    radius = apothem / Math.cos(Math.PI / input.sides);
    // A point pick gives the first edge's outward normal. Numeric input follows
    // AutoCAD's current snap rotation and places the bottom edge on that axis.
    const firstEdgeNormal = rotationInput === "radius-point" ? rotationRad : rotationRad - Math.PI / 2;
    firstVertexAngleRad = firstEdgeNormal - direction * Math.PI / input.sides;
  }
  const sideLength = 2 * radius * Math.sin(Math.PI / input.sides);
  return {
    vertices: regularVertices(center, radius, input.sides, firstVertexAngleRad, orientation),
    normalized: {
      sides: input.sides,
      mode: construction.mode,
      center,
      radius,
      apothem,
      sideLength,
      rotationRad,
      rotationInput,
      orientation,
    },
  };
}

export function prepareCompletePolygonCommand(input: CompletePolygonCommandInput): PreparedCompletePolygonCommand {
  if (input.command !== "POLYGON" || input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new PolygonCommandInputError("INVALID_IDENTITY", "POLYGON command, handle and layer are required.");
  }
  const resolved = resolveGeometry(input);
  const signedArea = polygonSignedArea(resolved.vertices);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) <= EPSILON) {
    throw new PolygonCommandInputError("NUMERIC_OVERFLOW", "POLYGON must produce a finite non-degenerate area.");
  }
  const expectedPositiveArea = resolved.normalized.orientation === "counter-clockwise";
  if ((signedArea > 0) !== expectedPositiveArea) {
    throw new PolygonCommandInputError("NUMERIC_OVERFLOW", "POLYGON winding does not match the requested orientation.");
  }
  const entity: CadPolyline = {
    kind: "polyline",
    handle: input.handle,
    layerId: input.layerId,
    vertices: resolved.vertices.map((vertex) => ({ ...vertex })),
    closed: true,
    ...(input.appearance ? { appearance: structuredClone(input.appearance) } : {}),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
  };
  return {
    commandId: "POLYGON",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: structuredClone(entity) }],
    resultHandles: [input.handle],
    normalized: { ...structuredClone(resolved.normalized), signedArea },
  };
}
