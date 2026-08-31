import type { CadLeader, CadPoint2, CadText, CadTextStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CadChange, EntityChange } from "../transaction.js";
import { withAnnotationExtension } from "./contracts.js";

function validatePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function validateEntityIdentity(document: KDrawDocumentV1, handle: string, layerId: string): void {
  if (!handle.trim()) throw new TypeError("Entity handle is required.");
  if ([...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle === handle)) throw new RangeError(`Duplicate entity handle: ${handle}.`);
  if (!document.layers.some((layer) => layer.id === layerId)) throw new RangeError(`Unknown layer: ${layerId}.`);
}

function validateStyleReference(document: KDrawDocumentV1, styleId: string | undefined): void {
  if (styleId && !document.textStyles.some((style) => style.id === styleId)) throw new RangeError(`Unknown text style: ${styleId}.`);
}

export interface MTextArgs {
  handle: string;
  layerId: string;
  position: CadPoint2;
  text: string;
  height: number;
  rotationRad?: number;
  styleId?: string;
  width: number;
  attachment?: "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
  lineSpacingFactor?: number;
}

export interface TextArgs {
  handle: string;
  layerId: string;
  position: CadPoint2;
  text: string;
  height: number;
  rotationRad?: number;
  styleId?: string;
}

export function createText(document: KDrawDocumentV1, args: TextArgs): CadText {
  validateEntityIdentity(document, args.handle, args.layerId);
  validateStyleReference(document, args.styleId);
  const rotationRad = args.rotationRad ?? 0;
  if (!args.text.length) throw new TypeError("TEXT content is required.");
  if (!Number.isFinite(args.height) || args.height <= 0 || !Number.isFinite(rotationRad)) throw new RangeError("TEXT height and rotation must be finite and valid.");
  return {
    kind: "text",
    handle: args.handle,
    layerId: args.layerId,
    position: validatePoint(args.position, "TEXT position"),
    text: args.text,
    height: args.height,
    rotationRad,
    ...(args.styleId ? { styleId: args.styleId } : {}),
  };
}

export function createMText(document: KDrawDocumentV1, args: MTextArgs): CadText {
  validateEntityIdentity(document, args.handle, args.layerId);
  validateStyleReference(document, args.styleId);
  const rotationRad = args.rotationRad ?? 0;
  const lineSpacingFactor = args.lineSpacingFactor ?? 1;
  if (!args.text.length) throw new TypeError("MTEXT content is required.");
  if (![args.height, args.width, lineSpacingFactor].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(rotationRad)) throw new RangeError("MTEXT height, width, spacing and rotation must be finite and valid.");
  const entity: CadText = {
    kind: "mtext", handle: args.handle, layerId: args.layerId,
    position: validatePoint(args.position, "MTEXT position"), text: args.text, height: args.height, rotationRad,
    ...(args.styleId ? { styleId: args.styleId } : {}),
  };
  return withAnnotationExtension(entity, {
    kind: "mtext", width: args.width, attachment: args.attachment ?? "top-left", lineSpacingFactor,
  });
}

export function createLeader(document: KDrawDocumentV1, args: { handle: string; layerId: string; vertices: CadPoint2[]; text?: string }): CadLeader {
  validateEntityIdentity(document, args.handle, args.layerId);
  if (args.vertices.length < 2) throw new RangeError("LEADER requires at least two vertices.");
  return {
    kind: "leader", handle: args.handle, layerId: args.layerId,
    vertices: args.vertices.map((point, index) => validatePoint(point, `Leader vertex ${index}`)),
    ...(args.text === undefined ? {} : { text: args.text }),
  };
}

export function createMLeader(document: KDrawDocumentV1, args: { handle: string; layerId: string; vertices: CadPoint2[]; text: string; textPosition: CadPoint2; styleId: string; textStyleId?: string; textHeight: number; landingGap?: number }): CadLeader {
  validateStyleReference(document, args.textStyleId);
  const leader = createLeader(document, args);
  const landingGap = args.landingGap ?? 1;
  if (!args.styleId.trim() || !Number.isFinite(args.textHeight) || args.textHeight <= 0 || !Number.isFinite(landingGap) || landingGap < 0) throw new RangeError("MLEADER style and sizes must be valid.");
  return withAnnotationExtension(leader, {
    kind: "mleader", styleId: args.styleId, textPosition: validatePoint(args.textPosition, "MLEADER text position"),
    ...(args.textStyleId ? { textStyleId: args.textStyleId } : {}), textHeight: args.textHeight, landingGap,
  });
}

export function createTextStyle(document: KDrawDocumentV1, style: CadTextStyle): CadChange {
  if (!style.id.trim() || !style.name.trim() || !style.fontFamily.trim()) throw new TypeError("Text style id, name and font family are required.");
  if (document.textStyles.some((candidate) => candidate.id === style.id || candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Text style already exists: ${style.name}.`);
  if (!Number.isFinite(style.widthFactor) || style.widthFactor <= 0 || !Number.isFinite(style.obliqueAngleRad) || Math.abs(style.obliqueAngleRad) >= Math.PI / 2) throw new RangeError("Text style width and oblique angle must be valid.");
  return { type: "put-text-style", textStyle: structuredClone(style) };
}

export function updateTextStyle(document: KDrawDocumentV1, style: CadTextStyle): CadChange {
  if (!document.textStyles.some((candidate) => candidate.id === style.id)) throw new RangeError(`Unknown text style: ${style.id}.`);
  return createTextStyle({ ...document, textStyles: document.textStyles.filter((candidate) => candidate.id !== style.id) }, style);
}

export function editMLeaderText(document: KDrawDocumentV1, handle: string, text: string): EntityChange {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity || entity.kind !== "leader" || entity.extensionData?.["kuubik.annotation.v1"] === undefined) throw new RangeError(`Unknown MLEADER: ${handle}.`);
  if (!text.length) throw new TypeError("MLEADER content is required.");
  return { type: "put", entity: { ...structuredClone(entity), text } };
}
