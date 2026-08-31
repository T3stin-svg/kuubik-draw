import type { CadBlockDefinition, CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import { TRIM_EPSILON, trimClosestPoint, trimCurveIntersections, trimCurvesOfEntity, trimPointAt } from "@kuubik/cad-core";
import { entityBounds, entityHasUnboundedGeometry } from "./bounds.js";
import { RTreeIndex } from "./rtree.js";

export const CAD_OSNAP_PRIORITY = Object.freeze({
  endpoint: 0,
  midpoint: 1,
  center: 2,
  quadrant: 3,
  intersection: 4,
  apparentIntersection: 5,
  extension: 6,
  insertion: 7,
  perpendicular: 8,
  tangent: 9,
  nearest: 10,
  geometricCenter: 11,
  parallel: 12,
});

export type CadOsnapMode = keyof typeof CAD_OSNAP_PRIORITY;

export interface CadSnapCandidate {
  /** Stable semantic identity. It never includes priority, distance or input order. */
  id: string;
  mode: CadOsnapMode;
  point: CadPoint2;
  handle: string;
  otherHandle?: string;
  otherSegment?: number;
  segment?: number;
  parameter?: number;
  priority: number;
  distance: number;
  key: string;
}

function pointKey(point: CadPoint2): string {
  const x = Object.is(point.x, -0) ? 0 : point.x;
  const y = Object.is(point.y, -0) ? 0 : point.y;
  return `${x.toPrecision(17)},${y.toPrecision(17)}`;
}

function candidate(
  mode: CadOsnapMode,
  point: CadPoint2,
  cursor: CadPoint2,
  handle: string,
  suffix = "",
  extra: Partial<CadSnapCandidate> = {},
  stableIdentity = `${handle}:${suffix}`,
): CadSnapCandidate {
  const id = `${mode}:${stableIdentity}:${pointKey(point)}`;
  return {
    id,
    mode,
    point,
    handle,
    priority: CAD_OSNAP_PRIORITY[mode],
    distance: Math.hypot(point.x - cursor.x, point.y - cursor.y),
    key: id,
    ...extra,
  };
}

interface DirectionalSegment {
  start: CadPoint2;
  end: CadPoint2;
  segment: number;
  terminal: "both" | "start" | "end" | "ray" | "none";
  extent: "segment" | "ray" | "line";
}

function finiteDirection(start: CadPoint2, end: CadPoint2): boolean {
  return Number.isFinite(start.x) && Number.isFinite(start.y) && Number.isFinite(end.x) && Number.isFinite(end.y)
    && Math.hypot(end.x - start.x, end.y - start.y) > TRIM_EPSILON;
}

function directionalSegments(entity: CadEntity): DirectionalSegment[] {
  if (entity.kind === "line") return finiteDirection(entity.start, entity.end)
    ? [{ start: entity.start, end: entity.end, segment: 0, terminal: "both", extent: "segment" }]
    : [];
  if (entity.kind === "ray" || entity.kind === "xline") {
    const end = { x: entity.basePoint.x + entity.direction.x, y: entity.basePoint.y + entity.direction.y };
    return finiteDirection(entity.basePoint, end)
      ? [{ start: entity.basePoint, end, segment: 0, terminal: entity.kind === "ray" ? "ray" : "none", extent: entity.kind === "ray" ? "ray" : "line" }]
      : [];
  }
  if (entity.kind !== "polyline" || entity.vertices.length < 2) return [];
  const result: DirectionalSegment[] = [];
  const count = entity.closed ? entity.vertices.length : entity.vertices.length - 1;
  for (let index = 0; index < count; index += 1) {
    const start = entity.vertices[index]!;
    const end = entity.vertices[(index + 1) % entity.vertices.length]!;
    if (Math.abs(start.bulge ?? 0) > TRIM_EPSILON || !finiteDirection(start, end)) continue;
    const terminal = entity.closed ? "none" : index === 0 && index === count - 1 ? "both" : index === 0 ? "start" : index === count - 1 ? "end" : "none";
    result.push({ start, end, segment: index, terminal, extent: "segment" });
  }
  return result;
}

interface SupportingLineHit {
  point: CadPoint2;
  firstParameter: number;
  secondParameter: number;
}

function supportingLineIntersection(first: DirectionalSegment, second: DirectionalSegment): SupportingLineHit | null {
  const firstDirection = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
  const secondDirection = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
  const denominator = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x;
  const scale = Math.hypot(firstDirection.x, firstDirection.y) * Math.hypot(secondDirection.x, secondDirection.y);
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= TRIM_EPSILON * scale) return null;
  const delta = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
  const firstParameter = (delta.x * secondDirection.y - delta.y * secondDirection.x) / denominator;
  const secondParameter = (delta.x * firstDirection.y - delta.y * firstDirection.x) / denominator;
  const point = {
    x: first.start.x + firstParameter * firstDirection.x,
    y: first.start.y + firstParameter * firstDirection.y,
  };
  return [point.x, point.y, firstParameter, secondParameter].every(Number.isFinite)
    ? { point, firstParameter, secondParameter }
    : null;
}

