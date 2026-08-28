import type { CadEntity, CadLayout, CadViewport, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { allocateEntityHandles } from "./commands.js";

export const MAX_PAPER_LAYOUTS = 255;
export const MAX_LAYOUT_NAME_LENGTH = 255;

export type LayoutCommandErrorCode =
  | "DUPLICATE_NAME"
  | "INVALID_NAME"
  | "LAYOUT_LIMIT"
  | "MISSING_LAYOUT"
  | "MODEL_LAYOUT_PROTECTED"
  | "LAST_PAPER_LAYOUT"
  | "ORDER_LIMIT";

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
    for (const viewport of layout.viewports) {
      if (!viewport.id || viewports.has(viewport.id)) throw new LayoutCommandError("MISSING_LAYOUT", `Duplicate or empty viewport id: ${viewport.id}`);
      viewports.add(viewport.id);
    }
  }
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
    paper: structuredClone(options.paper ?? {
      widthMm: 297,
      heightMm: 210,
      marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    }),
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
