import type { CadDimension, CadDimensionStyle, CadEntity, CadLinearUnit, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange, EntityChange } from "../transaction.js";
import { readDimensionAssociation, type StableEntityAnchor, withAnnotationExtension } from "./contracts.js";

const EPSILON = 1e-9;
export const DIMENSION_STYLE_OVERRIDE_KEY = "kuubik.dimensionStyle.v1" as const;

export type DimensionArrowType = "closed-filled" | "open" | "architectural-tick";
export type DimensionTolerance =
  | { mode: "none" }
  | { mode: "symmetric"; value: number; precision?: number }
  | { mode: "deviation"; upper: number; lower: number; precision?: number }
  | { mode: "limits"; upper: number; lower: number; precision?: number };

export interface DimensionStyleProfile {
  linearUnit?: CadLinearUnit;
  linearPrecision?: number;
  angularPrecision?: number;
  prefix?: string;
  suffix?: string;
  decimalSeparator?: "." | ",";
  roundingIncrement?: number;
  tolerance?: DimensionTolerance;
  arrowType?: DimensionArrowType;
  extensionBeyond?: number;
  textGap?: number;
}

export interface DimensionLineGeometry { start: CadPoint2; end: CadPoint2 }
export interface DimensionArrowGeometry { tip: CadPoint2; direction: CadPoint2; size: number; type: DimensionArrowType }
export interface DimensionArcGeometry { center: CadPoint2; radius: number; startAngleRad: number; endAngleRad: number }
export interface DimensionPresentation {
  handle: string;
  styleId: string;
  measurement: number;
  formattedText: string;
  text: { position: CadPoint2; rotationRad: number; height: number; gap: number };
  dimensionLines: DimensionLineGeometry[];
  extensionLines: DimensionLineGeometry[];
  arrows: DimensionArrowGeometry[];
  arc?: DimensionArcGeometry;
}

export type DimensionCapability =
  | { executable: true; code: "ready" }
  | { executable: false; code: "missing-dimension" | "locked-layer" | "orphan-association"; handle: string };

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function ensureDimensionStyle(document: KDrawDocumentV1, styleId: string): void {
  if (!document.dimensionStyles.some((style) => style.id === styleId)) throw new RangeError(`Unknown dimension style: ${styleId}.`);
}

