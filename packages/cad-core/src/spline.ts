import type { CadPoint2, CadSpline, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { EntityChange } from "./transaction.js";

// Adapted only from the F-012 creation kernel in WIP commit
// 0d9ca9a1d27d5e3c4e6382283b593b4d326a5b49. The WIP schema-only fields are
// stored in extensionData so this isolated branch keeps its pinned schema.
const EPSILON = 1e-9;

export type SplineKnotParameterization = "chord" | "sqrt-chord" | "uniform";

export interface ControlVertexSplineInput {
  handle: string;
  layerId: string;
  controlPoints: readonly CadPoint2[];
  degree?: number;
  weights?: readonly number[];
  closed?: boolean;
}

export interface FitPointSplineInput {
  handle: string;
  layerId: string;
  fitPoints: readonly CadPoint2[];
  fitTolerance?: number;
  knotParameterization?: SplineKnotParameterization;
  closed?: boolean;
  startTangent?: CadPoint2;
  endTangent?: CadPoint2;
}

export type SplineCommandInput =
  | { method: "control-vertices"; handle: string; layerId: string; points: readonly CadPoint2[]; degree?: number; weights?: readonly number[]; closed?: boolean }
  | { method: "fit"; handle: string; layerId: string; points: readonly CadPoint2[]; fitTolerance?: number; knotParameterization?: SplineKnotParameterization; closed?: boolean; startTangent?: CadPoint2; endTangent?: CadPoint2 }
  | { method: "object"; handle: string; sourceHandle: string };

export interface PreparedSplineCommand {
  commandId: "SPLINE";
  changes: EntityChange[];
  targetHandles: string[];
  resultHandles: string[];
  entity: CadSpline;
}

function checkedPoints(points: readonly CadPoint2[], label: string): CadPoint2[] {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) throw new TypeError(`${label} points must be finite.`);
  return points.map((point) => ({ ...point }));
}

function clampedUniformKnots(controlPointCount: number, degree: number): number[] {
  const interiorCount = controlPointCount - degree - 1;
  return [
    ...Array.from({ length: degree + 1 }, () => 0),
    ...Array.from({ length: interiorCount }, (_unused, index) => (index + 1) / (interiorCount + 1)),
    ...Array.from({ length: degree + 1 }, () => 1),
  ];
}

function definitionData(value: Record<string, unknown>): Record<string, unknown> {
  return { splineDefinition: structuredClone(value) };
}

export function createControlVertexSpline(input: ControlVertexSplineInput): CadSpline {
  const controlPoints = checkedPoints(input.controlPoints, "SPLINE control-vertex");
  const degree = input.degree ?? 3;
  if (!Number.isInteger(degree) || degree < 1 || degree > 10) throw new TypeError("SPLINE degree must be an integer from 1 through 10.");
  if (controlPoints.length <= degree) throw new TypeError("SPLINE requires at least degree plus one control vertices.");
  const weights = input.weights === undefined ? undefined : [...input.weights];
  if (weights && (weights.length !== controlPoints.length || weights.some((weight) => !Number.isFinite(weight) || weight <= 0))) {
    throw new TypeError("SPLINE weights must contain one positive finite value per control vertex.");
  }
  if (input.closed) {
    const periodicControlPoints = [...controlPoints, ...controlPoints.slice(0, degree)].map((point) => ({ ...point }));
    const periodicWeights = weights ? [...weights, ...weights.slice(0, degree)] : undefined;
    const lastKnot = periodicControlPoints.length + degree;
    return {
      kind: "spline", handle: input.handle, layerId: input.layerId,
      extensionData: definitionData({ method: "control-vertices", originalControlPoints: controlPoints }),
      degree, controlPoints: periodicControlPoints,
      knots: Array.from({ length: lastKnot + 1 }, (_unused, index) => index / lastKnot),
      ...(periodicWeights ? { weights: periodicWeights } : {}), closed: true, periodic: true,
    };
  }
  return {
    kind: "spline", handle: input.handle, layerId: input.layerId,
    extensionData: definitionData({ method: "control-vertices" }),
    degree, controlPoints, knots: clampedUniformKnots(controlPoints.length, degree),
    ...(weights ? { weights } : {}), closed: false, periodic: false,
  };
}

