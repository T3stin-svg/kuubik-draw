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
  perpendicular: 5,
  tangent: 6,
  nearest: 7,
});

export type CadOsnapMode = keyof typeof CAD_OSNAP_PRIORITY;

export interface CadSnapCandidate {
  mode: CadOsnapMode;
  point: CadPoint2;
  handle: string;
  otherHandle?: string;
  segment?: number;
  parameter?: number;
  priority: number;
  distance: number;
  key: string;
}

function pointKey(point: CadPoint2): string {
  return `${point.x.toPrecision(17)},${point.y.toPrecision(17)}`;
}

function candidate(mode: CadOsnapMode, point: CadPoint2, cursor: CadPoint2, handle: string, suffix = "", extra: Partial<CadSnapCandidate> = {}): CadSnapCandidate {
  return {
    mode,
    point,
    handle,
    priority: CAD_OSNAP_PRIORITY[mode],
    distance: Math.hypot(point.x - cursor.x, point.y - cursor.y),
    key: `${CAD_OSNAP_PRIORITY[mode]}:${handle}:${suffix}:${pointKey(point)}`,
    ...extra,
  };
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
    case "ellipse":
    case "spline": {
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
    ];
  }
  return [];
}

function tangentPoints(entity: CadEntity, reference: CadPoint2): CadPoint2[] {
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
}

export function generateCadSnapCandidates(entities: readonly CadEntity[], options: CadSnapGenerationOptions): CadSnapCandidate[] {
  if (![options.cursor.x, options.cursor.y, options.aperture].every(Number.isFinite) || options.aperture < 0) throw new TypeError("Snap cursor/aperture must be finite and aperture non-negative.");
  const modes = options.modes instanceof Set ? options.modes : new Set(options.modes);
  const results: CadSnapCandidate[] = [];
  for (const entity of entities) {
    if (modes.has("endpoint")) endpoints(entity).forEach((point, index) => results.push(candidate("endpoint", point, options.cursor, entity.handle, String(index))));
    if (modes.has("midpoint")) trimCurvesOfEntity(entity).forEach((curve, index) => results.push(candidate("midpoint", trimPointAt(curve, 0.5), options.cursor, entity.handle, String(index), { segment: curve.segment, parameter: 0.5 })));
    if (modes.has("center")) centers(entity).forEach((point) => results.push(candidate("center", point, options.cursor, entity.handle)));
    if (modes.has("quadrant")) quadrants(entity).forEach((point, index) => results.push(candidate("quadrant", point, options.cursor, entity.handle, String(index))));
    if (modes.has("perpendicular") && options.referencePoint) {
      const closest = trimClosestPoint(entity, options.referencePoint);
      if (closest) results.push(candidate("perpendicular", closest.point, options.cursor, entity.handle, `${closest.segment}`, { segment: closest.segment, parameter: closest.parameter }));
    }
    if (modes.has("tangent") && options.referencePoint) tangentPoints(entity, options.referencePoint).forEach((point, index) => results.push(candidate("tangent", point, options.cursor, entity.handle, String(index))));
    if (modes.has("nearest")) {
      const closest = trimClosestPoint(entity, options.cursor);
      if (closest) results.push(candidate("nearest", closest.point, options.cursor, entity.handle, `${closest.segment}`, { segment: closest.segment, parameter: closest.parameter }));
    }
  }
  if (modes.has("intersection")) {
    for (let firstIndex = 0; firstIndex < entities.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < entities.length; secondIndex += 1) {
        const first = entities[firstIndex]!;
        const second = entities[secondIndex]!;
        trimCurvesOfEntity(first).forEach((firstCurve) => trimCurvesOfEntity(second).forEach((secondCurve) => {
          trimCurveIntersections(firstCurve, secondCurve).forEach((hit, index) => results.push(candidate("intersection", hit.point, options.cursor, first.handle, `${second.handle}:${index}`, { otherHandle: second.handle, segment: firstCurve.segment, parameter: hit.first })));
        }));
      }
    }
  }
  const unique = new Map<string, CadSnapCandidate>();
  results.filter((item) => item.distance <= options.aperture).forEach((item) => { if (!unique.has(item.key)) unique.set(item.key, item); });
  return [...unique.values()].sort((a, b) => a.priority - b.priority || a.distance - b.distance || a.key.localeCompare(b.key));
}

export class CadSnapIndex {
  readonly #index = new RTreeIndex();
  #entities = new Map<string, CadEntity>();
  #blocks = new Map<string, CadBlockDefinition>();
  #unbounded = new Set<string>();

  setBlocks(blocks: readonly CadBlockDefinition[]): void {
    this.#blocks = new Map(blocks.map((block) => [block.id, block]));
    this.#rebuild();
  }

  setEntities(entities: readonly CadEntity[]): void {
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
    ];
    return generateCadSnapCandidates([...new Set(candidates)].flatMap((handle) => {
      const entity = this.#entities.get(handle);
      return entity && eligible(entity) ? [entity] : [];
    }), options);
  }
}
