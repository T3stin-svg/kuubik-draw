import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";

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

export function entityBounds(entity: CadEntity): Bounds2 | null {
  switch (entity.kind) {
    case "line": return boundsFromPoints([entity.start, entity.end]);
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
    case "blockRef": return { minX: entity.insertion.x, minY: entity.insertion.y, maxX: entity.insertion.x, maxY: entity.insertion.y };
    case "proxy": return entity.bounds
      ? { minX: entity.bounds.min.x, minY: entity.bounds.min.y, maxX: entity.bounds.max.x, maxY: entity.bounds.max.y }
      : null;
  }
}
