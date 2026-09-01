import type { CadAppearance, CadArc, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export type ArcCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_POINT"
  | "INVALID_ANGLE"
  | "INVALID_LENGTH"
  | "INVALID_RADIUS"
  | "DEGENERATE_CONSTRUCTION"
  | "FULL_CIRCLE_UNSUPPORTED"
  | "NO_ARC_SOLUTION"
  | "AMBIGUOUS_ARC_SOLUTION"
  | "INVALID_SOLUTION_SELECTION"
  | "LAYER_NOT_FOUND"
  | "LAYER_LOCKED"
  | "LAYER_HIDDEN"
  | "HANDLE_COLLISION";

export class ArcCommandInputError extends Error {
  constructor(readonly code: ArcCommandErrorCode, message: string) {
    super(message);
    this.name = "ArcCommandInputError";
  }
}

export type ArcSolutionSelection =
  | { mode: "index"; index: number }
  | { mode: "near-center"; point: CadPoint2 }
  | { mode: "through-point"; point: CadPoint2 };

interface CenterStartEndConstruction {
  center: CadPoint2;
  start: CadPoint2;
  end: CadPoint2;
  clockwiseCtrl?: boolean;
}

interface CenterStartAngleConstruction {
  center: CadPoint2;
  start: CadPoint2;
  includedAngleRad: number;
  clockwiseCtrl?: boolean;
}

interface CenterStartLengthConstruction {
  center: CadPoint2;
  start: CadPoint2;
  chordLength: number;
  clockwiseCtrl?: boolean;
  major?: boolean;
}

export type CompleteArcConstruction =
  | { mode: "3p"; start: CadPoint2; point: CadPoint2; end: CadPoint2 }
  | ({ mode: "start-center-end" } & CenterStartEndConstruction)
  | ({ mode: "start-center-angle" } & CenterStartAngleConstruction)
  | ({ mode: "start-center-length" } & CenterStartLengthConstruction)
  | { mode: "start-end-angle"; start: CadPoint2; end: CadPoint2; includedAngleRad: number; clockwiseCtrl?: boolean }
  | { mode: "start-end-direction"; start: CadPoint2; end: CadPoint2; tangentDirectionRad: number; clockwiseCtrl?: boolean }
  | {
    mode: "start-end-radius";
    start: CadPoint2;
    end: CadPoint2;
    radius: number;
    clockwiseCtrl?: boolean;
    major?: boolean;
    selection?: ArcSolutionSelection;
  }
  | ({ mode: "center-start-end" } & CenterStartEndConstruction)
  | ({ mode: "center-start-angle" } & CenterStartAngleConstruction)
  | ({ mode: "center-start-length" } & CenterStartLengthConstruction);

export interface CompleteArcCommandInput {
  command: "ARC";
  handle: string;
  layerId: string;
  construction: CompleteArcConstruction;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface ArcConstructionSolution {
  center: CadPoint2;
  radius: number;
  startAngleRad: number;
  endAngleRad: number;
  counterClockwise: boolean;
  sweepRad: number;
  major: boolean;
  startPoint: CadPoint2;
  endPoint: CadPoint2;
  midpoint: CadPoint2;
}

export interface PreparedCompleteArcCommand {
  commandId: "ARC";
  entity: CadArc;
  entities: [CadArc];
  changes: [EntityChange & { type: "put"; entity: CadArc }];
  resultHandles: [string];
  candidates: ArcConstructionSolution[];
  selectedCandidateIndex: number | null;
  selected: ArcConstructionSolution;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new ArcCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function samePoint(first: CadPoint2, second: CadPoint2): boolean {
  return distance(first, second) <= EPSILON;
}

function normalizedAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function ccwSweep(start: number, end: number): number {
  return normalizedAngle(end - start);
}

function finiteSweepMagnitude(angle: number): number {
  if (!Number.isFinite(angle) || Math.abs(angle) <= EPSILON) {
    throw new ArcCommandInputError("INVALID_ANGLE", "ARC included angle must be finite and non-zero.");
  }
  const magnitude = Math.abs(angle);
  if (magnitude >= TWO_PI - EPSILON) {
    throw new ArcCommandInputError("FULL_CIRCLE_UNSUPPORTED", "ARC cannot create a full circle or a sweep of 2π or more.");
  }
  return magnitude;
}

function clockwiseFromSignedValue(value: number, clockwiseCtrl: boolean | undefined): boolean {
  return (value < 0) !== (clockwiseCtrl ?? false);
}

function pointAt(center: CadPoint2, radius: number, angle: number): CadPoint2 {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

function makeSolution(
  center: CadPoint2,
  radius: number,
  startAngleRad: number,
  endAngleRad: number,
  counterClockwise: boolean,
): ArcConstructionSolution {
  if (!(Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(radius) && radius > EPSILON)) {
    throw new ArcCommandInputError("INVALID_RADIUS", "ARC solution must have a finite positive radius.");
  }
  const start = normalizedAngle(startAngleRad);
  const end = normalizedAngle(endAngleRad);
  const sweepRad = counterClockwise ? ccwSweep(start, end) : ccwSweep(end, start);
  if (sweepRad <= EPSILON) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC start and end directions must differ.");
  }
  if (sweepRad >= TWO_PI - EPSILON) {
    throw new ArcCommandInputError("FULL_CIRCLE_UNSUPPORTED", "ARC sweep must remain below a full circle.");
  }
  const midpointAngle = normalizedAngle(start + (counterClockwise ? 1 : -1) * sweepRad / 2);
  return {
    center: { ...center },
    radius,
    startAngleRad: start,
    endAngleRad: end,
    counterClockwise,
    sweepRad,
    major: sweepRad > Math.PI + EPSILON,
    startPoint: pointAt(center, radius, start),
    endPoint: pointAt(center, radius, end),
    midpoint: pointAt(center, radius, midpointAngle),
  };
}

function circleThroughThreePoints(first: CadPoint2, second: CadPoint2, third: CadPoint2): { center: CadPoint2; radius: number } {
  assertPoint(first, "ARC start point");
  assertPoint(second, "ARC second point");
  assertPoint(third, "ARC end point");
  const determinant = 2 * (first.x * (second.y - third.y)
    + second.x * (third.y - first.y)
    + third.x * (first.y - second.y));
  const coordinateScale = Math.max(
    1,
    distance(first, second),
    distance(second, third),
    distance(third, first),
  );
  if (Math.abs(determinant) <= EPSILON * coordinateScale ** 2) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "Three-point ARC requires non-collinear points.");
  }
  const firstSquared = first.x ** 2 + first.y ** 2;
  const secondSquared = second.x ** 2 + second.y ** 2;
  const thirdSquared = third.x ** 2 + third.y ** 2;
  const center = {
    x: (firstSquared * (second.y - third.y)
      + secondSquared * (third.y - first.y)
      + thirdSquared * (first.y - second.y)) / determinant,
    y: (firstSquared * (third.x - second.x)
      + secondSquared * (first.x - third.x)
      + thirdSquared * (second.x - first.x)) / determinant,
  };
  return { center, radius: distance(center, first) };
}

function threePointSolution(construction: Extract<CompleteArcConstruction, { mode: "3p" }>): ArcConstructionSolution {
  const resolved = circleThroughThreePoints(construction.start, construction.point, construction.end);
  const startAngle = Math.atan2(construction.start.y - resolved.center.y, construction.start.x - resolved.center.x);
  const pointAngle = Math.atan2(construction.point.y - resolved.center.y, construction.point.x - resolved.center.x);
  const endAngle = Math.atan2(construction.end.y - resolved.center.y, construction.end.x - resolved.center.x);
  const counterClockwise = ccwSweep(startAngle, pointAngle) <= ccwSweep(startAngle, endAngle) + EPSILON;
  return makeSolution(resolved.center, resolved.radius, startAngle, endAngle, counterClockwise);
}

function centerStartEndSolution(construction: CenterStartEndConstruction): ArcConstructionSolution {
  assertPoint(construction.center, "ARC center");
  assertPoint(construction.start, "ARC start");
  assertPoint(construction.end, "ARC end direction");
  const radius = distance(construction.center, construction.start);
  if (!(radius > EPSILON)) throw new ArcCommandInputError("INVALID_RADIUS", "ARC center and start must differ.");
  if (samePoint(construction.center, construction.end)) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC end direction must differ from its center.");
  }
  return makeSolution(
    construction.center,
    radius,
    Math.atan2(construction.start.y - construction.center.y, construction.start.x - construction.center.x),
    Math.atan2(construction.end.y - construction.center.y, construction.end.x - construction.center.x),
    !(construction.clockwiseCtrl ?? false),
  );
}