function parameterValues(points: readonly CadPoint2[], mode: SplineKnotParameterization): number[] {
  if (mode === "uniform") return points.map((_point, index) => index / (points.length - 1));
  const distances = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (!(length > EPSILON)) throw new TypeError("SPLINE fit points must not contain consecutive duplicates.");
    return mode === "sqrt-chord" ? Math.sqrt(length) : length;
  });
  const total = distances.reduce((sum, length) => sum + length, 0);
  let cumulative = 0;
  return [0, ...distances.map((length) => (cumulative += length) / total)];
}

function naturalFitKnots(parameters: readonly number[], degree: number): number[] {
  return [
    ...Array.from({ length: degree + 1 }, () => parameters[0]!),
    ...parameters.slice(1, -1),
    ...Array.from({ length: degree + 1 }, () => parameters.at(-1)!),
  ];
}

function basisRow(parameter: number, degree: number, knots: readonly number[], controlPointCount: number): number[] {
  const last = controlPointCount - 1;
  let span = degree;
  if (parameter >= knots[last + 1]! - EPSILON) span = last;
  else {
    let low = degree;
    let high = last + 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (parameter < knots[middle]!) high = middle;
      else low = middle;
    }
    span = low;
  }
  const basis = Array.from({ length: degree + 1 }, () => 0);
  const left = Array.from({ length: degree + 1 }, () => 0);
  const right = Array.from({ length: degree + 1 }, () => 0);
  basis[0] = 1;
  for (let order = 1; order <= degree; order += 1) {
    left[order] = parameter - knots[span + 1 - order]!;
    right[order] = knots[span + order]! - parameter;
    let saved = 0;
    for (let index = 0; index < order; index += 1) {
      const denominator = right[index + 1]! + left[order - index]!;
      const term = Math.abs(denominator) <= EPSILON ? 0 : basis[index]! / denominator;
      basis[index] = saved + right[index + 1]! * term;
      saved = left[order - index]! * term;
    }
    basis[order] = saved;
  }
  const row = Array.from({ length: controlPointCount }, () => 0);
  for (let index = 0; index <= degree; index += 1) row[span - degree + index] = basis[index]!;
  return row;
}

function solveLinearSystem(matrix: readonly (readonly number[])[], values: readonly number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]!]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(augmented[row]![pivot]!) > Math.abs(augmented[best]![pivot]!)) best = row;
    if (Math.abs(augmented[best]![pivot]!) <= EPSILON) throw new TypeError("SPLINE fit-point interpolation matrix is singular.");
    [augmented[pivot], augmented[best]] = [augmented[best]!, augmented[pivot]!];
    const divisor = augmented[pivot]![pivot]!;
    for (let column = pivot; column <= size; column += 1) augmented[pivot]![column] = augmented[pivot]![column]! / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]![pivot]!;
      for (let column = pivot; column <= size; column += 1) augmented[row]![column] = augmented[row]![column]! - factor * augmented[pivot]![column]!;
    }
  }
  return augmented.map((row) => row[size]!);
}

function openNaturalFitRepresentation(points: readonly CadPoint2[], parameters: readonly number[]): { controlPoints: CadPoint2[]; knots: number[] } {
  const degree = 3;
  const controlPointCount = points.length + 2;
  const knots = naturalFitKnots(parameters, degree);
  const matrix = parameters.map((parameter) => basisRow(parameter, degree, knots, controlPointCount));
  const startFirstSpan = knots[degree + 1]! - knots[1]!;
  const startSecondSpan = knots[degree + 2]! - knots[2]!;
  const endFirstSpan = knots.at(-2)! - knots[controlPointCount - 1]!;
  const endSecondSpan = knots.at(-3)! - knots[controlPointCount - 2]!;
  if (![startFirstSpan, startSecondSpan, endFirstSpan, endSecondSpan].every((value) => value > EPSILON)) throw new TypeError("SPLINE natural fit-point boundary is degenerate.");
  const startBoundary = Array.from({ length: controlPointCount }, () => 0);
  startBoundary[0] = 1 / startFirstSpan;
  startBoundary[1] = -1 / startFirstSpan - 1 / startSecondSpan;
  startBoundary[2] = 1 / startSecondSpan;
  const endBoundary = Array.from({ length: controlPointCount }, () => 0);
  endBoundary[controlPointCount - 1] = 1 / endFirstSpan;
  endBoundary[controlPointCount - 2] = -1 / endFirstSpan - 1 / endSecondSpan;
  endBoundary[controlPointCount - 3] = 1 / endSecondSpan;
  matrix.push(startBoundary, endBoundary);
  const x = solveLinearSystem(matrix, [...points.map((point) => point.x), 0, 0]);
  const y = solveLinearSystem(matrix, [...points.map((point) => point.y), 0, 0]);
  return { knots, controlPoints: x.map((coordinate, index) => ({ x: coordinate, y: y[index]! })) };
}

