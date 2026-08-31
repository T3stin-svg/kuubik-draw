import type { CadAppearance, CadCircle, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

const EPSILON = 1e-9;
const ROOT_EPSILON = 1e-8;

export type CircleCommandErrorCode =
  | "INVALID_IDENTITY"
  | "INVALID_POINT"
  | "INVALID_RADIUS"
  | "INVALID_DIAMETER"
  | "DEGENERATE_CONSTRUCTION"
  | "NO_TANGENT_SOLUTION"
  | "AMBIGUOUS_TANGENT_SOLUTION"
  | "INVALID_SOLUTION_SELECTION"
  | "LAYER_NOT_FOUND"
  | "LAYER_LOCKED"
  | "LAYER_HIDDEN"
  | "HANDLE_COLLISION";

export class CircleCommandInputError extends Error {
  constructor(readonly code: CircleCommandErrorCode, message: string) {
    super(message);
    this.name = "CircleCommandInputError";
  }
}

export interface CircleTangentLine {
  kind: "line";
  start: CadPoint2;
  end: CadPoint2;
  pickPoint?: CadPoint2;
}

export interface CircleTangentCircle {
  kind: "circle";
  center: CadPoint2;
  radius: number;
  pickPoint?: CadPoint2;
}

export type CircleTangentConstraint = CircleTangentLine | CircleTangentCircle;

export type CircleSolutionSelection =
  | { mode: "index"; index: number }
  | { mode: "near-center"; point: CadPoint2 }
  | { mode: "pick-points" };

export type CompleteCircleConstruction =
  | { mode: "center-radius"; center: CadPoint2; radius: number }
  | { mode: "center-diameter"; center: CadPoint2; diameter: number }
  | { mode: "2p"; first: CadPoint2; second: CadPoint2 }
  | { mode: "3p"; first: CadPoint2; second: CadPoint2; third: CadPoint2 }
  | {
    mode: "ttr";
    first: CircleTangentConstraint;
    second: CircleTangentConstraint;
    radius: number;
    selection?: CircleSolutionSelection;
  }
  | {
    mode: "ttt";
    first: CircleTangentConstraint;
    second: CircleTangentConstraint;
    third: CircleTangentConstraint;
    selection?: CircleSolutionSelection;
  };

export interface CompleteCircleCommandInput {
  command: "CIRCLE";
  handle: string;
  layerId: string;
  construction: CompleteCircleConstruction;
  appearance?: CadAppearance;
  extensionData?: Record<string, unknown>;
}

export interface CircleTangentSolution {
  center: CadPoint2;
  radius: number;
  tangentPoints: CadPoint2[];
  sideSignature: number[];
}

export interface PreparedCompleteCircleCommand {
  commandId: "CIRCLE";
  entity: CadCircle;
  entities: [CadCircle];
  changes: [EntityChange & { type: "put"; entity: CadCircle }];
  resultHandles: [string];
  candidates: CircleTangentSolution[];
  selectedCandidateIndex: number | null;
}

interface NormalizedLine {
  kind: "line";
  normal: CadPoint2;
  constant: number;
  source: CircleTangentLine;
}

interface NormalizedCircle {
  kind: "circle";
  center: CadPoint2;
  radius: number;
  source: CircleTangentCircle;
}

type NormalizedConstraint = NormalizedLine | NormalizedCircle;

interface LinearEquation {
  a: number;
  b: number;
  c: number;
  d: number;
}

function assertPoint(point: CadPoint2, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CircleCommandInputError("INVALID_POINT", `${label} must contain finite coordinates.`);
  }
}

function positive(value: number, code: "INVALID_RADIUS" | "INVALID_DIAMETER", label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CircleCommandInputError(code, `${label} must be finite and greater than zero.`);
  }
  return value;
}