function parameterIsOnEntity(segment: DirectionalSegment, parameter: number): boolean {
  if (segment.extent === "line") return true;
  if (segment.extent === "ray") return parameter >= -TRIM_EPSILON;
  return parameter >= -TRIM_EPSILON && parameter <= 1 + TRIM_EPSILON;
}

function canonicalPair(
  first: { handle: string; segment: number; parameter: number },
  second: { handle: string; segment: number; parameter: number },
): readonly [typeof first, typeof second] {
  return [first, second].sort((a, b) => a.handle.localeCompare(b.handle) || a.segment - b.segment) as [typeof first, typeof second];
}

function projectToLine(point: CadPoint2, segment: DirectionalSegment): { point: CadPoint2; parameter: number } {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const denominator = dx * dx + dy * dy;
  const parameter = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / denominator;
  return { point: { x: segment.start.x + parameter * dx, y: segment.start.y + parameter * dy }, parameter };
}

function extensionPoints(entity: CadEntity, cursor: CadPoint2): Array<{ point: CadPoint2; segment: number; parameter: number; suffix: string }> {
  if (entity.kind === "arc") {
    const dx = cursor.x - entity.center.x;
    const dy = cursor.y - entity.center.y;
    const length = Math.hypot(dx, dy);
    if (length <= TRIM_EPSILON) return [];
    const point = { x: entity.center.x + dx / length * entity.radius, y: entity.center.y + dy / length * entity.radius };
    if ((trimClosestPoint(entity, point)?.distance ?? Infinity) <= TRIM_EPSILON * Math.max(1, entity.radius)) return [];
    const parameter = Math.atan2(point.y - entity.center.y, point.x - entity.center.x);
    return [{ point, segment: 0, parameter, suffix: `0:arc:${parameter.toPrecision(17)}` }];
  }
  return directionalSegments(entity).flatMap((segment) => {
    const projected = projectToLine(cursor, segment);
    const onExtension = segment.terminal === "both" ? projected.parameter < 0 || projected.parameter > 1
      : segment.terminal === "start" || segment.terminal === "ray" ? projected.parameter < 0
        : segment.terminal === "end" ? projected.parameter > 1 : false;
    return onExtension ? [{ ...projected, segment: segment.segment, suffix: `${segment.segment}:${projected.parameter < 0 ? "start" : "end"}` }] : [];
  });
}

function insertionPoints(entity: CadEntity): CadPoint2[] {
  return entity.kind === "blockRef" ? [entity.insertion]
    : entity.kind === "text" || entity.kind === "mtext" ? [entity.position]
      : [];
}

function polygonAreaCentroid(points: readonly CadPoint2[]): { point: CadPoint2; area: number } | null {
  if (points.length < 3) return null;
  let areaTwice = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index]!;
    const second = points[(index + 1) % points.length]!;
    const cross = first.x * second.y - second.x * first.y;
    areaTwice += cross;
    x += (first.x + second.x) * cross;
    y += (first.y + second.y) * cross;
  }
  if (!Number.isFinite(areaTwice) || Math.abs(areaTwice) <= TRIM_EPSILON) return null;
  return { point: { x: x / (3 * areaTwice), y: y / (3 * areaTwice) }, area: areaTwice / 2 };
}

