import type {
  CadAppearance,
  CadDimensionStyle,
  CadEntity,
  CadLayer,
  CadLinetype,
  CadPolyline,
  CadTextStyle,
  CadViewport,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import type { CadChange, EntityChange } from "./transaction.js";

export interface MatchPropertiesSettings {
  color: boolean;
  layer: boolean;
  linetype: boolean;
  linetypeScale: boolean;
  lineweight: boolean;
  transparency: boolean;
  thickness: boolean;
  plotStyle: boolean;
  dimension: boolean;
  polyline: boolean;
  material: boolean;
  text: boolean;
  viewport: boolean;
  multileader: boolean;
  hatch: boolean;
  table: boolean;
  centerObject: boolean;
}

export const DEFAULT_MATCH_PROPERTIES_SETTINGS: Readonly<MatchPropertiesSettings> = Object.freeze({
  color: true,
  layer: true,
  linetype: true,
  linetypeScale: true,
  lineweight: true,
  transparency: true,
  thickness: true,
  plotStyle: true,
  dimension: true,
  polyline: true,
  material: true,
  text: true,
  viewport: true,
  multileader: true,
  hatch: true,
  table: true,
  centerObject: true,
});

export interface MatchPropertiesArgs {
  sourceHandle: string;
  targetHandles: readonly string[];
  settings?: Partial<MatchPropertiesSettings>;
}

export type MatchPropertiesRejectReason = "missing" | "locked-layer" | "source-target" | "no-compatible-change";

export interface MatchPropertiesRejectedTarget {
  handle: string;
  reason: MatchPropertiesRejectReason;
}

export interface MatchPropertiesResult {
  changes: EntityChange[];
  sourceHandle: string;
  targetHandles: string[];
  matchedHandles: string[];
  rejected: MatchPropertiesRejectedTarget[];
  settings: MatchPropertiesSettings;
}

export type MatchPropertiesResourceKind = "layer" | "linetype" | "text-style" | "dimension-style";

export interface MatchPropertiesResourceImport {
  kind: MatchPropertiesResourceKind;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  action: "reuse" | "import";
}

export interface CrossDocumentMatchPropertiesResult extends Omit<MatchPropertiesResult, "changes"> {
  changes: CadChange[];
  resourceImports: MatchPropertiesResourceImport[];
}

export interface MatchViewportRef {
  layoutId: string;
  viewportId: string;
}

export interface MatchViewportPropertiesResult {
  changes: CadChange[];
  source: MatchViewportRef;
  targets: MatchViewportRef[];
  matched: MatchViewportRef[];
  rejected: Array<{ target: MatchViewportRef; reason: "missing" | "source-target" | "no-compatible-change" }>;
}

export function resolveMatchPropertiesSettings(settings: Partial<MatchPropertiesSettings> = {}): MatchPropertiesSettings {
  const unknown = Object.keys(settings).filter((key) => !(key in DEFAULT_MATCH_PROPERTIES_SETTINGS));
  if (unknown.length) throw new TypeError(`Unknown MATCHPROP setting: ${unknown.join(", ")}.`);
  const resolved = { ...DEFAULT_MATCH_PROPERTIES_SETTINGS, ...settings };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== "boolean") throw new TypeError(`MATCHPROP setting ${key} must be boolean.`);
  }
  return resolved;
}

function own<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function copyAppearanceKeys(
  target: CadAppearance,
  source: CadAppearance,
  keys: readonly (keyof CadAppearance)[],
): void {
  for (const key of keys) {
    if (own(source, key)) {
      (target as Record<keyof CadAppearance, unknown>)[key] = structuredClone(source[key]);
    } else {
      delete target[key];
    }
  }
}

function supportsLinetype(entity: CadEntity): boolean {
  return entity.kind !== "hatch" && entity.kind !== "mtext";
}

function supportsThickness(entity: CadEntity): boolean {
  return ["line", "polyline", "circle", "arc", "text"].includes(entity.kind);
}

function uniformPolylineWidth(polyline: CadPolyline): number | null {
  const widths = polyline.vertices.flatMap((vertex) => [vertex.startWidth ?? 0, vertex.endWidth ?? 0]);
  const first = widths[0] ?? 0;
  return widths.every((width) => width === first) ? first : null;
}