function centerStartAngleSolution(construction: CenterStartAngleConstruction): ArcConstructionSolution {
  assertPoint(construction.center, "ARC center");
  assertPoint(construction.start, "ARC start");
  const radius = distance(construction.center, construction.start);
  if (!(radius > EPSILON)) throw new ArcCommandInputError("INVALID_RADIUS", "ARC center and start must differ.");
  const magnitude = finiteSweepMagnitude(construction.includedAngleRad);
  const clockwise = clockwiseFromSignedValue(construction.includedAngleRad, construction.clockwiseCtrl);
  const startAngle = Math.atan2(construction.start.y - construction.center.y, construction.start.x - construction.center.x);
  return makeSolution(construction.center, radius, startAngle, startAngle + (clockwise ? -1 : 1) * magnitude, !clockwise);
}

function centerStartLengthSolution(construction: CenterStartLengthConstruction): ArcConstructionSolution {
  assertPoint(construction.center, "ARC center");
  assertPoint(construction.start, "ARC start");
  const radius = distance(construction.center, construction.start);
  if (!(radius > EPSILON)) throw new ArcCommandInputError("INVALID_RADIUS", "ARC center and start must differ.");
  if (!Number.isFinite(construction.chordLength) || Math.abs(construction.chordLength) <= EPSILON) {
    throw new ArcCommandInputError("INVALID_LENGTH", "ARC chord length must be finite and non-zero.");
  }
  const chordLength = Math.abs(construction.chordLength);
  if (chordLength > 2 * radius + EPSILON) {
    throw new ArcCommandInputError("NO_ARC_SOLUTION", "ARC chord length exceeds the selected diameter.");
  }
  const minor = 2 * Math.asin(Math.min(1, chordLength / (2 * radius)));
  const major = construction.major ?? construction.chordLength < 0;
  const magnitude = major && minor < Math.PI - EPSILON ? TWO_PI - minor : minor;
  const clockwise = construction.clockwiseCtrl ?? false;
  const startAngle = Math.atan2(construction.start.y - construction.center.y, construction.start.x - construction.center.x);
  return makeSolution(construction.center, radius, startAngle, startAngle + (clockwise ? -1 : 1) * magnitude, !clockwise);
}

