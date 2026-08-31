import type { CadAppearance, CadPoint2, CadPolyline, CadPolylineVertex } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const TWO_PI = Math.PI * 2;

export type RectangleCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_POINT"
  | "INVALID_DIMENSION"
  | "INVALID_AREA"
  | "INVALID_ROTATION"
  | "INVALID_CHAMFER"
  | "INVALID_FILLET"
  | "INVALID_WIDTH"
  | "UNSUPPORTED_ELEVATION"
  | "INVALID_THICKNESS"
  | "CONFLICTING_CORNER_STYLE";

export class RectangleCommandInputError extends Error {
  constructor(readonly code: RectangleCommandErrorCode, message: string) {
    super(message);
    this.name = "RectangleCommandInputError";
  }
}

export interface RectangleDirection {
  length: 1 | -1;
  width: 1 | -1;
}

export type RectangleConstruction =
  | { mode: "corners"; firstCorner: CadPoint2; otherCorner: CadPoint2 }
  | { mode: "dimensions"; firstCorner: CadPoint2; length: number; width: number; direction?: RectangleDirection }
  | {
    mode: "area";
    firstCorner: CadPoint2;
    area: number;
    knownDimension: { axis: "length" | "width"; value: number };
    direction?: RectangleDirection;
  };

export interface RectangleChamfer {
  firstDistance: number;
  secondDistance: number;
}

export interface RectangleCommandInput {
  command: "RECTANGLE";
  handle: string;
  layerId: string;
  construction: RectangleConstruction;
  rotationRad?: number;
  chamfer?: RectangleChamfer;
  filletRadius?: number;
  width?: number;
  elevation?: number;
  thickness?: number;
  appearance?: Omit<CadAppearance, "thickness">;
  extensionData?: Record<string, unknown>;
}

export interface NormalizedRectangleDefinition {
  firstCorner: CadPoint2;
  length: number;
  width: number;
  rotationRad: number;
  direction: RectangleDirection;
  clockwise: boolean;
  chamfer: RectangleChamfer | null;
  filletRadius: number;
  polylineWidth: number;
  elevation: 0;
  thickness: number;
}

export interface PreparedRectangleCommand {
  commandId: "RECTANGLE";
  entity: CadPolyline;
  entities: [CadPolyline];
  changes: [EntityChange & { type: "put"; entity: CadPolyline }];
  resultHandles: [string];
  normalized: NormalizedRectangleDefinition;
}

interface RectangleFrame {
  points: [CadPoint2, CadPoint2, CadPoint2, CadPoint2];
  lengthAxis: CadPoint2;
  widthAxis: CadPoint2;
  definition: Omit<NormalizedRectangleDefinition, "chamfer" | "filletRadius" | "polylineWidth" | "elevation" | "thickness">;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RectangleCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function positive(value: number, code: RectangleCommandErrorCode, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RectangleCommandInputError(code, `${label} must be finite and greater than zero.`);
  }
  return value;
}

function nonNegative(value: number, code: RectangleCommandErrorCode, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RectangleCommandInputError(code, `${label} must be finite and non-negative.`);
  }
  return value;
}