function applyUniformPolylineWidth(polyline: CadPolyline, width: number): CadPolyline {
  return {
    ...polyline,
    vertices: polyline.vertices.map((vertex) => {
      const updated = { ...vertex };
      if (width === 0) {
        delete updated.startWidth;
        delete updated.endWidth;
      } else {
        updated.startWidth = width;
        updated.endWidth = width;
      }
      return updated;
    }),
  };
}

function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length
      && first.every((value, index) => sameValue(value, second[index]));
  }
  if (!first || !second || typeof first !== "object" || typeof second !== "object") return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord).sort();
  const secondKeys = Object.keys(secondRecord).sort();
  return firstKeys.length === secondKeys.length
    && firstKeys.every((key, index) => key === secondKeys[index] && sameValue(firstRecord[key], secondRecord[key]));
}

function sameEntity(first: CadEntity, second: CadEntity): boolean {
  return sameValue(first, second);
}

function copyOptionalViewportProperty<K extends keyof CadViewport>(
  target: CadViewport,
  source: CadViewport,
  key: K,
): void {
  if (own(source, key)) target[key] = structuredClone(source[key]) as CadViewport[K];
  else delete target[key];
}

/**
 * Copies only the AutoCAD 2024 MATCHPROP viewport-special set. Paper geometry,
 * view centre/twist, clipping and per-viewport layer states remain target-owned.
 */
export function matchCadViewportProperties(source: CadViewport, target: CadViewport): CadViewport {
  if (!(source.height > 0) || !(source.viewHeight > 0) || !(target.height > 0)) {
    throw new RangeError("MATCHPROP viewport dimensions and view height must be greater than zero.");
  }
  const result = structuredClone(target);
  result.viewHeight = target.height * (source.viewHeight / source.height);
  result.locked = source.locked;
  for (const key of ["on", "shadePlot", "snapEnabled", "gridEnabled", "ucsIconVisible", "ucsIconAtOrigin"] as const) {
    copyOptionalViewportProperty(result, source, key);
  }
  return result;
}

export function executeMatchViewportProperties(
  document: KDrawDocumentV1,
  sourceRef: MatchViewportRef,
  targetRefs: readonly MatchViewportRef[],
): MatchViewportPropertiesResult {
  const layouts = structuredClone(document.layouts);
  const findViewport = (ref: MatchViewportRef): CadViewport | null => (
    layouts.find((layout) => layout.id === ref.layoutId)?.viewports.find((viewport) => viewport.id === ref.viewportId) ?? null
  );
  const source = findViewport(sourceRef);
  if (!source) throw new RangeError(`MATCHPROP source viewport does not exist: ${sourceRef.layoutId}/${sourceRef.viewportId}.`);
  const targets = [...new Map(targetRefs.map((ref) => [`${ref.layoutId}\u0000${ref.viewportId}`, { ...ref }])).values()];
  if (!targets.length) throw new TypeError("MATCHPROP requires at least one destination viewport.");
  const matched: MatchViewportRef[] = [];
  const rejected: MatchViewportPropertiesResult["rejected"] = [];
  for (const targetRef of targets) {
    if (targetRef.layoutId === sourceRef.layoutId && targetRef.viewportId === sourceRef.viewportId) {
      rejected.push({ target: targetRef, reason: "source-target" });
      continue;
    }
    const target = findViewport(targetRef);
    if (!target) {
      rejected.push({ target: targetRef, reason: "missing" });
      continue;
    }
    const next = matchCadViewportProperties(source, target);
    if (sameValue(next, target)) {
      rejected.push({ target: targetRef, reason: "no-compatible-change" });
      continue;
    }
    Object.assign(target, next);
    matched.push(targetRef);
  }
  return {
    changes: matched.length ? [{ type: "set-layouts", layouts }] : [],
    source: { ...sourceRef },
    targets,
    matched,
    rejected,
  };
}

interface NamedResourcePlan<T extends { id: string; name: string }> {
  idMap: Map<string, string>;
  additions: T[];
  reports: MatchPropertiesResourceImport[];
}

function namedResourceBody(resource: { id: string; name: string }): Record<string, unknown> {
  const body = structuredClone(resource) as Record<string, unknown>;
  delete body.id;
  delete body.name;
  return body;
}

