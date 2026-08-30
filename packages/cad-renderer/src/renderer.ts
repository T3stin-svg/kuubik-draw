import type { CadBlockDefinition, CadEntity, CadLayer, CadPoint2, CadSpline } from "@kuubik/cad-schema";
import type { CadPlotStyle } from "@kuubik/cad-schema";
import { resolveCadAppearance, resolveEntityPlotAppearance } from "@kuubik/cad-core";
import { entityBounds, entityHasUnboundedGeometry, type Bounds2 } from "./bounds.js";
import { RTreeIndex } from "./rtree.js";

export interface Canvas2DContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(fillRule?: CanvasFillRule): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  translate(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  strokeStyle: string | object;
  fillStyle: string | object;
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
  /** Positive AutoCAD view twist in radians; rendered model geometry turns counter-clockwise on screen. */
  rotationRad?: number;
}

export interface RenderStats {
  totalEntities: number;
  visibleCandidates: number;
  drawnEntities: number;
}

export interface RenderOptions {
  /** When supplied, the canvas becomes a paper preview of the same resolved plot style used by export. */
  plotStyle?: CadPlotStyle;
  /** CSS pixels per paper millimetre; required to preview physical lineweights. */
  pixelsPerMillimeter?: number;
}

export interface ViewportScreenTransform {
  worldCenter: CadPoint2;
  screenCenter: CadPoint2;
  worldUnitsPerPixel: number;
  rotationRad: number;
}

/** The exact aspect-fit transform used by both Canvas2D paint and pointer input. */
export function viewportScreenTransform(viewport: Viewport2D): ViewportScreenTransform {
  const rotationRad = viewport.rotationRad ?? 0;
  const worldWidth = viewport.world.maxX - viewport.world.minX;
  const worldHeight = viewport.world.maxY - viewport.world.minY;
  if (
    !Number.isFinite(rotationRad) || !Number.isFinite(worldWidth) || !Number.isFinite(worldHeight) ||
    !Number.isFinite(viewport.widthPx) || !Number.isFinite(viewport.heightPx) ||
    worldWidth <= 0 || worldHeight <= 0 || viewport.widthPx <= 0 || viewport.heightPx <= 0
  ) throw new Error("Viewport screen transform requires finite positive world and pixel dimensions.");
  const pixelsPerWorldUnit = Math.min(viewport.widthPx / worldWidth, viewport.heightPx / worldHeight);
  return {
    worldCenter: { x: (viewport.world.minX + viewport.world.maxX) / 2, y: (viewport.world.minY + viewport.world.maxY) / 2 },
    screenCenter: { x: viewport.widthPx / 2, y: viewport.heightPx / 2 },
    worldUnitsPerPixel: 1 / pixelsPerWorldUnit,
    rotationRad,
  };
}

export function viewportWorldToScreen(viewport: Viewport2D, point: CadPoint2): CadPoint2 {
  const transform = viewportScreenTransform(viewport);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Viewport world point must be finite.");
  const dx = point.x - transform.worldCenter.x;
  const dy = point.y - transform.worldCenter.y;
  const cosine = Math.cos(transform.rotationRad);
  const sine = Math.sin(transform.rotationRad);
  const localX = dx * cosine - dy * sine;
  const localY = dx * sine + dy * cosine;
  return {
    x: transform.screenCenter.x + localX / transform.worldUnitsPerPixel,
    y: transform.screenCenter.y - localY / transform.worldUnitsPerPixel,
  };
}

export function viewportScreenToWorld(viewport: Viewport2D, point: CadPoint2): CadPoint2 {
  const transform = viewportScreenTransform(viewport);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Viewport screen point must be finite.");
  const localX = (point.x - transform.screenCenter.x) * transform.worldUnitsPerPixel;
  const localY = -(point.y - transform.screenCenter.y) * transform.worldUnitsPerPixel;
  const cosine = Math.cos(-transform.rotationRad);
  const sine = Math.sin(-transform.rotationRad);
  return {
    x: transform.worldCenter.x + localX * cosine - localY * sine,
    y: transform.worldCenter.y + localX * sine + localY * cosine,
  };
}

export function pannedViewportWorldCenter(viewport: Viewport2D, deltaPx: CadPoint2): CadPoint2 {
  const transform = viewportScreenTransform(viewport);
  if (!Number.isFinite(deltaPx.x) || !Number.isFinite(deltaPx.y)) throw new Error("Viewport pan delta must be finite.");
  const worldAtCenter = viewportScreenToWorld(viewport, transform.screenCenter);
  const worldAtDraggedCenter = viewportScreenToWorld(viewport, {
    x: transform.screenCenter.x + deltaPx.x,
    y: transform.screenCenter.y + deltaPx.y,
  });
  return {
    x: transform.worldCenter.x + worldAtCenter.x - worldAtDraggedCenter.x,
    y: transform.worldCenter.y + worldAtCenter.y - worldAtDraggedCenter.y,
  };
}

