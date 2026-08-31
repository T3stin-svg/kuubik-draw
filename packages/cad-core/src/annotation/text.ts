import type { CadLeader, CadPoint2, CadText, CadTextStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange, EntityChange } from "../transaction.js";
import { readLeaderContract, readMTextContract, withAnnotationExtension, type LeaderArrowType, type MTextContract, type StableEntityAnchor } from "./contracts.js";
import { resolveStableAnchor } from "./dimensions.js";

function validatePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function ensureWritableLayer(document: KDrawDocumentV1, layerId: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${layerId}.`);
  if (layer.locked) throw new RangeError(`Layer is locked: ${layerId}.`);
}

function validateEntityIdentity(document: KDrawDocumentV1, handle: string, layerId: string): void {
  if (!handle.trim()) throw new TypeError("Entity handle is required.");
  const normalizedHandle = handle.toLocaleUpperCase("en-US");
  if ([...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle.toLocaleUpperCase("en-US") === normalizedHandle)) throw new RangeError(`Duplicate entity handle: ${handle}.`);
  ensureWritableLayer(document, layerId);
}

function validateStyleReference(document: KDrawDocumentV1, styleId: string | undefined): void {
  if (styleId && !document.textStyles.some((style) => style.id === styleId)) throw new RangeError(`Unknown text style: ${styleId}.`);
}

function validateAnchor(document: KDrawDocumentV1, anchor: StableEntityAnchor | undefined): CadPoint2 | undefined {
  if (anchor === undefined) return undefined;
  if (anchor === null || typeof anchor !== "object") throw new TypeError("Leader anchor must be a stable entity anchor.");
  const point = resolveStableAnchor(document, anchor);
  if (!point) throw new RangeError(`Orphan leader association: ${anchor.handle}.`);
  return point;
}

export interface MTextArgs {
  handle: string; layerId: string; position: CadPoint2; text: string; height: number; rotationRad?: number; styleId?: string; width: number;
  attachment?: MTextContract["attachment"]; lineSpacingFactor?: number; wrapMode?: MTextContract["wrapMode"]; paragraphs?: MTextContract["paragraphs"];
}

export interface MTextEditPatch {
  position?: CadPoint2; text?: string; height?: number; rotationRad?: number; styleId?: string | null; width?: number;
  attachment?: MTextContract["attachment"]; lineSpacingFactor?: number; wrapMode?: MTextContract["wrapMode"]; paragraphs?: MTextContract["paragraphs"];
}

export interface TextArgs { handle: string; layerId: string; position: CadPoint2; text: string; height: number; rotationRad?: number; styleId?: string }

export interface LeaderArgs {
  handle: string; layerId: string; vertices: CadPoint2[]; text?: string; contentPosition?: CadPoint2; textStyleId?: string; textHeight?: number;
  arrowType?: LeaderArrowType; arrowSize?: number; landingEnabled?: boolean; landingLength?: number; anchor?: StableEntityAnchor;
}

export interface MLeaderArgs {
  handle: string; layerId: string; vertices: CadPoint2[]; text: string; textPosition: CadPoint2; styleId: string; textStyleId?: string; textHeight: number;
  landingGap?: number; arrowType?: LeaderArrowType; arrowSize?: number; landingEnabled?: boolean; landingLength?: number; anchor?: StableEntityAnchor;
}

export type LeaderEditPatch = Partial<Omit<LeaderArgs, "handle" | "layerId" | "text" | "textStyleId" | "anchor">> & {
  text?: string | null;
  textStyleId?: string | null;
  anchor?: StableEntityAnchor | null;
};
export type MLeaderEditPatch = Partial<Omit<MLeaderArgs, "handle" | "layerId" | "textStyleId" | "anchor">> & {
  textStyleId?: string | null;
  anchor?: StableEntityAnchor | null;
};
export interface MTextLayoutLine { paragraphId: string; alignment: MTextContract["paragraphs"][number]["alignment"]; text: string }
export type TextAnnotationCapability =
  | { executable: true; code: "ready" }
  | { executable: false; code: "missing-annotation" | "locked-layer" | "malformed-contract" | "orphan-style" | "orphan-association"; handle: string };

export function createText(document: KDrawDocumentV1, args: TextArgs): CadText {
  validateEntityIdentity(document, args.handle, args.layerId);
  validateStyleReference(document, args.styleId);
  const rotationRad = args.rotationRad === undefined ? 0 : args.rotationRad;
  if (typeof args.text !== "string" || !args.text.length) throw new TypeError("TEXT content is required.");
  if (!Number.isFinite(args.height) || args.height <= 0 || !Number.isFinite(rotationRad)) throw new RangeError("TEXT height and rotation must be finite and valid.");
  return { kind: "text", handle: args.handle, layerId: args.layerId, position: validatePoint(args.position, "TEXT position"), text: args.text, height: args.height, rotationRad, ...(args.styleId ? { styleId: args.styleId } : {}) };
}

function normalizeParagraphs(text: string, paragraphs: MTextContract["paragraphs"] | undefined): MTextContract["paragraphs"] {
  const count = text.split("\n").length;
  const normalized = paragraphs ?? Array.from({ length: count }, (_, index) => ({ id: `P${index + 1}`, alignment: "left" as const }));
  if (normalized.length !== count) throw new RangeError("MTEXT requires one paragraph contract per newline-delimited paragraph.");
  if (new Set(normalized.map((paragraph) => paragraph.id)).size !== normalized.length || normalized.some((paragraph) => !paragraph.id.trim())) throw new RangeError("MTEXT paragraph ids must be non-empty and unique.");
  if (normalized.some((paragraph) => !["left", "center", "right", "justify"].includes(paragraph.alignment))) throw new RangeError("MTEXT paragraph alignment is unsupported.");
  return structuredClone(normalized);
}

function reconcileParagraphs(existing: MTextContract["paragraphs"], count: number): MTextContract["paragraphs"] {
  const result = structuredClone(existing.slice(0, count));
  const used = new Set(result.map((paragraph) => paragraph.id));
  for (let candidate = 1; result.length < count; candidate += 1) {
    const id = `P${candidate}`;
    if (!used.has(id)) {
      result.push({ id, alignment: "left" });
      used.add(id);
    }
  }
  return result;
}

function validateMTextOptions(attachment: MTextContract["attachment"], wrapMode: MTextContract["wrapMode"]): void {
  if (!["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"].includes(attachment)) throw new RangeError("MTEXT attachment is unsupported.");
  if (!["word", "character", "none"].includes(wrapMode)) throw new RangeError("MTEXT wrap mode is unsupported.");
}

export function createMText(document: KDrawDocumentV1, args: MTextArgs): CadText {
  validateEntityIdentity(document, args.handle, args.layerId);
  validateStyleReference(document, args.styleId);
  const rotationRad = args.rotationRad === undefined ? 0 : args.rotationRad;
  const lineSpacingFactor = args.lineSpacingFactor === undefined ? 1 : args.lineSpacingFactor;
  const attachment = args.attachment === undefined ? "top-left" : args.attachment;
  const wrapMode = args.wrapMode === undefined ? "word" : args.wrapMode;
  if (typeof args.text !== "string" || !args.text.length) throw new TypeError("MTEXT content is required.");
  if (![args.height, args.width, lineSpacingFactor].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(rotationRad)) throw new RangeError("MTEXT height, width, spacing and rotation must be finite and valid.");
  validateMTextOptions(attachment, wrapMode);
  const entity: CadText = { kind: "mtext", handle: args.handle, layerId: args.layerId, position: validatePoint(args.position, "MTEXT position"), text: args.text, height: args.height, rotationRad, ...(args.styleId ? { styleId: args.styleId } : {}) };
  return withAnnotationExtension(entity, { kind: "mtext", version: 2, width: args.width, attachment, lineSpacingFactor, wrapMode, paragraphs: normalizeParagraphs(args.text, args.paragraphs) });
}

function wrapCharacters(text: string, limit: number): string[] {
  if (!text.length) return [""];
  const characters = Array.from(text);
  return Array.from({ length: Math.ceil(characters.length / limit) }, (_, index) => characters.slice(index * limit, (index + 1) * limit).join(""));
}

function characterCount(text: string): number { return Array.from(text).length; }

function wrapWords(text: string, limit: number): string[] {
  if (!text.length) return [""];
  const lines: string[] = []; let current = "";
  for (const word of text.split(/\s+/u)) {
    if (characterCount(word) > limit) {
      if (current) { lines.push(current); current = ""; }
      const chunks = wrapCharacters(word, limit); lines.push(...chunks.slice(0, -1)); current = chunks.at(-1) ?? "";
    } else if (!current) current = word;
    else if (characterCount(current) + 1 + characterCount(word) <= limit) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current || !lines.length) lines.push(current);
  return lines;
}

export function deriveMTextLayout(document: KDrawDocumentV1, entity: CadText): MTextLayoutLine[] {
  const contract = readMTextContract(entity);
  if (!contract) throw new TypeError(`Malformed MTEXT contract: ${entity.handle}.`);
  const style = entity.styleId ? document.textStyles.find((candidate) => candidate.id === entity.styleId) : undefined;
  if (entity.styleId && !style) throw new RangeError(`Unknown text style: ${entity.styleId}.`);
  const limit = Math.max(1, Math.floor(contract.width / (entity.height * (style?.widthFactor ?? 1) * 0.6)));
  return entity.text.split("\n").flatMap((paragraphText, index) => {
    const paragraph = contract.paragraphs[index]!;
    const lines = contract.wrapMode === "none" ? [paragraphText] : contract.wrapMode === "character" ? wrapCharacters(paragraphText, limit) : wrapWords(paragraphText, limit);
    return lines.map((text) => ({ paragraphId: paragraph.id, alignment: paragraph.alignment, text }));
  });
}

function normalizedLeaderVertices(document: KDrawDocumentV1, vertices: CadPoint2[], anchor: StableEntityAnchor | undefined, label: string): CadPoint2[] {
  if (vertices.length < 2) throw new RangeError(`${label} requires at least two vertices.`);
  const result = vertices.map((point, index) => validatePoint(point, `${label} vertex ${index}`));
  const anchorPoint = validateAnchor(document, anchor); if (anchorPoint) result[0] = anchorPoint;
  return result;
}

function positive(value: number, label: string): number { if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`); return value; }
function nonNegative(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative and finite.`); return value; }
function validateArrowType(value: LeaderArrowType): LeaderArrowType {
  if (!["closed-filled", "open", "dot", "none"].includes(value)) throw new RangeError("LEADER arrow type is unsupported.");
  return value;
}

export function createLeader(document: KDrawDocumentV1, args: LeaderArgs): CadLeader {
  validateEntityIdentity(document, args.handle, args.layerId); validateStyleReference(document, args.textStyleId);
  const vertices = normalizedLeaderVertices(document, args.vertices, args.anchor, "LEADER");
  if (args.text !== undefined && typeof args.text !== "string") throw new TypeError("LEADER content must be a string.");
  const textHeight = positive(args.textHeight === undefined ? 2.5 : args.textHeight, "LEADER text height");
  const arrowSize = positive(args.arrowSize === undefined ? textHeight : args.arrowSize, "LEADER arrow size");
  const landingEnabled = args.landingEnabled === undefined ? true : args.landingEnabled;
  if (typeof landingEnabled !== "boolean") throw new TypeError("LEADER landing enabled must be boolean.");
  const entity: CadLeader = { kind: "leader", handle: args.handle, layerId: args.layerId, vertices, ...(args.text === undefined ? {} : { text: args.text }) };
  return withAnnotationExtension(entity, {
    kind: "leader", version: 1, arrow: { type: validateArrowType(args.arrowType === undefined ? "closed-filled" : args.arrowType), size: arrowSize }, landing: { enabled: landingEnabled, length: nonNegative(args.landingLength === undefined ? 0 : args.landingLength, "LEADER landing length") },
    content: { position: validatePoint(args.contentPosition ?? vertices.at(-1)!, "LEADER content position"), ...(args.textStyleId ? { textStyleId: args.textStyleId } : {}), textHeight },
    associative: args.anchor !== undefined, ...(args.anchor ? { anchor: structuredClone(args.anchor) } : {}),
  });
}

export function createMLeader(document: KDrawDocumentV1, args: MLeaderArgs): CadLeader {
  validateStyleReference(document, args.textStyleId);
  if (typeof args.text !== "string" || !args.text.length) throw new TypeError("MLEADER content is required.");
  if (typeof args.styleId !== "string" || !args.styleId.trim()) throw new RangeError("MLEADER style is required.");
  const leader = createLeader(document, { handle: args.handle, layerId: args.layerId, vertices: args.vertices, text: args.text, contentPosition: args.textPosition, ...(args.textStyleId ? { textStyleId: args.textStyleId } : {}), textHeight: args.textHeight, ...(args.arrowType === undefined ? {} : { arrowType: args.arrowType }), ...(args.arrowSize === undefined ? {} : { arrowSize: args.arrowSize }), ...(args.landingEnabled === undefined ? {} : { landingEnabled: args.landingEnabled }), ...(args.landingLength === undefined ? {} : { landingLength: args.landingLength }), ...(args.anchor === undefined ? {} : { anchor: args.anchor }) });
  const base = readLeaderContract(leader);
  if (!base || base.kind !== "leader") throw new TypeError("MLEADER base contract is invalid.");
  return withAnnotationExtension(leader, { kind: "mleader", version: 2, styleId: args.styleId, textPosition: validatePoint(args.textPosition, "MLEADER text position"), ...(args.textStyleId ? { textStyleId: args.textStyleId } : {}), textHeight: positive(args.textHeight, "MLEADER text height"), landingGap: nonNegative(args.landingGap === undefined ? 1 : args.landingGap, "MLEADER landing gap"), arrow: base.arrow, landing: base.landing, associative: base.associative, ...(base.anchor ? { anchor: base.anchor } : {}) });
}

export function createTextStyle(document: KDrawDocumentV1, style: CadTextStyle): CadChange {
  if (!style.id.trim() || !style.name.trim() || !style.fontFamily.trim()) throw new TypeError("Text style id, name and font family are required.");
  const normalizedId = style.id.toLocaleUpperCase("en-US");
  if (document.textStyles.some((candidate) => candidate.id.toLocaleUpperCase("en-US") === normalizedId || candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Text style already exists: ${style.name}.`);
  if (!Number.isFinite(style.widthFactor) || style.widthFactor <= 0 || !Number.isFinite(style.obliqueAngleRad) || Math.abs(style.obliqueAngleRad) >= Math.PI / 2) throw new RangeError("Text style width and oblique angle must be valid.");
  return { type: "put-text-style", textStyle: structuredClone(style) };
}