function openFitRepresentationWithTangents(
  points: readonly CadPoint2[], parameters: readonly number[], startTangent: CadPoint2 | undefined, endTangent: CadPoint2 | undefined,
): { controlPoints: CadPoint2[]; knots: number[] } {
  const count = points.length;
  const lengths = parameters.slice(1).map((parameter, index) => parameter - parameters[index]!);
  const matrix = Array.from({ length: count }, () => Array.from({ length: count }, () => 0));
  const rhsX = Array.from({ length: count }, () => 0);
  const rhsY = Array.from({ length: count }, () => 0);
  if (startTangent) {
    matrix[0]![0] = 2 * lengths[0]!; matrix[0]![1] = lengths[0]!;
    rhsX[0] = 6 * ((points[1]!.x - points[0]!.x) / lengths[0]! - startTangent.x);
    rhsY[0] = 6 * ((points[1]!.y - points[0]!.y) / lengths[0]! - startTangent.y);
  } else matrix[0]![0] = 1;
  for (let index = 1; index < count - 1; index += 1) {
    const previousLength = lengths[index - 1]!;
    const nextLength = lengths[index]!;
    matrix[index]![index - 1] = previousLength;
    matrix[index]![index] = 2 * (previousLength + nextLength);
    matrix[index]![index + 1] = nextLength;
    rhsX[index] = 6 * ((points[index + 1]!.x - points[index]!.x) / nextLength - (points[index]!.x - points[index - 1]!.x) / previousLength);
    rhsY[index] = 6 * ((points[index + 1]!.y - points[index]!.y) / nextLength - (points[index]!.y - points[index - 1]!.y) / previousLength);
  }
  const last = count - 1;
  if (endTangent) {
    matrix[last]![last - 1] = lengths[last - 1]!; matrix[last]![last] = 2 * lengths[last - 1]!;
    rhsX[last] = 6 * (endTangent.x - (points[last]!.x - points[last - 1]!.x) / lengths[last - 1]!);
    rhsY[last] = 6 * (endTangent.y - (points[last]!.y - points[last - 1]!.y) / lengths[last - 1]!);
  } else matrix[last]![last] = 1;
  const secondX = solveLinearSystem(matrix, rhsX);
  const secondY = solveLinearSystem(matrix, rhsY);
  const second = secondX.map((x, index) => ({ x, y: secondY[index]! }));
  const controlPoints: CadPoint2[] = [{ ...points[0]! }];
  const knots = [0, 0, 0, 0];
  for (let index = 0; index < last; index += 1) {
    const point = points[index]!; const next = points[index + 1]!; const currentSecond = second[index]!; const nextSecond = second[index + 1]!; const length = lengths[index]!;
    const startDerivative = { x: (next.x - point.x) / length - length * (2 * currentSecond.x + nextSecond.x) / 6, y: (next.y - point.y) / length - length * (2 * currentSecond.y + nextSecond.y) / 6 };
    const endDerivative = { x: (next.x - point.x) / length + length * (currentSecond.x + 2 * nextSecond.x) / 6, y: (next.y - point.y) / length + length * (currentSecond.y + 2 * nextSecond.y) / 6 };
    controlPoints.push(
      { x: point.x + startDerivative.x * length / 3, y: point.y + startDerivative.y * length / 3 },
      { x: next.x - endDerivative.x * length / 3, y: next.y - endDerivative.y * length / 3 },
      { ...next },
    );
    if (index < last - 1) knots.push(parameters[index + 1]!, parameters[index + 1]!, parameters[index + 1]!);
  }
  knots.push(1, 1, 1, 1);
  return { controlPoints, knots };
}

