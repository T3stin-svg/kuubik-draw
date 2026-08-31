import type { CadPoint2, CadPolylineVertex } from "@kuubik/cad-schema";
import {
  GeometryCommandInputError,
  prepareGeometryCommand,
  type PreparedGeometryCommand,
} from "./geometry-commands.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export type PlineSegmentMode = "line" | "arc";

export type PlineArcConstruction =
  | { mode: "through"; point: CadPoint2; end: CadPoint2 }
  | { mode: "angle"; end: CadPoint2; includedAngleRad: number }
  | { mode: "center"; center: CadPoint2; end: CadPoint2; counterClockwise?: boolean }
  | { mode: "direction"; end: CadPoint2; tangentDirectionRad: number }
  | { mode: "radius"; end: CadPoint2; radius: number; side?: "left" | "right"; major?: boolean };

export type PlineCommandAction =
  | { type: "line"; end: CadPoint2 }
  | { type: "arc"; construction: PlineArcConstruction }
  | { type: "mode"; mode: PlineSegmentMode }
  | { type: "width"; startWidth: number; endWidth: number }
  | { type: "halfwidth"; startHalfWidth: number; endHalfWidth: number }
  | { type: "close" }
  | { type: "undo" };

interface PlineCommandSnapshot {
  vertices: CadPolylineVertex[];
  mode: PlineSegmentMode;
  startWidth: number;
  endWidth: number;
  closed: boolean;
}

export interface PlineCommandState extends PlineCommandSnapshot {
  handle: string;
  layerId: string;
  history: PlineCommandSnapshot[];
}

function cloneSnapshot(state: PlineCommandSnapshot): PlineCommandSnapshot {
  return {
    vertices: structuredClone(state.vertices),
    mode: state.mode,
    startWidth: state.startWidth,
    endWidth: state.endWidth,
    closed: state.closed,
  };
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new GeometryCommandInputError(`${label} must contain finite coordinates.`);
  }
}