function startEndAngleSolution(construction: Extract<CompleteArcConstruction, { mode: "start-end-angle" }>): ArcConstructionSolution {
  assertPoint(construction.start, "ARC start");
  assertPoint(construction.end, "ARC end");
  if (samePoint(construction.start, construction.end)) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC start and end must differ.");
  }
  const magnitude = finiteSweepMagnitude(construction.includedAngleRad);
  const clockwise = clockwiseFromSignedValue(construction.includedAngleRad, construction.clockwiseCtrl);
  const signedSweep = (clockwise ? -1 : 1) * magnitude;
  const chord = distance(construction.start, construction.end);
  const dx = construction.end.x - construction.start.x;
  const dy = construction.end.y - construction.start.y;
  const offset = chord / (2 * Math.tan(signedSweep / 2));
  const center = {
    x: (construction.start.x + construction.end.x) / 2 + (-dy / chord) * offset,
    y: (construction.start.y + construction.end.y) / 2 + (dx / chord) * offset,
  };
  const solution = makeSolution(
    center,
    distance(center, construction.start),
    Math.atan2(construction.start.y - center.y, construction.start.x - center.x),
    Math.atan2(construction.end.y - center.y, construction.end.x - center.x),
    !clockwise,
  );
  if (Math.abs(solution.sweepRad - magnitude) > 1e-7) {
    throw new ArcCommandInputError("NO_ARC_SOLUTION", "ARC angle and endpoints do not produce the requested directed sweep.");
  }
  return solution;
}