function planNamedResourceImports<T extends { id: string; name: string }>(
  kind: MatchPropertiesResourceKind,
  sourceResources: readonly T[],
  targetResources: readonly T[],
  requiredIds: ReadonlySet<string>,
  remap: (resource: T) => T = (resource) => resource,
): NamedResourcePlan<T> {
  const sourceById = new Map(sourceResources.map((resource) => [resource.id, resource]));
  const targetById = new Map(targetResources.map((resource) => [resource.id, resource]));
  const usedIds = new Set(targetResources.map((resource) => resource.id));
  const usedNames = new Set(targetResources.map((resource) => resource.name.toLocaleUpperCase("en-US")));
  const idMap = new Map<string, string>();
  const additions: T[] = [];
  const reports: MatchPropertiesResourceImport[] = [];
  for (const sourceId of requiredIds) {
    const sourceResource = sourceById.get(sourceId);
    if (!sourceResource) throw new RangeError(`MATCHPROP source ${kind} does not exist: ${sourceId}.`);
    const remapped = remap(structuredClone(sourceResource));
    const sameId = targetById.get(sourceId);
    const sameNameAndBody = targetResources.find((candidate) => (
      candidate.name.localeCompare(sourceResource.name, "en-US", { sensitivity: "accent" }) === 0
      && sameValue(namedResourceBody(candidate), namedResourceBody(remapped))
    ));
    if (sameId && sameValue(sameId, remapped)) {
      idMap.set(sourceId, sameId.id);
      reports.push({ kind, sourceId, targetId: sameId.id, sourceName: sourceResource.name, targetName: sameId.name, action: "reuse" });
      continue;
    }
    if (sameNameAndBody) {
      idMap.set(sourceId, sameNameAndBody.id);
      reports.push({ kind, sourceId, targetId: sameNameAndBody.id, sourceName: sourceResource.name, targetName: sameNameAndBody.name, action: "reuse" });
      continue;
    }
    let targetId = sourceId;
    for (let suffix = 1; usedIds.has(targetId); suffix += 1) targetId = `${sourceId}$matchprop${suffix}`;
    let targetName = sourceResource.name;
    for (let suffix = 1; usedNames.has(targetName.toLocaleUpperCase("en-US")); suffix += 1) targetName = `${sourceResource.name} [MATCHPROP ${suffix}]`;
    const addition = { ...remapped, id: targetId, name: targetName };
    usedIds.add(targetId);
    usedNames.add(targetName.toLocaleUpperCase("en-US"));
    idMap.set(sourceId, targetId);
    additions.push(addition);
    reports.push({ kind, sourceId, targetId, sourceName: sourceResource.name, targetName, action: "import" });
  }
  return { idMap, additions, reports };
}

/**
 * AutoCAD keeps MATCHPROP active while the user switches drawing tabs. This
 * pure core path imports every represented named dependency before putting the
 * changed target entities, so one CadOperation can undo the full transfer.
 */
