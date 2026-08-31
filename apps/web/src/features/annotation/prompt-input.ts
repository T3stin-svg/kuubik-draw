import type { StableEntityAnchor } from "@kuubik/cad-core";
import type { CadDimensionStyle, CadPoint2, CadTextStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AnnotationCommandInput } from "./command-adapter.js";
import type { AnnotationCommandId } from "./model.js";
import type { CommandPromptValue } from "./prompt-state-machine.js";

export interface AnnotationBlockPromptContext {
  activeLayerId?: string;
  selectedHandles?: readonly string[];
  dimensionAnchors?: readonly StableEntityAnchor[];
}

export function allocateDocumentHandles(document: KDrawDocumentV1, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("Handle allocation count must be a positive integer.");
  const used = new Set([...document.entities, ...document.blocks.flatMap((block) => block.entities)].map((entity) => entity.handle.toLocaleUpperCase("en-US")));
  let next = 0xfn;
  for (const handle of used) if (/^[0-9A-F]+$/u.test(handle)) {
    const value = BigInt(`0x${handle}`);
    if (value > next) next = value;
  }
  const handles: string[] = [];
  while (handles.length < count) {
    next += 1n;
    const handle = next.toString(16).toUpperCase();
    if (!used.has(handle)) {
      used.add(handle);
      handles.push(handle);
    }
  }
  return handles;
}

function required<T>(values: Readonly<Record<string, CommandPromptValue>>, id: string): T {
  if (!(id in values)) throw new RangeError(`Prompt value ${id} is required.`);
  return structuredClone(values[id]) as T;
}

function optional<T>(values: Readonly<Record<string, CommandPromptValue>>, id: string): T | undefined {
  return id in values ? structuredClone(values[id]) as T : undefined;
}

function association(values: Readonly<Record<string, CommandPromptValue>>, context: AnnotationBlockPromptContext): { anchors?: StableEntityAnchor[]; targetHandles?: string[] } {
  if (!required<boolean>(values, "associative")) return {};
  const anchors = [...structuredClone(context.dimensionAnchors ?? [])];
  if (!anchors.length) throw new RangeError("Associative DIM requires stable anchors from the shell context.");
  return { anchors, targetHandles: [...new Set(anchors.map((anchor) => anchor.handle))] };
}

function common(document: KDrawDocumentV1, values: Readonly<Record<string, CommandPromptValue>>, context: AnnotationBlockPromptContext) {
  return {
    handle: allocateDocumentHandles(document, 1)[0]!,
    layerId: context.activeLayerId ?? document.currentLayerId,
    styleId: required<string>(values, "styleId"),
  };
}

export function buildAnnotationPromptInput(
  document: KDrawDocumentV1,
  commandId: AnnotationCommandId,
  values: Readonly<Record<string, CommandPromptValue>>,
  context: AnnotationBlockPromptContext = {},
): AnnotationCommandInput {
  const layerId = context.activeLayerId ?? document.currentLayerId;
  switch (commandId) {
    case "DIMLINEAR": {
      const linked = association(values, context);
      return { commandId, args: { ...common(document, values, context), first: required<CadPoint2>(values, "first"), second: required<CadPoint2>(values, "second"), dimensionLinePoint: required<CadPoint2>(values, "dimensionLinePoint"), axis: required<"horizontal" | "vertical">(values, "axis"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMALIGNED": {
      const linked = association(values, context);
      return { commandId, args: { ...common(document, values, context), first: required<CadPoint2>(values, "first"), second: required<CadPoint2>(values, "second"), dimensionLinePoint: required<CadPoint2>(values, "dimensionLinePoint"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMANGULAR": {
      const linked = association(values, context);
      return { commandId, args: { ...common(document, values, context), vertex: required<CadPoint2>(values, "vertex"), firstRayPoint: required<CadPoint2>(values, "firstRayPoint"), secondRayPoint: required<CadPoint2>(values, "secondRayPoint"), arcPoint: required<CadPoint2>(values, "arcPoint"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMRADIUS":
    case "DIMDIAMETER": {
      const linked = association(values, context);
      return { commandId, args: { ...common(document, values, context), center: required<CadPoint2>(values, "center"), circumferencePoint: required<CadPoint2>(values, "circumferencePoint"), textPoint: required<CadPoint2>(values, "textPoint"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMCONTINUE": {
      const points = required<CadPoint2[]>(values, "points");
      const handles = allocateDocumentHandles(document, points.length - 1);
      const linked = association(values, context);
      if (linked.anchors && linked.anchors.length !== points.length) throw new RangeError("Associative continued DIM requires one stable anchor per point.");
      return { commandId, args: { handles, layerId, styleId: required<string>(values, "styleId"), points, dimensionLinePoint: required<CadPoint2>(values, "dimensionLinePoint"), axis: required<"horizontal" | "vertical">(values, "axis"), chainId: required<string>(values, "chainId"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMSTYLE": return { commandId, mode: required<"create" | "update">(values, "mode"), style: required<CadDimensionStyle>(values, "style") };
    case "TEXT": {
      const rotationRad = optional<number>(values, "rotationRad");
      const styleId = optional<string>(values, "styleId");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, position: required<CadPoint2>(values, "position"), text: required<string>(values, "text"), height: required<number>(values, "height"), ...(rotationRad === undefined ? {} : { rotationRad }), ...(styleId ? { styleId } : {}) } };
    }
    case "MTEXT": {
      const rotationRad = optional<number>(values, "rotationRad");
      const styleId = optional<string>(values, "styleId");
      const attachment = optional<"top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right">(values, "attachment");
      const lineSpacingFactor = optional<number>(values, "lineSpacingFactor");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, position: required<CadPoint2>(values, "position"), text: required<string>(values, "text"), height: required<number>(values, "height"), width: required<number>(values, "width"), ...(rotationRad === undefined ? {} : { rotationRad }), ...(styleId ? { styleId } : {}), ...(attachment ? { attachment } : {}), ...(lineSpacingFactor === undefined ? {} : { lineSpacingFactor }) } };
    }
    case "STYLE": return { commandId, mode: required<"create" | "update">(values, "mode"), style: required<CadTextStyle>(values, "style") };
    case "LEADER": {
      const text = optional<string>(values, "text");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, vertices: required<CadPoint2[]>(values, "vertices"), ...(text === undefined ? {} : { text }) } };
    }
    case "MLEADER": {
      const textStyleId = optional<string>(values, "textStyleId");
      const landingGap = optional<number>(values, "landingGap");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, vertices: required<CadPoint2[]>(values, "vertices"), text: required<string>(values, "text"), textPosition: required<CadPoint2>(values, "textPosition"), styleId: required<string>(values, "styleId"), textHeight: required<number>(values, "textHeight"), ...(textStyleId ? { textStyleId } : {}), ...(landingGap === undefined ? {} : { landingGap }) } };
    }
    case "HATCH": {
      const boundaryHandles = required<string[]>(values, "boundaryHandles");
      const origin = optional<CadPoint2>(values, "origin");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, boundaryHandles, pattern: required<string>(values, "pattern"), angleRad: required<number>(values, "angleRad"), scale: required<number>(values, "scale"), associative: required<boolean>(values, "associative"), ...(origin ? { origin } : {}) }, targetHandles: boundaryHandles };
    }
  }
}