function distance(first: CadPoint2, second: CadPoint2): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeConstraint(constraint: CircleTangentConstraint, label: string): NormalizedConstraint {
  if (constraint.pickPoint) assertPoint(constraint.pickPoint, `${label} pick point`);
  if (constraint.kind === "circle") {
    assertPoint(constraint.center, `${label} circle center`);
    positive(constraint.radius, "INVALID_RADIUS", `${label} circle radius`);
    return { kind: "circle", center: { ...constraint.center }, radius: constraint.radius, source: structuredClone(constraint) };
  }
  assertPoint(constraint.start, `${label} line start`);
  assertPoint(constraint.end, `${label} line end`);
  const dx = constraint.end.x - constraint.start.x;
  const dy = constraint.end.y - constraint.start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > EPSILON)) {
    throw new CircleCommandInputError("DEGENERATE_CONSTRUCTION", `${label} tangent line must have non-zero length.`);
  }
  const normal = { x: -dy / length, y: dx / length };
  return {
    kind: "line",
    normal,
    constant: normal.x * constraint.start.x + normal.y * constraint.start.y,
    source: structuredClone(constraint),
  };
}

function circleThroughThreePoints(first: CadPoint2, second: CadPoint2, third: CadPoint2): { center: CadPoint2; radius: number } {
  assertPoint(first, "First circle point");
  assertPoint(second, "Second circle point");
  assertPoint(third, "Third circle point");
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
    throw new CircleCommandInputError("DEGENERATE_CONSTRUCTION", "Three-point circle requires non-collinear points.");
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

function circleIntersections(firstCenter: CadPoint2, firstRadius: number, secondCenter: CadPoint2, secondRadius: number): CadPoint2[] {
  if (!(firstRadius > EPSILON) || !(secondRadius > EPSILON)) return [];
  const separation = distance(firstCenter, secondCenter);
  if (!(separation > EPSILON)
    || separation > firstRadius + secondRadius + ROOT_EPSILON
    || separation < Math.abs(firstRadius - secondRadius) - ROOT_EPSILON) return [];
  const along = (firstRadius ** 2 - secondRadius ** 2 + separation ** 2) / (2 * separation);
  const heightSquared = firstRadius ** 2 - along ** 2;
  if (heightSquared < -ROOT_EPSILON) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const ux = (secondCenter.x - firstCenter.x) / separation;
  const uy = (secondCenter.y - firstCenter.y) / separation;
  const base = { x: firstCenter.x + along * ux, y: firstCenter.y + along * uy };
  if (height <= ROOT_EPSILON) return [base];
  return [
    { x: base.x - uy * height, y: base.y + ux * height },
    { x: base.x + uy * height, y: base.y - ux * height },
  ];
}

function lineCircleIntersections(line: NormalizedLine, signedOffset: number, center: CadPoint2, radius: number): CadPoint2[] {
  if (!(radius > EPSILON)) return [];
  const constant = line.constant + signedOffset;
  const signedDistance = line.normal.x * center.x + line.normal.y * center.y - constant;
  if (Math.abs(signedDistance) > radius + ROOT_EPSILON) return [];
  const projection = {
    x: center.x - line.normal.x * signedDistance,
    y: center.y - line.normal.y * signedDistance,
  };
  const halfChord = Math.sqrt(Math.max(0, radius ** 2 - signedDistance ** 2));
  const tangent = { x: -line.normal.y, y: line.normal.x };
  if (halfChord <= ROOT_EPSILON) return [projection];
  return [
    { x: projection.x + tangent.x * halfChord, y: projection.y + tangent.y * halfChord },
    { x: projection.x - tangent.x * halfChord, y: projection.y - tangent.y * halfChord },
  ];
}

function twoLineIntersection(first: NormalizedLine, firstOffset: number, second: NormalizedLine, secondOffset: number): CadPoint2 | null {
  const determinant = first.normal.x * second.normal.y - first.normal.y * second.normal.x;
  if (Math.abs(determinant) <= EPSILON) return null;
  const firstConstant = first.constant + firstOffset;
  const secondConstant = second.constant + secondOffset;
  return {
    x: (firstConstant * second.normal.y - first.normal.y * secondConstant) / determinant,
    y: (first.normal.x * secondConstant - firstConstant * second.normal.x) / determinant,
  };
}

function tangentPoint(center: CadPoint2, radius: number, constraint: NormalizedConstraint, side: number): CadPoint2 {
  if (constraint.kind === "line") {
    const signedDistance = constraint.normal.x * center.x + constraint.normal.y * center.y - constraint.constant;
    return {
      x: center.x - constraint.normal.x * signedDistance,
      y: center.y - constraint.normal.y * signedDistance,
    };
  }
  const separation = distance(constraint.center, center);
  if (!(separation > EPSILON)) {
    throw new CircleCommandInputError("DEGENERATE_CONSTRUCTION", "Concentric tangent circles have no unique tangent point.");
  }
  const unit = {
    x: (center.x - constraint.center.x) / separation,
    y: (center.y - constraint.center.y) / separation,
  };
  const effective = constraint.radius + side * radius;
  const direction = effective < 0 ? -1 : 1;
  return {
    x: constraint.center.x + direction * unit.x * constraint.radius,
    y: constraint.center.y + direction * unit.y * constraint.radius,
  };
}

function validTangency(center: CadPoint2, radius: number, constraint: NormalizedConstraint): boolean {
  if (!(Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(radius) && radius > EPSILON)) return false;
  if (constraint.kind === "line") {
    const separation = Math.abs(constraint.normal.x * center.x + constraint.normal.y * center.y - constraint.constant);
    return Math.abs(separation - radius) <= ROOT_EPSILON * Math.max(1, radius);
  }
  const separation = distance(center, constraint.center);
  return Math.min(
    Math.abs(separation - (constraint.radius + radius)),
    Math.abs(separation - Math.abs(constraint.radius - radius)),
  ) <= ROOT_EPSILON * Math.max(1, constraint.radius, radius);
}

function candidate(center: CadPoint2, radius: number, constraints: NormalizedConstraint[], sides: number[]): CircleTangentSolution | null {
  if (!constraints.every((constraint) => validTangency(center, radius, constraint))) return null;
  try {
    return {
      center: { ...center },
      radius,
      tangentPoints: constraints.map((constraint, index) => tangentPoint(center, radius, constraint, sides[index]!)),
      sideSignature: [...sides],
    };
  } catch {
    return null;
  }
}

function sideCombinations(count: number): number[][] {
  return Array.from({ length: 2 ** count }, (_, mask) =>
    Array.from({ length: count }, (_unused, index) => (mask & (1 << index)) === 0 ? -1 : 1));
}

function deduplicateSolutions(solutions: CircleTangentSolution[]): CircleTangentSolution[] {
  const sorted = [...solutions].sort((first, second) =>
    first.center.x - second.center.x || first.center.y - second.center.y || first.radius - second.radius
    || first.sideSignature.join(",").localeCompare(second.sideSignature.join(",")));
  const unique: CircleTangentSolution[] = [];
  for (const solution of sorted) {
    const duplicate = unique.some((current) => distance(current.center, solution.center) <= ROOT_EPSILON
      && Math.abs(current.radius - solution.radius) <= ROOT_EPSILON);
    if (!duplicate) unique.push(solution);
  }
  return unique;
}

function solveTtr(constraints: [NormalizedConstraint, NormalizedConstraint], radius: number): CircleTangentSolution[] {
  const solutions: CircleTangentSolution[] = [];
  for (const sides of sideCombinations(2)) {
    const [first, second] = constraints;
    let centers: CadPoint2[] = [];
    if (first.kind === "line" && second.kind === "line") {
      const center = twoLineIntersection(first, sides[0]! * radius, second, sides[1]! * radius);
      if (center) centers = [center];
    } else if (first.kind === "line" && second.kind === "circle") {
      centers = lineCircleIntersections(first, sides[0]! * radius, second.center, Math.abs(second.radius + sides[1]! * radius));
    } else if (first.kind === "circle" && second.kind === "line") {
      centers = lineCircleIntersections(second, sides[1]! * radius, first.center, Math.abs(first.radius + sides[0]! * radius));
    } else if (first.kind === "circle" && second.kind === "circle") {
      centers = circleIntersections(
        first.center,
        Math.abs(first.radius + sides[0]! * radius),
        second.center,
        Math.abs(second.radius + sides[1]! * radius),
      );
    }
    for (const center of centers) {
      const value = candidate(center, radius, constraints, sides);
      if (value) solutions.push(value);
    }
  }
  return deduplicateSolutions(solutions);
}

function circleDifferenceEquation(reference: NormalizedCircle, referenceSide: number, other: NormalizedCircle, otherSide: number): LinearEquation {
  return {
    a: 2 * (reference.center.x - other.center.x),
    b: 2 * (reference.center.y - other.center.y),
    c: 2 * (reference.radius * referenceSide - other.radius * otherSide),
    d: reference.center.x ** 2 + reference.center.y ** 2
      - other.center.x ** 2 - other.center.y ** 2
      + other.radius ** 2 - reference.radius ** 2,
  };
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) <= EPSILON) {
    if (Math.abs(b) <= EPSILON) return [];
    return [-c / b];
  }
  const discriminant = b ** 2 - 4 * a * c;
  if (discriminant < -ROOT_EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  if (root <= ROOT_EPSILON) return [-b / (2 * a)];
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  return first < second ? [first, second] : [second, first];
}

