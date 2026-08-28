import type { CadEntity, CadLayout, CadPoint2, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateEntityHandles } from "./commands.js";

export const MAX_PAPER_LAYOUTS = 255;
export const MAX_LAYOUT_NAME_LENGTH = 255;
export const DEFAULT_PAPER_DEFINITION = Object.freeze({
  widthMm: 297,
  heightMm: 210,
  marginsMm: Object.freeze({ top: 10, right: 10, bottom: 10, left: 10 }),
});

export type LayoutCommandErrorCode =
  | "DUPLICATE_NAME"
  | "INVALID_PAPER"
  | "INVALID_VIEWPORT"
  | "INVALID_NAME"
  | "LAYOUT_LIMIT"
  | "MISSING_LAYOUT"
  | "MODEL_LAYOUT_PROTECTED"
  | "LAST_PAPER_LAYOUT"
  | "ORDER_LIMIT"
  | "VIEWPORT_LOCKED";

export class LayoutCommandError extends Error {
  constructor(readonly code: LayoutCommandErrorCode, message: string) {
    super(message);
    this.name = "LayoutCommandError";
  }
}

export interface LayoutSetChange {
  type: "set-layouts";
  layouts: CadLayout[];
}

export interface LayoutEditResult {
  changes: [LayoutSetChange];
  layoutId: string;
  layouts: CadLayout[];
}

export interface ViewportEditResult extends LayoutEditResult {
  viewportId: string | null;
}

export interface ViewportViewState {
  viewCenter: CadPoint2;
  scaleDenominator: number;
  twistAngleRad: number;
}

export const STANDARD_VIEWPORT_SCALE_DENOMINATORS = Object.freeze([1, 2, 4, 5, 8, 10, 16, 20, 25, 30, 40, 50, 100]);

function normalizedName(name: string): string {
  return name.toLocaleLowerCase("en-US");
}

function validLayoutName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LAYOUT_NAME_LENGTH || /[<>/\\":;?*|,=]/u.test(trimmed)) {
    throw new LayoutCommandError("INVALID_NAME", `Layout name must contain 1-${MAX_LAYOUT_NAME_LENGTH} valid characters.`);
  }
  return trimmed;
}

export function resolvePaperDefinition(layout: CadLayout): NonNullable<CadLayout["paper"]> | null {
  if (layout.kind !== "paper") return null;
  const paper = structuredClone(layout.paper ?? DEFAULT_PAPER_DEFINITION);
  const margins = paper.marginsMm;
  const values = [paper.widthMm, paper.heightMm, margins.top, margins.right, margins.bottom, margins.left];
  if (values.some((value) => !Number.isFinite(value)) || paper.widthMm <= 0 || paper.heightMm <= 0) {
    throw new LayoutCommandError("INVALID_PAPER", "Paper dimensions must be finite and positive.");
  }
  if (
    [margins.top, margins.right, margins.bottom, margins.left].some((value) => value < 0) ||
    margins.left + margins.right >= paper.widthMm ||
    margins.top + margins.bottom >= paper.heightMm
  ) throw new LayoutCommandError("INVALID_PAPER", "Paper margins must leave a positive printable area.");
  return paper;
}

