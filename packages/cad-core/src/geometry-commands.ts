import type {
  CadArc,
  CadCircle,
  CadEllipse,
  CadEntity,
  CadLine,
  CadPoint2,
  CadPolyline,
  CadPolylineVertex,
} from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export class GeometryCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryCommandInputError";
  }
}

interface EntityIdentity {
  handle: string;
  layerId: string;
}

export interface LineCommandInput {
  command: "LINE";
  handles: string[];
  layerId: string;
  points: CadPoint2[];
  close?: boolean;
}

export interface PlineCommandInput extends EntityIdentity {
  command: "PLINE";
  vertices: CadPolylineVertex[];
  closed?: boolean;
}

export type CircleConstruction =
  | { mode: "center-radius"; center: CadPoint2; radius: number }
  | { mode: "center-diameter"; center: CadPoint2; diameter: number }
  | { mode: "2p"; first: CadPoint2; second: CadPoint2 }
  | { mode: "3p"; first: CadPoint2; second: CadPoint2; third: CadPoint2 };

export interface CircleCommandInput extends EntityIdentity {
  command: "CIRCLE";
  construction: CircleConstruction;
}

export type ArcConstruction =
  | { mode: "3p"; start: CadPoint2; point: CadPoint2; end: CadPoint2 }
  | { mode: "start-center-end"; start: CadPoint2; center: CadPoint2; end: CadPoint2; counterClockwise?: boolean }
  | { mode: "start-center-angle"; start: CadPoint2; center: CadPoint2; includedAngleRad: number }
  | { mode: "start-end-angle"; start: CadPoint2; end: CadPoint2; includedAngleRad: number }
  | { mode: "center-start-end"; center: CadPoint2; start: CadPoint2; end: CadPoint2; counterClockwise?: boolean };

export interface ArcCommandInput extends EntityIdentity {
  command: "ARC";
  construction: ArcConstruction;
}

export type PolygonConstruction =
  | { mode: "inscribed"; center: CadPoint2; radiusPoint: CadPoint2 }
  | { mode: "circumscribed"; center: CadPoint2; apothemPoint: CadPoint2 }
  | { mode: "edge"; first: CadPoint2; second: CadPoint2; side?: "left" | "right" };

export interface PolygonCommandInput extends EntityIdentity {
  command: "POLYGON";
  sides: number;
  construction: PolygonConstruction;
}

export type EllipseConstruction =
  | { mode: "axis-end"; firstAxisEnd: CadPoint2; secondAxisEnd: CadPoint2; minorRadius: number }
  | { mode: "center"; center: CadPoint2; majorAxisEnd: CadPoint2; minorRadius: number };

export interface EllipseCommandInput extends EntityIdentity {
  command: "ELLIPSE";
  construction: EllipseConstruction;
  startParameter?: number;
  endParameter?: number;
}

export interface RevcloudCommandInput extends EntityIdentity {
  command: "REVCLOUD";
  outline: CadPoint2[];
  arcLengthMin: number;
  arcLengthMax: number;
  style?: "normal" | "calligraphy";
}

export type GeometryCommandInput =
  | LineCommandInput
  | PlineCommandInput
  | CircleCommandInput
  | ArcCommandInput
  | PolygonCommandInput
  | EllipseCommandInput
  | RevcloudCommandInput;

export interface PreparedGeometryCommand {
  commandId: GeometryCommandInput["command"];
  entities: CadEntity[];
  changes: EntityChange[];
  resultHandles: string[];
}

export const GEOMETRY_COMMAND_ALIASES = Object.freeze({
  L: "LINE",
  LINE: "LINE",
  PL: "PLINE",
  PLINE: "PLINE",
  C: "CIRCLE",
  CIRCLE: "CIRCLE",
  A: "ARC",
  ARC: "ARC",
  POL: "POLYGON",
  POLYGON: "POLYGON",
  EL: "ELLIPSE",
  ELLIPSE: "ELLIPSE",
  REVCLOUD: "REVCLOUD",
} satisfies Record<string, GeometryCommandInput["command"]>);

