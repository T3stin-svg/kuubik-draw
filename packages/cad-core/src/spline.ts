import type { CadLine, CadPoint2, CadPolyline, CadSpline } from "@kuubik/cad-schema";

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

export function transformSplineDefinition(
  spline: CadSpline,
  pointTransform: (point: CadPoint2) => CadPoint2,
  vectorTransform: (vector: CadPoint2) => CadPoint2 = (vector) => ({ ...vector }),
): CadSpline {
  return {
    ...spline,
    controlPoints: spline.controlPoints.map(pointTransform),
    ...(spline.fitPoints ? { fitPoints: spline.fitPoints.map(pointTransform) } : {}),
    ...(spline.startTangent ? { startTangent: vectorTransform(spline.startTangent) } : {}),
    ...(spline.endTangent ? { endTangent: vectorTransform(spline.endTangent) } : {}),
  };
}

export function editedControlVertexSpline(spline: CadSpline, controlPoints: readonly CadPoint2[]): CadSpline {
  const {
    fitPoints: _fitPoints,
    fitTolerance: _fitTolerance,
    startTangent: _startTangent,
    endTangent: _endTangent,
    knotParameterization: _knotParameterization,
    ...controlVertexSpline
  } = spline;
  return { ...controlVertexSpline, definitionMethod: "control-vertices", controlPoints: controlPoints.map((point) => ({ ...point })) };
}

function splineMetadata(spline: CadSpline): Omit<CadSpline,
  "definitionMethod" | "degree" | "controlPoints" | "knots" | "weights" | "fitPoints" | "fitTolerance" |
  "knotParameterization" | "startTangent" | "endTangent" | "closed" | "periodic"
> {
  const {
    definitionMethod: _definitionMethod,
    degree: _degree,
    controlPoints: _controlPoints,
    knots: _knots,
    weights: _weights,
    fitPoints: _fitPoints,
    fitTolerance: _fitTolerance,
    knotParameterization: _knotParameterization,
    startTangent: _startTangent,
    endTangent: _endTangent,
    closed: _closed,
    periodic: _periodic,
    ...metadata
  } = spline;
  return metadata;
}

interface FitDefinitionSnapshot {
  fitPoints: CadPoint2[];
  fitTolerance: number | undefined;
  knotParameterization: SplineKnotParameterization | undefined;
  startTangent: CadPoint2 | undefined;
  endTangent: CadPoint2 | undefined;
  closed: boolean;
}

interface FitRebuildChanges {
  fitPoints?: readonly CadPoint2[];
  fitTolerance?: number;
  knotParameterization?: SplineKnotParameterization;
  closed?: boolean;
  startTangent?: CadPoint2 | null;
  endTangent?: CadPoint2 | null;
}

function fitDefinition(spline: CadSpline): FitDefinitionSnapshot {
  if (spline.definitionMethod !== "fit-points" || !spline.fitPoints) throw new TypeError("SPLINEDIT Fit operation requires a Fit-defined SPLINE.");
  return {
    fitPoints: spline.fitPoints,
    fitTolerance: spline.fitTolerance,
    knotParameterization: spline.knotParameterization,
    startTangent: spline.startTangent,
    endTangent: spline.endTangent,
    closed: spline.closed,
  };
}

function rebuildFitSpline(spline: CadSpline, changes: FitRebuildChanges): CadSpline {
  const current = fitDefinition(spline);
  const startTangent = Object.prototype.hasOwnProperty.call(changes, "startTangent") ? changes.startTangent ?? undefined : current.startTangent;
  const endTangent = Object.prototype.hasOwnProperty.call(changes, "endTangent") ? changes.endTangent ?? undefined : current.endTangent;
  const input: FitPointSplineInput = {
    handle: spline.handle,
    layerId: spline.layerId,
    fitPoints: changes.fitPoints ?? current.fitPoints,
    closed: changes.closed ?? current.closed,
  };
  const fitTolerance = changes.fitTolerance ?? current.fitTolerance;
  const knotParameterization = changes.knotParameterization ?? current.knotParameterization;
  if (fitTolerance !== undefined) input.fitTolerance = fitTolerance;
  if (knotParameterization !== undefined) input.knotParameterization = knotParameterization;
  if (startTangent !== undefined) input.startTangent = startTangent;
  if (endTangent !== undefined) input.endTangent = endTangent;
  const rebuilt = createFitPointSpline(input);
  return { ...splineMetadata(spline), ...rebuilt };
}

/** Preserve the evaluated NURBS exactly while discarding editable Fit metadata. */
export function purgeSplineFitData(spline: CadSpline): CadSpline {
  fitDefinition(spline);
  return editedControlVertexSpline(spline, spline.controlPoints);
}

function pointsCoincide(first: CadPoint2, second: CadPoint2, tolerance = 1e-9): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

function appendLineToSplineEnd(source: CadSpline, lineEnd: CadPoint2): CadSpline {
  const degree = source.degree;
  const joinPoint = source.controlPoints.at(-1)!;
  if (pointsCoincide(joinPoint, lineEnd)) throw new TypeError("SPLINEDIT Join line must have non-zero length.");
  const endParameter = source.knots.at(-1)!;
  const controlPoints = [
    ...source.controlPoints.map((point) => ({ ...point })),
    ...Array.from({ length: degree }, (_, index) => {
      const fraction = (index + 1) / degree;
      return {
        x: joinPoint.x + (lineEnd.x - joinPoint.x) * fraction,
        y: joinPoint.y + (lineEnd.y - joinPoint.y) * fraction,
      };
    }),
  ];
  return {
    ...splineMetadata(source),
    definitionMethod: "control-vertices",
    degree,
    controlPoints,
    knots: [...source.knots.slice(0, -1), ...Array.from({ length: degree + 1 }, () => endParameter + 1)],
    weights: [...(source.weights ?? source.controlPoints.map(() => 1)), ...Array.from({ length: degree }, () => 1)],
    closed: false,
    periodic: false,
  };
}