export function updateTextStyle(document: KDrawDocumentV1, style: CadTextStyle): CadChange {
  if (!document.textStyles.some((candidate) => candidate.id === style.id)) throw new RangeError(`Unknown text style: ${style.id}.`);
  return createTextStyle({ ...document, textStyles: document.textStyles.filter((candidate) => candidate.id !== style.id) }, style);
}

export function editMText(document: KDrawDocumentV1, handle: string, patch: MTextEditPatch): EntityChange {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity || entity.kind !== "mtext") throw new RangeError(`Unknown MTEXT: ${handle}.`);
  ensureWritableLayer(document, entity.layerId);
  const contract = readMTextContract(entity); if (!contract) throw new TypeError(`Malformed MTEXT contract: ${handle}.`);
  const text = patch.text ?? entity.text;
  const paragraphCount = text.split("\n").length;
  const paragraphs = patch.paragraphs ?? (paragraphCount === contract.paragraphs.length ? contract.paragraphs : reconcileParagraphs(contract.paragraphs, paragraphCount));
  const without = { ...document, entities: document.entities.filter((candidate) => candidate.handle !== handle) };
  const styleId = patch.styleId === undefined ? entity.styleId : patch.styleId ?? undefined;
  return { type: "put", entity: createMText(without, { handle, layerId: entity.layerId, position: patch.position ?? entity.position, text, height: patch.height ?? entity.height, rotationRad: patch.rotationRad ?? entity.rotationRad, ...(styleId ? { styleId } : {}), width: patch.width ?? contract.width, attachment: patch.attachment ?? contract.attachment, lineSpacingFactor: patch.lineSpacingFactor ?? contract.lineSpacingFactor, wrapMode: patch.wrapMode ?? contract.wrapMode, ...(paragraphs ? { paragraphs } : {}) }) };
}