function assertHandle(handle: string): void {
  if (handle.trim() === "") throw new GeometryCommandInputError("Entity handle must not be empty.");
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new GeometryCommandInputError(`${label} must contain finite coordinates.`);
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= EPSILON) {
    throw new GeometryCommandInputError(`${label} must be a finite positive value.`);
  }
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function samePoint(first: CadPoint2, second: CadPoint2): boolean {
  return distance(first, second) <= EPSILON;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function ccwSweep(start: number, end: number): number {
  return normalizeAngle(end - start);
}

function circleThroughThreePoints(first: CadPoint2, second: CadPoint2, third: CadPoint2): { center: CadPoint2; radius: number } {
  assertPoint(first, "First point");
  assertPoint(second, "Second point");
  assertPoint(third, "Third point");
  const determinant = 2 * (first.x * (second.y - third.y) + second.x * (third.y - first.y) + third.x * (first.y - second.y));
  if (Math.abs(determinant) <= EPSILON) {
    throw new GeometryCommandInputError("Three-point construction requires non-collinear points.");
  }
  const firstSquared = first.x ** 2 + first.y ** 2;
  const secondSquared = second.x ** 2 + second.y ** 2;
  const thirdSquared = third.x ** 2 + third.y ** 2;
  const center = {
    x: (firstSquared * (second.y - third.y) + secondSquared * (third.y - first.y) + thirdSquared * (first.y - second.y)) / determinant,
    y: (firstSquared * (third.x - second.x) + secondSquared * (first.x - third.x) + thirdSquared * (second.x - first.x)) / determinant,
  };
  return { center, radius: distance(center, first) };
}

function createCircle(input: CircleCommandInput): CadCircle {
  const { construction } = input;
  let center: CadPoint2;
  let radius: number;
  switch (construction.mode) {
    case "center-radius":
      assertPoint(construction.center, "Circle center");
      assertFinitePositive(construction.radius, "Circle radius");
      center = construction.center;
      radius = construction.radius;
      break;
    case "center-diameter":
      assertPoint(construction.center, "Circle center");
      assertFinitePositive(construction.diameter, "Circle diameter");
      center = construction.center;
      radius = construction.diameter / 2;
      break;
    case "2p":
      assertPoint(construction.first, "First diameter point");
      assertPoint(construction.second, "Second diameter point");
      if (samePoint(construction.first, construction.second)) throw new GeometryCommandInputError("Circle diameter points must differ.");
      center = { x: (construction.first.x + construction.second.x) / 2, y: (construction.first.y + construction.second.y) / 2 };
      radius = distance(construction.first, construction.second) / 2;
      break;
    case "3p": {
      const result = circleThroughThreePoints(construction.first, construction.second, construction.third);
      center = result.center;
      radius = result.radius;
      break;
    }
  }
  return { kind: "circle", handle: input.handle, layerId: input.layerId, center: { ...center }, radius };
}

function createArc(input: ArcCommandInput): CadArc {
  const { construction } = input;
  let center: CadPoint2;
  let radius: number;
  let startAngleRad: number;
  let endAngleRad: number;
  let counterClockwise: boolean;
  if (construction.mode === "3p") {
    const result = circleThroughThreePoints(construction.start, construction.point, construction.end);
    center = result.center;
    radius = result.radius;
    startAngleRad = normalizeAngle(Math.atan2(construction.start.y - center.y, construction.start.x - center.x));
    endAngleRad = normalizeAngle(Math.atan2(construction.end.y - center.y, construction.end.x - center.x));
    const pointAngle = normalizeAngle(Math.atan2(construction.point.y - center.y, construction.point.x - center.x));
    counterClockwise = ccwSweep(startAngleRad, pointAngle) <= ccwSweep(startAngleRad, endAngleRad) + EPSILON;
  } else if (construction.mode === "start-end-angle") {
    assertPoint(construction.start, "Arc start");
    assertPoint(construction.end, "Arc end");
    if (samePoint(construction.start, construction.end)) throw new GeometryCommandInputError("Arc endpoints must differ.");
    const angle = construction.includedAngleRad;
    if (!Number.isFinite(angle) || Math.abs(angle) <= EPSILON || Math.abs(angle) >= TWO_PI - EPSILON) {
      throw new GeometryCommandInputError("Included angle must be finite, non-zero, and less than 2π.");
    }
    const chord = distance(construction.start, construction.end);
    const dx = construction.end.x - construction.start.x;
    const dy = construction.end.y - construction.start.y;
    const offset = chord / (2 * Math.tan(angle / 2));
    center = {
      x: (construction.start.x + construction.end.x) / 2 + (-dy / chord) * offset,
      y: (construction.start.y + construction.end.y) / 2 + (dx / chord) * offset,
    };
    radius = distance(center, construction.start);
    startAngleRad = normalizeAngle(Math.atan2(construction.start.y - center.y, construction.start.x - center.x));
    endAngleRad = normalizeAngle(Math.atan2(construction.end.y - center.y, construction.end.x - center.x));
    counterClockwise = angle > 0;
  } else {
    const centerConstruction = construction;
    assertPoint(centerConstruction.center, "Arc center");
    assertPoint(centerConstruction.start, "Arc start");
    if (samePoint(centerConstruction.center, centerConstruction.start)) throw new GeometryCommandInputError("Arc start must differ from its center.");
    center = centerConstruction.center;
    radius = distance(center, centerConstruction.start);
    startAngleRad = normalizeAngle(Math.atan2(centerConstruction.start.y - center.y, centerConstruction.start.x - center.x));
    if (centerConstruction.mode === "start-center-angle") {
      const angle = centerConstruction.includedAngleRad;
      if (!Number.isFinite(angle) || Math.abs(angle) <= EPSILON || Math.abs(angle) >= TWO_PI - EPSILON) {
        throw new GeometryCommandInputError("Included angle must be finite, non-zero, and less than 2π.");
      }
      endAngleRad = normalizeAngle(startAngleRad + angle);
      counterClockwise = angle > 0;
    } else {
      assertPoint(centerConstruction.end, "Arc end");
      if (samePoint(centerConstruction.center, centerConstruction.end)) throw new GeometryCommandInputError("Arc end must differ from its center.");
      endAngleRad = normalizeAngle(Math.atan2(centerConstruction.end.y - center.y, centerConstruction.end.x - center.x));
      counterClockwise = centerConstruction.counterClockwise ?? true;
      if (Math.abs(ccwSweep(startAngleRad, endAngleRad)) <= EPSILON) throw new GeometryCommandInputError("Arc start and end angles must differ.");
    }
  }
  return { kind: "arc", handle: input.handle, layerId: input.layerId, center: { ...center }, radius, startAngleRad, endAngleRad, counterClockwise };
}

function createPolygon(input: PolygonCommandInput): CadPolyline {
  if (!Number.isInteger(input.sides) || input.sides < 3 || input.sides > 1024) {
    throw new GeometryCommandInputError("Polygon side count must be an integer from 3 to 1024.");
  }
  const { construction } = input;
  let center: CadPoint2;
  let vertexRadius: number;
  let startAngle: number;
  if (construction.mode === "edge") {
    assertPoint(construction.first, "First edge point");
    assertPoint(construction.second, "Second edge point");
    const sideLength = distance(construction.first, construction.second);
    assertFinitePositive(sideLength, "Polygon edge length");
    const dx = construction.second.x - construction.first.x;
    const dy = construction.second.y - construction.first.y;
    const direction = construction.side === "right" ? -1 : 1;
    const apothem = sideLength / (2 * Math.tan(Math.PI / input.sides));
    center = {
      x: (construction.first.x + construction.second.x) / 2 + direction * (-dy / sideLength) * apothem,
      y: (construction.first.y + construction.second.y) / 2 + direction * (dx / sideLength) * apothem,
    };
    vertexRadius = distance(center, construction.first);
    startAngle = Math.atan2(construction.first.y - center.y, construction.first.x - center.x);
  } else {
    assertPoint(construction.center, "Polygon center");
    const radiusPoint = construction.mode === "inscribed" ? construction.radiusPoint : construction.apothemPoint;
    assertPoint(radiusPoint, "Polygon radius point");
    const suppliedRadius = distance(construction.center, radiusPoint);
    assertFinitePositive(suppliedRadius, "Polygon radius");
    center = construction.center;
    vertexRadius = construction.mode === "inscribed" ? suppliedRadius : suppliedRadius / Math.cos(Math.PI / input.sides);
    startAngle = Math.atan2(radiusPoint.y - center.y, radiusPoint.x - center.x);
  }
  const direction = construction.mode === "edge" && construction.side === "right" ? -1 : 1;
  const vertices = Array.from({ length: input.sides }, (_, index) => {
    const angle = startAngle + direction * index * TWO_PI / input.sides;
    return { x: center.x + vertexRadius * Math.cos(angle), y: center.y + vertexRadius * Math.sin(angle) };
  });
  return { kind: "polyline", handle: input.handle, layerId: input.layerId, vertices, closed: true };
}

function createEllipse(input: EllipseCommandInput): CadEllipse {
  const { construction } = input;
  let center: CadPoint2;
  let majorAxis: CadPoint2;
  if (construction.mode === "axis-end") {
    assertPoint(construction.firstAxisEnd, "First axis endpoint");
    assertPoint(construction.secondAxisEnd, "Second axis endpoint");
    center = {
      x: (construction.firstAxisEnd.x + construction.secondAxisEnd.x) / 2,
      y: (construction.firstAxisEnd.y + construction.secondAxisEnd.y) / 2,
    };
    majorAxis = { x: construction.secondAxisEnd.x - center.x, y: construction.secondAxisEnd.y - center.y };
  } else {
    assertPoint(construction.center, "Ellipse center");
    assertPoint(construction.majorAxisEnd, "Ellipse major-axis endpoint");
    center = construction.center;
    majorAxis = { x: construction.majorAxisEnd.x - center.x, y: construction.majorAxisEnd.y - center.y };
  }
  const majorRadius = Math.hypot(majorAxis.x, majorAxis.y);
  assertFinitePositive(majorRadius, "Ellipse major radius");
  assertFinitePositive(construction.minorRadius, "Ellipse minor radius");
  if (construction.minorRadius > majorRadius + EPSILON) {
    throw new GeometryCommandInputError("Ellipse minor radius must not exceed the selected major radius.");
  }
  const startParameter = input.startParameter ?? 0;
  const endParameter = input.endParameter ?? TWO_PI;
  if (!Number.isFinite(startParameter) || !Number.isFinite(endParameter) || Math.abs(endParameter - startParameter) <= EPSILON) {
    throw new GeometryCommandInputError("Ellipse arc parameters must be finite and distinct.");
  }
  return {
    kind: "ellipse",
    handle: input.handle,
    layerId: input.layerId,
    center: { ...center },
    majorAxis,
    ratio: construction.minorRadius / majorRadius,
    startParameter,
    endParameter,
  };
}

function createRevcloud(input: RevcloudCommandInput): CadPolyline {
  assertFinitePositive(input.arcLengthMin, "Revision-cloud minimum arc length");
  assertFinitePositive(input.arcLengthMax, "Revision-cloud maximum arc length");
  if (input.arcLengthMin > input.arcLengthMax) {
    throw new GeometryCommandInputError("Revision-cloud minimum arc length must not exceed its maximum.");
  }
  if (input.outline.length < 3) throw new GeometryCommandInputError("Revision cloud requires at least three outline points.");
  input.outline.forEach((point, index) => assertPoint(point, `Revision-cloud outline point ${index + 1}`));
  const points = samePoint(input.outline[0]!, input.outline.at(-1)!) ? input.outline.slice(0, -1) : [...input.outline];
  if (points.length < 3) throw new GeometryCommandInputError("Revision cloud requires at least three distinct outline points.");
  const targetLength = (input.arcLengthMin + input.arcLengthMax) / 2;
  const bulge = Math.tan((Math.PI * 2 / 3) / 4) * (input.style === "calligraphy" ? 0.75 : 1);
  const vertices: CadPolylineVertex[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const segmentLength = distance(start, end);
    assertFinitePositive(segmentLength, "Revision-cloud outline segment length");
    const subdivisions = Math.max(1, Math.round(segmentLength / targetLength));
    for (let part = 0; part < subdivisions; part += 1) {
      const ratio = part / subdivisions;
      vertices.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio, bulge });
    }
  }
  return { kind: "polyline", handle: input.handle, layerId: input.layerId, vertices, closed: true };
}