/** AutoCAD 2024 SPLINEDIT Join principal LINE path: retain the source handle and add a C0 Bezier span. */
export function joinSplineWithLine(spline: CadSpline, line: CadLine, tolerance = 1e-9): CadSpline {
  if (spline.closed || spline.periodic) throw new TypeError("SPLINEDIT Join requires an open source SPLINE.");
  const source = spline.definitionMethod === "fit-points" || spline.fitPoints ? purgeSplineFitData(spline) : structuredClone(spline);
  const start = source.controlPoints[0]!;
  const end = source.controlPoints.at(-1)!;
  if (pointsCoincide(end, line.start, tolerance)) return appendLineToSplineEnd(source, line.end);
  if (pointsCoincide(end, line.end, tolerance)) return appendLineToSplineEnd(source, line.start);
  if (pointsCoincide(start, line.end, tolerance)) return reverseSpline(appendLineToSplineEnd(reverseSpline(source), line.start));
  if (pointsCoincide(start, line.start, tolerance)) return reverseSpline(appendLineToSplineEnd(reverseSpline(source), line.end));
  throw new TypeError("SPLINEDIT Join requires coincident endpoints.");
}

export function reverseSpline(spline: CadSpline): CadSpline {
  if (spline.definitionMethod === "fit-points" && spline.fitPoints) {
    const negate = (value: CadPoint2 | undefined): CadPoint2 | undefined => value ? { x: -value.x, y: -value.y } : undefined;
    return rebuildFitSpline(spline, {
      fitPoints: [...spline.fitPoints].reverse(),
      startTangent: negate(spline.endTangent) ?? null,
      endTangent: negate(spline.startTangent) ?? null,
    });
  }
  const start = spline.knots[0]!;
  const end = spline.knots.at(-1)!;
  return {
    ...spline,
    controlPoints: [...spline.controlPoints].reverse().map((point) => ({ ...point })),
    knots: [...spline.knots].reverse().map((value) => start + end - value),
    ...(spline.weights ? { weights: [...spline.weights].reverse() } : {}),
  };
}

export function addSplineFitPoint(spline: CadSpline, index: number, point: CadPoint2): CadSpline {
  const current = fitDefinition(spline);
  if (!Number.isInteger(index) || index < 0 || index > current.fitPoints.length) throw new TypeError("SPLINEDIT Fit add index is outside the fit-point range.");
  const fitPoints = current.fitPoints.map((value) => ({ ...value }));
  fitPoints.splice(index, 0, checkedPoints([point], "SPLINEDIT Fit add")[0]!);
  return rebuildFitSpline(spline, { fitPoints });
}

export function deleteSplineFitPoint(spline: CadSpline, index: number): CadSpline {
  const current = fitDefinition(spline);
  if (!Number.isInteger(index) || index < 0 || index >= current.fitPoints.length) throw new TypeError("SPLINEDIT Fit delete index is outside the fit-point range.");
  if (current.fitPoints.length <= 3) throw new TypeError("SPLINEDIT Fit delete requires at least three remaining fit points.");
  const fitPoints = current.fitPoints.map((value) => ({ ...value }));
  fitPoints.splice(index, 1);
  return rebuildFitSpline(spline, { fitPoints });
}

export function moveSplineFitPoint(spline: CadSpline, index: number, point: CadPoint2): CadSpline {
  const current = fitDefinition(spline);
  if (!Number.isInteger(index) || index < 0 || index >= current.fitPoints.length) throw new TypeError("SPLINEDIT Fit move index is outside the fit-point range.");
  const fitPoints = current.fitPoints.map((value) => ({ ...value }));
  fitPoints[index] = checkedPoints([point], "SPLINEDIT Fit move")[0]!;
  return rebuildFitSpline(spline, { fitPoints });
}

export function setSplineFitProperties(spline: CadSpline, properties: {
  fitTolerance?: number;
  startTangent?: CadPoint2 | null;
  endTangent?: CadPoint2 | null;
  knotParameterization?: SplineKnotParameterization;
}): CadSpline {
  fitDefinition(spline);
  const changes: FitRebuildChanges = {};
  if (properties.fitTolerance !== undefined) changes.fitTolerance = properties.fitTolerance;
  if (properties.knotParameterization !== undefined) changes.knotParameterization = properties.knotParameterization;
  if (properties.startTangent !== undefined) changes.startTangent = properties.startTangent;
  if (properties.endTangent !== undefined) changes.endTangent = properties.endTangent;
  return rebuildFitSpline(spline, changes);
}

function visibleControlVertexCount(spline: CadSpline): number {
  return spline.closed && spline.periodic ? spline.controlPoints.length - spline.degree : spline.controlPoints.length;
}

function assertControlVertexDefinition(spline: CadSpline): void {
  if (spline.definitionMethod === "fit-points" || spline.fitPoints) throw new TypeError("SPLINEDIT CV operation requires a control-vertex-defined SPLINE.");
}

export function moveSplineControlVertex(spline: CadSpline, index: number, point: CadPoint2): CadSpline {
  assertControlVertexDefinition(spline);
  const count = visibleControlVertexCount(spline);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new TypeError("SPLINEDIT CV move index is outside the control-vertex range.");
  const checked = checkedPoints([point], "SPLINEDIT CV move")[0]!;
  const controlPoints = spline.controlPoints.map((value) => ({ ...value }));
  controlPoints[index] = checked;
  if (spline.closed && spline.periodic && index < spline.degree) controlPoints[count + index] = { ...checked };
  return { ...spline, controlPoints };
}