function solveThreeByThree(matrix: number[][], values: number[]): [number, number, number] | null {
  const rows = matrix.map((row, index) => [...row, values[index]!]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) <= EPSILON) return null;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const pivotRow = rows[column]!;
    const divisor = pivotRow[column]!;
    for (let index = column; index < 4; index += 1) pivotRow[index] = pivotRow[index]! / divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const currentRow = rows[row]!;
      const factor = currentRow[column]!;
      for (let index = column; index < 4; index += 1) currentRow[index] = currentRow[index]! - factor * pivotRow[index]!;
    }
  }
  return [rows[0]![3]!, rows[1]![3]!, rows[2]![3]!];
}

function solveTtt(constraints: [NormalizedConstraint, NormalizedConstraint, NormalizedConstraint]): CircleTangentSolution[] {
  const solutions: CircleTangentSolution[] = [];
  for (const sides of sideCombinations(3)) {
    const lines = constraints.map((constraint, index) => ({ constraint, index }))
      .filter((entry): entry is { constraint: NormalizedLine; index: number } => entry.constraint.kind === "line");
    const circles = constraints.map((constraint, index) => ({ constraint, index }))
      .filter((entry): entry is { constraint: NormalizedCircle; index: number } => entry.constraint.kind === "circle");
    if (lines.length === 3) {
      const solved = solveThreeByThree(
        lines.map(({ constraint, index }) => [constraint.normal.x, constraint.normal.y, -sides[index]!]),
        lines.map(({ constraint }) => constraint.constant),
      );
      if (solved && solved[2] > EPSILON) {
        const value = candidate({ x: solved[0], y: solved[1] }, solved[2], constraints, sides);
        if (value) solutions.push(value);
      }
      continue;
    }

    const equations: LinearEquation[] = lines.map(({ constraint, index }) => ({
      a: constraint.normal.x,
      b: constraint.normal.y,
      c: -sides[index]!,
      d: constraint.constant,
    }));
    const reference = circles[0]!;
    for (const current of circles.slice(1)) {
      equations.push(circleDifferenceEquation(reference.constraint, sides[reference.index]!, current.constraint, sides[current.index]!));
    }
    if (equations.length !== 2) continue;
    const first = equations[0]!;
    const second = equations[1]!;
    const determinant = first.a * second.b - first.b * second.a;
    if (Math.abs(determinant) <= EPSILON) continue;
    const x0 = (first.d * second.b - first.b * second.d) / determinant;
    const xr = (-first.c * second.b + first.b * second.c) / determinant;
    const y0 = (first.a * second.d - first.d * second.a) / determinant;
    const yr = (-first.a * second.c + first.c * second.a) / determinant;
    const circle = reference.constraint;
    const side = sides[reference.index]!;
    const dx = x0 - circle.center.x;
    const dy = y0 - circle.center.y;
    const roots = solveQuadratic(
      xr ** 2 + yr ** 2 - 1,
      2 * (dx * xr + dy * yr - circle.radius * side),
      dx ** 2 + dy ** 2 - circle.radius ** 2,
    );
    for (const radius of roots) {
      if (!(radius > EPSILON) || !Number.isFinite(radius)) continue;
      const value = candidate({ x: x0 + xr * radius, y: y0 + yr * radius }, radius, constraints, sides);
      if (value) solutions.push(value);
    }
  }
  return deduplicateSolutions(solutions);
}