function startEndDirectionSolution(construction: Extract<CompleteArcConstruction, { mode: "start-end-direction" }>): ArcConstructionSolution {
  assertPoint(construction.start, "ARC start");
  assertPoint(construction.end, "ARC end");
  if (samePoint(construction.start, construction.end)) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC start and end must differ.");
  }
  if (!Number.isFinite(construction.tangentDirectionRad)) {
    throw new ArcCommandInputError("INVALID_ANGLE", "ARC tangent direction must be finite.");
  }
  const tangentDirection = construction.tangentDirectionRad + (construction.clockwiseCtrl ? Math.PI : 0);
  const tangent = { x: Math.cos(tangentDirection), y: Math.sin(tangentDirection) };
  const normal = { x: -tangent.y, y: tangent.x };
  const chord = { x: construction.end.x - construction.start.x, y: construction.end.y - construction.start.y };
  const denominator = 2 * (chord.x * normal.x + chord.y * normal.y);
  if (Math.abs(denominator) <= EPSILON * Math.max(1, Math.hypot(chord.x, chord.y))) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC tangent direction is collinear with the chord and implies infinite radius.");
  }
  const signedRadius = (chord.x ** 2 + chord.y ** 2) / denominator;
  const center = {
    x: construction.start.x + normal.x * signedRadius,
    y: construction.start.y + normal.y * signedRadius,
  };
  return makeSolution(
    center,
    Math.abs(signedRadius),
    Math.atan2(construction.start.y - center.y, construction.start.x - center.x),
    Math.atan2(construction.end.y - center.y, construction.end.x - center.x),
    signedRadius > 0,
  );
}

function startEndRadiusSolutions(construction: Extract<CompleteArcConstruction, { mode: "start-end-radius" }>): ArcConstructionSolution[] {
  assertPoint(construction.start, "ARC start");
  assertPoint(construction.end, "ARC end");
  if (samePoint(construction.start, construction.end)) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC start and end must differ.");
  }
  if (!Number.isFinite(construction.radius) || Math.abs(construction.radius) <= EPSILON) {
    throw new ArcCommandInputError("INVALID_RADIUS", "ARC radius must be finite and non-zero.");
  }
  const radius = Math.abs(construction.radius);
  const chord = distance(construction.start, construction.end);
  if (chord > 2 * radius + EPSILON) {
    throw new ArcCommandInputError("NO_ARC_SOLUTION", "ARC radius is too small for the selected endpoints.");
  }
  const midpoint = {
    x: (construction.start.x + construction.end.x) / 2,
    y: (construction.start.y + construction.end.y) / 2,
  };
  const height = Math.sqrt(Math.max(0, radius ** 2 - (chord / 2) ** 2));
  const normal = {
    x: -(construction.end.y - construction.start.y) / chord,
    y: (construction.end.x - construction.start.x) / chord,
  };
  const centers = height <= EPSILON
    ? [midpoint]
    : [
      { x: midpoint.x + normal.x * height, y: midpoint.y + normal.y * height },
      { x: midpoint.x - normal.x * height, y: midpoint.y - normal.y * height },
    ];
  const solutions: ArcConstructionSolution[] = [];
  for (const center of centers) {
    const startAngle = Math.atan2(construction.start.y - center.y, construction.start.x - center.x);
    const endAngle = Math.atan2(construction.end.y - center.y, construction.end.x - center.x);
    solutions.push(makeSolution(center, radius, startAngle, endAngle, true));
    solutions.push(makeSolution(center, radius, startAngle, endAngle, false));
  }
  return solutions.sort((first, second) =>
    first.center.x - second.center.x || first.center.y - second.center.y
    || Number(first.counterClockwise) - Number(second.counterClockwise));
}

