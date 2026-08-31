import type { CadEntity, CadLayout, CadPageSetup, CadPoint2, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateEntityHandles } from "./commands.js";
import { DEFAULT_PLOT_STYLE, resolvePlotStyle } from "./plot-style.js";

export const MAX_PAPER_LAYOUTS = 255;
export const MAX_LAYOUT_NAME_LENGTH = 255;
export const DEFAULT_PAPER_DEFINITION = Object.freeze({
  widthMm: 297,
  heightMm: 210,
  marginsMm: Object.freeze({ top: 10, right: 10, bottom: 10, left: 10 }),
});
export const ISO_PAPER_MEDIA = Object.freeze([
  { mediaName: "ISO_A4", portraitWidthMm: 210, portraitHeightMm: 297 },
  { mediaName: "ISO_A3", portraitWidthMm: 297, portraitHeightMm: 420 },
  { mediaName: "ISO_A2", portraitWidthMm: 420, portraitHeightMm: 594 },
  { mediaName: "ISO_A1", portraitWidthMm: 594, portraitHeightMm: 841 },
  { mediaName: "ISO_A0", portraitWidthMm: 841, portraitHeightMm: 1189 },
]);
export const DEFAULT_PAGE_SETUP: Readonly<CadPageSetup> = Object.freeze({
  mediaName: "ISO_A4",
  orientation: "landscape",
  plotArea: Object.freeze({ kind: "layout" }),
  plotScale: Object.freeze({ mode: "custom", paperUnits: 1, drawingUnits: 1 }),
  centerPlot: false,
  plotOriginMm: Object.freeze({ x: 0, y: 0 }),
  plotStyle: DEFAULT_PLOT_STYLE,
  displayPlotStyles: false,
});