function assertWidth(width: number, label: string): void {
  if (!Number.isFinite(width) || width < 0) {
    throw new GeometryCommandInputError(`${label} must be finite and non-negative.`);
  }
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function samePoint(first: CadPoint2, second: CadPoint2): boolean {
  return distance(first, second) <= EPSILON;
}

function normalizePositive(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function ccwSweep(start: number, end: number): number {
  return normalizePositive(end - start);
}

function circleThroughThreePoints(first: CadPoint2, second: CadPoint2, third: CadPoint2): CadPoint2 {
  const determinant = 2 * (first.x * (second.y - third.y)
    + second.x * (third.y - first.y)
    + third.x * (first.y - second.y));
  if (Math.abs(determinant) <= EPSILON) {
    throw new GeometryCommandInputError("PLINE arc Through points must not be collinear.");
  }
  const firstSquared = first.x ** 2 + first.y ** 2;
  const secondSquared = second.x ** 2 + second.y ** 2;
  const thirdSquared = third.x ** 2 + third.y ** 2;
  return {
    x: (firstSquared * (second.y - third.y)
      + secondSquared * (third.y - first.y)
      + thirdSquared * (first.y - second.y)) / determinant,
    y: (firstSquared * (third.x - second.x)
      + secondSquared * (first.x - third.x)
      + thirdSquared * (second.x - first.x)) / determinant,
  };
}

function finiteIncludedAngle(angle: number): number {
  if (!Number.isFinite(angle) || Math.abs(angle) <= EPSILON || Math.abs(angle) >= TWO_PI - EPSILON) {
    throw new GeometryCommandInputError("PLINE arc included angle must be finite, non-zero, and less than 2π.");
  }
  return angle;
}

function bulgeFromConstruction(start: CadPoint2, construction: PlineArcConstruction): number {
  assertPoint(start, "PLINE arc start");
  assertPoint(construction.end, "PLINE arc end");
  if (samePoint(start, construction.end)) {
    throw new GeometryCommandInputError("PLINE arc endpoints must differ.");
  }

  let includedAngle: number;
  switch (construction.mode) {
    case "angle":
      includedAngle = finiteIncludedAngle(construction.includedAngleRad);
      break;
    case "through": {
      assertPoint(construction.point, "PLINE arc second point");
      if (samePoint(start, construction.point) || samePoint(construction.point, construction.end)) {
        throw new GeometryCommandInputError("PLINE arc Through points must differ.");
      }
      const center = circleThroughThreePoints(start, construction.point, construction.end);
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const throughAngle = Math.atan2(construction.point.y - center.y, construction.point.x - center.x);
      const endAngle = Math.atan2(construction.end.y - center.y, construction.end.x - center.x);
      const ccw = ccwSweep(startAngle, throughAngle) <= ccwSweep(startAngle, endAngle) + EPSILON;
      includedAngle = ccw ? ccwSweep(startAngle, endAngle) : -ccwSweep(endAngle, startAngle);
      break;
    }
    case "center": {
      assertPoint(construction.center, "PLINE arc center");
      const startRadius = distance(construction.center, start);
      const endRadius = distance(construction.center, construction.end);
      if (startRadius <= EPSILON || Math.abs(startRadius - endRadius) > Math.max(1, startRadius) * EPSILON) {
        throw new GeometryCommandInputError("PLINE arc Center endpoints must have the same non-zero radius.");
      }
      const startAngle = Math.atan2(start.y - construction.center.y, start.x - construction.center.x);
      const endAngle = Math.atan2(construction.end.y - construction.center.y, construction.end.x - construction.center.x);
      includedAngle = construction.counterClockwise === false
        ? -ccwSweep(endAngle, startAngle)
        : ccwSweep(startAngle, endAngle);
      includedAngle = finiteIncludedAngle(includedAngle);
      break;
    }
    case "direction": {
      if (!Number.isFinite(construction.tangentDirectionRad)) {
        throw new GeometryCommandInputError("PLINE arc tangent direction must be finite.");
      }
      const chord = { x: construction.end.x - start.x, y: construction.end.y - start.y };
      const tangent = { x: Math.cos(construction.tangentDirectionRad), y: Math.sin(construction.tangentDirectionRad) };
      const leftNormal = { x: -tangent.y, y: tangent.x };
      const denominator = 2 * (chord.x * leftNormal.x + chord.y * leftNormal.y);
      if (Math.abs(denominator) <= EPSILON * Math.max(1, distance(start, construction.end))) {
        throw new GeometryCommandInputError("PLINE arc Direction must define a finite-radius arc.");
      }
      const signedRadius = (chord.x ** 2 + chord.y ** 2) / denominator;
      const center = { x: start.x + leftNormal.x * signedRadius, y: start.y + leftNormal.y * signedRadius };
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(construction.end.y - center.y, construction.end.x - center.x);
      includedAngle = signedRadius > 0
        ? ccwSweep(startAngle, endAngle)
        : -ccwSweep(endAngle, startAngle);
      includedAngle = finiteIncludedAngle(includedAngle);
      break;
    }
    case "radius": {
      if (!Number.isFinite(construction.radius) || construction.radius <= EPSILON) {
        throw new GeometryCommandInputError("PLINE arc radius must be finite and positive.");
      }
      const chordLength = distance(start, construction.end);
      if (chordLength > 2 * construction.radius + EPSILON) {
        throw new GeometryCommandInputError("PLINE arc radius is too small for its chord.");
      }
      const minorAngle = 2 * Math.asin(Math.min(1, chordLength / (2 * construction.radius)));
      const magnitude = construction.major ? TWO_PI - minorAngle : minorAngle;
      includedAngle = (construction.side === "right" ? -1 : 1) * magnitude;
      includedAngle = finiteIncludedAngle(includedAngle);
      break;
    }
  }
  const bulge = Math.tan(includedAngle / 4);
  if (!Number.isFinite(bulge) || Math.abs(bulge) <= EPSILON) {
    throw new GeometryCommandInputError("PLINE arc construction produced a degenerate bulge.");
  }
  return bulge;
}

function withOutgoingSegment(vertex: CadPolylineVertex, bulge: number | undefined, startWidth: number, endWidth: number): CadPolylineVertex {
  return {
    x: vertex.x,
    y: vertex.y,
    ...(bulge === undefined ? {} : { bulge }),
    ...(startWidth === 0 ? {} : { startWidth }),
    ...(endWidth === 0 ? {} : { endWidth }),
  };
}

function previousEndTangent(state: PlineCommandState): number {
  if (state.vertices.length < 2) throw new GeometryCommandInputError("PLINE Arc Close requires a previous segment.");
  const start = state.vertices.at(-2)!;
  const end = state.vertices.at(-1)!;
  const chordAngle = Math.atan2(end.y - start.y, end.x - start.x);
  return chordAngle + 2 * Math.atan(start.bulge ?? 0);
}

function pushSnapshot(state: PlineCommandState): PlineCommandSnapshot[] {
  return [...state.history, cloneSnapshot(state)];
}

function appendSegment(state: PlineCommandState, end: CadPoint2, bulge: number | undefined): PlineCommandState {
  assertPoint(end, "PLINE endpoint");
  const start = state.vertices.at(-1)!;
  if (samePoint(start, end)) throw new GeometryCommandInputError("PLINE adjacent vertices must differ.");
  const vertices = structuredClone(state.vertices);
  vertices[vertices.length - 1] = withOutgoingSegment(start, bulge, state.startWidth, state.endWidth);
  vertices.push({ x: end.x, y: end.y });
  return { ...state, vertices, history: pushSnapshot(state), mode: bulge === undefined ? "line" : "arc" };
}

export function startPlineCommand(input: { handle: string; layerId: string; start: CadPoint2 }): PlineCommandState {
  assertPoint(input.start, "PLINE start point");
  if (input.handle.trim() === "") throw new GeometryCommandInputError("Entity handle must not be empty.");
  if (input.layerId.trim() === "") throw new GeometryCommandInputError("Layer id must not be empty.");
  return {
    handle: input.handle,
    layerId: input.layerId,
    vertices: [{ ...input.start }],
    mode: "line",
    startWidth: 0,
    endWidth: 0,
    closed: false,
    history: [],
  };
}

export function applyPlineCommandAction(state: PlineCommandState, action: PlineCommandAction): PlineCommandState {
  if (state.closed && action.type !== "undo") {
    throw new GeometryCommandInputError("Closed PLINE state only accepts Undo or commit.");
  }
  switch (action.type) {
    case "line":
      return appendSegment(state, action.end, undefined);
    case "arc":
      return appendSegment(state, action.construction.end, bulgeFromConstruction(state.vertices.at(-1)!, action.construction));
    case "mode":
      return { ...state, mode: action.mode, history: pushSnapshot(state) };
    case "width":
      assertWidth(action.startWidth, "PLINE start width");
      assertWidth(action.endWidth, "PLINE end width");
      return { ...state, startWidth: action.startWidth, endWidth: action.endWidth, history: pushSnapshot(state) };
    case "halfwidth":
      assertWidth(action.startHalfWidth, "PLINE start halfwidth");
      assertWidth(action.endHalfWidth, "PLINE end halfwidth");
      return { ...state, startWidth: action.startHalfWidth * 2, endWidth: action.endHalfWidth * 2, history: pushSnapshot(state) };
    case "close": {
      if (state.vertices.length < 3) throw new GeometryCommandInputError("PLINE Close requires at least three vertices.");
      const vertices = structuredClone(state.vertices);
      const last = vertices.at(-1)!;
      const first = vertices[0]!;
      if (samePoint(last, first)) {
        throw new GeometryCommandInputError("PLINE Close must not duplicate the seam vertex.");
      }
      const bulge = state.mode === "arc"
        ? bulgeFromConstruction(last, { mode: "direction", end: first, tangentDirectionRad: previousEndTangent(state) })
        : undefined;
      vertices[vertices.length - 1] = withOutgoingSegment(last, bulge, state.startWidth, state.endWidth);
      return { ...state, vertices, closed: true, history: pushSnapshot(state) };
    }
    case "undo": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        ...state,
        ...cloneSnapshot(previous),
        history: state.history.slice(0, -1),
      };
    }
  }
}

export function preparePlineCommandState(state: PlineCommandState): PreparedGeometryCommand {
  return prepareGeometryCommand({
    command: "PLINE",
    handle: state.handle,
    layerId: state.layerId,
    vertices: state.vertices,
    closed: state.closed,
  });
}