export function executeMatchPropertiesAcrossDocuments(
  sourceDocument: KDrawDocumentV1,
  targetDocument: KDrawDocumentV1,
  args: MatchPropertiesArgs,
): CrossDocumentMatchPropertiesResult {
  const sourceHandle = args.sourceHandle.trim();
  if (!sourceHandle) throw new TypeError("MATCHPROP requires a source handle.");
  const source = sourceDocument.entities.find((entity) => entity.handle === sourceHandle);
  if (!source) throw new RangeError(`MATCHPROP source does not exist: ${sourceHandle}.`);
  const settings = resolveMatchPropertiesSettings(args.settings);
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (!requested.length) throw new TypeError("MATCHPROP requires at least one destination handle.");
  const targetEntities = new Map(targetDocument.entities.map((entity) => [entity.handle, entity]));
  const lockedLayers = new Set(targetDocument.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const candidates = requested.flatMap((handle) => {
    const target = targetEntities.get(handle);
    return target && !lockedLayers.has(target.layerId) ? [target] : [];
  });

  const sourceLayer = sourceDocument.layers.find((layer) => layer.id === source.layerId);
  const linetypeIds = new Set<string>();
  if (settings.linetype && supportsLinetype(source) && candidates.some(supportsLinetype) && source.appearance?.linetypeId) {
    linetypeIds.add(source.appearance.linetypeId);
  }
  if (settings.layer) {
    if (!sourceLayer) throw new RangeError(`MATCHPROP source layer does not exist: ${source.layerId}.`);
    if (sourceLayer.appearance?.linetypeId) linetypeIds.add(sourceLayer.appearance.linetypeId);
  }
  const dimensionStyleIds = new Set<string>();
  const textStyleIds = new Set<string>();
  if (settings.dimension && source.kind === "dimension" && candidates.some((target) => target.kind === "dimension")) {
    dimensionStyleIds.add(source.styleId);
    const style = sourceDocument.dimensionStyles.find((candidate) => candidate.id === source.styleId);
    if (!style) throw new RangeError(`MATCHPROP source dimension style does not exist: ${source.styleId}.`);
    if (style.textStyleId) textStyleIds.add(style.textStyleId);
  }
  if (settings.text && (source.kind === "text" || source.kind === "mtext") && candidates.some((target) => target.kind === "text" || target.kind === "mtext") && source.styleId) {
    textStyleIds.add(source.styleId);
  }

  const linetypePlan = planNamedResourceImports("linetype", sourceDocument.linetypes, targetDocument.linetypes, linetypeIds);
  const textStylePlan = planNamedResourceImports("text-style", sourceDocument.textStyles, targetDocument.textStyles, textStyleIds);
  const dimensionStylePlan = planNamedResourceImports(
    "dimension-style",
    sourceDocument.dimensionStyles,
    targetDocument.dimensionStyles,
    dimensionStyleIds,
    (style: CadDimensionStyle) => ({
      ...style,
      ...(style.textStyleId ? { textStyleId: textStylePlan.idMap.get(style.textStyleId) ?? style.textStyleId } : {}),
    }),
  );
  const layerPlan = planNamedResourceImports(
    "layer",
    sourceDocument.layers,
    targetDocument.layers,
    settings.layer ? new Set([source.layerId]) : new Set<string>(),
    (layer: CadLayer) => ({
      ...layer,
      ...(layer.appearance?.linetypeId ? {
        appearance: { ...layer.appearance, linetypeId: linetypePlan.idMap.get(layer.appearance.linetypeId) ?? layer.appearance.linetypeId },
      } : {}),
    }),
  );

  const entityChanges: EntityChange[] = [];
  const matchedHandles: string[] = [];
  const rejected: MatchPropertiesRejectedTarget[] = [];
  for (const handle of requested) {
    const target = targetEntities.get(handle);
    if (!target) { rejected.push({ handle, reason: "missing" }); continue; }
    if (lockedLayers.has(target.layerId)) { rejected.push({ handle, reason: "locked-layer" }); continue; }
    let matched = matchCadEntityProperties(source, target, settings);
    if (settings.layer) matched.layerId = layerPlan.idMap.get(source.layerId) ?? source.layerId;
    if (matched.appearance?.linetypeId) {
      matched.appearance.linetypeId = linetypePlan.idMap.get(matched.appearance.linetypeId) ?? matched.appearance.linetypeId;
    }
    if ((matched.kind === "text" || matched.kind === "mtext") && matched.styleId) {
      matched.styleId = textStylePlan.idMap.get(matched.styleId) ?? matched.styleId;
    }
    if (matched.kind === "dimension") {
      matched.styleId = dimensionStylePlan.idMap.get(matched.styleId) ?? matched.styleId;
    }
    if (sameEntity(matched, target)) { rejected.push({ handle, reason: "no-compatible-change" }); continue; }
    entityChanges.push({ type: "put", entity: matched });
    matchedHandles.push(handle);
  }

  const resourceImports = [
    ...linetypePlan.reports,
    ...textStylePlan.reports,
    ...dimensionStylePlan.reports,
    ...layerPlan.reports,
  ];
  const changes: CadChange[] = matchedHandles.length ? [
    ...linetypePlan.additions.map((linetype: CadLinetype): CadChange => ({ type: "put-linetype", linetype })),
    ...textStylePlan.additions.map((textStyle: CadTextStyle): CadChange => ({ type: "put-text-style", textStyle })),
    ...dimensionStylePlan.additions.map((dimensionStyle: CadDimensionStyle): CadChange => ({ type: "put-dimension-style", dimensionStyle })),
    ...layerPlan.additions.map((layer: CadLayer): CadChange => ({ type: "put-layer", layer })),
    ...entityChanges,
  ] : [];
  return { changes, sourceHandle, targetHandles: requested, matchedHandles, rejected, settings, resourceImports };
}

/**
 * AutoCAD 2024 MATCHPROP's deterministic document-side predicate. Geometry,
 * handles and extension data remain untouched; preview and commit consume this
 * same function. Object families not yet represented by KDraw are retained as
 * explicit settings but cannot silently claim a special-property match.
 */
export function matchCadEntityProperties(
  source: CadEntity,
  target: CadEntity,
  settings: MatchPropertiesSettings,
): CadEntity {
  let result = structuredClone(target);
  const sourceAppearance = source.appearance ?? {};
  const appearance = structuredClone(target.appearance ?? {});

  if (settings.color) copyAppearanceKeys(appearance, sourceAppearance, ["color", "colorMethod", "aciIndex"]);
  if (settings.linetype && supportsLinetype(source) && supportsLinetype(target)) {
    copyAppearanceKeys(appearance, sourceAppearance, ["linetypeId"]);
  }
  if (settings.linetypeScale && supportsLinetype(source) && supportsLinetype(target)) {
    copyAppearanceKeys(appearance, sourceAppearance, ["linetypeScale"]);
  }
  if (settings.lineweight) copyAppearanceKeys(appearance, sourceAppearance, ["lineweightMm"]);
  if (settings.transparency) copyAppearanceKeys(appearance, sourceAppearance, ["transparency"]);
  if (settings.thickness && supportsThickness(source) && supportsThickness(target)) {
    copyAppearanceKeys(appearance, sourceAppearance, ["thickness"]);
  }
  if (settings.plotStyle) copyAppearanceKeys(appearance, sourceAppearance, ["plotStyleId"]);
  if (settings.material) copyAppearanceKeys(appearance, sourceAppearance, ["materialId"]);

  if (settings.layer) result.layerId = source.layerId;
  if (Object.keys(appearance).length) result.appearance = appearance;
  else delete result.appearance;

  if (settings.polyline && source.kind === "polyline" && result.kind === "polyline") {
    const width = uniformPolylineWidth(source);
    if (width !== null) result = applyUniformPolylineWidth(result, width);
  }
  if (settings.text && (source.kind === "text" || source.kind === "mtext") && (result.kind === "text" || result.kind === "mtext")) {
    const matchedText = {
      ...result,
      height: source.height,
      rotationRad: source.rotationRad,
    };
    if (source.styleId === undefined) delete matchedText.styleId;
    else matchedText.styleId = source.styleId;
    result = matchedText;
  }
  if (settings.dimension && source.kind === "dimension" && result.kind === "dimension") {
    result = { ...result, styleId: source.styleId };
  }
  if (settings.hatch && source.kind === "hatch" && result.kind === "hatch") {
    result = { ...result, pattern: source.pattern };
  }
  return result;
}

export function executeMatchProperties(document: KDrawDocumentV1, args: MatchPropertiesArgs): MatchPropertiesResult {
  const sourceHandle = args.sourceHandle.trim();
  if (!sourceHandle) throw new TypeError("MATCHPROP requires a source handle.");
  const entities = new Map(document.entities.map((entity) => [entity.handle, entity]));
  const source = entities.get(sourceHandle);
  if (!source) throw new RangeError(`MATCHPROP source does not exist: ${sourceHandle}.`);
  const settings = resolveMatchPropertiesSettings(args.settings);
  const requested = [...new Set(args.targetHandles.map((handle) => handle.trim()).filter(Boolean))];
  if (!requested.length) throw new TypeError("MATCHPROP requires at least one destination handle.");
  const lockedLayers = new Set(document.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const changes: EntityChange[] = [];
  const matchedHandles: string[] = [];
  const rejected: MatchPropertiesRejectedTarget[] = [];
  for (const handle of requested) {
    if (handle === sourceHandle) {
      rejected.push({ handle, reason: "source-target" });
      continue;
    }
    const target = entities.get(handle);
    if (!target) {
      rejected.push({ handle, reason: "missing" });
      continue;
    }
    if (lockedLayers.has(target.layerId)) {
      rejected.push({ handle, reason: "locked-layer" });
      continue;
    }
    const matched = matchCadEntityProperties(source, target, settings);
    if (sameEntity(matched, target)) {
      rejected.push({ handle, reason: "no-compatible-change" });
      continue;
    }
    changes.push({ type: "put", entity: matched });
    matchedHandles.push(handle);
  }
  return { changes, sourceHandle, targetHandles: requested, matchedHandles, rejected, settings };
}
