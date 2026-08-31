import type { CadAppearance, CadEllipse, CadPoint2 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export type EllipseCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_POINT"
  | "DEGENERATE_AXIS"
  | "INVALID_AXIS_DISTANCE"
  | "MINOR_EXCEEDS_MAJOR"
  | "INVALID_ARC_VALUE"
  | "INVALID_ARC_DIRECTION"
  | "DEGENERATE_ARC"
  | "NUMERIC_OVERFLOW";

export class EllipseCommandInputError extends Error {
  constructor(readonly code: EllipseCommandErrorCode, message: string) {
    super(message);
    this.name = "EllipseCommandInputError";
  }
}

export type EllipseArcDirection = "counter-clockwise" | "clockwise";

export type CompleteEllipseConstruction =
  | {
    mode: "center-major-minor";
    center: CadPoint2;
    majorAxisEnd: CadPoint2;
    minorDistance: number;
  }
  | {
    mode: "axis-endpoints";
    firstAxisEnd: CadPoint2;
    secondAxisEnd: CadPoint2;
    otherAxisDistance: number;
  };

export type EllipseArcDefinition =
  | { mode: "full" }
  | {
    mode: "parameters";
    startParameter: number;
    endParameter: number;
    direction?: EllipseArcDirection;
  }
  | {
    mode: "angles";
    startAngleRad: number;
    endAngleRad: number;
    direction?: EllipseArcDirection;
  };

export interface CompleteEllipseCommandInput {
  command: "ELLIPSE";
  handle: string;
  layerId: string;
  construction: CompleteEllipseConstruction;
  arc?: EllipseArcDefinition;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface NormalizedEllipseDefinition {
  constructionMode: CompleteEllipseConstruction["mode"];
  center: CadPoint2;
  majorAxis: CadPoint2;
  majorRadius: number;
  minorRadius: number;
  ratio: number;
  rotationRad: number;
  firstAxisWasMajor: boolean;
  shape: "full" | "arc";
  arcInputMode: EllipseArcDefinition["mode"];
  direction: EllipseArcDirection;
  requestedStartParameter: number;
  requestedEndParameter: number;
  storedStartParameter: number;
  storedEndParameter: number;
  sweepParameterRad: number;
  requestedStartPoint: CadPoint2;
  requestedEndPoint: CadPoint2;
}

export interface PreparedCompleteEllipseCommand {
  commandId: "ELLIPSE";
  entity: CadEllipse;
  entities: [CadEllipse];
  changes: [EntityChange & { type: "put"; entity: CadEllipse }];
  resultHandles: [string];
  normalized: NormalizedEllipseDefinition;
}

interface ResolvedAxes {
  constructionMode: CompleteEllipseConstruction["mode"];
  center: CadPoint2;
  majorAxis: CadPoint2;
  majorRadius: number;
  minorRadius: number;
  firstAxisWasMajor: boolean;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new EllipseCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function positiveDistance(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= EPSILON) {
    throw new EllipseCommandInputError("INVALID_AXIS_DISTANCE", `${label} must be finite and greater than ${EPSILON}.`);
  }
  return value;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function counterClockwiseSweep(start: number, end: number): number {
  return normalizeAngle(end - start);
}

function finiteArcValue(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new EllipseCommandInputError("INVALID_ARC_VALUE", `${label} must be finite.`);
  }
  return normalizeAngle(value);
}

function arcDirection(value: EllipseArcDirection | undefined): EllipseArcDirection {
  const direction = value ?? "counter-clockwise";
  if (direction !== "counter-clockwise" && direction !== "clockwise") {
    throw new EllipseCommandInputError("INVALID_ARC_DIRECTION", "ELLIPSE arc direction must be counter-clockwise or clockwise.");
  }
  return direction;
}

function vectorLength(vector: CadPoint2): number {
  return Math.hypot(vector.x, vector.y);
}

function canonicalCoordinate(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function safeMidpoint(first: CadPoint2, second: CadPoint2): CadPoint2 {
  const center = { x: first.x / 2 + second.x / 2, y: first.y / 2 + second.y / 2 };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new EllipseCommandInputError("NUMERIC_OVERFLOW", "ELLIPSE center calculation exceeded finite numeric range.");
  }
  return center;
}

function resolveAxes(construction: CompleteEllipseConstruction): ResolvedAxes {
  if (construction.mode === "center-major-minor") {
    assertPoint(construction.center, "ELLIPSE center");
    assertPoint(construction.majorAxisEnd, "ELLIPSE major-axis endpoint");
    const majorAxis = {
      x: construction.majorAxisEnd.x - construction.center.x,
      y: construction.majorAxisEnd.y - construction.center.y,
    };
    const majorRadius = vectorLength(majorAxis);
    if (!(Number.isFinite(majorRadius) && majorRadius > EPSILON)) {
      throw new EllipseCommandInputError("DEGENERATE_AXIS", "ELLIPSE center and major-axis endpoint must differ by more than numeric tolerance.");
    }
    const requestedMinor = positiveDistance(construction.minorDistance, "ELLIPSE minor-axis distance");
    if (requestedMinor > majorRadius + EPSILON) {
      throw new EllipseCommandInputError("MINOR_EXCEEDS_MAJOR", "ELLIPSE center construction requires minor distance at most the selected major radius.");
    }
    return {
      constructionMode: construction.mode,
      center: { ...construction.center },
      majorAxis,
      majorRadius,
      minorRadius: Math.min(requestedMinor, majorRadius),
      firstAxisWasMajor: true,
    };
  }

  assertPoint(construction.firstAxisEnd, "ELLIPSE first axis endpoint");
  assertPoint(construction.secondAxisEnd, "ELLIPSE second axis endpoint");
  const center = safeMidpoint(construction.firstAxisEnd, construction.secondAxisEnd);
  const firstAxis = {
    x: construction.secondAxisEnd.x / 2 - construction.firstAxisEnd.x / 2,
    y: construction.secondAxisEnd.y / 2 - construction.firstAxisEnd.y / 2,
  };
  const firstRadius = vectorLength(firstAxis);
  if (!(Number.isFinite(firstRadius) && firstRadius > EPSILON)) {
    throw new EllipseCommandInputError("DEGENERATE_AXIS", "ELLIPSE first-axis endpoints must differ by more than numeric tolerance.");
  }
  const otherRadius = positiveDistance(construction.otherAxisDistance, "ELLIPSE other-axis distance");
  if (otherRadius <= firstRadius + EPSILON) {
    return {
      constructionMode: construction.mode,
      center,
      majorAxis: firstAxis,
      majorRadius: firstRadius,
      minorRadius: Math.min(otherRadius, firstRadius),
      firstAxisWasMajor: true,
    };
  }
  const firstUnit = { x: firstAxis.x / firstRadius, y: firstAxis.y / firstRadius };
  const majorAxis = {
    x: canonicalCoordinate(-firstUnit.y * otherRadius),
    y: canonicalCoordinate(firstUnit.x * otherRadius),
  };
  if (!Number.isFinite(majorAxis.x) || !Number.isFinite(majorAxis.y)) {
    throw new EllipseCommandInputError("NUMERIC_OVERFLOW", "ELLIPSE major-axis calculation exceeded finite numeric range.");
  }
  return {
    constructionMode: construction.mode,
    center,
    majorAxis,
    majorRadius: otherRadius,
    minorRadius: firstRadius,
    firstAxisWasMajor: false,
  };
}

function ellipsePoint(axes: ResolvedAxes, parameter: number): CadPoint2 {
  const majorUnit = { x: axes.majorAxis.x / axes.majorRadius, y: axes.majorAxis.y / axes.majorRadius };
  const minorAxis = { x: -majorUnit.y * axes.minorRadius, y: majorUnit.x * axes.minorRadius };
  const point = {
    x: axes.center.x + axes.majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
    y: axes.center.y + axes.majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter),
  };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new EllipseCommandInputError("NUMERIC_OVERFLOW", "ELLIPSE point calculation exceeded finite numeric range.");
  }
  return point;
}

