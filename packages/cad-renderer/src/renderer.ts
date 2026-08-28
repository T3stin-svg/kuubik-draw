import type { CadEntity, CadLayer, CadPoint2 } from "@kuubik/cad-schema";
import { entityBounds, type Bounds2 } from "./bounds.js";
import { RTreeIndex } from "./rtree.js";

export interface Canvas2DContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  strokeStyle: string | object;
  lineWidth: number;
  globalAlpha: number;
  font: string;
}

export interface Viewport2D {
  world: Bounds2;
  widthPx: number;
  heightPx: number;
  devicePixelRatio: number;
}

export interface RenderStats {
  totalEntities: number;
  visibleCandidates: number;
  drawnEntities: number;
}

function drawPolyline(context: Canvas2DContext, points: readonly CadPoint2[], closed = false): void {
  const first = points[0];
  if (!first) return;
  context.moveTo(first.x, first.y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  if (closed) context.lineTo(first.x, first.y);
}

function drawCadPolyline(
  context: Canvas2DContext,
  vertices: readonly (CadPoint2 & { bulge?: number })[],
  closed: boolean,
): void {
  const first = vertices[0];
  if (!first) return;
  context.moveTo(first.x, first.y);
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index]!;
    const end = vertices[(index + 1) % vertices.length]!;
    const bulge = start.bulge ?? 0;
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    if (Math.abs(bulge) < 1e-12 || chord === 0) {
      context.lineTo(end.x, end.y);
      continue;
    }
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normal = { x: -(end.y - start.y) / chord, y: (end.x - start.x) / chord };
    const centerOffset = (chord * (1 - bulge * bulge)) / (4 * bulge);
    const center = { x: midpoint.x + normal.x * centerOffset, y: midpoint.y + normal.y * centerOffset };
    const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    // The render transform flips Y. Canvas clockwise therefore appears as world-space CCW.
    context.arc(center.x, center.y, radius, startAngle, endAngle, bulge < 0);
  }
}

function drawEntity(context: Canvas2DContext, entity: CadEntity): boolean {
  context.beginPath();
  switch (entity.kind) {
    case "line":
      context.moveTo(entity.start.x, entity.start.y);
      context.lineTo(entity.end.x, entity.end.y);
      break;
    case "polyline": drawCadPolyline(context, entity.vertices, entity.closed); break;
    case "circle": context.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2); break;
    case "arc": context.arc(entity.center.x, entity.center.y, entity.radius, entity.startAngleRad, entity.endAngleRad, !entity.counterClockwise); break;
    case "ellipse": {
      const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
      const rotation = Math.atan2(entity.majorAxis.y, entity.majorAxis.x);
      context.ellipse(entity.center.x, entity.center.y, major, major * entity.ratio, rotation, entity.startParameter, entity.endParameter);
      break;
    }
    case "spline": return false;
    case "text":
    case "mtext":
      context.save();
      context.translate(entity.position.x, entity.position.y);
      context.scale(1, -1);
      context.font = `${entity.height}px sans-serif`;
      context.fillText(entity.text, 0, 0);
      context.restore();
      return true;
    case "leader": drawPolyline(context, entity.vertices); break;
    case "dimension": drawPolyline(context, entity.definitionPoints); break;
    case "hatch": entity.loops.forEach((loop) => drawPolyline(context, loop.vertices, true)); break;
    default: return false;
  }
  context.stroke();
  return true;
}

export class CadCanvasRenderer {
  readonly #index = new RTreeIndex();
  #entities = new Map<string, CadEntity>();

  setEntities(entities: readonly CadEntity[]): void {
    this.#entities = new Map(entities.map((entity) => [entity.handle, entity]));
    this.#index.load(
      entities.flatMap((entity) => {
        const bounds = entityBounds(entity);
        return bounds ? [{ ...bounds, handle: entity.handle }] : [];
      }),
    );
  }

  visibleHandles(world: Bounds2): string[] {
    return this.#index.search(world).map((item) => item.handle);
  }

  render(
    context: Canvas2DContext,
    viewport: Viewport2D,
    layers: readonly CadLayer[],
    preview: CadEntity | null = null,
  ): RenderStats {
    const hidden = new Set(layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
    const candidates = this.#index.search(viewport.world);
    context.clearRect(0, 0, viewport.widthPx * viewport.devicePixelRatio, viewport.heightPx * viewport.devicePixelRatio);
    context.save();
    const worldWidth = viewport.world.maxX - viewport.world.minX || 1;
    const worldHeight = viewport.world.maxY - viewport.world.minY || 1;
    const scale = Math.min(viewport.widthPx / worldWidth, viewport.heightPx / worldHeight);
    const offsetX = (viewport.widthPx - worldWidth * scale) / 2;
    const offsetY = (viewport.heightPx - worldHeight * scale) / 2;
    context.translate(offsetX * viewport.devicePixelRatio, (viewport.heightPx - offsetY) * viewport.devicePixelRatio);
    context.scale(scale * viewport.devicePixelRatio, -scale * viewport.devicePixelRatio);
    context.translate(-viewport.world.minX, -viewport.world.minY);
    let drawnEntities = 0;
    for (const candidate of candidates) {
      const entity = this.#entities.get(candidate.handle);
      if (!entity || hidden.has(entity.layerId)) continue;
      context.globalAlpha = 1;
      context.strokeStyle = entity.appearance?.color ?? "#e8e8e8";
      context.lineWidth = (entity.appearance?.lineweightMm ?? 0.25) / scale;
      if (drawEntity(context, entity)) drawnEntities += 1;
    }
    if (preview) {
      context.globalAlpha = 0.65;
      context.strokeStyle = "#56a8ff";
      if (drawEntity(context, preview)) drawnEntities += 1;
    }
    context.restore();
    return { totalEntities: this.#entities.size, visibleCandidates: candidates.length, drawnEntities };
  }
}
