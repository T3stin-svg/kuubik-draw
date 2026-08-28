import type {
  CadLayout,
  CadPageSetup,
  CadViewport,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import {
  MAX_PAPER_LAYOUTS,
  assertLayoutCollection,
  paperDefinitionForPageSetup,
  resolveModelPageSetup,
  resolvePageSetup,
  setModelLayoutPageSetup,
  setPaperLayoutPageSetup,
} from "./layouts.js";
import type { CadChange } from "./transaction.js";

export const PAGE_SETUP_LIBRARY_EXTENSION_KEY = "kuubikDraw.pageSetupLibrary.v1";
export const PAGE_SETUP_TEMPLATE_FORMAT = "kuubik-draw-page-setup-template";
export const MAX_PAGE_SETUP_NAME_LENGTH = 255;
export const MAX_PAGE_SETUP_TEMPLATE_BYTES = 1024 * 1024;

export interface NamedPageSetupV1 {
  id: string;
  name: string;
  pageSetup: CadPageSetup;
  paperMarginsMm: { top: number; right: number; bottom: number; left: number };
}

export interface PageSetupLibraryV1 {
  schemaVersion: 1;
  setups: NamedPageSetupV1[];
  assignments: Record<string, string>;
}

export interface PageSetupTemplateLayoutV1 {
  id: string;
  name: string;
  kind: "model" | "paper";
  paper?: CadLayout["paper"];
  pageSetup: CadPageSetup;
  pageSetupId?: string;
  viewports: CadViewport[];
}

export interface PageSetupTemplateV1 {
  schemaVersion: 1;
  format: typeof PAGE_SETUP_TEMPLATE_FORMAT;
  name: string;
  units: KDrawDocumentV1["units"];
  pageSetups: NamedPageSetupV1[];
  layouts: PageSetupTemplateLayoutV1[];
}

export type PageSetupLibraryErrorCode =
  | "DANGLING_REFERENCE"
  | "DUPLICATE_ID"
  | "DUPLICATE_NAME"
  | "INVALID_ID"
  | "INVALID_LIBRARY"
  | "INVALID_NAME"
  | "INVALID_TEMPLATE"
  | "INCOMPATIBLE_UNITS"
  | "LAYOUT_LIMIT"
  | "MISSING_LAYOUT"
  | "MISSING_SETUP"
  | "NO_CHANGE"
  | "STALE_REFERENCE"
  | "TEMPLATE_TOO_LARGE";

export class PageSetupLibraryError extends Error {
  constructor(readonly code: PageSetupLibraryErrorCode, message: string) {
    super(message);
    this.name = "PageSetupLibraryError";
  }
}

export interface PageSetupLibraryEditResult {
  changes: CadChange[];
  library: PageSetupLibraryV1;
  setupId: string;
}

export interface PageSetupTemplateImportResult {
  changes: CadChange[];
  library: PageSetupLibraryV1;
  importedLayoutIds: string[];
  importedSetupIds: string[];
  layouts: CadLayout[];
}

const EMPTY_LIBRARY: PageSetupLibraryV1 = {
  schemaVersion: 1,
  setups: [],
  assignments: {},
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => semanticEqual(entry, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && semanticEqual(left[key], right[key]));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function normalizedName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function validName(value: unknown, label = "Page setup name"): string {
  if (typeof value !== "string") throw new PageSetupLibraryError("INVALID_NAME", `${label} must be text.`);
  const name = value.normalize("NFC").trim();
  if (name.length === 0 || name.length > MAX_PAGE_SETUP_NAME_LENGTH || /[<>/\\":;?*|,=]/u.test(name)) {
    throw new PageSetupLibraryError("INVALID_NAME", `${label} must contain 1-${MAX_PAGE_SETUP_NAME_LENGTH} valid characters.`);
  }
  return name;
}

function validId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new PageSetupLibraryError("INVALID_ID", `${label} must be a stable ASCII identifier.`);
  }
  return value;
}

function finiteMargins(value: unknown, label = "Page setup paper margins"): NamedPageSetupV1["paperMarginsMm"] {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_LIBRARY", "Page setup paper margins are missing.");
  exactKeys(value, ["top", "right", "bottom", "left"], label);
  const margins = {
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left,
  };
  if (Object.values(margins).some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0)) {
    throw new PageSetupLibraryError("INVALID_LIBRARY", "Page setup paper margins must be finite non-negative numbers.");
  }
  return margins as NamedPageSetupV1["paperMarginsMm"];
}

