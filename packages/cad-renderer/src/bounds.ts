import type { CadBlockDefinition, CadEntity, CadPoint2 } from "@kuubik/cad-schema";

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsFromPoints(points: readonly CadPoint2[]): Bounds2 | null {
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function intersects(a: Bounds2, b: Bounds2): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function unionBounds(items: readonly Bounds2[]): Bounds2 {
  if (items.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...items.map((item) => item.minX)),
    minY: Math.min(...items.map((item) => item.minY)),
    maxX: Math.max(...items.map((item) => item.maxX)),
    maxY: Math.max(...items.map((item) => item.maxY)),
  };
}

function transformedBlockPoint(point: CadPoint2, block: CadBlockDefinition, reference: Extract<CadEntity, { kind: "blockRef" }>): CadPoint2 {
  const x = (point.x - block.basePoint.x) * reference.scale.x;
  const y = (point.y - block.basePoint.y) * reference.scale.y;
  const cosine = Math.cos(reference.rotationRad);
  const sine = Math.sin(reference.rotationRad);
  return {
    x: reference.insertion.x + x * cosine - y * sine,
    y: reference.insertion.y + x * sine + y * cosine,
  };
}

export function entityBounds(
  entity: CadEntity,
  blocks: ReadonlyMap<string, CadBlockDefinition> = new Map(),
  blockTrail: ReadonlySet<string> = new Set(),
): Bounds2 | null {
  switch (entity.kind) {
    case "line": return boundsFromPoints([entity.start, entity.end]);
    case "ray":
    case "xline": return null;
    case "polyline": return boundsFromPoints(entity.vertices);
    case "circle":
    case "arc":
      return {
        minX: entity.center.x - entity.radius,
        minY: entity.center.y - entity.radius,
        maxX: entity.center.x + entity.radius,
        maxY: entity.center.y + entity.radius,
      };
    case "ellipse": {
      const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
      return {
        minX: entity.center.x - major,
        minY: entity.center.y - major,
        maxX: entity.center.x + major,
        maxY: entity.center.y + major,
      };
    }
    case "spline": return boundsFromPoints(entity.controlPoints);
    case "text":
    case "mtext": return { minX: entity.position.x, minY: entity.position.y, maxX: entity.position.x, maxY: entity.position.y };
    case "leader": return boundsFromPoints(entity.vertices);
    case "dimension": return boundsFromPoints(entity.definitionPoints);
    case "hatch": return boundsFromPoints(entity.loops.flatMap((loop) => loop.vertices));
    case "blockRef": {
      const block = blocks.get(entity.blockId);
      if (!block || blockTrail.has(block.id)) {
        return { minX: entity.insertion.x, minY: entity.insertion.y, maxX: entity.insertion.x, maxY: entity.insertion.y };
      }
      const nextTrail = new Set(blockTrail).add(block.id);
      const childBounds = block.entities.flatMap((child) => {
        const bounds = entityBounds(child, blocks, nextTrail);
        return bounds ? [bounds] : [];
      });
      if (childBounds.length === 0) return null;
      const local = unionBounds(childBounds);
      return boundsFromPoints([
        transformedBlockPoint({ x: local.minX, y: local.minY }, block, entity),
        transformedBlockPoint({ x: local.maxX, y: local.minY }, block, entity),
        transformedBlockPoint({ x: local.maxX, y: local.maxY }, block, entity),
        transformedBlockPoint({ x: local.minX, y: local.maxY }, block, entity),
      ]);
    }
    case "proxy": return entity.bounds
      ? { minX: entity.bounds.min.x, minY: entity.bounds.min.y, maxX: entity.bounds.max.x, maxY: entity.bounds.max.y }
      : null;
  }
}

/** True when an entity contains geometry that cannot be represented by a finite R-tree box. */
export function entityHasUnboundedGeometry(
  entity: CadEntity,
  blocks: ReadonlyMap<string, CadBlockDefinition> = new Map(),
  blockTrail: ReadonlySet<string> = new Set(),
): boolean {
  if (entity.kind === "ray" || entity.kind === "xline") return true;
  if (entity.kind !== "blockRef") return false;
  const block = blocks.get(entity.blockId);
  if (!block || blockTrail.has(block.id)) return false;
  const nextTrail = new Set(blockTrail).add(block.id);
  return block.entities.some((child) => entityHasUnboundedGeometry(child, blocks, nextTrail));
}