function geometricCenters(entity: CadEntity): CadPoint2[] {
  if (entity.kind === "polyline") {
    if (!entity.closed || entity.vertices.some((vertex) => Math.abs(vertex.bulge ?? 0) > TRIM_EPSILON)) return [];
    const center = polygonAreaCentroid(entity.vertices);
    return center ? [center.point] : [];
  }
  if (entity.kind !== "hatch") return [];
  let area = 0;
  let x = 0;
  let y = 0;
  for (const loop of entity.loops) {
    const centroid = polygonAreaCentroid(loop.vertices);
    if (!centroid) continue;
    const weight = Math.abs(centroid.area) * (loop.isHole ? -1 : 1);
    area += weight;
    x += centroid.point.x * weight;
    y += centroid.point.y * weight;
  }
  return Math.abs(area) <= TRIM_EPSILON ? [] : [{ x: x / area, y: y / area }];
}

function parallelPoints(entity: CadEntity, cursor: CadPoint2, reference: CadPoint2): Array<{ point: CadPoint2; segment: number; directionKey: string }> {
  return directionalSegments(entity).flatMap((segment) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    let ux = dx / length;
    let uy = dy / length;
    if (ux < 0 || (Math.abs(ux) <= TRIM_EPSILON && uy < 0)) { ux = -ux; uy = -uy; }
    const scalar = (cursor.x - reference.x) * ux + (cursor.y - reference.y) * uy;
    return [{
      point: { x: reference.x + scalar * ux, y: reference.y + scalar * uy },
      segment: segment.segment,
      directionKey: `${ux.toPrecision(17)},${uy.toPrecision(17)}`,
    }];
  });
}

function endpoints(entity: CadEntity): CadPoint2[] {
  switch (entity.kind) {
    case "line": return [entity.start, entity.end];
    case "ray": return [entity.basePoint];
    case "xline": return [];
    case "polyline": return entity.vertices;
    case "arc": {
      const curves = trimCurvesOfEntity(entity);
      return curves.length === 0 ? [] : [trimPointAt(curves[0]!, 0), trimPointAt(curves[0]!, 1)];
    }
    case "ellipse": {
      if (Math.abs(entity.endParameter - entity.startParameter) >= Math.PI * 2 - TRIM_EPSILON) return [];
      const curves = trimCurvesOfEntity(entity);
      return curves.length === 0 ? [] : [trimPointAt(curves[0]!, 0), trimPointAt(curves.at(-1)!, 1)];
    }
    case "spline": {
      if (entity.closed) return [];
      const curves = trimCurvesOfEntity(entity);
      return curves.length === 0 ? [] : [trimPointAt(curves[0]!, 0), trimPointAt(curves.at(-1)!, 1)];
    }
    case "text":
    case "mtext": return [entity.position];
    case "leader": return entity.vertices;
    case "dimension": return entity.definitionPoints;
    case "hatch": return entity.loops.flatMap((loop) => loop.vertices);
    case "blockRef": return [entity.insertion];
    case "circle": return [];
    case "proxy": return [];
  }
}

function centers(entity: CadEntity): CadPoint2[] {
  return entity.kind === "circle" || entity.kind === "arc" || entity.kind === "ellipse" ? [entity.center] : [];
}

function quadrants(entity: CadEntity): CadPoint2[] {
  if (entity.kind === "circle" || entity.kind === "arc") {
    const all = [
      { x: entity.center.x + entity.radius, y: entity.center.y },
      { x: entity.center.x, y: entity.center.y + entity.radius },
      { x: entity.center.x - entity.radius, y: entity.center.y },
      { x: entity.center.x, y: entity.center.y - entity.radius },
    ];
    if (entity.kind === "circle") return all;
    return all.filter((point) => (trimClosestPoint(entity, point)?.distance ?? Infinity) <= TRIM_EPSILON * Math.max(1, entity.radius));
  }
  if (entity.kind === "ellipse") {
    const major = entity.majorAxis;
    const minor = { x: -major.y * entity.ratio, y: major.x * entity.ratio };
    return [
      { x: entity.center.x + major.x, y: entity.center.y + major.y },
      { x: entity.center.x - major.x, y: entity.center.y - major.y },
      { x: entity.center.x + minor.x, y: entity.center.y + minor.y },
      { x: entity.center.x - minor.x, y: entity.center.y - minor.y },
    ].filter((point) => (trimClosestPoint(entity, point)?.distance ?? Infinity) <= TRIM_EPSILON * Math.max(1, Math.hypot(major.x, major.y)));
  }
  return [];
}