export function setSplineControlVertexWeight(spline: CadSpline, index: number, weight: number): CadSpline {
  assertControlVertexDefinition(spline);
  const count = visibleControlVertexCount(spline);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new TypeError("SPLINEDIT CV weight index is outside the control-vertex range.");
  if (!Number.isFinite(weight) || weight <= 0) throw new TypeError("SPLINEDIT CV weight must be a positive finite number.");
  const weights = spline.weights ? [...spline.weights] : spline.controlPoints.map(() => 1);
  weights[index] = weight;
  if (spline.closed && spline.periodic && index < spline.degree) weights[count + index] = weight;
  return { ...spline, weights };
}

export function setSplineClosed(spline: CadSpline, closed: boolean): CadSpline {
  if (spline.closed === closed && spline.periodic === closed) return structuredClone(spline);
  if (spline.definitionMethod === "fit-points" && spline.fitPoints) {
    return rebuildFitSpline(spline, {
      closed,
      ...(closed ? { startTangent: null, endTangent: null } : {}),
    });
  }
  assertControlVertexDefinition(spline);
  const count = visibleControlVertexCount(spline);
  const rebuilt = createControlVertexSpline({
    handle: spline.handle,
    layerId: spline.layerId,
    controlPoints: spline.controlPoints.slice(0, count),
    degree: spline.degree,
    ...(spline.weights ? { weights: spline.weights.slice(0, count) } : {}),
    closed,
  });
  return { ...splineMetadata(spline), ...rebuilt };
}

const EPSILON = 1e-12;

function splineSpan(entity: CadSpline, parameter: number): number {
  const last = entity.controlPoints.length - 1;
  const end = entity.knots[last + 1]!;
  if (parameter >= end - EPSILON) return last;
  let span = entity.degree;
  while (span < last && !(parameter >= entity.knots[span]! && parameter < entity.knots[span + 1]!)) span += 1;
  return span;
}

function splineKnotMultiplicity(entity: CadSpline, parameter: number): number {
  return entity.knots.filter((knot) => Math.abs(knot - parameter) <= 1e-10).length;
}

function insertSplineKnotOnce(entity: CadSpline, parameter: number): CadSpline {
  const degree = entity.degree;
  const last = entity.controlPoints.length - 1;
  const span = splineSpan(entity, parameter);
  const multiplicity = splineKnotMultiplicity(entity, parameter);
  if (multiplicity >= degree + 1) return structuredClone(entity);
  const source = entity.controlPoints.map((point, index) => {
    const weight = entity.weights?.[index] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  const output = Array.from({ length: source.length + 1 }, () => ({ x: 0, y: 0, weight: 0 }));
  for (let index = 0; index <= span - degree; index += 1) output[index] = source[index]!;
  for (let index = span - multiplicity; index <= last; index += 1) output[index + 1] = source[index]!;
  for (let index = span - degree + 1; index <= span - multiplicity; index += 1) {
    const denominator = entity.knots[index + degree]! - entity.knots[index]!;
    const alpha = Math.abs(denominator) <= EPSILON ? 0 : (parameter - entity.knots[index]!) / denominator;
    const before = source[index - 1]!;
    const current = source[index]!;
    output[index] = {
      x: before.x * (1 - alpha) + current.x * alpha,
      y: before.y * (1 - alpha) + current.y * alpha,
      weight: before.weight * (1 - alpha) + current.weight * alpha,
    };
  }
  const controlPoints = output.map((point) => {
    if (!(Math.abs(point.weight) > EPSILON)) throw new TypeError("SPLINEDIT Fit Kink produced a zero homogeneous weight.");
    return { x: point.x / point.weight, y: point.y / point.weight };
  });
  return {
    ...structuredClone(entity),
    controlPoints,
    knots: [...entity.knots.slice(0, span + 1), parameter, ...entity.knots.slice(span + 1)],
    ...(entity.weights ? { weights: output.map(({ weight }) => weight) } : {}),
  };
}

export function splinePointAtParameter(entity: CadSpline, parameter: number): CadPoint2 | null {
  const degree = entity.degree;
  const last = entity.controlPoints.length - 1;
  if (degree < 1 || last < degree || entity.knots.length !== last + degree + 2) return null;
  const start = entity.knots[degree]!;
  const end = entity.knots[last + 1]!;
  const u = Math.min(end, Math.max(start, parameter));
  let span = last;
  if (u < end) {
    span = degree;
    while (span < last && !(u >= entity.knots[span]! && u < entity.knots[span + 1]!)) span += 1;
  }
  const values = Array.from({ length: degree + 1 }, (_unused, index) => {
    const sourceIndex = span - degree + index;
    const point = entity.controlPoints[sourceIndex]!;
    const weight = entity.weights?.[sourceIndex] ?? 1;
    return { x: point.x * weight, y: point.y * weight, weight };
  });
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const sourceIndex = span - degree + index;
      const denominator = entity.knots[sourceIndex + degree - level + 1]! - entity.knots[sourceIndex]!;
      const alpha = denominator === 0 ? 0 : (u - entity.knots[sourceIndex]!) / denominator;
      const before = values[index - 1]!;
      const current = values[index]!;
      values[index] = {
        x: before.x * (1 - alpha) + current.x * alpha,
        y: before.y * (1 - alpha) + current.y * alpha,
        weight: before.weight * (1 - alpha) + current.weight * alpha,
      };
    }
  }
  const result = values[degree]!;
  return result.weight === 0 ? null : { x: result.x / result.weight, y: result.y / result.weight };
}

