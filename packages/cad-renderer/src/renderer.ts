import type { CadBlockDefinition, CadEntity, CadLayer, CadLinetype, CadPoint2, CadSpline } from "@kuubik/cad-schema";
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
  setLineDash?(segments: number[]): void;
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
  /** MATCHPROP previews resolved destination properties; geometry edits retain the blue highlight. */
  previewAppearance?: "highlight" | "resolved";
  /** Model-space entities currently selected by the user. Selection is a screen-only overlay. */
  selectedHandles?: readonly string[];
  /** AutoCAD-familiar world-aligned model grid. It is display-only and never enters the document. */
  grid?: ViewportGridOptions;
}

export interface ViewportGridOptions {
  enabled: boolean;
  minorColor?: string;
  majorColor?: string;
  targetSpacingPx?: number;
  majorEvery?: number;
}

const SELECTION_COLOR = "#4ea9f3";
const GRIP_FILL = "#00a8ff";
const GRIP_STROKE = "#0b2438";

/** Selects a stable 1/2/5 decade spacing close to the requested screen density. */
export function viewportGridSpacing(viewport: Viewport2D, targetSpacingPx = 20): number {
  if (!Number.isFinite(targetSpacingPx) || targetSpacingPx <= 0) throw new TypeError("Grid target spacing must be positive.");
  const worldUnitsPerPixel = viewportScreenTransform(viewport).worldUnitsPerPixel;
  const desired = worldUnitsPerPixel * targetSpacingPx;
  const decade = 10 ** Math.floor(Math.log10(desired));
  const normalized = desired / decade;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * decade;
}

function drawViewportGrid(
  context: Canvas2DContext,
  viewport: Viewport2D,
  transform: ReturnType<typeof viewportScreenTransform>,
  options: ViewportGridOptions,
): void {
  if (!options.enabled) return;
  const spacing = viewportGridSpacing(viewport, options.targetSpacingPx ?? 20);
  const majorEvery = Math.max(2, Math.round(options.majorEvery ?? 5));
  const scale = 1 / transform.worldUnitsPerPixel;
  const visibleCorners = [
    viewportScreenToWorld(viewport, { x: 0, y: 0 }),
    viewportScreenToWorld(viewport, { x: viewport.widthPx, y: 0 }),
    viewportScreenToWorld(viewport, { x: viewport.widthPx, y: viewport.heightPx }),
    viewportScreenToWorld(viewport, { x: 0, y: viewport.heightPx }),
  ];
  const visibleBounds = {
    minX: Math.min(...visibleCorners.map(({ x }) => x)),
    minY: Math.min(...visibleCorners.map(({ y }) => y)),
    maxX: Math.max(...visibleCorners.map(({ x }) => x)),
    maxY: Math.max(...visibleCorners.map(({ y }) => y)),
  };
  const firstX = Math.floor(visibleBounds.minX / spacing);
  const lastX = Math.ceil(visibleBounds.maxX / spacing);
  const firstY = Math.floor(visibleBounds.minY / spacing);
  const lastY = Math.ceil(visibleBounds.maxY / spacing);
  const drawPass = (major: boolean) => {
    context.beginPath();
    for (let index = firstX; index <= lastX; index += 1) {
      if ((index % majorEvery === 0) !== major) continue;
      const x = index * spacing;
      context.moveTo(x, visibleBounds.minY);
      context.lineTo(x, visibleBounds.maxY);
    }
    for (let index = firstY; index <= lastY; index += 1) {
      if ((index % majorEvery === 0) !== major) continue;
      const y = index * spacing;
      context.moveTo(visibleBounds.minX, y);
      context.lineTo(visibleBounds.maxX, y);
    }
    context.strokeStyle = major ? (options.majorColor ?? "#3d4850") : (options.minorColor ?? "#303940");
    context.lineWidth = (major ? 0.7 : 0.45) / scale;
    context.globalAlpha = major ? 0.9 : 0.72;
    context.setLineDash?.([]);
    context.stroke();
  };
  drawPass(false);
  drawPass(true);
}