function createLineEntities(input: LineCommandInput): CadLine[] {
  if (input.points.length < 2) throw new GeometryCommandInputError("LINE requires at least two points.");
  input.points.forEach((point, index) => assertPoint(point, `LINE point ${index + 1}`));
  const segmentCount = input.points.length - 1 + (input.close ? 1 : 0);
  if (input.handles.length !== segmentCount) throw new GeometryCommandInputError(`LINE requires exactly ${segmentCount} handles.`);
  const entities: CadLine[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = input.points[index % input.points.length]!;
    const end = input.points[(index + 1) % input.points.length]!;
    if (samePoint(start, end)) throw new GeometryCommandInputError("LINE segments must have non-zero length.");
    const handle = input.handles[index]!;
    assertHandle(handle);
    entities.push({ kind: "line", handle, layerId: input.layerId, start: { ...start }, end: { ...end } });
  }
  return entities;
}

function createPline(input: PlineCommandInput): CadPolyline {
  const minimum = input.closed ? 3 : 2;
  if (input.vertices.length < minimum) throw new GeometryCommandInputError(`PLINE requires at least ${minimum} vertices.`);
  input.vertices.forEach((vertex, index) => {
    assertPoint(vertex, `PLINE vertex ${index + 1}`);
    if (vertex.bulge !== undefined && !Number.isFinite(vertex.bulge)) throw new GeometryCommandInputError("PLINE bulges must be finite.");
    if (vertex.startWidth !== undefined && (!Number.isFinite(vertex.startWidth) || vertex.startWidth < 0)) throw new GeometryCommandInputError("PLINE start widths must be finite and non-negative.");
    if (vertex.endWidth !== undefined && (!Number.isFinite(vertex.endWidth) || vertex.endWidth < 0)) throw new GeometryCommandInputError("PLINE end widths must be finite and non-negative.");
    const next = input.vertices[index + 1] ?? (input.closed ? input.vertices[0] : undefined);
    if (next && samePoint(vertex, next)) throw new GeometryCommandInputError("PLINE adjacent vertices must differ.");
  });
  return { kind: "polyline", handle: input.handle, layerId: input.layerId, vertices: structuredClone(input.vertices), closed: input.closed ?? false };
}

export function prepareGeometryCommand(input: GeometryCommandInput): PreparedGeometryCommand {
  if (input.command !== "LINE") assertHandle(input.handle);
  if (input.layerId.trim() === "") throw new GeometryCommandInputError("Layer id must not be empty.");
  let entities: CadEntity[];
  switch (input.command) {
    case "LINE":
      entities = createLineEntities(input);
      break;
    case "PLINE":
      entities = [createPline(input)];
      break;
    case "CIRCLE":
      entities = [createCircle(input)];
      break;
    case "ARC":
      entities = [createArc(input)];
      break;
    case "POLYGON":
      entities = [createPolygon(input)];
      break;
    case "ELLIPSE":
      entities = [createEllipse(input)];
      break;
    case "REVCLOUD":
      entities = [createRevcloud(input)];
      break;
  }
  return {
    commandId: input.command,
    entities: structuredClone(entities),
    changes: entities.map((entity) => ({ type: "put", entity: structuredClone(entity) })),
    resultHandles: entities.map((entity) => entity.handle),
  };
}