/** Project a model-space point to the evaluated SPLINE parameter domain. */
export function closestSplineParameter(entity: CadSpline, point: CadPoint2): number {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError("SPLINE projection point must be finite.");
  const start = entity.knots[entity.degree];
  const end = entity.knots[entity.controlPoints.length];
  if (start === undefined || end === undefined || !(end > start)) throw new TypeError("SPLINE projection requires a valid parameter range.");
  const distanceSquaredAt = (parameter: number): number => {
    const candidate = splinePointAtParameter(entity, parameter);
    if (!candidate) return Number.POSITIVE_INFINITY;
    return (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
  };
  const samples = Math.max(1024, entity.controlPoints.length * 128);
  let best = start;
  let bestDistance = distanceSquaredAt(start);
  for (let index = 1; index <= samples; index += 1) {
    const parameter = start + (end - start) * index / samples;
    const candidateDistance = distanceSquaredAt(parameter);
    if (candidateDistance < bestDistance) {
      best = parameter;
      bestDistance = candidateDistance;
    }
  }
  const sampleSpan = (end - start) / samples;
  let low = Math.max(start, best - sampleSpan);
  let high = Math.min(end, best + sampleSpan);
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    if (distanceSquaredAt(first) <= distanceSquaredAt(second)) high = second;
    else low = first;
  }
  return (low + high) / 2;
}

/**
 * AutoCAD Fit Kink is a geometry-preserving refinement: it projects the
 * picked location onto a Fit-defined spline, inserts that knot to degree
 * multiplicity (C0 capacity), and purges editable Fit data to CV data.
 */
export function addSplineFitKink(spline: CadSpline, point: CadPoint2): CadSpline {
  fitDefinition(spline);
  const parameter = closestSplineParameter(spline, checkedPoints([point], "SPLINEDIT Fit Kink")[0]!);
  const start = spline.knots[spline.degree]!;
  const end = spline.knots[spline.controlPoints.length]!;
  if (!(parameter > start + EPSILON && parameter < end - EPSILON)) {
    throw new TypeError("SPLINEDIT Fit Kink requires an interior point on the SPLINE.");
  }
  let refined = structuredClone(spline);
  while (splineKnotMultiplicity(refined, parameter) < refined.degree) refined = insertSplineKnotOnce(refined, parameter);
  return editedControlVertexSpline(refined, refined.controlPoints);
}

/** AutoCAD Refine/Add: insert one knot at the projected curve point. */
export function addSplineControlVertex(spline: CadSpline, point: CadPoint2): CadSpline {
  assertControlVertexDefinition(spline);
  const parameter = closestSplineParameter(spline, checkedPoints([point], "SPLINEDIT CV Add")[0]!);
  const start = spline.knots[spline.degree]!;
  const end = spline.knots[spline.controlPoints.length]!;
  if (!(parameter > start + EPSILON && parameter < end - EPSILON)) {
    throw new TypeError("SPLINEDIT CV Add requires an interior point on the SPLINE.");
  }
  if (splineKnotMultiplicity(spline, parameter) >= spline.degree) {
    throw new TypeError("SPLINEDIT CV Add requires a point whose knot multiplicity is below the SPLINE degree.");
  }
  return insertSplineKnotOnce(spline, parameter);
}

/**
 * AutoCAD Refine/Delete removes the picked CV and the interior knot nearest
 * that CV's Greville abscissa. An exact tie resolves to the later knot. The
 * measured matrices cover open cubic/quadratic, rational, repeated-knot,
 * minimum-degree reduction and closed-periodic inputs.
 */
export function deleteSplineControlVertex(spline: CadSpline, index: number): CadSpline {
  assertControlVertexDefinition(spline);
  if (spline.closed !== spline.periodic) throw new TypeError("SPLINEDIT CV Delete requires coherent closed/periodic flags.");
  const count = visibleControlVertexCount(spline);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new TypeError("SPLINEDIT CV Delete index is outside the control-vertex range.");
  }
  if (spline.closed && spline.periodic) {
    if (count <= spline.degree + 1) {
      throw new TypeError("SPLINEDIT periodic CV Delete requires degree plus one remaining unique control vertices until the minimum periodic matrix is proven.");
    }
    const uniquePoints = spline.controlPoints.slice(0, count).map((point) => ({ ...point }));
    const uniqueWeights = spline.weights?.slice(0, count);
    uniquePoints.splice(index, 1);
    uniqueWeights?.splice(index, 1);
    const controlPoints = [...uniquePoints, ...uniquePoints.slice(0, spline.degree)].map((point) => ({ ...point }));
    const weights = uniqueWeights ? [...uniqueWeights, ...uniqueWeights.slice(0, spline.degree)] : undefined;
    const compactKnots = spline.knots.slice(spline.degree, spline.degree + count + 1);
    compactKnots.splice(index, 1);
    const period = compactKnots.at(-1)! - compactKnots[0]!;
    if (!(period > EPSILON)) throw new TypeError("SPLINEDIT periodic CV Delete requires a positive knot period.");
    const knots = [
      ...compactKnots.slice(compactKnots.length - spline.degree - 1, -1).map((knot) => knot - period),
      ...compactKnots,
      ...compactKnots.slice(1, spline.degree + 1).map((knot) => knot + period),
    ];
    return {
      ...structuredClone(spline),
      controlPoints,
      knots,
      ...(weights ? { weights } : {}),
    };
  }
  if (count < spline.degree + 1) {
    throw new TypeError("SPLINEDIT CV Delete received fewer control vertices than the SPLINE degree permits.");
  }
  if (count === spline.degree + 1) {
    if (spline.degree <= 1) {
      throw new TypeError("SPLINEDIT CV Delete cannot reduce a linear SPLINE until the AutoCAD minimum-degree matrix is proven.");
    }
    const controlPoints = spline.controlPoints.map((point) => ({ ...point }));
    const weights = spline.weights ? [...spline.weights] : undefined;
    controlPoints.splice(index, 1);
    weights?.splice(index, 1);
    return {
      ...structuredClone(spline),
      degree: spline.degree - 1,
      controlPoints,
      knots: spline.knots.slice(1, -1),
      ...(weights ? { weights } : {}),
    };
  }
  const firstInteriorKnotIndex = spline.degree + 1;
  const lastInteriorKnotIndex = spline.knots.length - spline.degree - 2;
  if (lastInteriorKnotIndex < firstInteriorKnotIndex) {
    throw new TypeError("SPLINEDIT CV Delete requires at least one interior knot.");
  }
  let greville = 0;
  for (let offset = 1; offset <= spline.degree; offset += 1) greville += spline.knots[index + offset]!;
  greville /= spline.degree;
  let knotIndex = firstInteriorKnotIndex;
  let knotDistance = Math.abs(spline.knots[knotIndex]! - greville);
  for (let candidate = firstInteriorKnotIndex + 1; candidate <= lastInteriorKnotIndex; candidate += 1) {
    const distance = Math.abs(spline.knots[candidate]! - greville);
    if (distance <= knotDistance + EPSILON) {
      knotIndex = candidate;
      knotDistance = distance;
    }
  }
  const controlPoints = spline.controlPoints.map((point) => ({ ...point }));
  const knots = [...spline.knots];
  controlPoints.splice(index, 1);
  knots.splice(knotIndex, 1);
  const weights = spline.weights ? [...spline.weights] : undefined;
  weights?.splice(index, 1);
  return {
    ...structuredClone(spline),
    controlPoints,
    knots,
    ...(weights ? { weights } : {}),
  };
}