export const DEFAULT_MODEL_PAGE_SETUP: Readonly<CadPageSetup> = Object.freeze({
  mediaName: "ISO_A4",
  orientation: "portrait",
  plotArea: Object.freeze({ kind: "extents" }),
  plotScale: Object.freeze({ mode: "custom", paperUnits: 1, drawingUnits: 50 }),
  centerPlot: true,
  plotOriginMm: Object.freeze({ x: 0, y: 0 }),
  plotStyle: DEFAULT_PLOT_STYLE,
  displayPlotStyles: false,
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
  | "VIEWPORT_LOCKED"
  | "INVALID_LAYOUT_WORKSPACE"
  | "INVALID_PAPER_WORKSPACE";

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

export interface ViewportLockResult extends Omit<LayoutEditResult, "changes"> {
  changes: [] | [LayoutSetChange];
  viewportId: string;
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

function closeNumber(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function paperDefinitionForPageSetup(
  setup: Pick<CadPageSetup, "mediaName" | "orientation">,
  marginsMm: NonNullable<CadLayout["paper"]>["marginsMm"] = DEFAULT_PAPER_DEFINITION.marginsMm,
): NonNullable<CadLayout["paper"]> {
  const media = ISO_PAPER_MEDIA.find((candidate) => candidate.mediaName === setup.mediaName);
  if (!media) throw new LayoutCommandError("INVALID_PAPER", `Unsupported paper media: ${setup.mediaName}`);
  const portrait = setup.orientation === "portrait";
  const paper = {
    widthMm: portrait ? media.portraitWidthMm : media.portraitHeightMm,
    heightMm: portrait ? media.portraitHeightMm : media.portraitWidthMm,
    marginsMm: structuredClone(marginsMm),
  };
  resolvePaperDefinition({ id: "page-setup-paper", name: "Page setup paper", kind: "paper", paper, viewports: [] });
  return paper;
}

function inferredPageSetup(layout: CadLayout): CadPageSetup {
  const paper = resolvePaperDefinition(layout)!;
  const media = ISO_PAPER_MEDIA.find((candidate) =>
    closeNumber(Math.min(paper.widthMm, paper.heightMm), candidate.portraitWidthMm) &&
    closeNumber(Math.max(paper.widthMm, paper.heightMm), candidate.portraitHeightMm));
  return {
    ...structuredClone(DEFAULT_PAGE_SETUP),
    mediaName: media?.mediaName ?? "CUSTOM",
    orientation: paper.widthMm > paper.heightMm ? "landscape" : "portrait",
  };
}

export function resolvePageSetup(layout: CadLayout): CadPageSetup | null {
  if (layout.kind !== "paper") return null;
  const paper = resolvePaperDefinition(layout)!;
  const setup = structuredClone(layout.pageSetup ?? inferredPageSetup(layout));
  validatePageSetup(setup, true);
  const knownMedia = ISO_PAPER_MEDIA.find((candidate) => candidate.mediaName === setup.mediaName);
  if (knownMedia) {
    const expectedWidth = setup.orientation === "portrait" ? knownMedia.portraitWidthMm : knownMedia.portraitHeightMm;
    const expectedHeight = setup.orientation === "portrait" ? knownMedia.portraitHeightMm : knownMedia.portraitWidthMm;
    if (!closeNumber(paper.widthMm, expectedWidth) || !closeNumber(paper.heightMm, expectedHeight)) {
      throw new LayoutCommandError("INVALID_PAPER", "Page setup media/orientation and paper dimensions disagree.");
    }
  }
  return setup;
}

function validatePageSetup(setup: CadPageSetup, allowLayout: boolean): void {
  setup.plotStyle = resolvePlotStyle(setup.plotStyle);
  setup.displayPlotStyles = setup.displayPlotStyles === true;
  if (setup.mediaName.trim().length === 0 || (setup.orientation !== "portrait" && setup.orientation !== "landscape")) {
    throw new LayoutCommandError("INVALID_PAPER", "Page setup media and orientation are required.");
  }
  if (!allowLayout && !ISO_PAPER_MEDIA.some((candidate) => candidate.mediaName === setup.mediaName)) {
    throw new LayoutCommandError("INVALID_PAPER", `Unsupported paper media: ${setup.mediaName}`);
  }
  if (!Number.isFinite(setup.plotOriginMm.x) || !Number.isFinite(setup.plotOriginMm.y)) {
    throw new LayoutCommandError("INVALID_PAPER", "Plot origin must contain finite millimeter coordinates.");
  }
  if (setup.plotArea.kind === "window") {
    const window = setup.plotArea.window;
    const values = [window.x, window.y, window.width, window.height];
    if (values.some((value) => !Number.isFinite(value)) || window.width <= 0 || window.height <= 0) {
      throw new LayoutCommandError("INVALID_PAPER", "Window plot area must be a finite rectangle with positive dimensions.");
    }
  }
  if (setup.plotScale.mode === "custom" && (
    !Number.isFinite(setup.plotScale.paperUnits) || setup.plotScale.paperUnits <= 0 ||
    !Number.isFinite(setup.plotScale.drawingUnits) || setup.plotScale.drawingUnits <= 0
  )) throw new LayoutCommandError("INVALID_PAPER", "Custom plot scale units must be finite and positive.");
  if (!allowLayout && setup.plotArea.kind === "layout") {
    throw new LayoutCommandError("INVALID_PAPER", "Model-space plot area must be Extents, Window or Display.");
  }
  if (setup.plotArea.kind === "layout" && (
    setup.centerPlot || setup.plotScale.mode !== "custom" ||
    !closeNumber(setup.plotScale.paperUnits, setup.plotScale.drawingUnits) ||
    !closeNumber(setup.plotOriginMm.x, 0) || !closeNumber(setup.plotOriginMm.y, 0)
  )) throw new LayoutCommandError("INVALID_PAPER", "Layout plot area uses fixed 1:1 scale, origin 0,0 and cannot be centered.");
}

export function resolveModelPageSetup(layout: CadLayout): CadPageSetup | null {
  if (layout.kind !== "model") return null;
  const setup = structuredClone(layout.pageSetup ?? DEFAULT_MODEL_PAGE_SETUP);
  validatePageSetup(setup, false);
  return setup;
}

export function plotScaleDenominator(setup: CadPageSetup): number | null {
  if (setup.plotScale.mode === "fit") return null;
  const denominator = setup.plotScale.drawingUnits / setup.plotScale.paperUnits;
  if (!Number.isFinite(denominator) || denominator <= 0) throw new LayoutCommandError("INVALID_PAPER", "Plot scale denominator must be finite and positive.");
  return denominator;
}

export function setPaperLayoutPageSetup(document: KDrawDocumentV1, layoutId: string, requested: CadPageSetup): LayoutEditResult {
  const layoutIndex = paperLayoutIndex(document, layoutId);
  const layouts = structuredClone(document.layouts);
  const layout = layouts[layoutIndex]!;
  const sourcePaper = resolvePaperDefinition(layout)!;
  const setup: CadPageSetup = structuredClone(requested);
  if (setup.plotArea.kind === "layout") {
    setup.centerPlot = false;
    setup.plotScale = { mode: "custom", paperUnits: 1, drawingUnits: 1 };
    setup.plotOriginMm = { x: 0, y: 0 };
  }
  const destinationPaper = paperDefinitionForPageSetup(setup, sourcePaper.marginsMm);
  layout.paper = destinationPaper;
  layout.pageSetup = setup;
  // AutoCAD 2024 keeps existing paper-space viewport coordinates unchanged
  // when PAGESETUP changes media or orientation. The sheet can become smaller
  // than a viewport; that is observable and is not silently repaired here.
  resolvePageSetup(layout);
  return result(layouts, layoutId);
}

export function setModelLayoutPageSetup(document: KDrawDocumentV1, layoutId: string, requested: CadPageSetup): LayoutEditResult {
  const layouts = structuredClone(document.layouts);
  const layout = layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layout.kind !== "model") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model page setup requires the Model layout.");
  const setup = structuredClone(requested);
  validatePageSetup(setup, false);
  layout.pageSetup = setup;
  return result(layouts, layoutId);
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
  if (typeof viewport.locked !== "boolean") {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport display-lock state must be boolean.");
  }
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
    resolvePageSetup(layout);
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

export function setPaperViewportDisplayLocked(
  document: KDrawDocumentV1,
  layoutId: string,
  viewportId: string,
  locked: boolean,
): ViewportLockResult {
  const source = paperViewport(document, layoutId, viewportId);
  if (typeof locked !== "boolean") {
    throw new LayoutCommandError("INVALID_VIEWPORT", "Viewport display-lock state must be boolean.");
  }
  if (source.locked === locked) {
    return { changes: [], layoutId, viewportId, layouts: structuredClone(document.layouts) };
  }
  const layouts = structuredClone(document.layouts);
  const layout = layouts[paperLayoutIndex(document, layoutId)]!;
  const viewport = layout.viewports.find((candidate) => candidate.id === viewportId)!;
  viewport.locked = locked;
  assertViewportGeometry(viewport);
  const edited = result(layouts, layoutId);
  return { ...edited, viewportId };
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
  options: { name?: string; paper?: CadLayout["paper"]; pageSetup?: CadPageSetup; viewports?: CadViewport[]; entities?: CadEntity[] } = {},
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
    paper: structuredClone(options.pageSetup ? paperDefinitionForPageSetup(options.pageSetup, options.paper?.marginsMm) : options.paper ?? DEFAULT_PAPER_DEFINITION),
    pageSetup: structuredClone(options.pageSetup ?? (options.paper ? inferredPageSetup({ id: layoutId, name, kind: "paper", paper: options.paper, viewports: [] }) : DEFAULT_PAGE_SETUP)),
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

export const LAYOUT_WORKSPACE_EXTENSION_KEY = "kuubik.layoutWorkspace.v1" as const;

export interface LayoutWorkspaceStateV1 {
  schemaVersion: 1;
  activeLayoutId: string;
  activeSpace: "model" | "paper";
  tabOrder: string[];
  nextLayoutSequence: number;
  nextViewportSequence: number;
}

export type LayoutWorkspaceRepairCode =
  | "MISSING_PAPER_LAYOUT"
  | "MISSING_WORKSPACE_STATE"
  | "INVALID_WORKSPACE_STATE"
  | "INVALID_ACTIVE_LAYOUT"
  | "INVALID_ACTIVE_SPACE"
  | "INVALID_TAB_ORDER"
  | "INVALID_SEQUENCE";

export type LayoutWorkspaceChange =
  | LayoutSetChange
  | { type: "set-metadata"; metadata: KDrawDocumentV1["metadata"] };

export interface LayoutWorkspaceEditResult {
  changes: LayoutWorkspaceChange[];
  layoutId: string;
  layouts: CadLayout[];
  workspace: LayoutWorkspaceStateV1;
}

export interface LayoutWorkspaceMigrationResult extends LayoutWorkspaceEditResult {
  document: KDrawDocumentV1;
  migrated: boolean;
  repairs: LayoutWorkspaceRepairCode[];
}

const WORKSPACE_KEYS = [
  "activeLayoutId",
  "activeSpace",
  "nextLayoutSequence",
  "nextViewportSequence",
  "schemaVersion",
  "tabOrder",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactWorkspaceKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === WORKSPACE_KEYS.length && keys.every((key, index) => key === WORKSPACE_KEYS[index]);
}

function numericSuffixMaximum(ids: readonly string[], prefix: string): number {
  let maximum = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "u");
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum;
}

function derivedSequences(layouts: readonly CadLayout[]): Pick<LayoutWorkspaceStateV1, "nextLayoutSequence" | "nextViewportSequence"> {
  return {
    nextLayoutSequence: numericSuffixMaximum(layouts.map((layout) => layout.id), "layout") + 1,
    nextViewportSequence: numericSuffixMaximum(layouts.flatMap((layout) => layout.viewports.map((viewport) => viewport.id)), "viewport") + 1,
  };
}

function exactTabOrder(layouts: readonly CadLayout[], candidate: unknown): candidate is string[] {
  if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== "string")) return false;
  const expected = layouts.map((layout) => layout.id);
  return candidate.length === expected.length
    && new Set(candidate).size === expected.length
    && expected.every((layoutId) => candidate.includes(layoutId));
}

function tabOrderMatchesLayouts(layouts: readonly CadLayout[], candidate: unknown): candidate is string[] {
  return exactTabOrder(layouts, candidate)
    && layouts.every((layout, index) => candidate[index] === layout.id);
}

function workspaceMetadata(document: KDrawDocumentV1, workspace: LayoutWorkspaceStateV1): KDrawDocumentV1["metadata"] {
  return {
    ...structuredClone(document.metadata),
    extensions: {
      ...structuredClone(document.metadata.extensions ?? {}),
      [LAYOUT_WORKSPACE_EXTENSION_KEY]: structuredClone(workspace),
    },
  };
}

function strictWorkspaceState(document: KDrawDocumentV1): LayoutWorkspaceStateV1 {
  assertLayoutCollection(document.layouts);
  if (!document.layouts.some((layout) => layout.kind === "paper")) {
    throw new LayoutCommandError("INVALID_LAYOUT_WORKSPACE", "At least one paper layout must remain in the document workspace.");
  }
  const raw = document.metadata.extensions?.[LAYOUT_WORKSPACE_EXTENSION_KEY];
  if (!isRecord(raw) || !exactWorkspaceKeys(raw) || raw.schemaVersion !== 1
    || typeof raw.activeLayoutId !== "string"
    || (raw.activeSpace !== "model" && raw.activeSpace !== "paper")
    || !Number.isSafeInteger(raw.nextLayoutSequence) || (raw.nextLayoutSequence as number) < 1
    || !Number.isSafeInteger(raw.nextViewportSequence) || (raw.nextViewportSequence as number) < 1
    || !tabOrderMatchesLayouts(document.layouts, raw.tabOrder)) {
    throw new LayoutCommandError("INVALID_LAYOUT_WORKSPACE", "Document layout workspace state is missing or malformed.");
  }
  const active = document.layouts.find((layout) => layout.id === raw.activeLayoutId);
  if (!active || active.kind !== raw.activeSpace) {
    throw new LayoutCommandError("INVALID_LAYOUT_WORKSPACE", "Document active layout and active space do not match.");
  }
  const derived = derivedSequences(document.layouts);
  if ((raw.nextLayoutSequence as number) < derived.nextLayoutSequence
    || (raw.nextViewportSequence as number) < derived.nextViewportSequence) {
    throw new LayoutCommandError("INVALID_LAYOUT_WORKSPACE", "Document layout workspace id sequence would reuse an issued id.");
  }
  return structuredClone(raw) as unknown as LayoutWorkspaceStateV1;
}

export function readLayoutWorkspace(document: KDrawDocumentV1): LayoutWorkspaceStateV1 {
  return strictWorkspaceState(document);
}

function workspaceResult(
  document: KDrawDocumentV1,
  layouts: CadLayout[],
  activeLayoutId: string,
  sequences: Pick<LayoutWorkspaceStateV1, "nextLayoutSequence" | "nextViewportSequence">,
  includeLayouts: boolean,
): LayoutWorkspaceEditResult {
  assertLayoutCollection(layouts);
  if (!layouts.some((layout) => layout.kind === "paper")) {
    throw new LayoutCommandError("LAST_PAPER_LAYOUT", "At least one paper layout must remain.");
  }
  const active = layouts.find((layout) => layout.id === activeLayoutId);
  if (!active) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${activeLayoutId}`);
  const derived = derivedSequences(layouts);
  const workspace: LayoutWorkspaceStateV1 = {
    schemaVersion: 1,
    activeLayoutId,
    activeSpace: active.kind,
    tabOrder: layouts.map((layout) => layout.id),
    nextLayoutSequence: Math.max(sequences.nextLayoutSequence, derived.nextLayoutSequence),
    nextViewportSequence: Math.max(sequences.nextViewportSequence, derived.nextViewportSequence),
  };
  const metadata = synchronizePaperWorkspaceMetadata(
    { ...structuredClone(document), layouts: structuredClone(layouts) },
    workspaceMetadata(document, workspace),
  );
  return {
    changes: [
      ...(includeLayouts ? [{ type: "set-layouts" as const, layouts: structuredClone(layouts) }] : []),
      { type: "set-metadata", metadata },
    ],
    layoutId: activeLayoutId,
    layouts: structuredClone(layouts),
    workspace,
  };
}

export function migrateLayoutWorkspace(document: KDrawDocumentV1): LayoutWorkspaceMigrationResult {
  assertLayoutCollection(document.layouts);
  const repairs: LayoutWorkspaceRepairCode[] = [];
  let layouts = structuredClone(document.layouts);
  if (!layouts.some((layout) => layout.kind === "paper")) {
    const created = createPaperLayout({ ...structuredClone(document), layouts }, { name: "Layout 1" });
    layouts = created.layouts;
    repairs.push("MISSING_PAPER_LAYOUT");
  }
  const raw = document.metadata.extensions?.[LAYOUT_WORKSPACE_EXTENSION_KEY];
  const validShape = isRecord(raw) && exactWorkspaceKeys(raw) && raw.schemaVersion === 1
    && typeof raw.activeLayoutId === "string"
    && (raw.activeSpace === "model" || raw.activeSpace === "paper")
    && Array.isArray(raw.tabOrder)
    && Number.isSafeInteger(raw.nextLayoutSequence)
    && Number.isSafeInteger(raw.nextViewportSequence);
  if (raw === undefined) repairs.push("MISSING_WORKSPACE_STATE");
  else if (!validShape) repairs.push("INVALID_WORKSPACE_STATE");
  const modelId = layouts.find((layout) => layout.kind === "model")!.id;
  const activeCandidate = validShape ? layouts.find((layout) => layout.id === raw.activeLayoutId) : undefined;
  if (validShape && !activeCandidate) repairs.push("INVALID_ACTIVE_LAYOUT");
  const activeLayoutId = activeCandidate?.id ?? modelId;
  if (validShape && activeCandidate && activeCandidate.kind !== raw.activeSpace) repairs.push("INVALID_ACTIVE_SPACE");
  const tabOrder = validShape && tabOrderMatchesLayouts(layouts, raw.tabOrder)
    ? [...raw.tabOrder]
    : layouts.map((layout) => layout.id);
  if (validShape && !tabOrderMatchesLayouts(layouts, raw.tabOrder)) repairs.push("INVALID_TAB_ORDER");
  const derived = derivedSequences(layouts);
  const validSequences = validShape
    && (raw.nextLayoutSequence as number) >= derived.nextLayoutSequence
    && (raw.nextViewportSequence as number) >= derived.nextViewportSequence;
  if (validShape && !validSequences) repairs.push("INVALID_SEQUENCE");
  const workspace: LayoutWorkspaceStateV1 = {
    schemaVersion: 1,
    activeLayoutId,
    activeSpace: layouts.find((layout) => layout.id === activeLayoutId)!.kind,
    tabOrder,
    nextLayoutSequence: validSequences ? raw.nextLayoutSequence as number : derived.nextLayoutSequence,
    nextViewportSequence: validSequences ? raw.nextViewportSequence as number : derived.nextViewportSequence,
  };
  const metadata = workspaceMetadata(document, workspace);
  const layoutsChanged = JSON.stringify(layouts) !== JSON.stringify(document.layouts);
  const metadataChanged = JSON.stringify(metadata) !== JSON.stringify(document.metadata);
  const changes: LayoutWorkspaceChange[] = [
    ...(layoutsChanged ? [{ type: "set-layouts" as const, layouts: structuredClone(layouts) }] : []),
    ...(metadataChanged ? [{ type: "set-metadata" as const, metadata }] : []),
  ];
  return {
    changes,
    layoutId: activeLayoutId,
    layouts: structuredClone(layouts),
    workspace,
    document: { ...structuredClone(document), layouts: structuredClone(layouts), metadata },
    migrated: changes.length > 0,
    repairs,
  };
}

function allocateWorkspaceId(prefix: "layout" | "viewport", used: ReadonlySet<string>, sequence: number): { id: string; next: number } {
  let next = sequence;
  while (used.has(`${prefix}-${next}`)) next += 1;
  return { id: `${prefix}-${next}`, next: next + 1 };
}

function rekeyNewLayout(
  layouts: CadLayout[],
  temporaryLayoutId: string,
  workspace: LayoutWorkspaceStateV1,
): { layouts: CadLayout[]; layoutId: string; sequences: Pick<LayoutWorkspaceStateV1, "nextLayoutSequence" | "nextViewportSequence"> } {
  const nextLayouts = structuredClone(layouts);
  const layout = nextLayouts.find((candidate) => candidate.id === temporaryLayoutId)!;
  const allocatedLayout = allocateWorkspaceId("layout", new Set(nextLayouts.filter((candidate) => candidate !== layout).map((candidate) => candidate.id)), workspace.nextLayoutSequence);
  layout.id = allocatedLayout.id;
  let nextViewportSequence = workspace.nextViewportSequence;
  const usedViewportIds = new Set(nextLayouts.filter((candidate) => candidate !== layout).flatMap((candidate) => candidate.viewports.map((viewport) => viewport.id)));
  for (const viewport of layout.viewports) {
    const allocatedViewport = allocateWorkspaceId("viewport", usedViewportIds, nextViewportSequence);
    viewport.id = allocatedViewport.id;
    usedViewportIds.add(allocatedViewport.id);
    nextViewportSequence = allocatedViewport.next;
  }
  return {
    layouts: nextLayouts,
    layoutId: allocatedLayout.id,
    sequences: { nextLayoutSequence: allocatedLayout.next, nextViewportSequence },
  };
}

const NAMED_PAGE_SETUP_LIBRARY_EXTENSION_KEY = "kuubikDraw.pageSetupLibrary.v1";

function documentWithNamedPageSetupAssignment(
  document: KDrawDocumentV1,
  sourceLayoutId: string | null,
  targetLayoutId: string,
): KDrawDocumentV1 {
  const candidate = structuredClone(document);
  const rawLibrary = candidate.metadata.extensions?.[NAMED_PAGE_SETUP_LIBRARY_EXTENSION_KEY];
  if (!isRecord(rawLibrary) || !isRecord(rawLibrary.assignments)) return candidate;
  const assignments = structuredClone(rawLibrary.assignments);
  if (sourceLayoutId === null) {
    delete assignments[targetLayoutId];
  } else {
    const setupId = assignments[sourceLayoutId];
    if (typeof setupId === "string") assignments[targetLayoutId] = setupId;
  }
  rawLibrary.assignments = assignments;
  return candidate;
}

export function activateLayoutWorkspace(document: KDrawDocumentV1, layoutId: string): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  if (workspace.activeLayoutId === layoutId) {
    return { changes: [], layoutId, layouts: structuredClone(document.layouts), workspace };
  }
  return workspaceResult(document, structuredClone(document.layouts), layoutId, workspace, false);
}

export function createPaperLayoutWorkspace(
  document: KDrawDocumentV1,
  options: Parameters<typeof createPaperLayout>[1] = {},
): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  const created = createPaperLayout(document, options);
  const rekeyed = rekeyNewLayout(created.layouts, created.layoutId, workspace);
  return workspaceResult(document, rekeyed.layouts, rekeyed.layoutId, rekeyed.sequences, true);
}

export function copyPaperLayoutWorkspace(document: KDrawDocumentV1, layoutId: string): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  const copied = copyPaperLayout(document, layoutId);
  const rekeyed = rekeyNewLayout(copied.layouts, copied.layoutId, workspace);
  const source = documentWithNamedPageSetupAssignment(document, layoutId, rekeyed.layoutId);
  return workspaceResult(source, rekeyed.layouts, rekeyed.layoutId, rekeyed.sequences, true);
}

export function renamePaperLayoutWorkspace(document: KDrawDocumentV1, layoutId: string, name: string): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  const renamed = renamePaperLayout(document, layoutId, name);
  return workspaceResult(document, renamed.layouts, workspace.activeLayoutId, workspace, true);
}

export function deletePaperLayoutWorkspace(document: KDrawDocumentV1, layoutId: string): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  const deleted = deletePaperLayout(document, layoutId);
  const activeLayoutId = workspace.activeLayoutId === layoutId ? deleted.layoutId : workspace.activeLayoutId;
  const source = documentWithNamedPageSetupAssignment(document, null, layoutId);
  return workspaceResult(source, deleted.layouts, activeLayoutId, workspace, true);
}

export function reorderPaperLayoutWorkspace(document: KDrawDocumentV1, layoutId: string, targetTabIndex: number): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  if (!Number.isSafeInteger(targetTabIndex) || targetTabIndex < 1 || targetTabIndex >= document.layouts.length) {
    throw new LayoutCommandError("ORDER_LIMIT", "Paper layout target tab index is outside the paper-layout range.");
  }
  const layouts = structuredClone(document.layouts);
  const sourceIndex = layouts.findIndex((layout) => layout.id === layoutId);
  if (sourceIndex < 0) throw new LayoutCommandError("MISSING_LAYOUT", `Layout not found: ${layoutId}`);
  if (layouts[sourceIndex]!.kind !== "paper") throw new LayoutCommandError("MODEL_LAYOUT_PROTECTED", "Model layout cannot be reordered.");
  if (sourceIndex === targetTabIndex) return { changes: [], layoutId: workspace.activeLayoutId, layouts, workspace };
  const [layout] = layouts.splice(sourceIndex, 1);
  layouts.splice(targetTabIndex, 0, layout!);
  return workspaceResult(document, layouts, workspace.activeLayoutId, workspace, true);
}

export const PAPER_WORKSPACE_EXTENSION_KEY = "kuubik.paperWorkspace.v1" as const;

export interface PaperWorkspaceViewportRefV1 {
  layoutId: string;
  viewportId: string;
}

export interface PaperWorkspaceLayoutStateV1 {
  layoutId: string;
  boundaryMm: { x: 0; y: 0; width: number; height: number };
  printableAreaMm: { x: number; y: number; width: number; height: number };
  mediaName: string;
  orientation: "portrait" | "landscape";
  plotOriginMm: CadPoint2;
  pageSetupId: string | null;
  viewportRefs: PaperWorkspaceViewportRefV1[];
}

export interface PaperWorkspaceStateV1 {
  schemaVersion: 1;
  paperUnits: "mm";
  activeLayoutId: string;
  activeSpace: "model" | "paper";
  papers: PaperWorkspaceLayoutStateV1[];
}

export type PaperWorkspaceRepairCode =
  | "MISSING_PAPER_WORKSPACE_STATE"
  | "INVALID_PAPER_WORKSPACE_STATE"
  | "INVALID_ACTIVE_PAPER_CONTEXT"
  | "INVALID_PAPER_LAYOUT_REFERENCE"
  | "INVALID_PAPER_BOUNDARY"
  | "INVALID_PRINTABLE_AREA"
  | "INVALID_PAPER_ORIGIN"
  | "INVALID_PAPER_ORIENTATION"
  | "INVALID_PAPER_UNITS"
  | "INVALID_PAGE_SETUP_REFERENCE"
  | "INVALID_VIEWPORT_REFERENCE";

export interface PaperWorkspaceReceiptV1 {
  schemaVersion: 1;
  code: "PAPER_WORKSPACE_CURRENT" | "PAPER_WORKSPACE_MIGRATED" | "PAPER_WORKSPACE_REPAIRED";
  repairs: PaperWorkspaceRepairCode[];
  summaryEt: string;
}

export interface PaperWorkspaceMigrationResult {
  changes: Array<{ type: "set-metadata"; metadata: KDrawDocumentV1["metadata"] }>;
  document: KDrawDocumentV1;
  state: PaperWorkspaceStateV1;
  receipt: PaperWorkspaceReceiptV1;
  migrated: boolean;
  repairs: PaperWorkspaceRepairCode[];
}

function workspaceSemanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => workspaceSemanticEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && workspaceSemanticEqual(left[key], right[key]));
}

function paperWorkspacePageSetupAssignments(document: KDrawDocumentV1): Record<string, string> {
  const raw = document.metadata.extensions?.[NAMED_PAGE_SETUP_LIBRARY_EXTENSION_KEY];
  if (raw === undefined) return {};
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.setups) || !isRecord(raw.assignments)) {
    throw new LayoutCommandError("INVALID_PAPER_WORKSPACE", "Stored named page-setup library is invalid for paper workspace read-back.");
  }
  const setupIds = new Set(raw.setups.map((entry) => isRecord(entry) && typeof entry.id === "string" ? entry.id : null).filter((id): id is string => id !== null));
  const layoutIds = new Set(document.layouts.map((layout) => layout.id));
  const assignments: Record<string, string> = {};
  for (const [layoutId, setupId] of Object.entries(raw.assignments)) {
    if (typeof setupId !== "string" || !layoutIds.has(layoutId) || !setupIds.has(setupId)) {
      throw new LayoutCommandError("INVALID_PAPER_WORKSPACE", `Named page-setup reference is dangling: ${layoutId} -> ${String(setupId)}.`);
    }
    assignments[layoutId] = setupId;
  }
  return assignments;
}

function derivePaperWorkspaceState(document: KDrawDocumentV1): PaperWorkspaceStateV1 {
  const layoutWorkspace = strictWorkspaceState(document);
  const assignments = paperWorkspacePageSetupAssignments(document);
  const papers = document.layouts.filter((layout) => layout.kind === "paper").map((layout): PaperWorkspaceLayoutStateV1 => {
    const paper = resolvePaperDefinition(layout)!;
    const setup = resolvePageSetup(layout)!;
    return {
      layoutId: layout.id,
      boundaryMm: { x: 0, y: 0, width: paper.widthMm, height: paper.heightMm },
      printableAreaMm: {
        x: paper.marginsMm.left,
        y: paper.marginsMm.bottom,
        width: paper.widthMm - paper.marginsMm.left - paper.marginsMm.right,
        height: paper.heightMm - paper.marginsMm.top - paper.marginsMm.bottom,
      },
      mediaName: setup.mediaName,
      orientation: setup.orientation,
      plotOriginMm: structuredClone(setup.plotOriginMm),
      pageSetupId: assignments[layout.id] ?? null,
      viewportRefs: layout.viewports.map((viewport) => ({ layoutId: layout.id, viewportId: viewport.id })),
    };
  });
  return {
    schemaVersion: 1,
    paperUnits: "mm",
    activeLayoutId: layoutWorkspace.activeLayoutId,
    activeSpace: layoutWorkspace.activeSpace,
    papers,
  };
}

function paperWorkspaceMetadata(document: KDrawDocumentV1, state: PaperWorkspaceStateV1): KDrawDocumentV1["metadata"] {
  return {
    ...structuredClone(document.metadata),
    extensions: {
      ...structuredClone(document.metadata.extensions ?? {}),
      [PAPER_WORKSPACE_EXTENSION_KEY]: structuredClone(state),
    },
  };
}

function synchronizePaperWorkspaceMetadata(
  document: KDrawDocumentV1,
  metadata: KDrawDocumentV1["metadata"],
): KDrawDocumentV1["metadata"] {
  if (metadata.extensions?.[PAPER_WORKSPACE_EXTENSION_KEY] === undefined) return metadata;
  const candidate = { ...structuredClone(document), metadata: structuredClone(metadata) };
  return paperWorkspaceMetadata(candidate, derivePaperWorkspaceState(candidate));
}

function paperRepairReceipt(repairs: PaperWorkspaceRepairCode[], migrated: boolean): PaperWorkspaceReceiptV1 {
  const code = !migrated
    ? "PAPER_WORKSPACE_CURRENT"
    : repairs.length === 1 && repairs[0] === "MISSING_PAPER_WORKSPACE_STATE"
      ? "PAPER_WORKSPACE_MIGRATED"
      : "PAPER_WORKSPACE_REPAIRED";
  const summaryEt = code === "PAPER_WORKSPACE_CURRENT"
    ? "Paberiruumi dokumendiolek on kehtiv."
    : code === "PAPER_WORKSPACE_MIGRATED"
      ? "Paberiruumi päranddokument migreeriti deterministlikult."
      : `Paberiruumi vigased viited taastati deterministlikult: ${repairs.join(", ")}.`;
  return { schemaVersion: 1, code, repairs: [...repairs], summaryEt };
}

function rawPaperByLayout(raw: Record<string, unknown>, layoutId: string): Record<string, unknown> | null {
  if (!Array.isArray(raw.papers)) return null;
  const match = raw.papers.find((entry) => isRecord(entry) && entry.layoutId === layoutId);
  return isRecord(match) ? match : null;
}

function paperWorkspaceRepairs(raw: unknown, expected: PaperWorkspaceStateV1): PaperWorkspaceRepairCode[] {
  if (raw === undefined) return ["MISSING_PAPER_WORKSPACE_STATE"];
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.papers)) return ["INVALID_PAPER_WORKSPACE_STATE"];
  const repairs: PaperWorkspaceRepairCode[] = [];
  if (raw.paperUnits !== expected.paperUnits) repairs.push("INVALID_PAPER_UNITS");
  if (raw.activeLayoutId !== expected.activeLayoutId || raw.activeSpace !== expected.activeSpace) repairs.push("INVALID_ACTIVE_PAPER_CONTEXT");
  const rawLayoutIds = raw.papers.map((entry) => isRecord(entry) && typeof entry.layoutId === "string" ? entry.layoutId : null);
  if (rawLayoutIds.length !== expected.papers.length
    || rawLayoutIds.some((layoutId, index) => layoutId !== expected.papers[index]!.layoutId)) {
    repairs.push("INVALID_PAPER_LAYOUT_REFERENCE");
  }
  for (const expectedPaper of expected.papers) {
    const candidate = rawPaperByLayout(raw, expectedPaper.layoutId);
    if (!candidate) continue;
    if (!workspaceSemanticEqual(candidate.boundaryMm, expectedPaper.boundaryMm)) repairs.push("INVALID_PAPER_BOUNDARY");
    if (!workspaceSemanticEqual(candidate.printableAreaMm, expectedPaper.printableAreaMm)) repairs.push("INVALID_PRINTABLE_AREA");
    if (!workspaceSemanticEqual(candidate.plotOriginMm, expectedPaper.plotOriginMm)) repairs.push("INVALID_PAPER_ORIGIN");
    if (candidate.orientation !== expectedPaper.orientation || candidate.mediaName !== expectedPaper.mediaName) repairs.push("INVALID_PAPER_ORIENTATION");
    if (candidate.pageSetupId !== expectedPaper.pageSetupId) repairs.push("INVALID_PAGE_SETUP_REFERENCE");
    if (!workspaceSemanticEqual(candidate.viewportRefs, expectedPaper.viewportRefs)) repairs.push("INVALID_VIEWPORT_REFERENCE");
  }
  if (!workspaceSemanticEqual(raw, expected) && repairs.length === 0) repairs.push("INVALID_PAPER_WORKSPACE_STATE");
  return [...new Set(repairs)];
}

export function readPaperWorkspace(document: KDrawDocumentV1): PaperWorkspaceStateV1 {
  const expected = derivePaperWorkspaceState(document);
  const raw = document.metadata.extensions?.[PAPER_WORKSPACE_EXTENSION_KEY];
  if (!workspaceSemanticEqual(raw, expected)) {
    throw new LayoutCommandError("INVALID_PAPER_WORKSPACE", "Document paper workspace state is missing, stale or malformed.");
  }
  return structuredClone(expected);
}

export function migratePaperWorkspace(document: KDrawDocumentV1): PaperWorkspaceMigrationResult {
  const state = derivePaperWorkspaceState(document);
  const raw = document.metadata.extensions?.[PAPER_WORKSPACE_EXTENSION_KEY];
  const repairs = paperWorkspaceRepairs(raw, state);
  const metadata = paperWorkspaceMetadata(document, state);
  const migrated = !workspaceSemanticEqual(metadata, document.metadata);
  const changes: PaperWorkspaceMigrationResult["changes"] = migrated ? [{ type: "set-metadata", metadata }] : [];
  return {
    changes,
    document: { ...structuredClone(document), metadata },
    state,
    receipt: paperRepairReceipt(repairs, migrated),
    migrated,
    repairs,
  };
}

export function setPaperWorkspacePageSetup(
  document: KDrawDocumentV1,
  layoutId: string,
  requested: CadPageSetup,
): LayoutWorkspaceEditResult {
  const workspace = strictWorkspaceState(document);
  readPaperWorkspace(document);
  const edited = setPaperLayoutPageSetup(document, layoutId, requested);
  return workspaceResult(document, edited.layouts, workspace.activeLayoutId, workspace, true);
}