export function editLeader(document: KDrawDocumentV1, handle: string, patch: LeaderEditPatch | MLeaderEditPatch): EntityChange {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity || entity.kind !== "leader") throw new RangeError(`Unknown LEADER/MLEADER: ${handle}.`);
  ensureWritableLayer(document, entity.layerId);
  const contract = readLeaderContract(entity); if (!contract) throw new TypeError(`Malformed LEADER/MLEADER contract: ${handle}.`);
  const without = { ...document, entities: document.entities.filter((candidate) => candidate.handle !== handle) };
  if (contract.kind === "mleader") {
    const next = patch as MLeaderEditPatch;
    const textStyleId = next.textStyleId === undefined ? contract.textStyleId : next.textStyleId ?? undefined;
    const anchor = next.anchor === undefined ? contract.anchor : next.anchor ?? undefined;
    return { type: "put", entity: createMLeader(without, { handle, layerId: entity.layerId, vertices: next.vertices ?? entity.vertices, text: next.text ?? entity.text ?? "", textPosition: next.textPosition ?? contract.textPosition, styleId: next.styleId ?? contract.styleId, ...(textStyleId ? { textStyleId } : {}), textHeight: next.textHeight ?? contract.textHeight, landingGap: next.landingGap ?? contract.landingGap, arrowType: next.arrowType ?? contract.arrow.type, arrowSize: next.arrowSize ?? contract.arrow.size, landingEnabled: next.landingEnabled ?? contract.landing.enabled, landingLength: next.landingLength ?? contract.landing.length, ...(anchor ? { anchor } : {}) }) };
  }
  const next = patch as LeaderEditPatch;
  const text = next.text === undefined ? entity.text : next.text ?? undefined;
  const textStyleId = next.textStyleId === undefined ? contract.content.textStyleId : next.textStyleId ?? undefined;
  const anchor = next.anchor === undefined ? contract.anchor : next.anchor ?? undefined;
  return { type: "put", entity: createLeader(without, { handle, layerId: entity.layerId, vertices: next.vertices ?? entity.vertices, ...(text === undefined ? {} : { text }), contentPosition: next.contentPosition ?? contract.content.position, ...(textStyleId ? { textStyleId } : {}), textHeight: next.textHeight ?? contract.content.textHeight, arrowType: next.arrowType ?? contract.arrow.type, arrowSize: next.arrowSize ?? contract.arrow.size, landingEnabled: next.landingEnabled ?? contract.landing.enabled, landingLength: next.landingLength ?? contract.landing.length, ...(anchor ? { anchor } : {}) }) };
}