function basisValues(knots: readonly number[], degree: number, controlPointCount: number, parameter: number): number[] {
  const start = knots[degree]!;
  const end = knots[controlPointCount]!;
  if (Math.abs(parameter - start) <= EPSILON) return Array.from({ length: controlPointCount }, (_unused, index) => index === 0 ? 1 : 0);
  if (Math.abs(parameter - end) <= EPSILON) return Array.from({ length: controlPointCount }, (_unused, index) => index === controlPointCount - 1 ? 1 : 0);
  let basis: number[] = Array.from({ length: knots.length - 1 }, (_unused, index) => parameter >= knots[index]! && parameter < knots[index + 1]! ? 1 : 0);
  for (let level = 1; level <= degree; level += 1) {
    basis = Array.from({ length: basis.length - 1 }, (_unused, index) => {
      const leftDenominator = knots[index + level]! - knots[index]!;
      const rightDenominator = knots[index + level + 1]! - knots[index + 1]!;
      const left = Math.abs(leftDenominator) <= EPSILON ? 0 : (parameter - knots[index]!) * basis[index]! / leftDenominator;
      const right = Math.abs(rightDenominator) <= EPSILON ? 0 : (knots[index + level + 1]! - parameter) * basis[index + 1]! / rightDenominator;
      return left + right;
    });
  }
  return basis.slice(0, controlPointCount);
}

function solveElevationLinearSystem(matrix: readonly (readonly number[])[], values: readonly number[]): number[] {
  const size = matrix.length;
  if (values.length !== size || matrix.some((row) => row.length !== size)) throw new TypeError("SPLINE degree elevation matrix must be square.");
  const augmented = matrix.map((row, index) => [...row, values[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    if (!(Math.abs(augmented[pivot]![column]!) > 1e-13)) throw new TypeError("SPLINE degree elevation matrix is singular.");
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let index = column; index <= size; index += 1) augmented[column]![index] = augmented[column]![index]! / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (Math.abs(factor) <= EPSILON) continue;
      for (let index = column; index <= size; index += 1) augmented[row]![index] = augmented[row]![index]! - factor * augmented[column]![index]!;
    }
  }
  return augmented.map((row) => row[size]!);
}

function elevateSplineDegreeOnce(spline: CadSpline): CadSpline {
  const degree = spline.degree;
  const elevatedDegree = degree + 1;
  const elevatedKnots: number[] = [];
  for (const knot of spline.knots) {
    if (!elevatedKnots.length || Math.abs(elevatedKnots.at(-1)! - knot) > 1e-12) elevatedKnots.push(knot, knot);
    else elevatedKnots.push(knot);
  }
  const controlPointCount = elevatedKnots.length - elevatedDegree - 1;
  const parameters = Array.from({ length: controlPointCount }, (_unused, index) => {
    let sum = 0;
    for (let offset = 1; offset <= elevatedDegree; offset += 1) sum += elevatedKnots[index + offset]!;
    return sum / elevatedDegree;
  });
  const matrix = parameters.map((parameter) => basisValues(elevatedKnots, elevatedDegree, controlPointCount, parameter));
  const sourceHomogeneous = parameters.map((parameter) => {
    const basis = basisValues(spline.knots, degree, spline.controlPoints.length, parameter);
    return spline.controlPoints.reduce<{ x: number; y: number; weight: number }>((sum, point, index) => {
      const weight = spline.weights?.[index] ?? 1;
      const factor = basis[index]! * weight;
      return { x: sum.x + point.x * factor, y: sum.y + point.y * factor, weight: sum.weight + factor };
    }, { x: 0, y: 0, weight: 0 });
  });
  const homogeneousX = solveElevationLinearSystem(matrix, sourceHomogeneous.map(({ x }) => x));
  const homogeneousY = solveElevationLinearSystem(matrix, sourceHomogeneous.map(({ y }) => y));
  const weights = solveElevationLinearSystem(matrix, sourceHomogeneous.map(({ weight }) => weight));
  const controlPoints = weights.map((weight, index) => {
    if (!(Math.abs(weight) > EPSILON)) throw new TypeError("SPLINE degree elevation produced a zero homogeneous weight.");
    return { x: homogeneousX[index]! / weight, y: homogeneousY[index]! / weight };
  });
  return {
    ...structuredClone(spline),
    degree: elevatedDegree,
    controlPoints,
    knots: elevatedKnots,
    ...(spline.weights ? { weights } : {}),
  };
}