function normalizedAngle(angle: number): number {
  if (!Number.isFinite(angle)) {
    throw new RectangleCommandInputError("INVALID_ROTATION", "Rectangle rotation must be finite.");
  }
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function addScaled(origin: CadPoint2, axis: CadPoint2, distance: number): CadPoint2 {
  return { x: origin.x + axis.x * distance, y: origin.y + axis.y * distance };
}

function buildFrame(construction: RectangleConstruction, rotationRad: number): RectangleFrame {
  assertPoint(construction.firstCorner, "Rectangle first corner");
  const baseLengthAxis = { x: Math.cos(rotationRad), y: Math.sin(rotationRad) };
  const baseWidthAxis = { x: -Math.sin(rotationRad), y: Math.cos(rotationRad) };
  let length: number;
  let width: number;
  let direction: RectangleDirection;

  if (construction.mode === "corners") {
    assertPoint(construction.otherCorner, "Rectangle other corner");
    const delta = {
      x: construction.otherCorner.x - construction.firstCorner.x,
      y: construction.otherCorner.y - construction.firstCorner.y,
    };
    const signedLength = delta.x * baseLengthAxis.x + delta.y * baseLengthAxis.y;
    const signedWidth = delta.x * baseWidthAxis.x + delta.y * baseWidthAxis.y;
    length = positive(Math.abs(signedLength), "INVALID_DIMENSION", "Rectangle length");
    width = positive(Math.abs(signedWidth), "INVALID_DIMENSION", "Rectangle width");
    direction = { length: signedLength < 0 ? -1 : 1, width: signedWidth < 0 ? -1 : 1 };
  } else if (construction.mode === "dimensions") {
    length = positive(construction.length, "INVALID_DIMENSION", "Rectangle length");
    width = positive(construction.width, "INVALID_DIMENSION", "Rectangle width");
    direction = construction.direction ?? { length: 1, width: 1 };
  } else {
    const area = positive(construction.area, "INVALID_AREA", "Rectangle area");
    const known = positive(construction.knownDimension.value, "INVALID_DIMENSION", "Rectangle known dimension");
    if (construction.knownDimension.axis === "length") {
      length = known;
      width = positive(area / known, "INVALID_DIMENSION", "Derived rectangle width");
    } else {
      width = known;
      length = positive(area / known, "INVALID_DIMENSION", "Derived rectangle length");
    }
    direction = construction.direction ?? { length: 1, width: 1 };
  }

  if ((direction.length !== 1 && direction.length !== -1) || (direction.width !== 1 && direction.width !== -1)) {
    throw new RectangleCommandInputError("INVALID_DIMENSION", "Rectangle direction values must be 1 or -1.");
  }

  const lengthAxis = {
    x: baseLengthAxis.x * direction.length,
    y: baseLengthAxis.y * direction.length,
  };
  const widthAxis = {
    x: baseWidthAxis.x * direction.width,
    y: baseWidthAxis.y * direction.width,
  };
  const first = { ...construction.firstCorner };
  const second = addScaled(first, lengthAxis, length);
  const fourth = addScaled(first, widthAxis, width);
  const third = addScaled(second, widthAxis, width);
  return {
    points: [first, second, third, fourth],
    lengthAxis,
    widthAxis,
    definition: {
      firstCorner: first,
      length,
      width,
      rotationRad,
      direction: { ...direction },
      clockwise: direction.length * direction.width < 0,
    },
  };
}

function vertex(point: CadPoint2, width: number, bulge?: number): CadPolylineVertex {
  return {
    x: point.x,
    y: point.y,
    ...(bulge === undefined ? {} : { bulge }),
    ...(width === 0 ? {} : { startWidth: width, endWidth: width }),
  };
}

function plainVertices(frame: RectangleFrame, width: number): CadPolylineVertex[] {
  return frame.points.map((point) => vertex(point, width));
}

function chamferedVertices(frame: RectangleFrame, chamfer: RectangleChamfer, width: number): CadPolylineVertex[] {
  const [first, second, third, fourth] = frame.points;
  const alongLength = chamfer.firstDistance;
  const alongWidth = chamfer.secondDistance;
  return [
    addScaled(first, frame.lengthAxis, alongLength),
    addScaled(second, frame.lengthAxis, -alongLength),
    addScaled(second, frame.widthAxis, alongWidth),
    addScaled(third, frame.widthAxis, -alongWidth),
    addScaled(third, frame.lengthAxis, -alongLength),
    addScaled(fourth, frame.lengthAxis, alongLength),
    addScaled(fourth, frame.widthAxis, -alongWidth),
    addScaled(first, frame.widthAxis, alongWidth),
  ].map((point) => vertex(point, width));
}

function filletedVertices(frame: RectangleFrame, radius: number, width: number): CadPolylineVertex[] {
  const [first, second, third, fourth] = frame.points;
  const signedBulge = (frame.definition.clockwise ? -1 : 1) * Math.tan(Math.PI / 8);
  const points = [
    addScaled(first, frame.lengthAxis, radius),
    addScaled(second, frame.lengthAxis, -radius),
    addScaled(second, frame.widthAxis, radius),
    addScaled(third, frame.widthAxis, -radius),
    addScaled(third, frame.lengthAxis, -radius),
    addScaled(fourth, frame.lengthAxis, radius),
    addScaled(fourth, frame.widthAxis, -radius),
    addScaled(first, frame.widthAxis, radius),
  ];
  return points.map((point, index) => vertex(point, width, index % 2 === 1 ? signedBulge : undefined));
}

function normalizeOptions(input: RectangleCommandInput, frame: RectangleFrame): Pick<NormalizedRectangleDefinition, "chamfer" | "filletRadius" | "polylineWidth" | "elevation" | "thickness"> {
  const chamfer = input.chamfer === undefined ? null : {
    firstDistance: nonNegative(input.chamfer.firstDistance, "INVALID_CHAMFER", "Rectangle first chamfer distance"),
    secondDistance: nonNegative(input.chamfer.secondDistance, "INVALID_CHAMFER", "Rectangle second chamfer distance"),
  };
  const activeChamfer = chamfer !== null && (chamfer.firstDistance > 0 || chamfer.secondDistance > 0);
  const filletRadius = nonNegative(input.filletRadius ?? 0, "INVALID_FILLET", "Rectangle fillet radius");
  if (activeChamfer && filletRadius > 0) {
    throw new RectangleCommandInputError("CONFLICTING_CORNER_STYLE", "Rectangle Chamfer and Fillet cannot both be active.");
  }
  if (activeChamfer && (2 * chamfer.firstDistance >= frame.definition.length
    || 2 * chamfer.secondDistance >= frame.definition.width)) {
    throw new RectangleCommandInputError("INVALID_CHAMFER", "Rectangle chamfer distances must leave non-zero straight edges.");
  }
  if (2 * filletRadius >= Math.min(frame.definition.length, frame.definition.width)) {
    throw new RectangleCommandInputError("INVALID_FILLET", "Rectangle fillet radius must leave non-zero straight edges.");
  }
  const polylineWidth = nonNegative(input.width ?? 0, "INVALID_WIDTH", "Rectangle polyline width");
  const elevation = input.elevation ?? 0;
  if (!Number.isFinite(elevation)) {
    throw new RectangleCommandInputError("UNSUPPORTED_ELEVATION", "Rectangle elevation must be finite.");
  }
  if (elevation !== 0) {
    throw new RectangleCommandInputError("UNSUPPORTED_ELEVATION", "Non-zero RECTANGLE Elevation is unsupported by the pinned 2D schema.");
  }
  const thickness = input.thickness ?? 0;
  if (!Number.isFinite(thickness)) {
    throw new RectangleCommandInputError("INVALID_THICKNESS", "Rectangle thickness must be finite.");
  }
  return {
    chamfer: activeChamfer ? chamfer : null,
    filletRadius,
    polylineWidth,
    elevation: 0,
    thickness: thickness === 0 ? 0 : thickness,
  };
}

export function prepareRectangleCommand(input: RectangleCommandInput): PreparedRectangleCommand {
  if (input.command !== "RECTANGLE" || input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new RectangleCommandInputError("INVALID_IDENTITY", "Rectangle command, handle and layer are required.");
  }
  const rotationRad = normalizedAngle(input.rotationRad ?? 0);
  const frame = buildFrame(input.construction, rotationRad);
  const options = normalizeOptions(input, frame);
  const vertices = options.chamfer
    ? chamferedVertices(frame, options.chamfer, options.polylineWidth)
    : options.filletRadius > 0
      ? filletedVertices(frame, options.filletRadius, options.polylineWidth)
      : plainVertices(frame, options.polylineWidth);
  const appearance = {
    ...(input.appearance ? structuredClone(input.appearance) : {}),
    ...(options.thickness === 0 ? {} : { thickness: options.thickness }),
  };
  const entity: CadPolyline = {
    kind: "polyline",
    handle: input.handle,
    layerId: input.layerId,
    closed: true,
    vertices,
    ...(Object.keys(appearance).length === 0 ? {} : { appearance }),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
  };
  const committedEntity = structuredClone(entity);
  return {
    commandId: "RECTANGLE",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: committedEntity }],
    resultHandles: [input.handle],
    normalized: { ...frame.definition, ...options },
  };
}