function pickScore(solution: CircleTangentSolution, constraints: NormalizedConstraint[]): number | null {
  let score = 0;
  let count = 0;
  constraints.forEach((constraint, index) => {
    const pickPoint = constraint.source.pickPoint;
    if (!pickPoint) return;
    score += distance(solution.tangentPoints[index]!, pickPoint);
    count += 1;
  });
  return count === 0 ? null : score;
}

function selectSolution(solutions: CircleTangentSolution[], constraints: NormalizedConstraint[], selection: CircleSolutionSelection | undefined): number {
  if (solutions.length === 0) {
    throw new CircleCommandInputError("NO_TANGENT_SOLUTION", "No finite tangent circle satisfies the selected constraints.");
  }
  if (selection?.mode === "index") {
    if (!Number.isInteger(selection.index) || selection.index < 0 || selection.index >= solutions.length) {
      throw new CircleCommandInputError("INVALID_SOLUTION_SELECTION", "Tangent solution index is outside the candidate list.");
    }
    return selection.index;
  }
  if (selection?.mode === "near-center") {
    assertPoint(selection.point, "Tangent solution center pick");
    const ranked = solutions.map((solution, index) => ({ index, score: distance(solution.center, selection.point) }))
      .sort((first, second) => first.score - second.score || first.index - second.index);
    if (ranked.length > 1 && Math.abs(ranked[0]!.score - ranked[1]!.score) <= ROOT_EPSILON) {
      throw new CircleCommandInputError("AMBIGUOUS_TANGENT_SOLUTION", "Center pick is equidistant from multiple tangent solutions.");
    }
    return ranked[0]!.index;
  }
  const scores = solutions.map((solution, index) => ({ index, score: pickScore(solution, constraints) }))
    .filter((entry): entry is { index: number; score: number } => entry.score !== null)
    .sort((first, second) => first.score - second.score || first.index - second.index);
  if ((selection?.mode === "pick-points" || scores.length > 0) && scores.length > 0) {
    if (scores.length > 1 && Math.abs(scores[0]!.score - scores[1]!.score) <= ROOT_EPSILON) {
      throw new CircleCommandInputError("AMBIGUOUS_TANGENT_SOLUTION", "Constraint picks are equidistant from multiple tangent solutions.");
    }
    return scores[0]!.index;
  }
  if (solutions.length === 1) return 0;
  throw new CircleCommandInputError(
    "AMBIGUOUS_TANGENT_SOLUTION",
    `Tangent construction has ${solutions.length} solutions; supply pick points, a near-center point, or an explicit index.`,
  );
}

