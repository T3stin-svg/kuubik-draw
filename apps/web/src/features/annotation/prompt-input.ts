import type { CreateTableArgs, HatchEditPatch, HatchIslandDetection, LeaderArrowType, LeaderEditPatch, MLeaderEditPatch, MTextContract, MTextEditPatch, StableEntityAnchor, TableEditOperation, TableStyle } from "@kuubik/cad-core";
import type { CadDimensionStyle, CadPoint2, CadTextStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AnnotationCommandInput } from "./command-adapter.js";
import type { AnnotationCommandId } from "./model.js";
import type { CommandPromptValue } from "./prompt-state-machine.js";

export interface AnnotationBlockPromptContext {
  activeLayerId?: string;
  selectedHandles?: readonly string[];
  dimensionAnchors?: readonly StableEntityAnchor[];
  leaderAnchor?: StableEntityAnchor;
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

function leaderAssociation(values: Readonly<Record<string, CommandPromptValue>>, context: AnnotationBlockPromptContext): { anchor?: StableEntityAnchor; targetHandles?: string[] } {
  if (!(optional<boolean>(values, "associative") ?? false)) return {};
  if (!context.leaderAnchor) throw new RangeError("Associative LEADER/MLEADER requires a stable anchor from the shell context.");
  return { anchor: structuredClone(context.leaderAnchor), targetHandles: [context.leaderAnchor.handle] };
}

function selectedOrPrompt(values: Readonly<Record<string, CommandPromptValue>>, context: AnnotationBlockPromptContext): string {
  const selected = [...new Set(context.selectedHandles ?? [])];
  if (selected.length > 1) throw new RangeError("Annotation edit requires exactly one selected handle.");
  return selected[0] ?? required<string>(values, "targetHandle");
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
    case "DIMBASELINE": {
      const points = required<CadPoint2[]>(values, "points");
      const handles = allocateDocumentHandles(document, points.length - 1);
      const linked = association(values, context);
      if (linked.anchors && linked.anchors.length !== points.length) throw new RangeError("Associative baseline DIM requires one stable anchor per point.");
      return { commandId, args: { handles, layerId, styleId: required<string>(values, "styleId"), points, dimensionLinePoints: required<CadPoint2[]>(values, "dimensionLinePoints"), axis: required<"horizontal" | "vertical">(values, "axis"), chainId: required<string>(values, "chainId"), ...(linked.anchors ? { anchors: linked.anchors } : {}) }, ...(linked.targetHandles ? { targetHandles: linked.targetHandles } : {}) };
    }
    case "DIMSTYLE": {
      const mode = required<"create" | "update" | "apply">(values, "mode");
      if (mode === "apply") return { commandId, mode, styleId: required<string>(values, "styleId"), targetHandles: [...new Set(context.selectedHandles ?? [])] };
      return { commandId, mode, style: required<CadDimensionStyle>(values, "style") };
    }
    case "TEXT": {
      const rotationRad = optional<number>(values, "rotationRad");
      const styleId = optional<string>(values, "styleId");
      return { commandId, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, position: required<CadPoint2>(values, "position"), text: required<string>(values, "text"), height: required<number>(values, "height"), ...(rotationRad === undefined ? {} : { rotationRad }), ...(styleId ? { styleId } : {}) } };
    }
    case "MTEXT": {
      const mode = optional<"create" | "edit">(values, "mode") ?? "create";
      if (mode === "edit") return { commandId, mode, handle: selectedOrPrompt(values, context), patch: required<MTextEditPatch>(values, "patch") };
      const rotationRad = optional<number>(values, "rotationRad");
      const styleId = optional<string>(values, "styleId");
      const attachment = optional<"top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right">(values, "attachment");
      const lineSpacingFactor = optional<number>(values, "lineSpacingFactor");
      const wrapMode = optional<MTextContract["wrapMode"]>(values, "wrapMode");
      const paragraphs = optional<MTextContract["paragraphs"]>(values, "paragraphs");
      return { commandId, mode, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, position: required<CadPoint2>(values, "position"), text: required<string>(values, "text"), height: required<number>(values, "height"), width: required<number>(values, "width"), ...(rotationRad === undefined ? {} : { rotationRad }), ...(styleId ? { styleId } : {}), ...(attachment ? { attachment } : {}), ...(lineSpacingFactor === undefined ? {} : { lineSpacingFactor }), ...(wrapMode ? { wrapMode } : {}), ...(paragraphs ? { paragraphs } : {}) } };
    }
    case "STYLE": {
      const mode = required<"create" | "update" | "apply">(values, "mode");
      if (mode === "apply") return { commandId, mode, styleId: required<string>(values, "styleId"), targetHandles: [...new Set(context.selectedHandles ?? [])] };
      return { commandId, mode, style: required<CadTextStyle>(values, "style") };
    }
    case "LEADER": {
      const mode = optional<"create" | "edit">(values, "mode") ?? "create";
      if (mode === "edit") return { commandId, mode, handle: selectedOrPrompt(values, context), patch: required<LeaderEditPatch>(values, "patch") };
      const text = optional<string>(values, "text");
      const link = leaderAssociation(values, context);
      const contentPosition = optional<CadPoint2>(values, "contentPosition"); const textStyleId = optional<string>(values, "textStyleId");
      const textHeight = optional<number>(values, "textHeight"); const arrowType = optional<LeaderArrowType>(values, "arrowType");
      const arrowSize = optional<number>(values, "arrowSize"); const landingEnabled = optional<boolean>(values, "landingEnabled"); const landingLength = optional<number>(values, "landingLength");
      return { commandId, mode, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, vertices: required<CadPoint2[]>(values, "vertices"), ...(text === undefined ? {} : { text }), ...(contentPosition ? { contentPosition } : {}), ...(textStyleId ? { textStyleId } : {}), ...(textHeight === undefined ? {} : { textHeight }), ...(arrowType ? { arrowType } : {}), ...(arrowSize === undefined ? {} : { arrowSize }), ...(landingEnabled === undefined ? {} : { landingEnabled }), ...(landingLength === undefined ? {} : { landingLength }), ...(link.anchor ? { anchor: link.anchor } : {}) }, ...(link.targetHandles ? { targetHandles: link.targetHandles } : {}) };
    }
    case "MLEADER": {
      const mode = optional<"create" | "edit">(values, "mode") ?? "create";
      if (mode === "edit") return { commandId, mode, handle: selectedOrPrompt(values, context), patch: required<MLeaderEditPatch>(values, "patch") };
      const textStyleId = optional<string>(values, "textStyleId");
      const landingGap = optional<number>(values, "landingGap");
      const link = leaderAssociation(values, context); const arrowType = optional<LeaderArrowType>(values, "arrowType");
      const arrowSize = optional<number>(values, "arrowSize"); const landingEnabled = optional<boolean>(values, "landingEnabled"); const landingLength = optional<number>(values, "landingLength");
      return { commandId, mode, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, vertices: required<CadPoint2[]>(values, "vertices"), text: required<string>(values, "text"), textPosition: required<CadPoint2>(values, "textPosition"), styleId: required<string>(values, "styleId"), textHeight: required<number>(values, "textHeight"), ...(textStyleId ? { textStyleId } : {}), ...(landingGap === undefined ? {} : { landingGap }), ...(arrowType ? { arrowType } : {}), ...(arrowSize === undefined ? {} : { arrowSize }), ...(landingEnabled === undefined ? {} : { landingEnabled }), ...(landingLength === undefined ? {} : { landingLength }), ...(link.anchor ? { anchor: link.anchor } : {}) }, ...(link.targetHandles ? { targetHandles: link.targetHandles } : {}) };
    }
    case "HATCH": {
      const mode = optional<"create" | "edit">(values, "mode") ?? "create";
      if (mode === "edit") return { commandId, mode, handle: selectedOrPrompt(values, context), patch: required<HatchEditPatch>(values, "patch") };
      const boundaryHandles = required<string[]>(values, "boundaryHandles");
      const origin = optional<CadPoint2>(values, "origin");
      const islandDetection = optional<HatchIslandDetection>(values, "islandDetection");
      return { commandId, mode, args: { handle: allocateDocumentHandles(document, 1)[0]!, layerId, boundaryHandles, pattern: required<string>(values, "pattern"), angleRad: required<number>(values, "angleRad"), scale: required<number>(values, "scale"), associative: required<boolean>(values, "associative"), ...(islandDetection ? { islandDetection } : {}), ...(origin ? { origin } : {}) }, targetHandles: boundaryHandles };
    }
    case "TABLE": {
      const mode = required<"create" | "edit" | "style-create" | "style-update">(values, "mode");
      if (mode === "create") {
        const definition = required<Omit<CreateTableArgs, "handle" | "layerId">>(values, "definition");
        return { commandId, mode, args: { ...definition, handle: allocateDocumentHandles(document, 1)[0]!, layerId } };
      }
      if (mode === "edit") {
        const selected = [...new Set(context.selectedHandles ?? [])];
        const handle = selected.length === 1 ? selected[0]! : required<string>(values, "tableHandle");
        return { commandId, mode, handle, operations: required<TableEditOperation[]>(values, "operations") };
      }
      return { commandId, mode, style: required<TableStyle>(values, "style") };
    }
  }
}
