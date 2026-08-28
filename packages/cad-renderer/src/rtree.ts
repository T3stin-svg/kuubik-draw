import { intersects, unionBounds, type Bounds2 } from "./bounds.js";

export interface SpatialItem extends Bounds2 {
  handle: string;
}

interface RTreeNode extends Bounds2 {
  leaf: boolean;
  children: Array<RTreeNode | SpatialItem>;
}

function centerX(item: Bounds2): number {
  return (item.minX + item.maxX) / 2;
}

function centerY(item: Bounds2): number {
  return (item.minY + item.maxY) / 2;
}

function node(children: Array<RTreeNode | SpatialItem>, leaf: boolean): RTreeNode {
  return { ...unionBounds(children), leaf, children };
}

export class RTreeIndex {
  readonly #maxEntries: number;
  #root: RTreeNode = node([], true);

  constructor(maxEntries = 16) {
    if (!Number.isInteger(maxEntries) || maxEntries < 4) throw new RangeError("maxEntries must be >= 4.");
    this.#maxEntries = maxEntries;
  }

  load(source: readonly SpatialItem[]): void {
    if (source.length === 0) {
      this.#root = node([], true);
      return;
    }
    const sliceCount = Math.max(1, Math.ceil(Math.sqrt(source.length / this.#maxEntries)));
    const sliceSize = Math.ceil(source.length / sliceCount);
    const byX = [...source].sort((a, b) => centerX(a) - centerX(b));
    let level: RTreeNode[] = [];
    for (let start = 0; start < byX.length; start += sliceSize) {
      const slice = byX.slice(start, start + sliceSize).sort((a, b) => centerY(a) - centerY(b));
      for (let offset = 0; offset < slice.length; offset += this.#maxEntries) {
        level.push(node(slice.slice(offset, offset + this.#maxEntries), true));
      }
    }
    while (level.length > this.#maxEntries) {
      const next: RTreeNode[] = [];
      const ordered = [...level].sort((a, b) => centerX(a) - centerX(b));
      for (let index = 0; index < ordered.length; index += this.#maxEntries) {
        next.push(node(ordered.slice(index, index + this.#maxEntries), false));
      }
      level = next;
    }
    this.#root = level.length === 1 ? level[0]! : node(level, false);
  }

  search(bounds: Bounds2): SpatialItem[] {
    const matches: SpatialItem[] = [];
    const visit = (current: RTreeNode): void => {
      if (!intersects(current, bounds)) return;
      for (const child of current.children) {
        if (!intersects(child, bounds)) continue;
        if (current.leaf) matches.push(child as SpatialItem);
        else visit(child as RTreeNode);
      }
    };
    visit(this.#root);
    return matches;
  }
}