export function solveCircleTangentConstruction(construction: Extract<CompleteCircleConstruction, { mode: "ttr" | "ttt" }>): CircleTangentSolution[] {
  if (construction.mode === "ttr") {
    const radius = positive(construction.radius, "INVALID_RADIUS", "TTR radius");
    const constraints: [NormalizedConstraint, NormalizedConstraint] = [
      normalizeConstraint(construction.first, "First TTR constraint"),
      normalizeConstraint(construction.second, "Second TTR constraint"),
    ];
    return solveTtr(constraints, radius);
  }
  const constraints: [NormalizedConstraint, NormalizedConstraint, NormalizedConstraint] = [
    normalizeConstraint(construction.first, "First TTT constraint"),
    normalizeConstraint(construction.second, "Second TTT constraint"),
    normalizeConstraint(construction.third, "Third TTT constraint"),
  ];
  return solveTtt(constraints);
}

function resolveConstruction(construction: CompleteCircleConstruction): {
  center: CadPoint2;
  radius: number;
  candidates: CircleTangentSolution[];
  selectedCandidateIndex: number | null;
} {
  if (construction.mode === "center-radius") {
    assertPoint(construction.center, "Circle center");
    return { center: { ...construction.center }, radius: positive(construction.radius, "INVALID_RADIUS", "Circle radius"), candidates: [], selectedCandidateIndex: null };
  }
  if (construction.mode === "center-diameter") {
    assertPoint(construction.center, "Circle center");
    return { center: { ...construction.center }, radius: positive(construction.diameter, "INVALID_DIAMETER", "Circle diameter") / 2, candidates: [], selectedCandidateIndex: null };
  }
  if (construction.mode === "2p") {
    assertPoint(construction.first, "First diameter point");
    assertPoint(construction.second, "Second diameter point");
    const diameter = distance(construction.first, construction.second);
    if (!(diameter > EPSILON)) throw new CircleCommandInputError("DEGENERATE_CONSTRUCTION", "Two diameter points must differ.");
    return {
      center: { x: (construction.first.x + construction.second.x) / 2, y: (construction.first.y + construction.second.y) / 2 },
      radius: diameter / 2,
      candidates: [],
      selectedCandidateIndex: null,
    };
  }
  if (construction.mode === "3p") {
    const resolved = circleThroughThreePoints(construction.first, construction.second, construction.third);
    return { ...resolved, candidates: [], selectedCandidateIndex: null };
  }
  const rawConstraints = construction.mode === "ttr"
    ? [construction.first, construction.second]
    : [construction.first, construction.second, construction.third];
  const constraints = rawConstraints.map((constraint, index) => normalizeConstraint(constraint, `Tangent constraint ${index + 1}`));
  const candidates = construction.mode === "ttr"
    ? solveTtr(constraints as [NormalizedConstraint, NormalizedConstraint], positive(construction.radius, "INVALID_RADIUS", "TTR radius"))
    : solveTtt(constraints as [NormalizedConstraint, NormalizedConstraint, NormalizedConstraint]);
  const selectedCandidateIndex = selectSolution(candidates, constraints, construction.selection);
  const selected = candidates[selectedCandidateIndex]!;
  return { center: selected.center, radius: selected.radius, candidates, selectedCandidateIndex };
}