function periodicFitRepresentation(points: readonly CadPoint2[], mode: SplineKnotParameterization): { controlPoints: CadPoint2[]; knots: number[] } {
  const count = points.length;
  const rawLengths = points.map((point, index) => {
    const next = points[(index + 1) % count]!;
    const length = mode === "uniform" ? 1 : Math.hypot(next.x - point.x, next.y - point.y);
    if (!(length > EPSILON)) throw new TypeError("SPLINE closed fit points must not contain coincident neighboring points.");
    return mode === "sqrt-chord" ? Math.sqrt(length) : length;
  });
  const total = rawLengths.reduce((sum, length) => sum + length, 0);
  const lengths = rawLengths.map((length) => length / total);
  const matrix = Array.from({ length: count }, (_unused, index) => {
    const previous = (index - 1 + count) % count; const next = (index + 1) % count; const row = Array.from({ length: count }, () => 0);
    row[previous] = lengths[previous]!; row[index] = 2 * (lengths[previous]! + lengths[index]!); row[next] = lengths[index]!; return row;
  });
  const rhs = (axis: "x" | "y") => points.map((point, index) => {
    const previous = points[(index - 1 + count) % count]!; const next = points[(index + 1) % count]!;
    return 6 * ((next[axis] - point[axis]) / lengths[index]! - (point[axis] - previous[axis]) / lengths[(index - 1 + count) % count]!);
  });
  const secondX = solveLinearSystem(matrix, rhs("x")); const secondY = solveLinearSystem(matrix, rhs("y"));
  const second = secondX.map((x, index) => ({ x, y: secondY[index]! }));
  const controlPoints: CadPoint2[] = []; const boundaries = [0]; let cumulative = 0;
  for (let index = 0; index < count; index += 1) {
    const point = points[index]!; const next = points[(index + 1) % count]!; const currentSecond = second[index]!; const nextSecond = second[(index + 1) % count]!; const length = lengths[index]!;
    const startDerivative = { x: (next.x - point.x) / length - length * (2 * currentSecond.x + nextSecond.x) / 6, y: (next.y - point.y) / length - length * (2 * currentSecond.y + nextSecond.y) / 6 };
    const endDerivative = { x: (next.x - point.x) / length + length * (currentSecond.x + 2 * nextSecond.x) / 6, y: (next.y - point.y) / length + length * (currentSecond.y + 2 * nextSecond.y) / 6 };
    if (index === 0) controlPoints.push({ ...point });
    controlPoints.push({ x: point.x + startDerivative.x * length / 3, y: point.y + startDerivative.y * length / 3 }, { x: next.x - endDerivative.x * length / 3, y: next.y - endDerivative.y * length / 3 }, { ...next });
    cumulative += length; boundaries.push(index === count - 1 ? 1 : cumulative);
  }
  const knots = [0, 0, 0, 0];
  for (const boundary of boundaries.slice(1, -1)) knots.push(boundary, boundary, boundary);
  knots.push(1, 1, 1, 1);
  return { controlPoints, knots };
}

function checkedTangent(value: CadPoint2 | undefined, label: string): CadPoint2 | undefined {
  if (!value) return undefined;
  const length = Math.hypot(value.x, value.y);
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !(length > EPSILON)) throw new TypeError(`SPLINE ${label} tangent must be a non-zero finite vector.`);
  return { x: value.x / length, y: value.y / length };
}

export function createFitPointSpline(input: FitPointSplineInput): CadSpline {
  const fitPoints = checkedPoints(input.fitPoints, "SPLINE fit");
  if (fitPoints.length < 3) throw new TypeError("SPLINE fit method requires at least three points.");
  const fitTolerance = input.fitTolerance ?? 0;
  if (!Number.isFinite(fitTolerance) || fitTolerance < 0) throw new TypeError("SPLINE fit tolerance must be finite and non-negative.");
  const knotParameterization = input.knotParameterization ?? "chord";
  const startTangent = checkedTangent(input.startTangent, "start");
  const endTangent = checkedTangent(input.endTangent, "end");
  if (input.closed && (startTangent || endTangent)) throw new TypeError("SPLINE closed periodic Fit method does not accept endpoint tangents.");
  let representation: { controlPoints: CadPoint2[]; knots: number[] };
  if (input.closed) representation = periodicFitRepresentation(fitPoints, knotParameterization);
  else {
    const parameters = parameterValues(fitPoints, knotParameterization);
    representation = startTangent || endTangent
      ? openFitRepresentationWithTangents(fitPoints, parameters, startTangent, endTangent)
      : openNaturalFitRepresentation(fitPoints, parameters);
  }
  return {
    kind: "spline", handle: input.handle, layerId: input.layerId,
    extensionData: definitionData({
      method: "fit-points", fitPoints, fitTolerance, knotParameterization,
      ...(startTangent ? { startTangent } : {}), ...(endTangent ? { endTangent } : {}),
    }),
    degree: 3, controlPoints: representation.controlPoints, knots: representation.knots,
    closed: input.closed === true, periodic: input.closed === true,
  };
}