export function editMLeaderText(document: KDrawDocumentV1, handle: string, text: string): EntityChange { if (!text.length) throw new TypeError("MLEADER content is required."); return editLeader(document, handle, { text }); }

export function applyTextStyle(document: KDrawDocumentV1, styleId: string, targetHandles: readonly string[]): EntityChange[] {
  validateStyleReference(document, styleId);
  const handles = [...new Set(targetHandles)]; if (!handles.length) throw new RangeError("STYLE apply requires at least one annotation.");
  return handles.map((handle) => {
    const entity = document.entities.find((candidate) => candidate.handle === handle);
    if (!entity || !["text", "mtext", "leader"].includes(entity.kind)) throw new RangeError(`Unknown text annotation: ${handle}.`);
    ensureWritableLayer(document, entity.layerId);
    if (entity.kind === "text" || entity.kind === "mtext") return { type: "put", entity: { ...structuredClone(entity), styleId } };
    const contract = readLeaderContract(entity); if (!contract) throw new TypeError(`Malformed LEADER/MLEADER contract: ${handle}.`);
    return { type: "put", entity: withAnnotationExtension(entity, contract.kind === "mleader" ? { ...contract, textStyleId: styleId } : { ...contract, content: { ...contract.content, textStyleId: styleId } }) };
  });
}