/** AutoCAD Refine/Elevate order. Order is degree plus one and is capped at 26. */
export function elevateSplineOrder(spline: CadSpline, order: number): CadSpline {
  assertControlVertexDefinition(spline);
  if (!Number.isInteger(order) || order < spline.degree + 2 || order > 26) {
    throw new TypeError(`SPLINEDIT CV Elevate requires an integer order from ${spline.degree + 2} through 26.`);
  }
  let elevated = structuredClone(spline);
  while (elevated.degree + 1 < order) elevated = elevateSplineDegreeOnce(elevated);
  return elevated;
}

function splinePolylineTolerance(spline: CadSpline, precision: number): number {
  const xs = spline.controlPoints.map(({ x }) => x);
  const ys = spline.controlPoints.map(({ y }) => y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(diagonal > EPSILON)) throw new TypeError("SPLINEDIT Convert to Polyline requires non-degenerate SPLINE geometry.");
  // AutoCAD exposes an integer 0..99 precision rather than a drawing-unit
  // tolerance. Keep the same monotonic contract and use a cubic scale so the
  // measured precision-10 fixture lands at the observed sub-unit error level.
  return Math.max(diagonal / ((precision + 1) ** 3), diagonal * 1e-10);
}

/**
 * Build a deterministic linear LWPOLYLINE approximation of the evaluated
 * NURBS. Every active knot span is retained and recursively subdivided using
 * quarter/midpoint chord error, so preview, commit and exported DXF share one
 * predicate and cannot skip an inflection hidden at the midpoint.
 */
export function convertSplineToPolyline(spline: CadSpline, resultHandle: string, precision: number): CadPolyline {
  if (!resultHandle.trim()) throw new TypeError("SPLINEDIT Convert to Polyline result handle is required.");
  if (!Number.isInteger(precision) || precision < 0 || precision > 99) {
    throw new TypeError("SPLINEDIT Convert to Polyline precision must be an integer from 0 through 99.");
  }
  const start = spline.knots[spline.degree];
  const end = spline.knots[spline.controlPoints.length];
  if (start === undefined || end === undefined || !(end > start)) {
    throw new TypeError("SPLINEDIT Convert to Polyline requires a valid SPLINE parameter range.");
  }
  const tolerance = splinePolylineTolerance(spline, precision);
  const pointAt = (parameter: number): CadPoint2 => {
    const point = splinePointAtParameter(spline, parameter);
    if (!point) throw new TypeError("SPLINEDIT Convert to Polyline could not evaluate the SPLINE.");
    return point;
  };
  const spans = [
    start,
    ...spline.knots.filter((value, index) => index > spline.degree && index < spline.controlPoints.length && value > start + EPSILON && value < end - EPSILON),
    end,
  ].filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]!) > EPSILON);
  const vertices: CadPoint2[] = [pointAt(start)];
  const subdivide = (from: number, fromPoint: CadPoint2, to: number, toPoint: CadPoint2, depth: number): void => {
    const quarter = from + (to - from) * 0.25;
    const middle = (from + to) / 2;
    const threeQuarter = from + (to - from) * 0.75;
    const quarterPoint = pointAt(quarter);
    const middlePoint = pointAt(middle);
    const threeQuarterPoint = pointAt(threeQuarter);
    const error = Math.max(
      pointToSegmentDistance(quarterPoint, fromPoint, toPoint),
      pointToSegmentDistance(middlePoint, fromPoint, toPoint),
      pointToSegmentDistance(threeQuarterPoint, fromPoint, toPoint),
    );
    if (error <= tolerance || depth >= 20) {
      vertices.push(toPoint);
      return;
    }
    subdivide(from, fromPoint, middle, middlePoint, depth + 1);
    subdivide(middle, middlePoint, to, toPoint, depth + 1);
  };
  for (let index = 0; index < spans.length - 1; index += 1) {
    const from = spans[index]!;
    const to = spans[index + 1]!;
    subdivide(from, pointAt(from), to, pointAt(to), 0);
  }
  if (spline.closed && vertices.length > 1) {
    const first = vertices[0]!;
    const last = vertices.at(-1)!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tolerance) vertices.pop();
  }
  if (vertices.length < (spline.closed ? 3 : 2)) throw new TypeError("SPLINEDIT Convert to Polyline produced too few vertices.");
  return {
    ...splineMetadata(spline),
    kind: "polyline",
    handle: resultHandle,
    layerId: spline.layerId,
    closed: spline.closed,
    vertices,
  };
}