function validatedUnits(value: Record<string, unknown>): KDrawDocumentV1["units"] {
  exactKeys(value, ["linear", "displayPrecision", "angularPrecision"], "Template units");
  const linearUnits = new Set(["unitless", "mm", "cm", "m", "in", "ft"]);
  if (
    typeof value.linear !== "string" || !linearUnits.has(value.linear) ||
    !Number.isInteger(value.displayPrecision) || (value.displayPrecision as number) < 0 || (value.displayPrecision as number) > 15 ||
    !Number.isInteger(value.angularPrecision) || (value.angularPrecision as number) < 0 || (value.angularPrecision as number) > 15
  ) throw new PageSetupLibraryError("INVALID_TEMPLATE", "Template units are invalid.");
  return {
    linear: value.linear as KDrawDocumentV1["units"]["linear"],
    displayPrecision: value.displayPrecision as number,
    angularPrecision: value.angularPrecision as number,
  };
}

function exactPoint(value: unknown, label: string): void {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} must be a point.`);
  exactKeys(value, ["x", "y"], label);
}

function exactPageSetupShape(value: Record<string, unknown>, label: string): void {
  exactKeys(value, ["mediaName", "orientation", "plotArea", "plotScale", "centerPlot", "plotOriginMm", "plotStyle", "displayPlotStyles"], `${label} page setup`);
  if (!record(value.plotArea)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} plot area must be an object.`);
  exactKeys(value.plotArea, value.plotArea.kind === "window" ? ["kind", "window"] : ["kind"], `${label} plot area`);
  if (value.plotArea.kind === "window") {
    if (!record(value.plotArea.window)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} plot window must be a rectangle.`);
    exactKeys(value.plotArea.window, ["x", "y", "width", "height"], `${label} plot window`);
  }
  if (!record(value.plotScale)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} plot scale must be an object.`);
  exactKeys(value.plotScale, value.plotScale.mode === "custom" ? ["mode", "paperUnits", "drawingUnits"] : ["mode"], `${label} plot scale`);
  exactPoint(value.plotOriginMm, `${label} plot origin`);
  if (value.plotStyle !== undefined) {
    if (!record(value.plotStyle)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} plot style must be an object.`);
    exactKeys(value.plotStyle, ["profile", "plotLineweights", "plotTransparency"], `${label} plot style`);
  }
}

function exactPaperShape(value: unknown, label: string): void {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} paper must be an object.`);
  exactKeys(value, ["widthMm", "heightMm", "marginsMm"], `${label} paper`);
  finiteMargins(value.marginsMm, `${label} paper margins`);
}

