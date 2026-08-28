import type { CadBlockDefinition, CadEntity, CadLayer, CadPoint2, CadSpline } from "@kuubik/cad-schema";
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
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  strokeStyle: string | object;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
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

function splinePoint(entity: CadSpline, parameter: number): CadPoint2 | null {
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
  const values = Array.from({ length: degree + 1 }, (_, index) => {
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

function drawSpline(context: Canvas2DContext, entity: CadSpline): boolean {
  const start = entity.knots[entity.degree];
  const end = entity.knots[entity.controlPoints.length];
  if (start === undefined || end === undefined || !(end > start)) return false;
  const segments = Math.max(32, Math.min(256, entity.controlPoints.length * 16));
  const first = splinePoint(entity, start);
  if (!first) return false;
  context.moveTo(first.x, first.y);
  for (let index = 1; index <= segments; index += 1) {
    const point = splinePoint(entity, start + ((end - start) * index) / segments);
    if (!point) return false;
    context.lineTo(point.x, point.y);
  }
  if (entity.closed) context.lineTo(first.x, first.y);
  return true;
}

function drawEntity(
  context: Canvas2DContext,
  entity: CadEntity,
  blocks: ReadonlyMap<string, CadBlockDefinition>,
  blockTrail: ReadonlySet<string> = new Set(),
): boolean {
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
    case "spline": if (!drawSpline(context, entity)) return false; break;
    case "text":
    case "mtext":
      context.save();
      context.translate(entity.position.x, entity.position.y);
      context.rotate(entity.rotationRad);
      context.scale(1, -1);
      context.font = `${entity.height}px sans-serif`;
      context.textAlign = entity.extensionData?.kuubikMirrorTextAlign === "end" ? "right" : "left";
      context.fillText(entity.text, 0, 0);
      context.restore();
      return true;
    case "leader": drawPolyline(context, entity.vertices); break;
    case "dimension": drawPolyline(context, entity.definitionPoints); break;
    case "hatch": entity.loops.forEach((loop) => drawPolyline(context, loop.vertices, true)); break;
    case "blockRef": {
      const block = blocks.get(entity.blockId);
      if (!block || blockTrail.has(block.id)) return false;
      const nextTrail = new Set(blockTrail).add(block.id);
      context.save();
      context.translate(entity.insertion.x, entity.insertion.y);
      context.rotate(entity.rotationRad);
      context.scale(entity.scale.x, entity.scale.y);
      context.translate(-block.basePoint.x, -block.basePoint.y);
      const drawn = block.entities.reduce((count, child) => count + (drawEntity(context, child, blocks, nextTrail) ? 1 : 0), 0);
      context.restore();
      return drawn > 0;
    }
    default: return false;
  }
  context.stroke();
  return true;
}

export class CadCanvasRenderer {
  readonly #index = new RTreeIndex();
  #entities = new Map<string, CadEntity>();
  #blocks = new Map<string, CadBlockDefinition>();

  setEntities(entities: readonly CadEntity[]): void {
    this.#entities = new Map(entities.map((entity) => [entity.handle, entity]));
    this.#rebuildIndex();
  }

  #rebuildIndex(): void {
    this.#index.load(
      [...this.#entities.values()].flatMap((entity) => {
        const bounds = entityBounds(entity, this.#blocks);
        return bounds ? [{ ...bounds, handle: entity.handle }] : [];
      }),
    );
  }

  setBlocks(blocks: readonly CadBlockDefinition[]): void {
    this.#blocks = new Map(blocks.map((block) => [block.id, block]));
    this.#rebuildIndex();
  }

  visibleHandles(world: Bounds2): string[] {
    return this.#index.search(world).map((item) => item.handle);
  }

  render(
    context: Canvas2DContext,
    viewport: Viewport2D,
    layers: readonly CadLayer[],
    preview: CadEntity | readonly CadEntity[] | null = null,
    hiddenSourceHandles: readonly string[] = [],
  ): RenderStats {
    const hidden = new Set(layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
    const hiddenSources = new Set(hiddenSourceHandles);
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
      if (!entity || hidden.has(entity.layerId) || hiddenSources.has(entity.handle)) continue;
      context.globalAlpha = 1;
      context.strokeStyle = entity.appearance?.color ?? "#e8e8e8";
      context.lineWidth = (entity.appearance?.lineweightMm ?? 0.25) / scale;
      if (drawEntity(context, entity, this.#blocks)) drawnEntities += 1;
    }
    const previews = preview ? (Array.isArray(preview) ? preview : [preview]) : [];
    for (const previewEntity of previews) {
      if (hidden.has(previewEntity.layerId)) continue;
      context.globalAlpha = 0.65;
      context.strokeStyle = "#56a8ff";
      context.lineWidth = (previewEntity.appearance?.lineweightMm ?? 0.25) / scale;
      if (drawEntity(context, previewEntity, this.#blocks)) drawnEntities += 1;
    }
    context.restore();
    return { totalEntities: this.#entities.size, visibleCandidates: candidates.length, drawnEntities };
  }
}