function tangentPoints(entity: CadEntity, reference: CadPoint2): CadPoint2[] {
  if (entity.kind === "ellipse") {
    const majorLength = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
    const minorLength = majorLength * entity.ratio;
    if (!(majorLength > TRIM_EPSILON) || !(minorLength > TRIM_EPSILON)) return [];
    const majorUnit = { x: entity.majorAxis.x / majorLength, y: entity.majorAxis.y / majorLength };
    const minorUnit = { x: -majorUnit.y, y: majorUnit.x };
    const relative = { x: reference.x - entity.center.x, y: reference.y - entity.center.y };
    const normalizedX = (relative.x * majorUnit.x + relative.y * majorUnit.y) / majorLength;
    const normalizedY = (relative.x * minorUnit.x + relative.y * minorUnit.y) / minorLength;
    const normalizedDistance = Math.hypot(normalizedX, normalizedY);
    if (normalizedDistance < 1 - TRIM_EPSILON || normalizedDistance === 0) return [];
    const base = Math.atan2(normalizedY, normalizedX);
    const offset = Math.acos(Math.min(1, 1 / normalizedDistance));
    const angles = offset <= TRIM_EPSILON ? [base] : [base + offset, base - offset];
    return angles.map((angle) => ({
      x: entity.center.x + majorUnit.x * majorLength * Math.cos(angle) + minorUnit.x * minorLength * Math.sin(angle),
      y: entity.center.y + majorUnit.y * majorLength * Math.cos(angle) + minorUnit.y * minorLength * Math.sin(angle),
    })).filter((point) => (trimClosestPoint(entity, point)?.distance ?? Infinity) <= TRIM_EPSILON * Math.max(1, majorLength));
  }
  // A general NURBS tangent needs a derivative/root proof. Unsupported curves fail closed.
  if (entity.kind !== "circle" && entity.kind !== "arc") return [];
  const dx = reference.x - entity.center.x;
  const dy = reference.y - entity.center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < entity.radius || distance === 0) return [];
  const base = Math.atan2(dy, dx);
  const offset = Math.acos(entity.radius / distance);
  const points = [base + offset, base - offset].map((angle) => ({ x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) }));
  if (entity.kind === "circle") return points;
  return points.filter((point) => (trimClosestPoint(entity, point)?.distance ?? Infinity) <= TRIM_EPSILON * Math.max(1, entity.radius));
}

export interface CadSnapGenerationOptions {
  modes: ReadonlySet<CadOsnapMode> | readonly CadOsnapMode[];
  cursor: CadPoint2;
  aperture: number;
  referencePoint?: CadPoint2;
  /** Explicitly acquired/hovered entities used for unbounded Extension/Parallel queries. */
  referenceHandles?: readonly string[];
}