function rotatedWorldBounds(world: Bounds2, rotationRad: number): Bounds2 {
  if (Math.abs(rotationRad) <= 1e-12) return world;
  const center = { x: (world.minX + world.maxX) / 2, y: (world.minY + world.maxY) / 2 };
  const half = { x: (world.maxX - world.minX) / 2, y: (world.maxY - world.minY) / 2 };
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  const points = [
    { x: -half.x, y: -half.y }, { x: half.x, y: -half.y },
    { x: half.x, y: half.y }, { x: -half.x, y: half.y },
  ].map((point) => ({
    x: center.x + point.x * cosine - point.y * sine,
    y: center.y + point.x * sine + point.y * cosine,
  }));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
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

function drawConstructionLine(
  context: Canvas2DContext,
  entity: Extract<CadEntity, { kind: "ray" | "xline" }>,
  clipBounds: Bounds2,
): boolean {
  const magnitude = Math.hypot(entity.direction.x, entity.direction.y);
  if (!(magnitude > 1e-12)) return false;
  const direction = { x: entity.direction.x / magnitude, y: entity.direction.y / magnitude };
  const clipCenter = { x: (clipBounds.minX + clipBounds.maxX) / 2, y: (clipBounds.minY + clipBounds.maxY) / 2 };
  const clipDiagonal = Math.hypot(clipBounds.maxX - clipBounds.minX, clipBounds.maxY - clipBounds.minY);
  const reach = Math.hypot(entity.basePoint.x - clipCenter.x, entity.basePoint.y - clipCenter.y) + clipDiagonal * 2 + 1;
  const start = entity.kind === "ray"
    ? entity.basePoint
    : { x: entity.basePoint.x - direction.x * reach, y: entity.basePoint.y - direction.y * reach };
  const end = { x: entity.basePoint.x + direction.x * reach, y: entity.basePoint.y + direction.y * reach };
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  return true;
}

function blockLocalClipBounds(
  clipBounds: Bounds2,
  block: CadBlockDefinition,
  reference: Extract<CadEntity, { kind: "blockRef" }>,
): Bounds2 {
  if (Math.abs(reference.scale.x) <= 1e-12 || Math.abs(reference.scale.y) <= 1e-12) return clipBounds;
  const cosine = Math.cos(-reference.rotationRad);
  const sine = Math.sin(-reference.rotationRad);
  const points = [
    { x: clipBounds.minX, y: clipBounds.minY }, { x: clipBounds.maxX, y: clipBounds.minY },
    { x: clipBounds.maxX, y: clipBounds.maxY }, { x: clipBounds.minX, y: clipBounds.maxY },
  ].map((point) => {
    const x = point.x - reference.insertion.x;
    const y = point.y - reference.insertion.y;
    return {
      x: block.basePoint.x + (x * cosine - y * sine) / reference.scale.x,
      y: block.basePoint.y + (x * sine + y * cosine) / reference.scale.y,
    };
  });
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function drawEntity(
  context: Canvas2DContext,
  entity: CadEntity,
  blocks: ReadonlyMap<string, CadBlockDefinition>,
  clipBounds: Bounds2,
  blockTrail: ReadonlySet<string> = new Set(),
): boolean {
  context.beginPath();
  switch (entity.kind) {
    case "line":
      context.moveTo(entity.start.x, entity.start.y);
      context.lineTo(entity.end.x, entity.end.y);
      break;
    case "ray":
    case "xline":
      if (!drawConstructionLine(context, entity, clipBounds)) return false;
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
    case "hatch":
      entity.loops.forEach((loop) => drawPolyline(context, loop.vertices, true));
      if (entity.pattern.trim().toUpperCase() === "SOLID") {
        context.fill("evenodd");
        return true;
      }
      break;
    case "blockRef": {
      const block = blocks.get(entity.blockId);
      if (!block || blockTrail.has(block.id)) return false;
      const nextTrail = new Set(blockTrail).add(block.id);
      context.save();
      context.translate(entity.insertion.x, entity.insertion.y);
      context.rotate(entity.rotationRad);
      context.scale(entity.scale.x, entity.scale.y);
      context.translate(-block.basePoint.x, -block.basePoint.y);
      const localClipBounds = blockLocalClipBounds(clipBounds, block, entity);
      const drawn = block.entities.reduce((count, child) => count + (drawEntity(context, child, blocks, localClipBounds, nextTrail) ? 1 : 0), 0);
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
  #unboundedHandles = new Set<string>();

  setEntities(entities: readonly CadEntity[]): void {
    this.#entities = new Map(entities.map((entity) => [entity.handle, entity]));
    this.#rebuildIndex();
  }

  #rebuildIndex(): void {
    this.#unboundedHandles = new Set(
      [...this.#entities.values()]
        .filter((entity) => entityHasUnboundedGeometry(entity, this.#blocks))
        .map((entity) => entity.handle),
    );
    this.#index.load(
      [...this.#entities.values()].flatMap((entity) => {
        if (this.#unboundedHandles.has(entity.handle)) return [];
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
    return [...new Set([
      ...this.#index.search(world).map((item) => item.handle),
      ...this.#unboundedHandles,
    ])];
  }

  render(
    context: Canvas2DContext,
    viewport: Viewport2D,
    layers: readonly CadLayer[],
    preview: CadEntity | readonly CadEntity[] | null = null,
    hiddenSourceHandles: readonly string[] = [],
    options: RenderOptions = {},
  ): RenderStats {
    const transform = viewportScreenTransform(viewport);
    const rotationRad = transform.rotationRad;
    const hidden = new Set(layers.filter((layer) => !layer.visible || layer.frozen).map((layer) => layer.id));
    const hiddenSources = new Set(hiddenSourceHandles);
    const clipBounds = rotatedWorldBounds(viewport.world, -rotationRad);
    const candidateHandles = [...new Set([
      ...this.#index.search(clipBounds).map((candidate) => candidate.handle),
      ...this.#unboundedHandles,
    ])];
    context.clearRect(0, 0, viewport.widthPx * viewport.devicePixelRatio, viewport.heightPx * viewport.devicePixelRatio);
    context.save();
    const scale = 1 / transform.worldUnitsPerPixel;
    context.translate(transform.screenCenter.x * viewport.devicePixelRatio, transform.screenCenter.y * viewport.devicePixelRatio);
    context.scale(scale * viewport.devicePixelRatio, -scale * viewport.devicePixelRatio);
    context.rotate(rotationRad);
    context.translate(-transform.worldCenter.x, -transform.worldCenter.y);
    let drawnEntities = 0;
    for (const handle of candidateHandles) {
      const entity = this.#entities.get(handle);
      if (!entity || hidden.has(entity.layerId) || hiddenSources.has(entity.handle)) continue;
      const sourceAppearance = resolveCadAppearance(entity, layers);
      const appearance = options.plotStyle
        ? resolveEntityPlotAppearance(entity, layers, options.plotStyle)
        : {
            ...sourceAppearance,
            color: entity.appearance?.color || layers.find((layer) => layer.id === entity.layerId)?.appearance?.color
              ? sourceAppearance.color
              : "#e8e8e8",
            opacity: 1 - sourceAppearance.transparencyPercent / 100,
          };
      const previewScale = options.plotStyle ? options.pixelsPerMillimeter ?? Number.NaN : 1;
      if (!Number.isFinite(previewScale) || previewScale <= 0) throw new TypeError("Paper preview requires positive pixelsPerMillimeter.");
      context.globalAlpha = appearance.opacity;
      context.strokeStyle = appearance.color;
      context.fillStyle = appearance.color;
      // Canvas ignores lineWidth=0. Preview the PDF/SVG hairline as one device
      // pixel while retaining the shared semantic lineweight of exactly zero.
      const previewWidthPx = appearance.lineweightMm === 0
        ? 1 / viewport.devicePixelRatio
        : appearance.lineweightMm * previewScale;
      context.lineWidth = previewWidthPx / scale;
      if (drawEntity(context, entity, this.#blocks, clipBounds)) drawnEntities += 1;
    }
    const previews = preview ? (Array.isArray(preview) ? preview : [preview]) : [];
    for (const previewEntity of previews) {
      if (hidden.has(previewEntity.layerId)) continue;
      context.globalAlpha = 0.65;
      context.strokeStyle = "#56a8ff";
      context.fillStyle = "#56a8ff";
      context.lineWidth = (previewEntity.appearance?.lineweightMm ?? 0.25) / scale;
      if (drawEntity(context, previewEntity, this.#blocks, clipBounds)) drawnEntities += 1;
    }
    context.restore();
    return { totalEntities: this.#entities.size, visibleCandidates: candidateHandles.length, drawnEntities };
  }
}