function polarAngleToParameter(angle: number, majorRadius: number, minorRadius: number): number {
  return normalizeAngle(Math.atan2(majorRadius * Math.sin(angle), minorRadius * Math.cos(angle)));
}

function resolveArc(axes: ResolvedAxes, definition: EllipseArcDefinition | undefined): Omit<NormalizedEllipseDefinition,
  "constructionMode" | "center" | "majorAxis" | "majorRadius" | "minorRadius" | "ratio" | "rotationRad" | "firstAxisWasMajor"> {
  const arc = definition ?? { mode: "full" as const };
  if (arc.mode === "full") {
    return {
      shape: "full",
      arcInputMode: "full",
      direction: "counter-clockwise",
      requestedStartParameter: 0,
      requestedEndParameter: TWO_PI,
      storedStartParameter: 0,
      storedEndParameter: TWO_PI,
      sweepParameterRad: TWO_PI,
      requestedStartPoint: ellipsePoint(axes, 0),
      requestedEndPoint: ellipsePoint(axes, TWO_PI),
    };
  }
  const direction = arcDirection(arc.direction);
  const requestedStart = arc.mode === "parameters"
    ? finiteArcValue(arc.startParameter, "ELLIPSE start parameter")
    : polarAngleToParameter(finiteArcValue(arc.startAngleRad, "ELLIPSE start angle"), axes.majorRadius, axes.minorRadius);
  const requestedEnd = arc.mode === "parameters"
    ? finiteArcValue(arc.endParameter, "ELLIPSE end parameter")
    : polarAngleToParameter(finiteArcValue(arc.endAngleRad, "ELLIPSE end angle"), axes.majorRadius, axes.minorRadius);
  const sweepParameterRad = direction === "counter-clockwise"
    ? counterClockwiseSweep(requestedStart, requestedEnd)
    : counterClockwiseSweep(requestedEnd, requestedStart);
  if (sweepParameterRad <= EPSILON) {
    throw new EllipseCommandInputError("DEGENERATE_ARC", "ELLIPSE arc start and end must differ; use full mode for a closed ellipse.");
  }
  const storedStartParameter = direction === "counter-clockwise" ? requestedStart : requestedEnd;
  const storedEndParameter = direction === "counter-clockwise" ? requestedEnd : requestedStart;
  return {
    shape: "arc",
    arcInputMode: arc.mode,
    direction,
    requestedStartParameter: requestedStart,
    requestedEndParameter: requestedEnd,
    storedStartParameter,
    storedEndParameter,
    sweepParameterRad,
    requestedStartPoint: ellipsePoint(axes, requestedStart),
    requestedEndPoint: ellipsePoint(axes, requestedEnd),
  };
}