export function prepareCompleteCircleCommand(input: CompleteCircleCommandInput): PreparedCompleteCircleCommand {
  if (input.command !== "CIRCLE" || input.handle.trim() === "" || input.layerId.trim() === "") {
    throw new CircleCommandInputError("INVALID_IDENTITY", "Circle command, handle and layer are required.");
  }
  const resolved = resolveConstruction(input.construction);
  if (!Number.isFinite(resolved.center.x) || !Number.isFinite(resolved.center.y)
    || !Number.isFinite(resolved.radius) || !(resolved.radius > EPSILON)) {
    throw new CircleCommandInputError("DEGENERATE_CONSTRUCTION", "Circle construction did not produce a finite non-zero circle.");
  }
  const entity: CadCircle = {
    kind: "circle",
    handle: input.handle,
    layerId: input.layerId,
    center: { ...resolved.center },
    radius: resolved.radius,
    ...(input.appearance ? { appearance: structuredClone(input.appearance) } : {}),
    ...(input.extensionData ? { extensionData: structuredClone(input.extensionData) } : {}),
  };
  return {
    commandId: "CIRCLE",
    entity: structuredClone(entity),
    entities: [structuredClone(entity)],
    changes: [{ type: "put", entity: structuredClone(entity) }],
    resultHandles: [input.handle],
    candidates: structuredClone(resolved.candidates),
    selectedCandidateIndex: resolved.selectedCandidateIndex,
  };
}

/**
 * Document-aware F-004 preparation gate used by browser preview and commit.
 * The pure construction function remains available for geometry-only consumers.
 */
export function prepareCompleteCircleDocumentCommand(
  document: KDrawDocumentV1,
  input: CompleteCircleCommandInput,
): PreparedCompleteCircleCommand {
  const layer = document.layers.find((candidate) => candidate.id === input.layerId);
  if (!layer) {
    throw new CircleCommandInputError("LAYER_NOT_FOUND", `CIRCLE result layer ${input.layerId} does not exist.`);
  }
  if (layer.locked) {
    throw new CircleCommandInputError("LAYER_LOCKED", `CIRCLE result layer ${input.layerId} is locked.`);
  }
  if (!layer.visible || layer.frozen) {
    throw new CircleCommandInputError("LAYER_HIDDEN", `CIRCLE result layer ${input.layerId} is off or frozen.`);
  }
  if (document.entities.some((entity) => entity.handle === input.handle)) {
    throw new CircleCommandInputError("HANDLE_COLLISION", `CIRCLE result handle ${input.handle} already exists.`);
  }
  return prepareCompleteCircleCommand(input);
}