function exactAppearanceShape(value: unknown, label: string): void {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} must be an appearance object.`);
  exactKeys(value, ["color", "colorMethod", "linetypeId", "lineweightMm", "transparency", "frozen"], label);
}

function exactViewportShape(value: unknown, label: string): void {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} must be an object.`);
  exactKeys(value, ["id", "center", "width", "height", "viewCenter", "viewHeight", "twistAngleRad", "locked", "clipBoundary", "layerOverrides"], label);
  exactPoint(value.center, `${label} center`);
  exactPoint(value.viewCenter, `${label} view center`);
  if (value.clipBoundary !== undefined) {
    if (!Array.isArray(value.clipBoundary)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} clip boundary must be an array.`);
    value.clipBoundary.forEach((point, index) => exactPoint(point, `${label} clip point ${index + 1}`));
  }
  if (value.layerOverrides !== undefined) {
    if (!record(value.layerOverrides)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `${label} layer overrides must be an object.`);
    Object.entries(value.layerOverrides).forEach(([layerId, appearance]) => exactAppearanceShape(appearance, `${label} layer override ${layerId}`));
  }
}

function validatedSetup(value: unknown, label: string): CadPageSetup {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_LIBRARY", `${label} page setup is missing.`);
  exactPageSetupShape(value, label);
  const setup = structuredClone(value) as unknown as CadPageSetup;
  try {
    const paper = paperDefinitionForPageSetup(setup);
    resolvePageSetup({ id: "page-setup-probe", name: "Page setup probe", kind: "paper", paper, pageSetup: setup, viewports: [], entities: [] });
  } catch (error) {
    throw new PageSetupLibraryError("INVALID_LIBRARY", `${label} is not a valid page setup: ${error instanceof Error ? error.message : String(error)}`);
  }
  return setup;
}

function validatedNamedSetup(value: unknown, label: string): NamedPageSetupV1 {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_LIBRARY", `${label} is invalid.`);
  exactKeys(value, ["id", "name", "pageSetup", "paperMarginsMm"], label);
  return {
    id: validId(value.id, `${label} id`),
    name: validName(value.name, `${label} name`),
    pageSetup: validatedSetup(value.pageSetup, label),
    paperMarginsMm: finiteMargins(value.paperMarginsMm, `${label} paper margins`),
  };
}

function assertUniqueSetups(setups: readonly NamedPageSetupV1[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const setup of setups) {
    if (ids.has(setup.id)) throw new PageSetupLibraryError("DUPLICATE_ID", `Duplicate page setup id: ${setup.id}.`);
    const name = normalizedName(setup.name);
    if (names.has(name)) throw new PageSetupLibraryError("DUPLICATE_NAME", `Duplicate page setup name: ${setup.name}.`);
    ids.add(setup.id);
    names.add(name);
    paperDefinitionForPageSetup(setup.pageSetup, setup.paperMarginsMm);
  }
}

function metadataWithLibrary(document: KDrawDocumentV1, library: PageSetupLibraryV1): KDrawDocumentV1["metadata"] {
  return {
    ...structuredClone(document.metadata),
    extensions: {
      ...structuredClone(document.metadata.extensions ?? {}),
      [PAGE_SETUP_LIBRARY_EXTENSION_KEY]: structuredClone(library),
    },
  };
}

function allocatedId(prefix: string, used: ReadonlySet<string>): string {
  let sequence = 1;
  while (used.has(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
}

function uniqueName(preferred: string, usedNames: ReadonlySet<string>): string {
  if (!usedNames.has(normalizedName(preferred))) return preferred;
  let sequence = 2;
  while (usedNames.has(normalizedName(`${preferred} (${sequence})`))) sequence += 1;
  return `${preferred} (${sequence})`;
}

function layoutById(document: KDrawDocumentV1, layoutId: string): CadLayout {
  const layout = document.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) throw new PageSetupLibraryError("MISSING_LAYOUT", `Layout not found: ${layoutId}.`);
  return layout;
}

export function resolvePageSetupLibrary(document: KDrawDocumentV1): PageSetupLibraryV1 {
  const value = document.metadata.extensions?.[PAGE_SETUP_LIBRARY_EXTENSION_KEY];
  if (value === undefined) return structuredClone(EMPTY_LIBRARY);
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.setups) || !record(value.assignments)) {
    throw new PageSetupLibraryError("INVALID_LIBRARY", "Stored page setup library is invalid.");
  }
  const library: PageSetupLibraryV1 = {
    schemaVersion: 1,
    setups: value.setups.map((entry, index) => validatedNamedSetup(entry, `Page setup ${index + 1}`)),
    assignments: {},
  };
  assertUniqueSetups(library.setups);
  const setupIds = new Set(library.setups.map((setup) => setup.id));
  const layoutIds = new Set(document.layouts.map((layout) => layout.id));
  for (const [layoutId, setupId] of Object.entries(value.assignments)) {
    if (typeof setupId !== "string" || !layoutIds.has(layoutId) || !setupIds.has(setupId)) {
      throw new PageSetupLibraryError("DANGLING_REFERENCE", `Page setup assignment is dangling: ${layoutId} -> ${String(setupId)}.`);
    }
    library.assignments[layoutId] = setupId;
  }
  return structuredClone(library);
}

export function saveNamedPageSetup(document: KDrawDocumentV1, layoutId: string, requestedName: string): PageSetupLibraryEditResult {
  const layout = layoutById(document, layoutId);
  const name = validName(requestedName);
  const library = resolvePageSetupLibrary(document);
  if (library.setups.some((setup) => normalizedName(setup.name) === normalizedName(name))) {
    throw new PageSetupLibraryError("DUPLICATE_NAME", `Page setup name already exists: ${name}.`);
  }
  const pageSetup = layout.kind === "model" ? resolveModelPageSetup(layout) : resolvePageSetup(layout);
  if (!pageSetup) throw new PageSetupLibraryError("INVALID_LIBRARY", `Layout ${layoutId} has no page setup.`);
  const setupId = allocatedId("page-setup", new Set(library.setups.map((setup) => setup.id)));
  const margins = layout.paper?.marginsMm ?? paperDefinitionForPageSetup(pageSetup).marginsMm;
  library.setups.push({ id: setupId, name, pageSetup: structuredClone(pageSetup), paperMarginsMm: structuredClone(margins) });
  library.assignments[layoutId] = setupId;
  return { changes: [{ type: "set-metadata", metadata: metadataWithLibrary(document, library) }], library, setupId };
}

export function applyNamedPageSetup(document: KDrawDocumentV1, layoutId: string, setupId: string): PageSetupLibraryEditResult {
  const layout = layoutById(document, layoutId);
  const library = resolvePageSetupLibrary(document);
  const named = library.setups.find((setup) => setup.id === setupId);
  if (!named) throw new PageSetupLibraryError("MISSING_SETUP", `Page setup not found: ${setupId}.`);
  const result = layout.kind === "model"
    ? setModelLayoutPageSetup(document, layoutId, named.pageSetup)
    : setPaperLayoutPageSetup(document, layoutId, named.pageSetup);
  if (layout.kind === "paper") {
    const target = result.layouts.find((candidate) => candidate.id === layoutId)!;
    target.paper = paperDefinitionForPageSetup(named.pageSetup, named.paperMarginsMm);
    assertLayoutCollection(result.layouts);
    result.changes[0] = { type: "set-layouts", layouts: structuredClone(result.layouts) };
  }
  library.assignments[layoutId] = setupId;
  const changes: CadChange[] = [];
  if (!semanticEqual(result.layouts, document.layouts)) changes.push(...result.changes);
  const metadata = metadataWithLibrary(document, library);
  if (!semanticEqual(metadata, document.metadata)) changes.push({ type: "set-metadata", metadata });
  if (changes.length === 0) throw new PageSetupLibraryError("NO_CHANGE", `Page setup ${named.name} is already applied.`);
  return { changes, library, setupId };
}

export function renameNamedPageSetup(document: KDrawDocumentV1, setupId: string, requestedName: string): PageSetupLibraryEditResult {
  const name = validName(requestedName);
  const library = resolvePageSetupLibrary(document);
  const setup = library.setups.find((candidate) => candidate.id === setupId);
  if (!setup) throw new PageSetupLibraryError("MISSING_SETUP", `Page setup not found: ${setupId}.`);
  if (library.setups.some((candidate) => candidate.id !== setupId && normalizedName(candidate.name) === normalizedName(name))) {
    throw new PageSetupLibraryError("DUPLICATE_NAME", `Page setup name already exists: ${name}.`);
  }
  if (setup.name === name) throw new PageSetupLibraryError("NO_CHANGE", "Page setup name did not change.");
  setup.name = name;
  return { changes: [{ type: "set-metadata", metadata: metadataWithLibrary(document, library) }], library, setupId };
}

export function deleteNamedPageSetup(document: KDrawDocumentV1, setupId: string): PageSetupLibraryEditResult {
  const library = resolvePageSetupLibrary(document);
  if (!library.setups.some((setup) => setup.id === setupId)) throw new PageSetupLibraryError("MISSING_SETUP", `Page setup not found: ${setupId}.`);
  library.setups = library.setups.filter((setup) => setup.id !== setupId);
  library.assignments = Object.fromEntries(Object.entries(library.assignments).filter(([, assigned]) => assigned !== setupId));
  return { changes: [{ type: "set-metadata", metadata: metadataWithLibrary(document, library) }], library, setupId };
}

export function clearNamedPageSetupAssignment(document: KDrawDocumentV1, layoutId: string): CadChange[] {
  layoutById(document, layoutId);
  const library = resolvePageSetupLibrary(document);
  if (library.assignments[layoutId] === undefined) return [];
  delete library.assignments[layoutId];
  return [{ type: "set-metadata", metadata: metadataWithLibrary(document, library) }];
}

export function createPageSetupTemplate(document: KDrawDocumentV1, requestedName: string): PageSetupTemplateV1 {
  const name = validName(requestedName, "Template name");
  const library = resolvePageSetupLibrary(document);
  return {
    schemaVersion: 1,
    format: PAGE_SETUP_TEMPLATE_FORMAT,
    name,
    units: structuredClone(document.units),
    pageSetups: structuredClone(library.setups),
    layouts: document.layouts.map((layout) => {
      const pageSetup = layout.kind === "model" ? resolveModelPageSetup(layout) : resolvePageSetup(layout);
      if (!pageSetup) throw new PageSetupLibraryError("INVALID_TEMPLATE", `Layout ${layout.id} has no page setup.`);
      return {
        id: layout.id,
        name: layout.name,
        kind: layout.kind,
        ...(layout.paper ? { paper: structuredClone(layout.paper) } : {}),
        pageSetup: structuredClone(pageSetup),
        ...(() => {
          const setupId = library.assignments[layout.id];
          const named = library.setups.find((candidate) => candidate.id === setupId);
          const margins = layout.paper?.marginsMm ?? paperDefinitionForPageSetup(pageSetup).marginsMm;
          return typeof setupId === "string" && named && semanticEqual(named.pageSetup, pageSetup) && semanticEqual(named.paperMarginsMm, margins)
            ? { pageSetupId: setupId }
            : {};
        })(),
        viewports: structuredClone(layout.viewports),
      };
    }),
  };
}

export function serializePageSetupTemplate(template: PageSetupTemplateV1): string {
  const validated = parsePageSetupTemplate(`${JSON.stringify(template)}\n`);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

function parsedTemplateLayout(value: unknown, index: number, setupsById: ReadonlyMap<string, NamedPageSetupV1>): PageSetupTemplateLayoutV1 {
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `Template layout ${index + 1} is invalid.`);
  exactKeys(value, ["id", "name", "kind", "paper", "pageSetup", "pageSetupId", "viewports"], `Template layout ${index + 1}`);
  if (value.kind !== "model" && value.kind !== "paper") throw new PageSetupLibraryError("INVALID_TEMPLATE", `Template layout ${index + 1} has an invalid kind.`);
  if (!Array.isArray(value.viewports)) throw new PageSetupLibraryError("INVALID_TEMPLATE", `Template layout ${index + 1} has invalid viewports.`);
  if (value.pageSetupId !== undefined && (typeof value.pageSetupId !== "string" || !setupsById.has(value.pageSetupId))) {
    throw new PageSetupLibraryError("DANGLING_REFERENCE", `Template layout ${index + 1} references a missing page setup.`);
  }
  const layout: PageSetupTemplateLayoutV1 = {
    id: validId(value.id, `Template layout ${index + 1} id`),
    name: validName(value.name, `Template layout ${index + 1} name`),
    kind: value.kind,
    pageSetup: validatedSetup(value.pageSetup, `Template layout ${index + 1}`),
    ...(value.pageSetupId === undefined ? {} : { pageSetupId: value.pageSetupId }),
    viewports: value.viewports.map((viewport, viewportIndex) => {
      exactViewportShape(viewport, `Template layout ${index + 1} viewport ${viewportIndex + 1}`);
      return structuredClone(viewport) as CadViewport;
    }),
  };
  if (value.paper !== undefined) {
    exactPaperShape(value.paper, `Template layout ${index + 1}`);
    layout.paper = structuredClone(value.paper) as CadLayout["paper"];
  }
  if (layout.kind === "paper" && !layout.paper) layout.paper = paperDefinitionForPageSetup(layout.pageSetup);
  if (layout.pageSetupId) {
    const named = setupsById.get(layout.pageSetupId)!;
    const margins = layout.paper?.marginsMm ?? paperDefinitionForPageSetup(layout.pageSetup).marginsMm;
    if (!semanticEqual(layout.pageSetup, named.pageSetup) || !semanticEqual(margins, named.paperMarginsMm)) {
      throw new PageSetupLibraryError("STALE_REFERENCE", `Template layout ${index + 1} does not match its named page setup.`);
    }
  }
  return layout;
}

export function parsePageSetupTemplate(text: string): PageSetupTemplateV1 {
  if (new TextEncoder().encode(text).byteLength > MAX_PAGE_SETUP_TEMPLATE_BYTES) {
    throw new PageSetupLibraryError("TEMPLATE_TOO_LARGE", `Page setup template exceeds ${MAX_PAGE_SETUP_TEMPLATE_BYTES} bytes.`);
  }
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new PageSetupLibraryError("INVALID_TEMPLATE", "Page setup template is not valid JSON."); }
  if (!record(value)) throw new PageSetupLibraryError("INVALID_TEMPLATE", "Page setup template must be an object.");
  exactKeys(value, ["schemaVersion", "format", "name", "units", "pageSetups", "layouts"], "Page setup template");
  if (value.schemaVersion !== 1 || value.format !== PAGE_SETUP_TEMPLATE_FORMAT || !Array.isArray(value.pageSetups) || !Array.isArray(value.layouts) || !record(value.units)) {
    throw new PageSetupLibraryError("INVALID_TEMPLATE", "Page setup template header is invalid.");
  }
  const pageSetups = value.pageSetups.map((entry, index) => validatedNamedSetup(entry, `Template page setup ${index + 1}`));
  assertUniqueSetups(pageSetups);
  const setupsById = new Map(pageSetups.map((setup) => [setup.id, setup] as const));
  const layouts = value.layouts.map((entry, index) => parsedTemplateLayout(entry, index, setupsById));
  const layoutIds = new Set<string>();
  for (const layout of layouts) {
    if (layoutIds.has(layout.id)) throw new PageSetupLibraryError("DUPLICATE_ID", `Duplicate template layout id: ${layout.id}.`);
    layoutIds.add(layout.id);
  }
  if (layouts.length === 0 || layouts[0]?.kind !== "model" || layouts.filter((layout) => layout.kind === "model").length !== 1) {
    throw new PageSetupLibraryError("INVALID_TEMPLATE", "Template must contain exactly one first Model layout.");
  }
  const probe: CadLayout[] = layouts.map((layout) => ({
    id: layout.id,
    name: layout.name,
    kind: layout.kind,
    ...(layout.paper ? { paper: structuredClone(layout.paper) } : {}),
    pageSetup: structuredClone(layout.pageSetup),
    viewports: structuredClone(layout.viewports),
    entities: [],
  }));
  assertLayoutCollection(probe);
  return {
    schemaVersion: 1,
    format: PAGE_SETUP_TEMPLATE_FORMAT,
    name: validName(value.name, "Template name"),
    units: validatedUnits(value.units),
    pageSetups,
    layouts,
  };
}

export function importPageSetupTemplate(document: KDrawDocumentV1, template: PageSetupTemplateV1): PageSetupTemplateImportResult {
  const parsed = parsePageSetupTemplate(`${JSON.stringify(template)}\n`);
  if (parsed.units.linear !== document.units.linear || parsed.units.displayPrecision !== document.units.displayPrecision || parsed.units.angularPrecision !== document.units.angularPrecision) {
    throw new PageSetupLibraryError("INCOMPATIBLE_UNITS", `Template units ${parsed.units.linear} do not match document units ${document.units.linear}.`);
  }
  const library = resolvePageSetupLibrary(document);
  const usedSetupIds = new Set(library.setups.map((setup) => setup.id));
  const usedSetupNames = new Set(library.setups.map((setup) => normalizedName(setup.name)));
  const setupIdMap = new Map<string, string>();
  const importedSetupIds: string[] = [];
  for (const source of parsed.pageSetups) {
    const matching = library.setups.find((candidate) => normalizedName(candidate.name) === normalizedName(source.name) &&
      semanticEqual(candidate.pageSetup, source.pageSetup) && semanticEqual(candidate.paperMarginsMm, source.paperMarginsMm));
    if (matching) { setupIdMap.set(source.id, matching.id); continue; }
    const id = allocatedId("page-setup", usedSetupIds);
    usedSetupIds.add(id);
    const name = uniqueName(source.name, usedSetupNames);
    usedSetupNames.add(normalizedName(name));
    library.setups.push({ ...structuredClone(source), id, name });
    setupIdMap.set(source.id, id);
    importedSetupIds.push(id);
  }

  const paperTemplates = parsed.layouts.filter((layout) => layout.kind === "paper");
  const existingPaperCount = document.layouts.filter((layout) => layout.kind === "paper").length;
  if (existingPaperCount + paperTemplates.length > MAX_PAPER_LAYOUTS) {
    throw new PageSetupLibraryError("LAYOUT_LIMIT", `Template would exceed ${MAX_PAPER_LAYOUTS} paper layouts.`);
  }
  const layouts = structuredClone(document.layouts);
  const modelTemplate = parsed.layouts[0]!;
  const modelResult = setModelLayoutPageSetup({ ...structuredClone(document), layouts }, layouts[0]!.id, modelTemplate.pageSetup);
  layouts.splice(0, layouts.length, ...modelResult.layouts);
  if (modelTemplate.pageSetupId) library.assignments[layouts[0]!.id] = setupIdMap.get(modelTemplate.pageSetupId)!;

  const usedLayoutIds = new Set(layouts.map((layout) => layout.id));
  const usedLayoutNames = new Set(layouts.map((layout) => normalizedName(layout.name)));
  const usedViewportIds = new Set(layouts.flatMap((layout) => layout.viewports.map((viewport) => viewport.id)));
  const importedLayoutIds: string[] = [];
  for (const source of paperTemplates) {
    const id = allocatedId("layout", usedLayoutIds);
    usedLayoutIds.add(id);
    const name = uniqueName(source.name, usedLayoutNames);
    usedLayoutNames.add(normalizedName(name));
    const viewports = source.viewports.map((viewport) => {
      const viewportId = allocatedId("viewport", usedViewportIds);
      usedViewportIds.add(viewportId);
      return { ...structuredClone(viewport), id: viewportId };
    });
    const layout: CadLayout = {
      id,
      name,
      kind: "paper",
      paper: structuredClone(source.paper ?? paperDefinitionForPageSetup(source.pageSetup)),
      pageSetup: structuredClone(source.pageSetup),
      viewports,
      entities: [],
    };
    layouts.push(layout);
    importedLayoutIds.push(id);
    if (source.pageSetupId) library.assignments[id] = setupIdMap.get(source.pageSetupId)!;
  }
  assertLayoutCollection(layouts);
  return {
    changes: [
      { type: "set-layouts", layouts: structuredClone(layouts) },
      { type: "set-metadata", metadata: metadataWithLibrary(document, library) },
    ],
    library,
    importedLayoutIds,
    importedSetupIds,
    layouts,
  };
}