function angularDistance(first: number, second: number): number {
  const delta = Math.abs(normalizedAngle(first) - normalizedAngle(second));
  return Math.min(delta, TWO_PI - delta);
}

function pointToArcScore(point: CadPoint2, solution: ArcConstructionSolution): number {
  const radial = Math.abs(distance(point, solution.center) - solution.radius);
  const angle = Math.atan2(point.y - solution.center.y, point.x - solution.center.x);
  const fromStart = solution.counterClockwise
    ? ccwSweep(solution.startAngleRad, angle)
    : ccwSweep(angle, solution.startAngleRad);
  if (fromStart <= solution.sweepRad + EPSILON) return radial;
  return radial + solution.radius * Math.min(
    angularDistance(angle, solution.startAngleRad),
    angularDistance(angle, solution.endAngleRad),
  );
}

function selectRadiusSolution(
  candidates: ArcConstructionSolution[],
  construction: Extract<CompleteArcConstruction, { mode: "start-end-radius" }>,
): { index: number; solution: ArcConstructionSolution } {
  let eligible = candidates.map((solution, index) => ({ solution, index }));
  const selection = construction.selection;
  if (construction.clockwiseCtrl !== undefined || selection === undefined) {
    const clockwise = construction.clockwiseCtrl ?? false;
    eligible = eligible.filter(({ solution }) => solution.counterClockwise === !clockwise);
  }
  if (construction.major !== undefined || selection === undefined) {
    const major = construction.major ?? construction.radius < 0;
    eligible = eligible.filter(({ solution }) => solution.major === major);
  }
  if (eligible.length === 0) {
    throw new ArcCommandInputError("NO_ARC_SOLUTION", "No Start-End-Radius candidate matches the requested direction and major/minor preference.");
  }
  if (selection?.mode === "index") {
    if (!Number.isInteger(selection.index) || selection.index < 0 || selection.index >= candidates.length) {
      throw new ArcCommandInputError("INVALID_SOLUTION_SELECTION", "ARC solution index is outside the candidate list.");
    }
    const selected = eligible.find(({ index }) => index === selection.index);
    if (!selected) throw new ArcCommandInputError("INVALID_SOLUTION_SELECTION", "ARC solution index conflicts with direction or major/minor filters.");
    return selected;
  }
  if (selection) {
    assertPoint(selection.point, "ARC solution pick");
    const ranked = eligible.map((entry) => ({
      ...entry,
      score: selection.mode === "near-center"
        ? distance(entry.solution.center, selection.point)
        : pointToArcScore(selection.point, entry.solution),
    })).sort((first, second) => first.score - second.score || first.index - second.index);
    if (ranked.length > 1 && Math.abs(ranked[0]!.score - ranked[1]!.score) <= 1e-8) {
      throw new ArcCommandInputError("AMBIGUOUS_ARC_SOLUTION", "ARC pick is equidistant from multiple candidates.");
    }
    return ranked[0]!;
  }
  if (eligible.length === 1) return eligible[0]!;
  throw new ArcCommandInputError(
    "AMBIGUOUS_ARC_SOLUTION",
    `Start-End-Radius has ${eligible.length} candidates; supply direction plus major/minor or a pick-side selection.`,
  );
}

