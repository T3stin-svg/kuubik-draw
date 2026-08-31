import type { CadDimension, CadDimensionStyle, CadEntity, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange, EntityChange } from "../transaction.js";
import { readDimensionAssociation, type StableEntityAnchor, withAnnotationExtension } from "./contracts.js";

const EPSILON = 1e-9;

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function ensureDimensionStyle(document: KDrawDocumentV1, styleId: string): void {
  if (!document.dimensionStyles.some((style) => style.id === styleId)) throw new RangeError(`Unknown dimension style: ${styleId}.`);
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
  if (!document.layers.some((layer) => layer.id === args.layerId)) throw new RangeError(`Unknown layer: ${args.layerId}.`);
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
      chain: { id: args.chainId, index, ...(index > 0 ? { previousDimensionHandle: args.handles[index - 1]! } : {}) },
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

export function createDimensionStyle(document: KDrawDocumentV1, style: CadDimensionStyle): CadChange {
  if (!style.id.trim() || !style.name.trim()) throw new TypeError("Dimension style id and name are required.");
  if (document.dimensionStyles.some((candidate) => candidate.id === style.id || candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Dimension style already exists: ${style.name}.`);
  if (![style.textHeight, style.arrowSize, style.scale].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(style.extensionOffset) || style.extensionOffset < 0) throw new RangeError("Dimension style sizes and scale must be finite and valid.");
  if (style.textStyleId && !document.textStyles.some((candidate) => candidate.id === style.textStyleId)) throw new RangeError(`Unknown text style: ${style.textStyleId}.`);
  return { type: "put-dimension-style", dimensionStyle: structuredClone(style) };
}

export function updateDimensionStyle(document: KDrawDocumentV1, style: CadDimensionStyle): CadChange {
  const existing = document.dimensionStyles.find((candidate) => candidate.id === style.id);
  if (!existing) throw new RangeError(`Unknown dimension style: ${style.id}.`);
  const withoutExisting = { ...document, dimensionStyles: document.dimensionStyles.filter((candidate) => candidate.id !== style.id) };
  const change = createDimensionStyle(withoutExisting, style);
  return change;
}