function ensureWritableLayer(document: KDrawDocumentV1, layerId: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${layerId}.`);
  if (layer.locked) throw new RangeError(`Layer is locked: ${layerId}.`);
}

function handleExists(document: KDrawDocumentV1, handle: string): boolean {
  return [...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle === handle);
}

function baseDimension(
  document: KDrawDocumentV1,
  args: { handle: string; layerId: string; styleId: string; dimensionKind: CadDimension["dimensionKind"]; definitionPoints: CadPoint2[]; anchors?: StableEntityAnchor[]; linearAxis?: "horizontal" | "vertical"; overrideText?: string },
): CadDimension {
  if (!args.handle.trim()) throw new TypeError("Dimension handle is required.");
  if (handleExists(document, args.handle)) throw new RangeError(`Duplicate entity handle: ${args.handle}.`);
  ensureWritableLayer(document, args.layerId);
  ensureDimensionStyle(document, args.styleId);
  const entity: CadDimension = {
    kind: "dimension",
    handle: args.handle,
    layerId: args.layerId,
    dimensionKind: args.dimensionKind,
    definitionPoints: args.definitionPoints.map((point, index) => finitePoint(point, `Definition point ${index}`)),
    styleId: args.styleId,
    ...(args.overrideText === undefined ? {} : { overrideText: args.overrideText }),
  };
  return withAnnotationExtension(entity, {
    kind: "dimension",
    associative: (args.anchors?.length ?? 0) > 0,
    anchors: structuredClone(args.anchors ?? []),
    ...(args.linearAxis ? { linearAxis: args.linearAxis } : {}),
  });
}

export interface DimensionBaseArgs {
  handle: string;
  layerId: string;
  styleId: string;
  first: CadPoint2;
  second: CadPoint2;
  dimensionLinePoint: CadPoint2;
  anchors?: StableEntityAnchor[];
  overrideText?: string;
}

export function createLinearDimension(document: KDrawDocumentV1, args: DimensionBaseArgs & { axis: "horizontal" | "vertical" }): CadDimension {
  const first = finitePoint(args.first, "First extension point");
  const second = finitePoint(args.second, "Second extension point");
  const line = finitePoint(args.dimensionLinePoint, "Dimension line point");
  return baseDimension(document, { ...args, dimensionKind: "linear", definitionPoints: [first, second, line, line], linearAxis: args.axis });
}

export function createAlignedDimension(document: KDrawDocumentV1, args: DimensionBaseArgs): CadDimension {
  const first = finitePoint(args.first, "First extension point");
  const second = finitePoint(args.second, "Second extension point");
  if (Math.hypot(second.x - first.x, second.y - first.y) <= EPSILON) throw new RangeError("Aligned dimension requires distinct extension points.");
  const line = finitePoint(args.dimensionLinePoint, "Dimension line point");
  return baseDimension(document, { ...args, dimensionKind: "aligned", definitionPoints: [first, second, line, line] });
}

export function createAngularDimension(document: KDrawDocumentV1, args: Omit<DimensionBaseArgs, "first" | "second" | "dimensionLinePoint"> & { vertex: CadPoint2; firstRayPoint: CadPoint2; secondRayPoint: CadPoint2; arcPoint: CadPoint2 }): CadDimension {
  const vertex = finitePoint(args.vertex, "Angular vertex");
  const first = finitePoint(args.firstRayPoint, "First ray point");
  const second = finitePoint(args.secondRayPoint, "Second ray point");
  if (Math.hypot(first.x - vertex.x, first.y - vertex.y) <= EPSILON || Math.hypot(second.x - vertex.x, second.y - vertex.y) <= EPSILON) throw new RangeError("Angular dimension rays must be non-zero.");
  return baseDimension(document, { ...args, dimensionKind: "angular", definitionPoints: [vertex, first, second, finitePoint(args.arcPoint, "Arc point")] });
}

export function createRadialDimension(document: KDrawDocumentV1, args: Omit<DimensionBaseArgs, "first" | "second" | "dimensionLinePoint"> & { center: CadPoint2; circumferencePoint: CadPoint2; textPoint: CadPoint2; diameter?: boolean }): CadDimension {
  const center = finitePoint(args.center, "Circle center");
  const circumference = finitePoint(args.circumferencePoint, "Circumference point");
  if (Math.hypot(circumference.x - center.x, circumference.y - center.y) <= EPSILON) throw new RangeError("Radial dimension radius must be positive.");
  return baseDimension(document, { ...args, dimensionKind: args.diameter ? "diameter" : "radial", definitionPoints: [center, circumference, finitePoint(args.textPoint, "Text point")] });
}

export function createContinuedDimensions(
  document: KDrawDocumentV1,
  args: { handles: string[]; layerId: string; styleId: string; points: CadPoint2[]; dimensionLinePoint: CadPoint2; axis: "horizontal" | "vertical"; chainId: string; anchors?: StableEntityAnchor[] },
): CadDimension[] {
  if (args.points.length < 3 || args.handles.length !== args.points.length - 1) throw new RangeError("Continued dimension requires N points and N-1 handles.");
  if (new Set(args.handles).size !== args.handles.length) throw new RangeError("Continued dimension handles must be unique.");
  if (!args.chainId.trim()) throw new TypeError("Dimension chain id is required.");
  const result: CadDimension[] = [];
  for (let index = 0; index < args.handles.length; index += 1) {
    const anchors = args.anchors?.slice(index, index + 2);
    const entity = createLinearDimension(document, {
      handle: args.handles[index]!, layerId: args.layerId, styleId: args.styleId,
      first: args.points[index]!, second: args.points[index + 1]!, dimensionLinePoint: args.dimensionLinePoint,
      axis: args.axis, ...(anchors?.length ? { anchors } : {}),
    });
    const association = readDimensionAssociation(entity)!;
    result.push(withAnnotationExtension(entity, {
      ...association,
      chain: { id: args.chainId, index, mode: "continued", ...(index > 0 ? { previousDimensionHandle: args.handles[index - 1]! } : {}) },
    }));
  }
  return result;
}

export function createBaselineDimensions(
  document: KDrawDocumentV1,
  args: { handles: string[]; layerId: string; styleId: string; points: CadPoint2[]; dimensionLinePoints: CadPoint2[]; axis: "horizontal" | "vertical"; chainId: string; anchors?: StableEntityAnchor[] },
): CadDimension[] {
  if (args.points.length < 3 || args.handles.length !== args.points.length - 1 || args.dimensionLinePoints.length !== args.handles.length) {
    throw new RangeError("Baseline dimension requires N points, N-1 handles and N-1 dimension-line points.");
  }
  if (new Set(args.handles).size !== args.handles.length) throw new RangeError("Baseline dimension handles must be unique.");
  if (!args.chainId.trim()) throw new TypeError("Dimension chain id is required.");
  const result: CadDimension[] = [];
  for (let index = 0; index < args.handles.length; index += 1) {
    const anchors = args.anchors ? [args.anchors[0]!, args.anchors[index + 1]!].filter(Boolean) : undefined;
    const entity = createLinearDimension(document, {
      handle: args.handles[index]!, layerId: args.layerId, styleId: args.styleId,
      first: args.points[0]!, second: args.points[index + 1]!, dimensionLinePoint: args.dimensionLinePoints[index]!,
      axis: args.axis, ...(anchors?.length ? { anchors } : {}),
    });
    const association = readDimensionAssociation(entity)!;
    result.push(withAnnotationExtension(entity, {
      ...association,
      chain: { id: args.chainId, index, mode: "baseline", ...(index > 0 ? { baselineDimensionHandle: args.handles[0]! } : {}) },
    }));
  }
  return result;
}

export function resolveStableAnchor(document: KDrawDocumentV1, anchor: StableEntityAnchor): CadPoint2 | null {
  const entity = document.entities.find((candidate) => candidate.handle === anchor.handle);
  if (!entity) return null;
  if (anchor.feature === "start" && entity.kind === "line") return structuredClone(entity.start);
  if (anchor.feature === "end" && entity.kind === "line") return structuredClone(entity.end);
  if (anchor.feature === "center" && (entity.kind === "circle" || entity.kind === "arc" || entity.kind === "ellipse")) return structuredClone(entity.center);
  if (anchor.feature === "insertion" && entity.kind === "blockRef") return structuredClone(entity.insertion);
  if (anchor.feature === "position" && (entity.kind === "text" || entity.kind === "mtext")) return structuredClone(entity.position);
  if (anchor.feature === "vertex" && entity.kind === "polyline" && anchor.vertexIndex !== undefined) {
    const vertex = entity.vertices[anchor.vertexIndex];
    return vertex ? { x: vertex.x, y: vertex.y } : null;
  }
  return null;
}

export interface AssociationUpdateResult {
  changes: EntityChange[];
  updatedHandles: string[];
  broken: Array<{ dimensionHandle: string; targetHandle: string }>;
}

export function updateAssociativeDimensions(document: KDrawDocumentV1, changedHandles: readonly string[]): AssociationUpdateResult {
  const changed = new Set(changedHandles);
  const changes: EntityChange[] = [];
  const updatedHandles: string[] = [];
  const broken: AssociationUpdateResult["broken"] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "dimension") continue;
    const association = readDimensionAssociation(entity);
    if (!association?.associative || !association.anchors.some((anchor) => changed.has(anchor.handle))) continue;
    if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) throw new RangeError(`Associative dimension ${entity.handle} is on locked layer ${entity.layerId}.`);
    const resolved = association.anchors.map((anchor) => resolveStableAnchor(document, anchor));
    resolved.forEach((point, index) => {
      if (!point) broken.push({ dimensionHandle: entity.handle, targetHandle: association.anchors[index]!.handle });
    });
    if (resolved.some((point) => point === null)) continue;
    const next = structuredClone(entity);
    resolved.forEach((point, index) => {
      if (index < next.definitionPoints.length) next.definitionPoints[index] = point!;
    });
    if (JSON.stringify(next.definitionPoints) !== JSON.stringify(entity.definitionPoints)) {
      changes.push({ type: "put", entity: next });
      updatedHandles.push(entity.handle);
    }
  }
  return { changes, updatedHandles, broken };
}

export function evaluateDimensionCapability(document: KDrawDocumentV1, dimensionHandle: string): DimensionCapability {
  const entity = document.entities.find((candidate) => candidate.handle === dimensionHandle);
  if (!entity || entity.kind !== "dimension") return { executable: false, code: "missing-dimension", handle: dimensionHandle };
  if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) return { executable: false, code: "locked-layer", handle: entity.layerId };
  const association = readDimensionAssociation(entity);
  if (association?.associative) {
    const orphan = association.anchors.find((anchor) => resolveStableAnchor(document, anchor) === null);
    if (orphan) return { executable: false, code: "orphan-association", handle: orphan.handle };
  }
  return { executable: true, code: "ready" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readDimensionStyleProfile(style: CadDimensionStyle): DimensionStyleProfile {
  const raw = style.overrides?.[DIMENSION_STYLE_OVERRIDE_KEY];
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new TypeError(`${DIMENSION_STYLE_OVERRIDE_KEY} must be an object.`);
  const profile = structuredClone(raw) as DimensionStyleProfile;
  if (profile.linearUnit !== undefined && !["unitless", "mm", "cm", "m", "in", "ft"].includes(profile.linearUnit)) throw new RangeError("Unsupported dimension linear unit.");
  for (const [label, value] of [["linearPrecision", profile.linearPrecision], ["angularPrecision", profile.angularPrecision]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 12)) throw new RangeError(`${label} must be an integer from 0 to 12.`);
  }
  if (profile.decimalSeparator !== undefined && profile.decimalSeparator !== "." && profile.decimalSeparator !== ",") throw new RangeError("Unsupported decimal separator.");
  if (profile.prefix !== undefined && typeof profile.prefix !== "string") throw new TypeError("Dimension prefix must be a string.");
  if (profile.suffix !== undefined && typeof profile.suffix !== "string") throw new TypeError("Dimension suffix must be a string.");
  if (profile.roundingIncrement !== undefined && (!(profile.roundingIncrement > 0) || !Number.isFinite(profile.roundingIncrement))) throw new RangeError("Rounding increment must be positive and finite.");
  if (profile.extensionBeyond !== undefined && !finiteNonNegative(profile.extensionBeyond)) throw new RangeError("Extension beyond must be non-negative and finite.");
  if (profile.textGap !== undefined && !finiteNonNegative(profile.textGap)) throw new RangeError("Text gap must be non-negative and finite.");
  if (profile.arrowType !== undefined && !["closed-filled", "open", "architectural-tick"].includes(profile.arrowType)) throw new RangeError("Unsupported arrow type.");
  const tolerance = profile.tolerance;
  if (tolerance) {
    if (tolerance.mode === "symmetric" && !finiteNonNegative(tolerance.value)) throw new RangeError("Symmetric tolerance must be non-negative and finite.");
    if ((tolerance.mode === "deviation" || tolerance.mode === "limits") && (!finiteNonNegative(tolerance.upper) || !finiteNonNegative(tolerance.lower))) throw new RangeError("Tolerance deviations must be non-negative and finite.");
    if (!["none", "symmetric", "deviation", "limits"].includes(tolerance.mode)) throw new RangeError("Unsupported tolerance mode.");
    if ("precision" in tolerance && tolerance.precision !== undefined && (!Number.isInteger(tolerance.precision) || tolerance.precision < 0 || tolerance.precision > 12)) throw new RangeError("Tolerance precision must be an integer from 0 to 12.");
  }
  return profile;
}

function unitToMillimetres(unit: CadLinearUnit): number {
  return { unitless: 1, mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit];
}

function convertLinear(value: number, from: CadLinearUnit, to: CadLinearUnit): number {
  if (from === "unitless" || to === "unitless") return value;
  return value * unitToMillimetres(from) / unitToMillimetres(to);
}

function fixed(value: number, precision: number, separator: "." | ","): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(precision).replace(".", separator);
}

function formatMeasurement(value: number, angular: boolean, document: KDrawDocumentV1, style: CadDimensionStyle, profile: DimensionStyleProfile): string {
  const separator = profile.decimalSeparator ?? ".";
  const precision = angular ? profile.angularPrecision ?? document.units.angularPrecision : profile.linearPrecision ?? document.units.displayPrecision;
  let displayValue = angular ? value * 180 / Math.PI : convertLinear(value, document.units.linear, profile.linearUnit ?? document.units.linear);
  if (profile.roundingIncrement) displayValue = Math.round(displayValue / profile.roundingIncrement) * profile.roundingIncrement;
  let text = `${profile.prefix ?? ""}${fixed(displayValue, precision, separator)}${angular ? "°" : profile.suffix ?? ""}`;
  const tolerance = profile.tolerance;
  if (!tolerance || tolerance.mode === "none") return text;
  const tolerancePrecision = tolerance.precision ?? precision;
  if (tolerance.mode === "symmetric") text += ` ±${fixed(tolerance.value, tolerancePrecision, separator)}`;
  if (tolerance.mode === "deviation") text += ` +${fixed(tolerance.upper, tolerancePrecision, separator)}/-${fixed(tolerance.lower, tolerancePrecision, separator)}`;
  if (tolerance.mode === "limits") text = `${profile.prefix ?? ""}${fixed(displayValue + tolerance.upper, tolerancePrecision, separator)}${angular ? "°" : profile.suffix ?? ""}/${profile.prefix ?? ""}${fixed(displayValue - tolerance.lower, tolerancePrecision, separator)}${angular ? "°" : profile.suffix ?? ""}`;
  return text;
}

function normalize(vector: CadPoint2): CadPoint2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPSILON) throw new RangeError("Dimension geometry contains a zero-length direction.");
  return { x: vector.x / length, y: vector.y / length };
}

function normalizeOr(vector: CadPoint2, fallback: CadPoint2): CadPoint2 {
  return Math.hypot(vector.x, vector.y) <= EPSILON ? structuredClone(fallback) : normalize(vector);
}

function add(point: CadPoint2, vector: CadPoint2, factor = 1): CadPoint2 { return { x: point.x + vector.x * factor, y: point.y + vector.y * factor }; }
function subtract(first: CadPoint2, second: CadPoint2): CadPoint2 { return { x: first.x - second.x, y: first.y - second.y }; }
function dot(first: CadPoint2, second: CadPoint2): number { return first.x * second.x + first.y * second.y; }
function negate(vector: CadPoint2): CadPoint2 { return { x: vector.x === 0 ? 0 : -vector.x, y: vector.y === 0 ? 0 : -vector.y }; }

export function deriveDimensionPresentation(document: KDrawDocumentV1, dimension: CadDimension): DimensionPresentation {
  const style = document.dimensionStyles.find((candidate) => candidate.id === dimension.styleId);
  if (!style) throw new RangeError(`Unknown dimension style: ${dimension.styleId}.`);
  const profile = readDimensionStyleProfile(style);
  const association = readDimensionAssociation(dimension);
  const arrowType = profile.arrowType ?? "closed-filled";
  const arrowSize = style.arrowSize * style.scale;
  const extensionOffset = style.extensionOffset * style.scale;
  const extensionBeyond = (profile.extensionBeyond ?? style.extensionOffset) * style.scale;
  const textGap = (profile.textGap ?? 0.625) * style.scale;
  const point = (index: number) => dimension.definitionPoints[index] ?? (() => { throw new RangeError(`Dimension ${dimension.handle} is missing definition point ${index}.`); })();
  let measurement: number;
  let rotationRad = 0;
  let textPosition = structuredClone(point(dimension.dimensionKind === "radial" || dimension.dimensionKind === "diameter" ? 2 : 3));
  let dimensionLines: DimensionLineGeometry[] = [];
  let extensionLines: DimensionLineGeometry[] = [];
  let arrows: DimensionArrowGeometry[] = [];
  let arc: DimensionArcGeometry | undefined;
  let angular = false;
  if (dimension.dimensionKind === "linear" || dimension.dimensionKind === "aligned") {
    const first = point(0); const second = point(1); const linePoint = point(2);
    const direction = dimension.dimensionKind === "linear"
      ? (association?.linearAxis === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 })
      : normalize(subtract(second, first));
    const normal = { x: -direction.y, y: direction.x };
    const firstProjection = add(linePoint, direction, dot(subtract(first, linePoint), direction));
    const secondProjection = add(linePoint, direction, dot(subtract(second, linePoint), direction));
    const firstOffsetDirection = normalizeOr(subtract(firstProjection, first), normal);
    const secondOffsetDirection = normalizeOr(subtract(secondProjection, second), normal);
    extensionLines = [
      { start: add(first, firstOffsetDirection, extensionOffset), end: add(firstProjection, firstOffsetDirection, extensionBeyond) },
      { start: add(second, secondOffsetDirection, extensionOffset), end: add(secondProjection, secondOffsetDirection, extensionBeyond) },
    ];
    dimensionLines = [{ start: firstProjection, end: secondProjection }];
    arrows = [
      { tip: firstProjection, direction, size: arrowSize, type: arrowType },
      { tip: secondProjection, direction: negate(direction), size: arrowSize, type: arrowType },
    ];
    measurement = Math.abs(dot(subtract(second, first), direction));
    rotationRad = Math.atan2(direction.y, direction.x);
  } else if (dimension.dimensionKind === "angular") {
    angular = true;
    const center = point(0); const first = point(1); const second = point(2); const arcPoint = point(3);
    const firstDirection = normalize(subtract(first, center));
    const secondDirection = normalize(subtract(second, center));
    measurement = Math.acos(Math.max(-1, Math.min(1, dot(firstDirection, secondDirection))));
    const radius = Math.hypot(arcPoint.x - center.x, arcPoint.y - center.y);
    const start = Math.atan2(firstDirection.y, firstDirection.x);
    const end = Math.atan2(secondDirection.y, secondDirection.x);
    arc = { center: structuredClone(center), radius, startAngleRad: start, endAngleRad: end };
    const firstTip = add(center, firstDirection, radius); const secondTip = add(center, secondDirection, radius);
    arrows = [
      { tip: firstTip, direction: { x: -firstDirection.y, y: firstDirection.x }, size: arrowSize, type: arrowType },
      { tip: secondTip, direction: { x: secondDirection.y, y: -secondDirection.x }, size: arrowSize, type: arrowType },
    ];
  } else if (dimension.dimensionKind === "radial" || dimension.dimensionKind === "diameter") {
    const center = point(0); const circumference = point(1); const direction = normalize(subtract(circumference, center));
    const radius = Math.hypot(circumference.x - center.x, circumference.y - center.y);
    measurement = dimension.dimensionKind === "diameter" ? radius * 2 : radius;
    const opposite = add(center, direction, -radius);
    dimensionLines = [{ start: dimension.dimensionKind === "diameter" ? opposite : center, end: circumference }];
    arrows = [{ tip: circumference, direction: negate(direction), size: arrowSize, type: arrowType }];
    if (dimension.dimensionKind === "diameter") arrows.push({ tip: opposite, direction, size: arrowSize, type: arrowType });
    rotationRad = Math.atan2(direction.y, direction.x);
  } else throw new RangeError(`Dimension presentation does not support ${dimension.dimensionKind}.`);
  return {
    handle: dimension.handle,
    styleId: dimension.styleId,
    measurement,
    formattedText: dimension.overrideText ?? formatMeasurement(measurement, angular, document, style, profile),
    text: { position: textPosition, rotationRad, height: style.textHeight * style.scale, gap: textGap },
    dimensionLines,
    extensionLines,
    arrows,
    ...(arc ? { arc } : {}),
  };
}

export function createDimensionStyle(document: KDrawDocumentV1, style: CadDimensionStyle): CadChange {
  if (!style.id.trim() || !style.name.trim()) throw new TypeError("Dimension style id and name are required.");
  if (document.dimensionStyles.some((candidate) => candidate.id === style.id || candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Dimension style already exists: ${style.name}.`);
  if (![style.textHeight, style.arrowSize, style.scale].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(style.extensionOffset) || style.extensionOffset < 0) throw new RangeError("Dimension style sizes and scale must be finite and valid.");
  if (style.textStyleId && !document.textStyles.some((candidate) => candidate.id === style.textStyleId)) throw new RangeError(`Unknown text style: ${style.textStyleId}.`);
  readDimensionStyleProfile(style);
  return { type: "put-dimension-style", dimensionStyle: structuredClone(style) };
}

export function applyDimensionStyle(document: KDrawDocumentV1, styleId: string, dimensionHandles: readonly string[]): EntityChange[] {
  ensureDimensionStyle(document, styleId);
  const uniqueHandles = [...new Set(dimensionHandles)];
  if (!uniqueHandles.length) throw new RangeError("DIMSTYLE apply requires at least one dimension.");
  return uniqueHandles.map((handle) => {
    const entity = document.entities.find((candidate) => candidate.handle === handle);
    if (!entity || entity.kind !== "dimension") throw new RangeError(`Unknown dimension: ${handle}.`);
    ensureWritableLayer(document, entity.layerId);
    return { type: "put", entity: { ...structuredClone(entity), styleId } };
  });
}

export function updateDimensionStyle(document: KDrawDocumentV1, style: CadDimensionStyle): CadChange {
  const existing = document.dimensionStyles.find((candidate) => candidate.id === style.id);
  if (!existing) throw new RangeError(`Unknown dimension style: ${style.id}.`);
  const withoutExisting = { ...document, dimensionStyles: document.dimensionStyles.filter((candidate) => candidate.id !== style.id) };
  const change = createDimensionStyle(withoutExisting, style);
  return change;
}