function checkedPoints(points: readonly CadPoint2[], label: string): CadPoint2[] {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw new TypeError(`${label} points must be finite.`);
  }
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
      kind: "spline",
      handle: input.handle,
      layerId: input.layerId,
      definitionMethod: "control-vertices",
      degree,
      controlPoints: periodicControlPoints,
      knots: Array.from({ length: lastKnot + 1 }, (_unused, index) => index / lastKnot),
      ...(periodicWeights ? { weights: periodicWeights } : {}),
      closed: true,
      periodic: true,
    };
  }
  return {
    kind: "spline",
    handle: input.handle,
    layerId: input.layerId,
    definitionMethod: "control-vertices",
    degree,
    controlPoints,
    knots: clampedUniformKnots(controlPoints.length, degree),
    ...(weights ? { weights } : {}),
    closed: false,
    periodic: false,
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
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  let cumulative = 0;
  return [0, ...distances.map((distance) => (cumulative += distance) / total)];
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
  if (![startFirstSpan, startSecondSpan, endFirstSpan, endSecondSpan].every((value) => value > EPSILON)) {
    throw new TypeError("SPLINE natural fit-point boundary is degenerate.");
  }
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

function pointToSegmentDistance(point: CadPoint2, start: CadPoint2, end: CadPoint2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const parameter = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + parameter * dx), point.y - (start.y + parameter * dy));
}

function maximumFitPointDeviation(points: readonly CadPoint2[], representation: { controlPoints: CadPoint2[]; knots: number[] }): number {
  const spline: CadSpline = {
    kind: "spline",
    handle: "F012-TOLERANCE-PROBE",
    layerId: "0",
    definitionMethod: "control-vertices",
    degree: 3,
    controlPoints: representation.controlPoints,
    knots: representation.knots,
    closed: false,
    periodic: false,
  };
  const sampleCount = Math.max(256, Math.min(2048, representation.controlPoints.length * 64));
  const start = representation.knots[3]!;
  const end = representation.knots[representation.controlPoints.length]!;
  const samples = Array.from({ length: sampleCount + 1 }, (_unused, index) => {
    const point = splinePointAtParameter(spline, start + (end - start) * index / sampleCount);
    if (!point) throw new TypeError("SPLINE tolerance approximation produced an invalid sample.");
    return point;
  });
  return points.reduce((maximum, point) => {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < sampleCount; index += 1) minimum = Math.min(minimum, pointToSegmentDistance(point, samples[index]!, samples[index + 1]!));
    return Math.max(maximum, minimum);
  }, 0);
}

function approximateNaturalFitRepresentation(
  points: readonly CadPoint2[],
  parameters: readonly number[],
  fitTolerance: number,
  parameterization: SplineKnotParameterization,
): { controlPoints: CadPoint2[]; knots: number[] } {
  const exact = openNaturalFitRepresentation(points, parameters);
  if (!(fitTolerance > 0) || points.length < 3) return exact;
  const directions = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { x: 0, y: 0 };
    const previous = points[index - 1]!;
    const next = points[index + 1]!;
    const span = parameters[index + 1]! - parameters[index - 1]!;
    const ratio = span <= EPSILON ? 0.5 : (parameters[index]! - parameters[index - 1]!) / span;
    const chordPoint = { x: previous.x + (next.x - previous.x) * ratio, y: previous.y + (next.y - previous.y) * ratio };
    return { x: chordPoint.x - point.x, y: chordPoint.y - point.y };
  });
  if (directions.every(({ x, y }) => Math.hypot(x, y) <= EPSILON)) return exact;
  const at = (factor: number) => {
    const adjustedPoints = points.map((point, index) => ({
    x: point.x + directions[index]!.x * factor,
    y: point.y + directions[index]!.y * factor,
    }));
    return openNaturalFitRepresentation(adjustedPoints, parameterValues(adjustedPoints, parameterization));
  };
  const limit = fitTolerance * 0.995;
  const fullySmoothed = at(1);
  if (maximumFitPointDeviation(points, fullySmoothed) <= limit) return fullySmoothed;
  let lower = 0;
  let upper = 1;
  let accepted = exact;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const factor = (lower + upper) / 2;
    const candidate = at(factor);
    if (maximumFitPointDeviation(points, candidate) <= limit) {
      lower = factor;
      accepted = candidate;
    } else upper = factor;
  }
  return accepted;
}

function closedSegmentLengths(points: readonly CadPoint2[], mode: SplineKnotParameterization): number[] {
  if (mode === "uniform") return points.map(() => 1 / points.length);
  const raw = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (!(length > EPSILON)) throw new TypeError("SPLINE closed fit points must not contain coincident neighboring points.");
    return mode === "sqrt-chord" ? Math.sqrt(length) : length;
  });
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

function periodicFitRepresentation(points: readonly CadPoint2[], mode: SplineKnotParameterization): { controlPoints: CadPoint2[]; knots: number[] } {
  const count = points.length;
  const lengths = closedSegmentLengths(points, mode);
  const matrix = Array.from({ length: count }, (_unused, index) => {
    const previous = (index - 1 + count) % count;
    const next = (index + 1) % count;
    const row = Array.from({ length: count }, () => 0);
    row[previous] = lengths[previous]!;
    row[index] = 2 * (lengths[previous]! + lengths[index]!);
    row[next] = lengths[index]!;
    return row;
  });
  const rightHandSide = (axis: "x" | "y"): number[] => points.map((point, index) => {
    const previous = points[(index - 1 + count) % count]!;
    const next = points[(index + 1) % count]!;
    return 6 * ((next[axis] - point[axis]) / lengths[index]! - (point[axis] - previous[axis]) / lengths[(index - 1 + count) % count]!);
  });
  const secondX = solveLinearSystem(matrix, rightHandSide("x"));
  const secondY = solveLinearSystem(matrix, rightHandSide("y"));
  const second = secondX.map((x, index) => ({ x, y: secondY[index]! }));
  const controlPoints: CadPoint2[] = [];
  const boundaries = [0];
  let cumulative = 0;
  for (let index = 0; index < count; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % count]!;
    const currentSecond = second[index]!;
    const nextSecond = second[(index + 1) % count]!;
    const length = lengths[index]!;
    const startDerivative = {
      x: (next.x - point.x) / length - length * (2 * currentSecond.x + nextSecond.x) / 6,
      y: (next.y - point.y) / length - length * (2 * currentSecond.y + nextSecond.y) / 6,
    };
    const endDerivative = {
      x: (next.x - point.x) / length + length * (currentSecond.x + 2 * nextSecond.x) / 6,
      y: (next.y - point.y) / length + length * (currentSecond.y + 2 * nextSecond.y) / 6,
    };
    if (index === 0) controlPoints.push({ ...point });
    controlPoints.push(
      { x: point.x + startDerivative.x * length / 3, y: point.y + startDerivative.y * length / 3 },
      { x: next.x - endDerivative.x * length / 3, y: next.y - endDerivative.y * length / 3 },
      { ...next },
    );
    cumulative += length;
    boundaries.push(index === count - 1 ? 1 : cumulative);
  }
  const knots = [0, 0, 0, 0];
  for (const boundary of boundaries.slice(1, -1)) knots.push(boundary, boundary, boundary);
  knots.push(1, 1, 1, 1);
  return { controlPoints, knots };
}