export interface LeaderAssociationUpdate { changes: EntityChange[]; updatedHandles: string[]; broken: Array<{ leaderHandle: string; targetHandle: string }> }

export function updateAssociativeLeaders(document: KDrawDocumentV1, changedHandles: readonly string[]): LeaderAssociationUpdate {
  const changed = new Set(changedHandles); const changes: EntityChange[] = []; const updatedHandles: string[] = []; const broken: LeaderAssociationUpdate["broken"] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "leader") continue;
    const contract = readLeaderContract(entity);
    if (!contract?.associative || !contract.anchor || !changed.has(contract.anchor.handle)) continue;
    ensureWritableLayer(document, entity.layerId);
    const point = resolveStableAnchor(document, contract.anchor);
    if (!point) { broken.push({ leaderHandle: entity.handle, targetHandle: contract.anchor.handle }); continue; }
    if (entity.vertices[0]?.x === point.x && entity.vertices[0]?.y === point.y) continue;
    const next = structuredClone(entity); next.vertices[0] = point; changes.push({ type: "put", entity: next }); updatedHandles.push(entity.handle);
  }
  return { changes, updatedHandles, broken };
}

export function evaluateTextAnnotationCapability(document: KDrawDocumentV1, handle: string): TextAnnotationCapability {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity || !["text", "mtext", "leader"].includes(entity.kind)) return { executable: false, code: "missing-annotation", handle };
  if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) return { executable: false, code: "locked-layer", handle: entity.layerId };
  if ((entity.kind === "text" || entity.kind === "mtext") && entity.styleId && !document.textStyles.some((style) => style.id === entity.styleId)) return { executable: false, code: "orphan-style", handle: entity.styleId };
  if (entity.kind === "mtext" && !readMTextContract(entity)) return { executable: false, code: "malformed-contract", handle };
  if (entity.kind === "leader") {
    const contract = readLeaderContract(entity); if (!contract) return { executable: false, code: "malformed-contract", handle };
    const textStyleId = contract.kind === "mleader" ? contract.textStyleId : contract.content.textStyleId;
    if (textStyleId && !document.textStyles.some((style) => style.id === textStyleId)) return { executable: false, code: "orphan-style", handle: textStyleId };
    if (contract.anchor && resolveStableAnchor(document, contract.anchor) === null) return { executable: false, code: "orphan-association", handle: contract.anchor.handle };
  }
  return { executable: true, code: "ready" };
}