export function splinePointAtParameter(entity: CadSpline, parameter: number): CadPoint2 | null {
  const degree = entity.degree; const last = entity.controlPoints.length - 1;
  if (degree < 1 || last < degree || entity.knots.length !== last + degree + 2) return null;
  const start = entity.knots[degree]!; const end = entity.knots[last + 1]!; const u = Math.min(end, Math.max(start, parameter));
  let span = last;
  if (u < end) { span = degree; while (span < last && !(u >= entity.knots[span]! && u < entity.knots[span + 1]!)) span += 1; }
  const values = Array.from({ length: degree + 1 }, (_unused, index) => {
    const sourceIndex = span - degree + index; const point = entity.controlPoints[sourceIndex]!; const weight = entity.weights?.[sourceIndex] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  for (let level = 1; level <= degree; level += 1) for (let index = degree; index >= level; index -= 1) {
    const sourceIndex = span - degree + index; const denominator = entity.knots[sourceIndex + degree - level + 1]! - entity.knots[sourceIndex]!;
    const alpha = denominator === 0 ? 0 : (u - entity.knots[sourceIndex]!) / denominator; const before = values[index - 1]!; const current = values[index]!;
    values[index] = { x: before.x * (1 - alpha) + current.x * alpha, y: before.y * (1 - alpha) + current.y * alpha, weight: before.weight * (1 - alpha) + current.weight * alpha };
  }
  const result = values[degree]!;
  return result.weight === 0 ? null : { x: result.x / result.weight, y: result.y / result.weight };
}

export function prepareSplineCommand(document: KDrawDocumentV1, input: SplineCommandInput): PreparedSplineCommand {
  let entity: CadSpline;
  const changes: EntityChange[] = [];
  const targetHandles: string[] = [];
  if (input.method === "control-vertices") {
    entity = createControlVertexSpline({ handle: input.handle, layerId: input.layerId, controlPoints: input.points, ...(input.degree !== undefined ? { degree: input.degree } : {}), ...(input.weights ? { weights: input.weights } : {}), ...(input.closed !== undefined ? { closed: input.closed } : {}) });
  } else if (input.method === "fit") {
    entity = createFitPointSpline({
      handle: input.handle, layerId: input.layerId, fitPoints: input.points,
      ...(input.fitTolerance !== undefined ? { fitTolerance: input.fitTolerance } : {}),
      ...(input.knotParameterization ? { knotParameterization: input.knotParameterization } : {}),
      ...(input.closed !== undefined ? { closed: input.closed } : {}),
      ...(input.startTangent ? { startTangent: input.startTangent } : {}), ...(input.endTangent ? { endTangent: input.endTangent } : {}),
    });
  } else {
    const source = document.entities.find((candidate) => candidate.handle === input.sourceHandle);
    if (!source) throw new TypeError(`SPLINE Object source ${input.sourceHandle} does not exist.`);
    if (document.layers.find((layer) => layer.id === source.layerId)?.locked) throw new TypeError("SPLINE Object source is on a locked layer.");
    if (source.kind !== "polyline" || source.closed || source.vertices.some((vertex) => vertex.bulge !== undefined || vertex.startWidth !== undefined || vertex.endWidth !== undefined)) {
      throw new TypeError("SPLINE Object requires an open polyline without bulges or widths.");
    }
    const degree = Math.min(3, source.vertices.length - 1);
    entity = createControlVertexSpline({ handle: input.handle, layerId: source.layerId, controlPoints: source.vertices, degree });
    entity = { ...entity, ...(source.appearance ? { appearance: structuredClone(source.appearance) } : {}), extensionData: { ...(source.extensionData ?? {}), ...(entity.extensionData ?? {}) } };
    changes.push({ type: "delete", handle: source.handle });
    targetHandles.push(source.handle);
  }
  changes.push({ type: "put", entity });
  return { commandId: "SPLINE", changes, targetHandles, resultHandles: [entity.handle], entity: structuredClone(entity) };
}
