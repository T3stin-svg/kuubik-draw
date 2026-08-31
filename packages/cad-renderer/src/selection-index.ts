import type { CadBlockDefinition, CadEntity, CadPoint2 } from "@kuubik/cad-schema";
import { entityBounds, entityHasUnboundedGeometry } from "./bounds.js";
import { RTreeIndex } from "./rtree.js";
import { pickCadEntity, type CadPickHit } from "./selection.js";

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