export function generateCadSnapCandidates(entities: readonly CadEntity[], options: CadSnapGenerationOptions): CadSnapCandidate[] {
  if (![options.cursor.x, options.cursor.y, options.aperture].every(Number.isFinite) || options.aperture < 0) throw new TypeError("Snap cursor/aperture must be finite and aperture non-negative.");
  const modes = options.modes instanceof Set ? options.modes : new Set(options.modes);
  for (const mode of modes) {
    if (!Object.hasOwn(CAD_OSNAP_PRIORITY, mode)) throw new TypeError(`Unsupported OSNAP mode ${String(mode)}.`);
  }
  const results: CadSnapCandidate[] = [];
  for (const entity of entities) {
    if (modes.has("endpoint")) endpoints(entity).forEach((point, index) => results.push(candidate("endpoint", point, options.cursor, entity.handle, String(index))));
    if (modes.has("midpoint")) trimCurvesOfEntity(entity).forEach((curve, index) => results.push(candidate("midpoint", trimPointAt(curve, 0.5), options.cursor, entity.handle, String(index), { segment: curve.segment, parameter: 0.5 })));
    if (modes.has("center")) centers(entity).forEach((point) => results.push(candidate("center", point, options.cursor, entity.handle)));
    if (modes.has("quadrant")) quadrants(entity).forEach((point, index) => results.push(candidate("quadrant", point, options.cursor, entity.handle, String(index))));
    if (modes.has("extension")) extensionPoints(entity, options.cursor).forEach((item) => results.push(candidate("extension", item.point, options.cursor, entity.handle, item.suffix, { segment: item.segment, parameter: item.parameter })));
    if (modes.has("insertion")) insertionPoints(entity).forEach((point, index) => results.push(candidate("insertion", point, options.cursor, entity.handle, String(index))));
    if (modes.has("perpendicular") && options.referencePoint) {
      const closest = trimClosestPoint(entity, options.referencePoint);
      if (closest) results.push(candidate("perpendicular", closest.point, options.cursor, entity.handle, `${closest.segment}`, { segment: closest.segment, parameter: closest.parameter }));
    }
    if (modes.has("tangent") && options.referencePoint) tangentPoints(entity, options.referencePoint).forEach((point, index) => results.push(candidate("tangent", point, options.cursor, entity.handle, String(index))));
    if (modes.has("nearest")) {
      const closest = trimClosestPoint(entity, options.cursor);
      if (closest) results.push(candidate("nearest", closest.point, options.cursor, entity.handle, `${closest.segment}`, { segment: closest.segment, parameter: closest.parameter }));
    }
    if (modes.has("geometricCenter")) geometricCenters(entity).forEach((point, index) => results.push(candidate("geometricCenter", point, options.cursor, entity.handle, String(index))));
    if (modes.has("parallel") && options.referencePoint) parallelPoints(entity, options.cursor, options.referencePoint).forEach((item) => results.push(candidate(
      "parallel", item.point, options.cursor, entity.handle, `${item.segment}:${item.directionKey}`, { segment: item.segment },
    )));
  }
  if (modes.has("intersection")) {
    for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
        const first = entities[firstIndex]!;
        const second = entities[secondIndex]!;
        trimCurvesOfEntity(first).forEach((firstCurve) => trimCurvesOfEntity(second).forEach((secondCurve) => {
          trimCurveIntersections(firstCurve, secondCurve).forEach((hit, index) => {
            const stablePair = canonicalPair(
              { handle: first.handle, segment: firstCurve.segment, parameter: hit.first },
              { handle: second.handle, segment: secondCurve.segment, parameter: hit.second },
            );
            const stableIdentity = stablePair.map((item) => `${item.handle}:${item.segment}`).join("|");
            results.push(candidate(
              "intersection", hit.point, options.cursor, stablePair[0].handle, `${stablePair[1].handle}:${index}`,
              { otherHandle: stablePair[1].handle, segment: stablePair[0].segment, otherSegment: stablePair[1].segment, parameter: stablePair[0].parameter },
              stableIdentity,
            ));
          });
        }));
      }
    }
  }
  if (modes.has("apparentIntersection")) {
    for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
        const first = entities[firstIndex]!;
        const second = entities[secondIndex]!;
        for (const firstSegment of directionalSegments(first)) {
          for (const secondSegment of directionalSegments(second)) {
            const hit = supportingLineIntersection(firstSegment, secondSegment);
            if (!hit || (parameterIsOnEntity(firstSegment, hit.firstParameter) && parameterIsOnEntity(secondSegment, hit.secondParameter))) continue;
            const stablePair = canonicalPair(
              { handle: first.handle, segment: firstSegment.segment, parameter: hit.firstParameter },
              { handle: second.handle, segment: secondSegment.segment, parameter: hit.secondParameter },
            );
            const stableIdentity = stablePair.map((item) => `${item.handle}:${item.segment}`).join("|");
            results.push(candidate(
              "apparentIntersection", hit.point, options.cursor, stablePair[0].handle, stablePair[1].handle,
              {
                otherHandle: stablePair[1].handle,
                segment: stablePair[0].segment,
                otherSegment: stablePair[1].segment,
                parameter: stablePair[0].parameter,
              },
              stableIdentity,
            ));
          }
        }
      }
    }
  }
  const unique = new Map<string, CadSnapCandidate>();
  results.filter((item) => item.distance <= options.aperture).forEach((item) => { if (!unique.has(item.key)) unique.set(item.key, item); });
  return [...unique.values()].sort((a, b) => a.priority - b.priority || a.distance - b.distance || a.key.localeCompare(b.key));
}