function polygonArea(points: readonly { x: number; y: number }[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function pointsEqual(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.abs(orientation(start, end, point)) <= 1e-9 &&
    point.x >= Math.min(start.x, end.x) - 1e-9 && point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 && point.y <= Math.max(start.y, end.y) + 1e-9;
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if ([abC, abD, cdA, cdB].some((value) => !Number.isFinite(value))) return true;
  if ((abC > 1e-9 && abD < -1e-9 || abC < -1e-9 && abD > 1e-9) &&
      (cdA > 1e-9 && cdB < -1e-9 || cdA < -1e-9 && cdB > 1e-9)) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function isSimplePolygon(points: readonly { x: number; y: number }[]): boolean {
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    if (pointsEqual(points[index]!, points[next]!)) return false;
    for (let other = index + 1; other < points.length; other += 1) {
      const otherNext = (other + 1) % points.length;
      if (index === other || next === other || otherNext === index) continue;
      if (segmentsIntersect(points[index]!, points[next]!, points[other]!, points[otherNext]!)) return false;
    }
  }
  return true;
}

export function assertViewportGeometry(viewport: CadViewport): void {
  const values = [
    viewport.center.x, viewport.center.y, viewport.width, viewport.height,
    viewport.viewCenter.x, viewport.viewCenter.y, viewport.viewHeight, viewport.twistAngleRad,
  ];
  if (values.some((value) => !Number.isFinite(value)) || viewport.width <= 0 || viewport.height <= 0 || viewport.viewHeight <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport frame and view dimensions must be finite and positive.");
  }
  const minX = viewport.center.x - viewport.width / 2;
  const maxX = viewport.center.x + viewport.width / 2;
  const minY = viewport.center.y - viewport.height / 2;
  const maxY = viewport.center.y + viewport.height / 2;
  const viewWidth = viewport.viewHeight * (viewport.width / viewport.height);
  if ([minX, maxX, minY, maxY, viewWidth].some((value) => !Number.isFinite(value)) || viewWidth <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport derived frame and view bounds must remain finite and positive.");
  }
  if (viewport.clipBoundary !== undefined) {
    const points = viewport.clipBoundary;
    const area = polygonArea(points);
    if (
      points.length < 3 ||
      points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
      !Number.isFinite(area) ||
      Math.abs(area) <= 1e-9 ||
      !isSimplePolygon(points)
    ) throw new LayoutCommandError("INVALID_VIEWPORT", "A clipped viewport requires a finite simple non-collinear polygon with at least three points.");
    if (points.some((point) => point.x < minX - 1e-9 || point.x > maxX + 1e-9 || point.y < minY - 1e-9 || point.y > maxY + 1e-9)) {
      throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport clip boundary must stay inside its paper-space frame.");
    }
  }
}

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new LayoutCommandError("INVALID_VIEWPORT", `${label} must contain finite coordinates.`);
  }
  return { x: point.x, y: point.y };
}

function normalizedTwist(angle: number): number {
  if (!Number.isFinite(angle)) throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport twist angle must be finite.");
  const fullTurn = Math.PI * 2;
  if (angle >= 0 && angle < fullTurn) return Math.abs(angle) <= 1e-12 ? 0 : angle;
  const normalized = ((angle % fullTurn) + fullTurn) % fullTurn;
  return Math.abs(normalized - fullTurn) <= 1e-12 || Math.abs(normalized) <= 1e-12 ? 0 : normalized;
}

export function viewportScaleDenominator(viewport: CadViewport): number {
  assertViewportGeometry(viewport);
  const denominator = viewport.viewHeight / viewport.height;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport scale denominator must be finite and positive.");
  }
  return denominator;
}

export function formatViewportScale(viewport: CadViewport): string {
  const denominator = viewportScaleDenominator(viewport);
  const standard = STANDARD_VIEWPORT_SCALE_DENOMINATORS.find((candidate) => Math.abs(candidate - denominator) <= Math.max(1, candidate) * 1e-9);
  return standard === undefined ? `1:${Number(denominator.toFixed(3))} (Custom)` : `1:${standard}`;
}

export function viewportModelToNormalized(viewport: CadViewport, point: CadPoint2): CadPoint2 {
  assertViewportGeometry(viewport);
  finitePoint(point, "Viewport model point");
  const dx = point.x - viewport.viewCenter.x;
  const dy = point.y - viewport.viewCenter.y;
  const cosine = Math.cos(viewport.twistAngleRad);
  const sine = Math.sin(viewport.twistAngleRad);
  const viewWidth = viewport.viewHeight * (viewport.width / viewport.height);
  return {
    x: (dx * cosine - dy * sine) / viewWidth,
    y: (dx * sine + dy * cosine) / viewport.viewHeight,
  };
}

export function viewportNormalizedToModel(viewport: CadViewport, normalized: CadPoint2): CadPoint2 {
  assertViewportGeometry(viewport);
  finitePoint(normalized, "Viewport normalized point");
  const viewWidth = viewport.viewHeight * (viewport.width / viewport.height);
  const localX = normalized.x * viewWidth;
  const localY = normalized.y * viewport.viewHeight;
  const cosine = Math.cos(-viewport.twistAngleRad);
  const sine = Math.sin(-viewport.twistAngleRad);
  return finitePoint({
    x: viewport.viewCenter.x + localX * cosine - localY * sine,
    y: viewport.viewCenter.y + localX * sine + localY * cosine,
  }, "Viewport model point");
}