function openFitRepresentationWithTangents(
  points: readonly CadPoint2[],
  parameters: readonly number[],
  startTangent: CadPoint2 | undefined,
  endTangent: CadPoint2 | undefined,
): { controlPoints: CadPoint2[]; knots: number[] } {
  const count = points.length;
  const lengths = parameters.slice(1).map((parameter, index) => parameter - parameters[index]!);
  const matrix = Array.from({ length: count }, () => Array.from({ length: count }, () => 0));
  const rhsX = Array.from({ length: count }, () => 0);
  const rhsY = Array.from({ length: count }, () => 0);
  if (startTangent) {
    matrix[0]![0] = 2 * lengths[0]!;
    matrix[0]![1] = lengths[0]!;
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
    matrix[last]![last - 1] = lengths[last - 1]!;
    matrix[last]![last] = 2 * lengths[last - 1]!;
    rhsX[last] = 6 * (endTangent.x - (points[last]!.x - points[last - 1]!.x) / lengths[last - 1]!);
    rhsY[last] = 6 * (endTangent.y - (points[last]!.y - points[last - 1]!.y) / lengths[last - 1]!);
  } else matrix[last]![last] = 1;
  const secondX = solveLinearSystem(matrix, rhsX);
  const secondY = solveLinearSystem(matrix, rhsY);
  const second = secondX.map((x, index) => ({ x, y: secondY[index]! }));
  const controlPoints: CadPoint2[] = [{ ...points[0]! }];
  const knots = [0, 0, 0, 0];
  for (let index = 0; index < last; index += 1) {
    const point = points[index]!;
    const next = points[index + 1]!;
    const currentSecond = second[index]!;
    const nextSecond = second[index + 1]!;
    const length = lengths[index]!;
    const startDerivative = {
      x: (next.x - point.x) / length - length * (2 * currentSecond.x + nextSecond.x) / 6,
      y: (next.y - point.y) / length - length * (2 * currentSecond.y + nextSecond.y) / 6,
    };
    const endDerivative = {
      x: (next.x - point.x) / length + length * (currentSecond.x + 2 * nextSecond.x) / 6,
      y: (next.y - point.y) / length + length * (currentSecond.y + 2 * nextSecond.y) / 6,
    };
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

export function createFitPointSpline(input: FitPointSplineInput): CadSpline {
  const fitPoints = checkedPoints(input.fitPoints, "SPLINE fit");
  if (fitPoints.length < 3) throw new TypeError("SPLINE fit method requires at least three points.");
  const fitTolerance = input.fitTolerance ?? 0;
  if (!Number.isFinite(fitTolerance) || fitTolerance < 0) throw new TypeError("SPLINE fit tolerance must be finite and non-negative.");
  const knotParameterization = input.knotParameterization ?? "chord";
  const checkedTangent = (value: CadPoint2 | undefined, label: string): CadPoint2 | undefined => {
    if (!value) return undefined;
    const length = Math.hypot(value.x, value.y);
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !(length > EPSILON)) {
      throw new TypeError(`SPLINE ${label} tangent must be a non-zero finite vector.`);
    }
    return { x: value.x / length, y: value.y / length };
  };
  const startTangent = checkedTangent(input.startTangent, "start");
  const endTangent = checkedTangent(input.endTangent, "end");
  if (input.closed && (startTangent || endTangent)) throw new TypeError("SPLINE closed periodic Fit method does not accept endpoint tangents.");
  const degree = 3;
  let knots: number[];
  let controlPoints: CadPoint2[];
  if (input.closed) {
    ({ knots, controlPoints } = periodicFitRepresentation(fitPoints, knotParameterization));
  } else if (startTangent || endTangent) {
    const parameters = parameterValues(fitPoints, knotParameterization);
    ({ knots, controlPoints } = openFitRepresentationWithTangents(fitPoints, parameters, startTangent, endTangent));
  } else {
    const parameters = parameterValues(fitPoints, knotParameterization);
    ({ knots, controlPoints } = approximateNaturalFitRepresentation(fitPoints, parameters, fitTolerance, knotParameterization));
  }
  return {
    kind: "spline",
    handle: input.handle,
    layerId: input.layerId,
    definitionMethod: "fit-points",
    degree,
    controlPoints,
    knots,
    fitPoints,
    fitTolerance,
    knotParameterization,
    ...(startTangent ? { startTangent } : {}),
    ...(endTangent ? { endTangent } : {}),
    closed: input.closed === true,
    periodic: input.closed === true,
  };
}