function midpoint(first: CadPoint2, second: CadPoint2): CadPoint2 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function polarPoint(center: CadPoint2, radius: number, angle: number): CadPoint2 {
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function ellipsePoint(entity: Extract<CadEntity, { kind: "ellipse" }>, parameter: number): CadPoint2 {
  const minorAxis = { x: -entity.majorAxis.y * entity.ratio, y: entity.majorAxis.x * entity.ratio };
  return {
    x: entity.center.x + entity.majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
    y: entity.center.y + entity.majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter),
  };
}

function arcMidAngle(entity: Extract<CadEntity, { kind: "arc" }>): number {
  const full = Math.PI * 2;
  const forward = ((entity.endAngleRad - entity.startAngleRad) % full + full) % full;
  const sweep = entity.counterClockwise ? forward : forward - full;
  return entity.startAngleRad + sweep / 2;
}

function ellipseMidParameter(entity: Extract<CadEntity, { kind: "ellipse" }>): number {
  const full = Math.PI * 2;
  const sweep = ((entity.endParameter - entity.startParameter) % full + full) % full || full;
  return entity.startParameter + sweep / 2;
}

function uniquePoints(points: readonly CadPoint2[]): CadPoint2[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x.toFixed(9)}:${point.y.toFixed(9)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** AutoCAD-familiar cold-grip locations. They are display metadata, never document mutations. */
export function entityGripPoints(entity: CadEntity): CadPoint2[] {
  switch (entity.kind) {
    case "line": return [entity.start, midpoint(entity.start, entity.end), entity.end];
    case "ray": return [entity.basePoint];
    case "xline": return [entity.basePoint];
    case "polyline": {
      const points: CadPoint2[] = [];
      const segmentCount = entity.closed ? entity.vertices.length : Math.max(0, entity.vertices.length - 1);
      entity.vertices.forEach((vertex) => points.push(vertex));
      for (let index = 0; index < segmentCount; index += 1) {
        points.push(midpoint(entity.vertices[index]!, entity.vertices[(index + 1) % entity.vertices.length]!));
      }
      return uniquePoints(points);
    }
    case "circle": return [
      entity.center,
      polarPoint(entity.center, entity.radius, 0),
      polarPoint(entity.center, entity.radius, Math.PI / 2),
      polarPoint(entity.center, entity.radius, Math.PI),
      polarPoint(entity.center, entity.radius, Math.PI * 1.5),
    ];
    case "arc": return [
      entity.center,
      polarPoint(entity.center, entity.radius, entity.startAngleRad),
      polarPoint(entity.center, entity.radius, arcMidAngle(entity)),
      polarPoint(entity.center, entity.radius, entity.endAngleRad),
    ];
    case "ellipse": return uniquePoints([
      entity.center,
      ellipsePoint(entity, entity.startParameter),
      ellipsePoint(entity, ellipseMidParameter(entity)),
      ellipsePoint(entity, entity.endParameter),
    ]);
    case "spline": return uniquePoints(entity.controlPoints);
    case "text":
    case "mtext": return [entity.position];
    case "leader": return uniquePoints(entity.vertices);
    case "dimension": return uniquePoints(entity.definitionPoints);
    case "hatch": return uniquePoints(entity.loops.flatMap((loop) => loop.vertices));
    case "blockRef": return [entity.insertion];
    case "proxy": return entity.bounds ? [entity.bounds.min, midpoint(entity.bounds.min, entity.bounds.max), entity.bounds.max] : [];
  }
}

function drawGrip(context: Canvas2DContext, point: CadPoint2, sizeWorld: number): void {
  const half = sizeWorld / 2;
  context.beginPath();
  context.moveTo(point.x - half, point.y - half);
  context.lineTo(point.x + half, point.y - half);
  context.lineTo(point.x + half, point.y + half);
  context.lineTo(point.x - half, point.y + half);
  context.lineTo(point.x - half, point.y - half);
  context.fill();
  context.stroke();
}

function lineDashForEntity(
  entity: CadEntity,
  layers: readonly CadLayer[],
  linetypes: ReadonlyMap<string, CadLinetype>,
): number[] {
  const layer = layers.find((candidate) => candidate.id === entity.layerId);
  const linetypeId = entity.appearance?.linetypeId ?? layer?.appearance?.linetypeId;
  if (!linetypeId) return [];
  const pattern = linetypes.get(linetypeId)?.pattern ?? [];
  const scale = entity.appearance?.linetypeScale ?? layer?.appearance?.linetypeScale ?? 1;
  return pattern.map((segment) => Math.max(Math.abs(segment) * scale, Number.EPSILON));
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
  fillSolidHatch = true,
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
      if (fillSolidHatch && entity.pattern.trim().toUpperCase() === "SOLID") {
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
      const drawn = block.entities.reduce((count, child) => count + (drawEntity(context, child, blocks, localClipBounds, nextTrail, fillSolidHatch) ? 1 : 0), 0);
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
  #linetypes = new Map<string, CadLinetype>();
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

  setLinetypes(linetypes: readonly CadLinetype[]): void {
    this.#linetypes = new Map(linetypes.map((linetype) => [linetype.id, structuredClone(linetype)]));
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
    if (options.grid?.enabled) drawViewportGrid(context, viewport, transform, options.grid);
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
      context.setLineDash?.(lineDashForEntity(entity, layers, this.#linetypes));
      if (drawEntity(context, entity, this.#blocks, clipBounds)) drawnEntities += 1;
    }
    const previews = preview ? (Array.isArray(preview) ? preview : [preview]) : [];
    for (const previewEntity of previews) {
      if (hidden.has(previewEntity.layerId)) continue;
      if (options.previewAppearance === "resolved") {
        const appearance = resolveCadAppearance(previewEntity, layers);
        context.globalAlpha = 1 - appearance.transparencyPercent / 100;
        context.strokeStyle = appearance.color;
        context.fillStyle = appearance.color;
        context.lineWidth = appearance.lineweightMm / scale;
        context.setLineDash?.(lineDashForEntity(previewEntity, layers, this.#linetypes));
      } else {
        context.globalAlpha = 0.65;
        context.strokeStyle = "#56a8ff";
        context.fillStyle = "#56a8ff";
        context.lineWidth = (previewEntity.appearance?.lineweightMm ?? 0.25) / scale;
        context.setLineDash?.([]);
      }
      if (drawEntity(context, previewEntity, this.#blocks, clipBounds)) drawnEntities += 1;
    }
    const selectedHandles = new Set(options.selectedHandles ?? []);
    const selectedEntities = candidateHandles.flatMap((handle) => {
      const entity = this.#entities.get(handle);
      return entity && selectedHandles.has(handle) && !hidden.has(entity.layerId) && !hiddenSources.has(handle) ? [entity] : [];
    });
    if (selectedEntities.length > 0) {
      context.globalAlpha = 1;
      context.strokeStyle = SELECTION_COLOR;
      context.fillStyle = SELECTION_COLOR;
      context.lineWidth = 1.25 / scale;
      context.setLineDash?.([]);
      selectedEntities.forEach((entity) => { drawEntity(context, entity, this.#blocks, clipBounds, new Set(), false); });

      context.fillStyle = GRIP_FILL;
      context.strokeStyle = GRIP_STROKE;
      context.lineWidth = 1 / scale;
      const gripSizeWorld = 8 / scale;
      selectedEntities.flatMap(entityGripPoints).forEach((point) => drawGrip(context, point, gripSizeWorld));
    }
    context.restore();
    return { totalEntities: this.#entities.size, visibleCandidates: candidateHandles.length, drawnEntities };
  }
}