function uniqueId(prefix: string, used: ReadonlySet<string>): string {
  let sequence = 1;
  while (used.has(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
}

function uniqueLayoutName(layouts: readonly CadLayout[], preferred: string): string {
  const used = new Set(layouts.map((layout) => normalizedName(layout.name)));
  if (!used.has(normalizedName(preferred))) return preferred;
  let sequence = 2;
  while (used.has(normalizedName(`${preferred} (${sequence})`))) sequence += 1;
  return `${preferred} (${sequence})`;
}

function copyName(layouts: readonly CadLayout[], sourceName: string): string {
  const used = new Set(layouts.map((layout) => normalizedName(layout.name)));
  let sequence = 2;
  while (used.has(normalizedName(`${sourceName} (${sequence})`))) sequence += 1;
  return `${sourceName} (${sequence})`;
}

function viewportIds(layouts: readonly CadLayout[]): Set<string> {
  return new Set(layouts.flatMap((layout) => layout.viewports.map((viewport) => viewport.id)));
}

function cloneViewport(viewport: CadViewport, used: Set<string>): CadViewport {
  const id = uniqueId("viewport", used);
  used.add(id);
  return { ...structuredClone(viewport), id };
}

export function assertLayoutCollection(layouts: readonly CadLayout[]): void {
  if (layouts.length === 0 || layouts[0]?.kind !== "model" || layouts.filter((layout) => layout.kind === "model").length !== 1) {
    throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Exactly one model layout must remain first.");
  }
  if (layouts.filter((layout) => layout.kind === "paper").length > MAX_PAPER_LAYOUTS) {
    throw new LayoutCommandError("LAYOUT_LIMIT", `At most ${MAX_PAPER_LAYOUTS} paper layouts are allowed.`);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const viewports = new Set<string>();
  for (const layout of layouts) {
    if (!layout.id || ids.has(layout.id)) throw new LayoutCommandError("MISSING_LAYOUT", `Duplicate or empty layout id: ${layout.id}`);
    ids.add(layout.id);
    const name = validLayoutName(layout.name);
    const normalized = normalizedName(name);
    if (names.has(normalized)) throw new LayoutCommandError("DUPLICATE_NAME", `Layout name already exists: ${name}`);
    names.add(normalized);
    resolvePaperDefinition(layout);
    for (const viewport of layout.viewports) {
      if (!viewport.id || viewports.has(viewport.id)) throw new LayoutCommandError("MISSING_LAYOUT", `Duplicate or empty viewport id: ${viewport.id}`);
      viewports.add(viewport.id);
      assertViewportGeometry(viewport);
    }
  }
}

function paperLayoutIndex(document: KDrawDocumentV1, layoutId: string): number {
  const index = document.layouts.findIndex((layout) => layout.id === layoutId);
  const layout = document.layouts[index];
  if (!layout) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layout.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Paper viewports cannot be changed in Model layout.");
  return index;
}

function paperViewport(document: KDrawDocumentV1, layoutId: string, viewportId: string): CadViewport {
  const layout = document.layouts[paperLayoutIndex(document, layoutId)]!;
  const viewport = layout.viewports.find((candidate) => candidate.id === viewportId);
  if (!viewport) throw new LayoutCommandError("INVALID_VIEWPORT", `Viewport not found: ${viewportId}`);
  return viewport;
}

export function setPaperViewportView(
  document: KDrawDocumentV1,
  layoutId: string,
  viewportId: string,
  state: ViewportViewState,
): ViewportEditResult {
  const source = paperViewport(document, layoutId, viewportId);
  if (source.locked) throw new LayoutCommandError("VIEWPORT_LOCKED", `Viewport is display locked: ${viewportId}`);
  const viewCenter = finitePoint(state.viewCenter, "Viewport view center");
  if (!Number.isFinite(state.scaleDenominator) || state.scaleDenominator <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport scale denominator must be finite and positive.");
  }
  const layouts = structuredClone(document.layouts);
  const layout = layouts[paperLayoutIndex(document, layoutId)]!;
  const viewport = layout.viewports.find((candidate) => candidate.id === viewportId)!;
  viewport.viewCenter = viewCenter;
  viewport.viewHeight = viewport.height * state.scaleDenominator;
  viewport.twistAngleRad = normalizedTwist(state.twistAngleRad);
  assertViewportGeometry(viewport);
  const edited = result(layouts, layoutId);
  return { ...edited, viewportId };
}

/** AutoCAD-style wheel zoom: the model point under the cursor remains under it. */
export function zoomPaperViewportAtModelPoint(
  document: KDrawDocumentV1,
  layoutId: string,
  viewportId: string,
  anchorModel: CadPoint2,
  scaleFactor: number,
): ViewportEditResult {
  const viewport = paperViewport(document, layoutId, viewportId);
  finitePoint(anchorModel, "Viewport zoom anchor");
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport zoom factor must be finite and positive.");
  }
  const anchor = viewportModelToNormalized(viewport, anchorModel);
  const scaleDenominator = viewportScaleDenominator(viewport) * scaleFactor;
  const nextViewHeight = viewport.height * scaleDenominator;
  const nextViewWidth = nextViewHeight * (viewport.width / viewport.height);
  const localX = anchor.x * nextViewWidth;
  const localY = anchor.y * nextViewHeight;
  const cosine = Math.cos(-viewport.twistAngleRad);
  const sine = Math.sin(-viewport.twistAngleRad);
  const viewCenter = finitePoint({
    x: anchorModel.x - (localX * cosine - localY * sine),
    y: anchorModel.y - (localX * sine + localY * cosine),
  }, "Viewport zoom center");
  return setPaperViewportView(document, layoutId, viewportId, {
    viewCenter,
    scaleDenominator,
    twistAngleRad: viewport.twistAngleRad,
  });
}

/** Convert a viewport pointer drag to the rotated model-space view center. */
export function pannedViewportCenter(
  viewport: CadViewport,
  deltaPx: CadPoint2,
  viewportPx: { width: number; height: number },
): CadPoint2 {
  assertViewportGeometry(viewport);
  finitePoint(deltaPx, "Viewport pan delta");
  if (!Number.isFinite(viewportPx.width) || !Number.isFinite(viewportPx.height) || viewportPx.width <= 0 || viewportPx.height <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport pan pixel dimensions must be finite and positive.");
  }
  const viewWidth = viewport.viewHeight * (viewport.width / viewport.height);
  const pixelsPerModelUnit = Math.min(viewportPx.width / viewWidth, viewportPx.height / viewport.viewHeight);
  if (!Number.isFinite(pixelsPerModelUnit) || pixelsPerModelUnit <= 0) {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport pan transform must remain finite and positive.");
  }
  const localX = -deltaPx.x / pixelsPerModelUnit;
  const localY = deltaPx.y / pixelsPerModelUnit;
  const cosine = Math.cos(-viewport.twistAngleRad);
  const sine = Math.sin(-viewport.twistAngleRad);
  return finitePoint({
    x: viewport.viewCenter.x + localX * cosine - localY * sine,
    y: viewport.viewCenter.y + localX * sine + localY * cosine,
  }, "Viewport pan center");
}

export function panPaperViewportByPixels(
  document: KDrawDocumentV1,
  layoutId: string,
  viewportId: string,
  deltaPx: CadPoint2,
  viewportPx: { width: number; height: number },
): ViewportEditResult {
  const viewport = paperViewport(document, layoutId, viewportId);
  const viewCenter = pannedViewportCenter(viewport, deltaPx, viewportPx);
  return setPaperViewportView(document, layoutId, viewportId, {
    viewCenter,
    scaleDenominator: viewportScaleDenominator(viewport),
    twistAngleRad: viewport.twistAngleRad,
  });
}

export function createPaperViewport(
  document: KDrawDocumentV1,
  layoutId: string,
  options: Omit<CadViewport, "id">,
): ViewportEditResult {
  const layoutIndex = paperLayoutIndex(document, layoutId);
  const layouts = structuredClone(document.layouts);
  const viewport: CadViewport = {
    ...structuredClone(options),
    id: uniqueId("viewport", viewportIds(layouts)),
  };
  assertViewportGeometry(viewport);
  layouts[layoutIndex]!.viewports.push(viewport);
  const edited = result(layouts, layoutId);
  return { ...edited, viewportId: viewport.id };
}

export function deletePaperViewport(document: KDrawDocumentV1, layoutId: string, viewportId: string): ViewportEditResult {
  const layoutIndex = paperLayoutIndex(document, layoutId);
  const layouts = structuredClone(document.layouts);
  const viewports = layouts[layoutIndex]!.viewports;
  const viewportIndex = viewports.findIndex((viewport) => viewport.id === viewportId);
  if (viewportIndex < 0) throw new LayoutCommandError("INVALID_VIEWPORT", `Viewport not found: ${viewportId}`);
  viewports.splice(viewportIndex, 1);
  const nextViewportId = viewports[Math.min(viewportIndex, viewports.length - 1)]?.id ?? null;
  const edited = result(layouts, layoutId);
  return { ...edited, viewportId: nextViewportId };
}

function result(layouts: CadLayout[], layoutId: string): LayoutEditResult {
  assertLayoutCollection(layouts);
  return { changes: [{ type: "set-layouts", layouts: structuredClone(layouts) }], layoutId, layouts: structuredClone(layouts) };
}

export function createPaperLayout(
  document: KDrawDocumentV1,
  options: { name?: string; paper?: CadLayout["paper"]; viewports?: CadViewport[]; entities?: CadEntity[] } = {},
): LayoutEditResult {
  const papers = document.layouts.filter((layout) => layout.kind === "paper");
  if (papers.length >= MAX_PAPER_LAYOUTS) throw new LayoutCommandError("LAYOUT_LIMIT", `At most ${MAX_PAPER_LAYOUTS} paper layouts are allowed.`);
  const name = options.name === undefined
    ? uniqueLayoutName(document.layouts, "Layout 1")
    : validLayoutName(options.name);
  if (document.layouts.some((layout) => normalizedName(layout.name) === normalizedName(name))) {
    throw new LayoutCommandError("DUPLICATE_NAME", `Layout name already exists: ${name}`);
  }
  const usedLayoutIds = new Set(document.layouts.map((layout) => layout.id));
  const usedViewportIds = viewportIds(document.layouts);
  const layoutId = uniqueId("layout", usedLayoutIds);
  const defaultViewport: CadViewport = {
    id: uniqueId("viewport", usedViewportIds),
    center: { x: 148.5, y: 105 },
    width: 277,
    height: 190,
    viewCenter: { x: 0, y: 0 },
    viewHeight: 190,
    twistAngleRad: 0,
    locked: false,
  };
  const layout: CadLayout = {
    id: layoutId,
    name,
    kind: "paper",
    paper: structuredClone(options.paper ?? DEFAULT_PAPER_DEFINITION),
    viewports: structuredClone(options.viewports ?? [defaultViewport]),
    entities: structuredClone(options.entities ?? []),
  };
  return result([...structuredClone(document.layouts), layout], layoutId);
}

export function copyPaperLayout(document: KDrawDocumentV1, layoutId: string): LayoutEditResult {
  const sourceIndex = document.layouts.findIndex((layout) => layout.id === layoutId);
  const source = document.layouts[sourceIndex];
  if (!source) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (source.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model layout cannot be copied as paper.");
  if (document.layouts.filter((layout) => layout.kind === "paper").length >= MAX_PAPER_LAYOUTS) {
    throw new LayoutCommandError("LAYOUT_LIMIT", `At most ${MAX_PAPER_LAYOUTS} paper layouts are allowed.`);
  }
  const newLayoutId = uniqueId("layout", new Set(document.layouts.map((layout) => layout.id)));
  const usedViewports = viewportIds(document.layouts);
  const sourceEntities = source.entities ?? [];
  const handles = allocateEntityHandles(document, sourceEntities.length);
  const copied: CadLayout = {
    ...structuredClone(source),
    id: newLayoutId,
    name: copyName(document.layouts, source.name),
    viewports: source.viewports.map((viewport) => cloneViewport(viewport, usedViewports)),
    entities: sourceEntities.map((entity, index) => ({ ...structuredClone(entity), handle: handles[index]! })),
  };
  const layouts = structuredClone(document.layouts);
  layouts.splice(sourceIndex, 0, copied);
  return result(layouts, newLayoutId);
}

export function renamePaperLayout(document: KDrawDocumentV1, layoutId: string, requestedName: string): LayoutEditResult {
  const layouts = structuredClone(document.layouts);
  const layout = layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layout.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model layout cannot be renamed.");
  const name = validLayoutName(requestedName);
  if (layouts.some((candidate) => candidate.id !== layoutId && normalizedName(candidate.name) === normalizedName(name))) {
    throw new LayoutCommandError("DUPLICATE_NAME", `Layout name already exists: ${name}`);
  }
  layout.name = name;
  return result(layouts, layoutId);
}

export function movePaperLayout(document: KDrawDocumentV1, layoutId: string, delta: -1 | 1): LayoutEditResult {
  const layouts = structuredClone(document.layouts);
  const index = layouts.findIndex((layout) => layout.id === layoutId);
  const layout = layouts[index];
  if (!layout) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layout.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model layout cannot be reordered.");
  const destination = index + delta;
  if (destination < 1 || destination >= layouts.length) throw new LayoutCommandError("ORDER_LIMIT", "Layout is already at that edge.");
  layouts.splice(index, 1);
  layouts.splice(destination, 0, layout);
  return result(layouts, layoutId);
}

export function deletePaperLayout(document: KDrawDocumentV1, layoutId: string): LayoutEditResult {
  const layouts = structuredClone(document.layouts);
  const index = layouts.findIndex((layout) => layout.id === layoutId);
  const layout = layouts[index];
  if (!layout) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layout.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model layout cannot be deleted.");
  if (layouts.filter((candidate) => candidate.kind === "paper").length <= 1) {
    throw new LayoutCommandError("LAST_PAPER_LAYOUT", "At least one paper layout must remain.");
  }
  layouts.splice(index, 1);
  const adjacent = layouts[Math.min(index, layouts.length - 1)] ?? layouts[0]!;
  return result(layouts, adjacent.id);
}