export function prepareCompleteEllipseCommand(input: CompleteEllipseCommandInput): PreparedCompleteEllipseCommand {
  if (input.command !== "ELLIPSE" || input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new EllipseCommandInputError("INVALID_IDENTITY", "ELLIPSE command, handle and layer are required.");
  }
  const axes = resolveAxes(input.construction);
  const ratio = axes.minorRadius / axes.majorRadius;
  if (!(Number.isFinite(ratio) && ratio > 0 && ratio <= 1)) {
    throw new EllipseCommandInputError("NUMERIC_OVERFLOW", "ELLIPSE axis ratio must remain finite and in (0, 1].");
  }
  for (const parameter of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) ellipsePoint(axes, parameter);
  const arc = resolveArc(axes, input.arc);
  const entity: CadEllipse = {
    kind: "ellipse",
    handle: input.handle,
    layerId: input.layerId,
    center: { ...axes.center },
    majorAxis: { ...axes.majorAxis },
    ratio,
    startParameter: arc.storedStartParameter,
    endParameter: arc.storedEndParameter,
    ...(input.appearance ? { appearance: structuredClone(input.appearance) } : {}),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
  };
  const normalized: NormalizedEllipseDefinition = {
    constructionMode: axes.constructionMode,
    center: { ...axes.center },
    majorAxis: { ...axes.majorAxis },
    majorRadius: axes.majorRadius,
    minorRadius: axes.minorRadius,
    ratio,
    rotationRad: normalizeAngle(Math.atan2(axes.majorAxis.y, axes.majorAxis.x)),
    firstAxisWasMajor: axes.firstAxisWasMajor,
    ...arc,
  };
  return {
    commandId: "ELLIPSE",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: structuredClone(entity) }],
    resultHandles: [input.handle],
    normalized: structuredClone(normalized),
  };
}