export interface CadSnapCycleReadback {
  candidate: CadSnapCandidate | null;
  candidateId: string | null;
  candidateIds: string[];
  index: number;
  count: number;
}

/** Stateful selection cycling that preserves the active semantic candidate ID across fresh queries. */
export class CadSnapSelectionCycle {
  #candidateId: string | null = null;

  get candidateId(): string | null { return this.#candidateId; }

  reset(): void { this.#candidateId = null; }

  update(candidates: readonly CadSnapCandidate[]): CadSnapCycleReadback {
    return this.#readback(candidates, 0, false);
  }

  cycle(candidates: readonly CadSnapCandidate[], step = 1): CadSnapCycleReadback {
    if (!Number.isSafeInteger(step) || step === 0) throw new RangeError("Snap cycle step must be a non-zero safe integer.");
    return this.#readback(candidates, step, true);
  }

  select(candidates: readonly CadSnapCandidate[], candidateId: string): CadSnapCycleReadback {
    if (!candidates.some((candidate) => candidate.id === candidateId)) throw new RangeError(`Snap candidate ${candidateId} is not available.`);
    this.#candidateId = candidateId;
    return this.#readback(candidates, 0, false);
  }

  #readback(candidates: readonly CadSnapCandidate[], step: number, advance: boolean): CadSnapCycleReadback {
    const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
    if (unique.length === 0) {
      this.#candidateId = null;
      return { candidate: null, candidateId: null, candidateIds: [], index: -1, count: 0 };
    }
    let index = this.#candidateId === null ? 0 : unique.findIndex((candidate) => candidate.id === this.#candidateId);
    if (index < 0) index = 0;
    if (advance) index = ((index + step) % unique.length + unique.length) % unique.length;
    const selected = unique[index]!;
    this.#candidateId = selected.id;
    return {
      candidate: structuredClone(selected), candidateId: selected.id,
      candidateIds: unique.map((candidate) => candidate.id), index, count: unique.length,
    };
  }
}

export class CadSnapIndex {
  readonly #index = new RTreeIndex();
  #entities = new Map<string, CadEntity>();
  #blocks = new Map<string, CadBlockDefinition>();
  #unbounded = new Set<string>();

  setBlocks(blocks: readonly CadBlockDefinition[]): void {
    if (new Set(blocks.map((block) => block.id)).size !== blocks.length) throw new TypeError("Duplicate block ids are not allowed in the snap index.");
    this.#blocks = new Map(blocks.map((block) => [block.id, block]));
    this.#rebuild();
  }

  setEntities(entities: readonly CadEntity[]): void {
    if (new Set(entities.map((entity) => entity.handle)).size !== entities.length) throw new TypeError("Duplicate entity handles are not allowed in the snap index.");
    this.#entities = new Map(entities.map((entity) => [entity.handle, entity]));
    this.#rebuild();
  }

  #rebuild(): void {
    this.#unbounded = new Set([...this.#entities.values()].filter((entity) => entityHasUnboundedGeometry(entity, this.#blocks)).map((entity) => entity.handle));
    this.#index.load([...this.#entities.values()].flatMap((entity) => {
      if (this.#unbounded.has(entity.handle)) return [];
      const bounds = entityBounds(entity, this.#blocks);
      return bounds ? [{ ...bounds, handle: entity.handle }] : [];
    }));
  }

  query(options: CadSnapGenerationOptions, eligible: (entity: CadEntity) => boolean = () => true): CadSnapCandidate[] {
    const { x, y } = options.cursor;
    const candidates = [
      ...this.#index.search({ minX: x - options.aperture, minY: y - options.aperture, maxX: x + options.aperture, maxY: y + options.aperture }).map((item) => item.handle),
      ...this.#unbounded,
      ...(options.referenceHandles ?? []),
    ];
    return generateCadSnapCandidates([...new Set(candidates)].flatMap((handle) => {
      const entity = this.#entities.get(handle);
      return entity && eligible(entity) ? [entity] : [];
    }), options);
  }
}