function resolveConstruction(construction: CompleteArcConstruction): {
  candidates: ArcConstructionSolution[];
  selectedCandidateIndex: number | null;
  selected: ArcConstructionSolution;
} {
  if (construction.mode === "3p") {
    const selected = threePointSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  if (construction.mode === "start-center-end" || construction.mode === "center-start-end") {
    const selected = centerStartEndSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  if (construction.mode === "start-center-angle" || construction.mode === "center-start-angle") {
    const selected = centerStartAngleSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  if (construction.mode === "start-center-length" || construction.mode === "center-start-length") {
    const selected = centerStartLengthSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  if (construction.mode === "start-end-angle") {
    const selected = startEndAngleSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  if (construction.mode === "start-end-direction") {
    const selected = startEndDirectionSolution(construction);
    return { candidates: [], selectedCandidateIndex: null, selected };
  }
  const candidates = startEndRadiusSolutions(construction);
  const chosen = selectRadiusSolution(candidates, construction);
  return { candidates, selectedCandidateIndex: chosen.index, selected: chosen.solution };
}

export function solveStartEndRadiusArc(
  construction: Extract<CompleteArcConstruction, { mode: "start-end-radius" }>,
): ArcConstructionSolution[] {
  return startEndRadiusSolutions(construction);
}

export function prepareCompleteArcCommand(input: CompleteArcCommandInput): PreparedCompleteArcCommand {
  if (input.command !== "ARC" || input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new ArcCommandInputError("INVALID_IDENTITY", "ARC command, handle and layer are required.");
  }
  const resolved = resolveConstruction(input.construction);
  if (!Number.isFinite(resolved.selected.center.x) || !Number.isFinite(resolved.selected.center.y)
    || !Number.isFinite(resolved.selected.radius) || !(resolved.selected.radius > EPSILON)
    || !Number.isFinite(resolved.selected.startAngleRad) || !Number.isFinite(resolved.selected.endAngleRad)) {
    throw new ArcCommandInputError("DEGENERATE_CONSTRUCTION", "ARC construction did not produce finite non-zero geometry.");
  }
  const entity: CadArc = {
    kind: "arc",
    handle: input.handle,
    layerId: input.layerId,
    center: { ...resolved.selected.center },
    radius: resolved.selected.radius,
    startAngleRad: resolved.selected.startAngleRad,
    endAngleRad: resolved.selected.endAngleRad,
    counterClockwise: resolved.selected.counterClockwise,
    ...(input.appearance ? { appearance: structuredClone(input.appearance) } : {}),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
  };
  return {
    commandId: "ARC",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: structuredClone(entity) }],
    resultHandles: [input.handle],
    candidates: structuredClone(resolved.candidates),
    selectedCandidateIndex: resolved.selectedCandidateIndex,
    selected: structuredClone(resolved.selected),
  };
}

/** Document-aware preview/commit gate for the complete F-005 ARC matrix. */
export function prepareCompleteArcDocumentCommand(
  document: KDrawDocumentV1,
  input: CompleteArcCommandInput,
): PreparedCompleteArcCommand {
  const layer = document.layers.find((candidate) => candidate.id === input.layerId);
  if (!layer) throw new ArcCommandInputError("LAYER_NOT_FOUND", `ARC result layer ${input.layerId} does not exist.`);
  if (layer.locked) throw new ArcCommandInputError("LAYER_LOCKED", `ARC result layer ${input.layerId} is locked.`);
  if (!layer.visible || layer.frozen) {
    throw new ArcCommandInputError("LAYER_HIDDEN", `ARC result layer ${input.layerId} is off or frozen.`);
  }
  const requestedHandle = input.handle.trim().toLocaleUpperCase("en-US");
  if (document.entities.some((entity) => entity.handle.toLocaleUpperCase("en-US") === requestedHandle)) {
    throw new ArcCommandInputError("HANDLE_COLLISION", `ARC result handle ${input.handle} already exists.`);
  }
  return prepareCompleteArcCommand(input);
}
