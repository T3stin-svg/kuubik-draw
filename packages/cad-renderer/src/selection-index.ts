import type { CadBlockDefinition, CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import { entityBounds, entityHasUnboundedGeometry } from "./bounds.js";
import { RTreeIndex } from "./rtree.js";
import { pickCadEntity, type CadPickHit } from "./selection.js";
import { CadSnapIndex, type CadSnapCandidate, type CadSnapGenerationOptions } from "./snap.js";

export class CadSelectionIndex {
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

  pick(point: CadPoint2, tolerance: number, eligible: (entity: CadEntity) => boolean = () => true): CadPickHit[] {
    const handles = [
      ...this.#index.search({ minX: point.x - tolerance, minY: point.y - tolerance, maxX: point.x + tolerance, maxY: point.y + tolerance }).map((item) => item.handle),
      ...this.#unbounded,
    ];
    return [...new Set(handles)].flatMap((handle) => {
      const entity = this.#entities.get(handle);
      if (!entity || !eligible(entity)) return [];
      const hit = pickCadEntity(entity, point, tolerance);
      return hit ? [hit] : [];
    }).sort((a, b) => a.distance - b.distance || a.handle.localeCompare(b.handle));
  }
}

export interface CadSpatialPerformanceProfile {
  entityCount: number;
  selectionBuildMs: number;
  snapBuildMs: number;
  queryMs: number;
  queryIterations: number;
  p95QueryMs: number;
  maxQueryMs: number;
  selectionHits: number;
  snapCandidates: number;
}

export interface CadSpatialPerformanceOptions {
  selectionPoint: CadPoint2;
  selectionTolerance: number;
  snap: CadSnapGenerationOptions;
  eligible?: (entity: CadEntity) => boolean;
  queryIterations?: number;
  now?: () => number;
}

/** Reproducible profile boundary used by the 50k regression gate and manual evidence runs. */
export function profileCadSpatialIndexes(
  entities: readonly CadEntity[],
  options: CadSpatialPerformanceOptions,
): { profile: CadSpatialPerformanceProfile; selection: CadPickHit[]; snaps: CadSnapCandidate[] } {
  const now = options.now ?? (() => globalThis.performance.now());
  const queryIterations = options.queryIterations ?? 1;
  if (!Number.isSafeInteger(queryIterations) || queryIterations < 1 || queryIterations > 10_000) {
    throw new RangeError("Spatial profile queryIterations must be an integer from 1 to 10000.");
  }
  const selection = new CadSelectionIndex();
  const snap = new CadSnapIndex();
  const selectionStarted = now();
  selection.setEntities(entities);
  const selectionBuildMs = now() - selectionStarted;
  const snapStarted = now();
  snap.setEntities(entities);
  const snapBuildMs = now() - snapStarted;
  const querySamples: number[] = [];
  let selectionHits: CadPickHit[] = [];
  let snaps: CadSnapCandidate[] = [];
  for (let index = 0; index < queryIterations; index += 1) {
    const queryStarted = now();
    selectionHits = selection.pick(options.selectionPoint, options.selectionTolerance, options.eligible);
    snaps = snap.query(options.snap, options.eligible);
    querySamples.push(now() - queryStarted);
  }
  const orderedSamples = [...querySamples].sort((first, second) => first - second);
  const queryMs = querySamples.reduce((sum, value) => sum + value, 0);
  const p95QueryMs = orderedSamples[Math.max(0, Math.ceil(orderedSamples.length * 0.95) - 1)]!;
  const maxQueryMs = orderedSamples.at(-1)!;
  return {
    profile: {
      entityCount: entities.length,
      selectionBuildMs,
      snapBuildMs,
      queryMs,
      queryIterations,
      p95QueryMs,
      maxQueryMs,
      selectionHits: selectionHits.length,
      snapCandidates: snaps.length,
    },
    selection: selectionHits,
    snaps,
  };
}
