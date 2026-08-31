import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";

export const ANNOTATION_EXTENSION_KEY = "kuubik.annotation.v1" as const;

export type AnchorFeature = "start" | "end" | "center" | "quadrant" | "insertion" | "position" | "vertex";

export interface StableEntityAnchor {
  handle: string;
  feature: AnchorFeature;
  vertexIndex?: number;
  quadrantIndex?: 0 | 1 | 2 | 3;
  fallback: CadPoint2;
}

export interface DimensionAssociation {
  kind: "dimension";
  associative: boolean;
  anchors: StableEntityAnchor[];
  linearAxis?: "horizontal" | "vertical";
  chain?: {
    id: string;
    index: number;
    mode?: "continued" | "baseline";
    previousDimensionHandle?: string;
    baselineDimensionHandle?: string;
  };
}

export interface HatchAssociation {
  kind: "hatch";
  islandDetection: "normal" | "outer" | "ignore";
  pattern: {
    type: "solid" | "line";
    angleRad: number;
    scale: number;
    origin: CadPoint2;
  };
  boundaryHandles: string[];
}

export interface MTextContract {
  kind: "mtext";
  version: 2;
  width: number;
  attachment: "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
  lineSpacingFactor: number;
  wrapMode: "word" | "character" | "none";
  paragraphs: Array<{
    id: string;
    alignment: "left" | "center" | "right" | "justify";
  }>;
}

export type LeaderArrowType = "closed-filled" | "open" | "dot" | "none";

export interface LeaderContract {
  kind: "leader";
  version: 1;
  arrow: { type: LeaderArrowType; size: number };
  landing: { enabled: boolean; length: number };
  content: {
    position: CadPoint2;
    textStyleId?: string;
    textHeight: number;
  };
  associative: boolean;
  anchor?: StableEntityAnchor;
}

export interface MLeaderContract {
  kind: "mleader";
  version: 2;
  styleId: string;
  textPosition: CadPoint2;
  textStyleId?: string;
  textHeight: number;
  landingGap: number;
  arrow: { type: LeaderArrowType; size: number };
  landing: { enabled: boolean; length: number };
  associative: boolean;
  anchor?: StableEntityAnchor;
}

export type TableHorizontalAlignment = "left" | "center" | "right";
export type TableVerticalAlignment = "top" | "middle" | "bottom";

export type TableCellValue =
  | { kind: "text"; text: string }
  | { kind: "field"; code: string; fallback: string };

export interface TableCellFormat {
  textStyleId?: string;
  textHeight?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export interface TableCellContract {
  id: string;
  rowId: string;
  columnId: string;
  value: TableCellValue;
  horizontalAlignment?: TableHorizontalAlignment;
  verticalAlignment?: TableVerticalAlignment;
  format?: TableCellFormat;
}

export interface TableMergeContract {
  id: string;
  rowIds: string[];
  columnIds: string[];
}

export interface TableContract {
  kind: "table";
  version: 1;
  origin: CadPoint2;
  rotationRad: number;
  styleId: string;
  rows: Array<{ id: string; height: number }>;
  columns: Array<{ id: string; width: number }>;
  cells: TableCellContract[];
  merges: TableMergeContract[];
}

export type AnnotationExtension = DimensionAssociation | HatchAssociation | MTextContract | LeaderContract | MLeaderContract | TableContract;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is CadPoint2 {
  return isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x)
    && typeof value.y === "number" && Number.isFinite(value.y);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readStableAnchor(value: unknown): StableEntityAnchor | null {
  if (!isRecord(value) || typeof value.handle !== "string" || !value.handle.length || !isPoint(value.fallback)) return null;
  if (!["start", "end", "center", "quadrant", "insertion", "position", "vertex"].includes(String(value.feature))) return null;
  if (value.feature === "vertex" && (!Number.isSafeInteger(value.vertexIndex) || (value.vertexIndex as number) < 0)) return null;
  if (value.feature === "quadrant" && (!Number.isSafeInteger(value.quadrantIndex) || (value.quadrantIndex as number) < 0 || (value.quadrantIndex as number) > 3)) return null;
  return {
    handle: value.handle,
    feature: value.feature as AnchorFeature,
    ...(value.feature === "vertex" ? { vertexIndex: value.vertexIndex as number } : {}),
    ...(value.feature === "quadrant" ? { quadrantIndex: value.quadrantIndex as 0 | 1 | 2 | 3 } : {}),
    fallback: structuredClone(value.fallback),
  };
}

function isTableCellValue(value: unknown): boolean {
  return isRecord(value) && (value.kind === "text"
    ? typeof value.text === "string"
    : value.kind === "field" && typeof value.code === "string" && typeof value.fallback === "string");
}

function isTableCellFormat(value: unknown): boolean {
  if (value === undefined) return true;
  return isRecord(value)
    && (value.textStyleId === undefined || typeof value.textStyleId === "string")
    && (value.textHeight === undefined || typeof value.textHeight === "number" && Number.isFinite(value.textHeight))
    && (value.bold === undefined || typeof value.bold === "boolean")
    && (value.italic === undefined || typeof value.italic === "boolean")
    && (value.color === undefined || typeof value.color === "string");
}

export function withAnnotationExtension<T extends CadEntity>(entity: T, value: AnnotationExtension): T {
  return {
    ...structuredClone(entity),
    extensionData: {
      ...structuredClone(entity.extensionData ?? {}),
      [ANNOTATION_EXTENSION_KEY]: structuredClone(value),
    },
  };
}

export function readDimensionAssociation(entity: CadEntity): DimensionAssociation | null {
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (!isRecord(value) || value.kind !== "dimension" || typeof value.associative !== "boolean" || !Array.isArray(value.anchors)) return null;
  const anchors: StableEntityAnchor[] = [];
  for (const candidate of value.anchors) {
    if (!isRecord(candidate) || typeof candidate.handle !== "string" || !isPoint(candidate.fallback)) return null;
    if (!["start", "end", "center", "quadrant", "insertion", "position", "vertex"].includes(String(candidate.feature))) return null;
    if (candidate.feature === "vertex" && (!Number.isSafeInteger(candidate.vertexIndex) || (candidate.vertexIndex as number) < 0)) return null;
    if (candidate.feature === "quadrant" && (!Number.isSafeInteger(candidate.quadrantIndex) || (candidate.quadrantIndex as number) < 0 || (candidate.quadrantIndex as number) > 3)) return null;
    anchors.push({
      handle: candidate.handle,
      feature: candidate.feature as AnchorFeature,
      ...(candidate.feature === "vertex" ? { vertexIndex: candidate.vertexIndex as number } : {}),
      ...(candidate.feature === "quadrant" ? { quadrantIndex: candidate.quadrantIndex as 0 | 1 | 2 | 3 } : {}),
      fallback: structuredClone(candidate.fallback),
    });
  }
  let chain: DimensionAssociation["chain"];
  if (value.chain !== undefined) {
    if (!isRecord(value.chain) || typeof value.chain.id !== "string" || !Number.isSafeInteger(value.chain.index) || (value.chain.index as number) < 0) return null;
    if (value.chain.mode !== undefined && value.chain.mode !== "continued" && value.chain.mode !== "baseline") return null;
    if (value.chain.previousDimensionHandle !== undefined && typeof value.chain.previousDimensionHandle !== "string") return null;
    if (value.chain.baselineDimensionHandle !== undefined && typeof value.chain.baselineDimensionHandle !== "string") return null;
    chain = {
      id: value.chain.id,
      index: value.chain.index as number,
      ...(value.chain.mode === "continued" || value.chain.mode === "baseline" ? { mode: value.chain.mode } : {}),
      ...(typeof value.chain.previousDimensionHandle === "string" ? { previousDimensionHandle: value.chain.previousDimensionHandle } : {}),
      ...(typeof value.chain.baselineDimensionHandle === "string" ? { baselineDimensionHandle: value.chain.baselineDimensionHandle } : {}),
    };
  }
  if (value.linearAxis !== undefined && value.linearAxis !== "horizontal" && value.linearAxis !== "vertical") return null;
  return { kind: "dimension", associative: value.associative, anchors, ...(value.linearAxis ? { linearAxis: value.linearAxis } : {}), ...(chain ? { chain } : {}) };
}

export function readMTextContract(entity: CadEntity): MTextContract | null {
  if (entity.kind !== "mtext") return null;
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (!isRecord(value) || value.kind !== "mtext" || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width <= 0) return null;
  if (value.version !== undefined && value.version !== 2) return null;
  const attachment = String(value.attachment);
  if (!["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"].includes(attachment)) return null;
  if (typeof value.lineSpacingFactor !== "number" || !Number.isFinite(value.lineSpacingFactor) || value.lineSpacingFactor <= 0) return null;
  const wrapMode = value.wrapMode === undefined ? "word" : value.wrapMode;
  if (wrapMode !== "word" && wrapMode !== "character" && wrapMode !== "none") return null;
  const paragraphCount = entity.text.split("\n").length;
  const rawParagraphs = value.paragraphs === undefined
    ? Array.from({ length: paragraphCount }, (_, index) => ({ id: `P${index + 1}`, alignment: "left" as const }))
    : value.paragraphs;
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length !== paragraphCount) return null;
  const paragraphs: MTextContract["paragraphs"] = [];
  for (const paragraph of rawParagraphs) {
    if (!isRecord(paragraph) || typeof paragraph.id !== "string" || !paragraph.id.trim()) return null;
    if (!["left", "center", "right", "justify"].includes(String(paragraph.alignment))) return null;
    paragraphs.push({ id: paragraph.id, alignment: paragraph.alignment as MTextContract["paragraphs"][number]["alignment"] });
  }
  if (new Set(paragraphs.map((paragraph) => paragraph.id)).size !== paragraphs.length) return null;
  return { kind: "mtext", version: 2, width: value.width, attachment: attachment as MTextContract["attachment"], lineSpacingFactor: value.lineSpacingFactor, wrapMode, paragraphs };
}

function readLeaderArrow(value: unknown): LeaderContract["arrow"] | null {
  if (!isRecord(value) || !["closed-filled", "open", "dot", "none"].includes(String(value.type))) return null;
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size <= 0) return null;
  return { type: value.type as LeaderArrowType, size: value.size };
}

function readLeaderLanding(value: unknown): LeaderContract["landing"] | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.length !== "number" || !Number.isFinite(value.length) || value.length < 0) return null;
  return { enabled: value.enabled, length: value.length };
}

export function readLeaderContract(entity: CadEntity): LeaderContract | MLeaderContract | null {
  if (entity.kind !== "leader") return null;
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (!isRecord(value) || (value.kind !== "leader" && value.kind !== "mleader")) return null;
  const anchor = value.anchor === undefined ? undefined : readStableAnchor(value.anchor);
  if (value.anchor !== undefined && !anchor) return null;
  if (value.associative !== undefined && typeof value.associative !== "boolean") return null;
  if (value.kind === "leader") {
    if (value.version !== 1) return null;
    const arrow = readLeaderArrow(value.arrow);
    const landing = readLeaderLanding(value.landing);
    if (!arrow || !landing || !isRecord(value.content) || !isPoint(value.content.position)) return null;
    if (value.content.textStyleId !== undefined && typeof value.content.textStyleId !== "string") return null;
    if (typeof value.content.textHeight !== "number" || !Number.isFinite(value.content.textHeight) || value.content.textHeight <= 0) return null;
    const associative = value.associative ?? anchor !== undefined;
    if (associative !== (anchor !== undefined)) return null;
    return { kind: "leader", version: 1, arrow, landing, content: {
      position: structuredClone(value.content.position),
      ...(typeof value.content.textStyleId === "string" ? { textStyleId: value.content.textStyleId } : {}),
      textHeight: value.content.textHeight,
    }, associative, ...(anchor ? { anchor } : {}) };
  }
  if (value.version !== undefined && value.version !== 2) return null;
  if (typeof value.styleId !== "string" || !value.styleId.trim() || !isPoint(value.textPosition)) return null;
  if (value.textStyleId !== undefined && typeof value.textStyleId !== "string") return null;
  if (typeof value.textHeight !== "number" || !Number.isFinite(value.textHeight) || value.textHeight <= 0) return null;
  if (typeof value.landingGap !== "number" || !Number.isFinite(value.landingGap) || value.landingGap < 0) return null;
  const arrow = value.arrow === undefined ? { type: "closed-filled" as const, size: value.textHeight } : readLeaderArrow(value.arrow);
  const landing = value.landing === undefined ? { enabled: true, length: 0 } : readLeaderLanding(value.landing);
  if (!arrow || !landing) return null;
  const associative = value.associative ?? anchor !== undefined;
  if (associative !== (anchor !== undefined)) return null;
  return { kind: "mleader", version: 2, styleId: value.styleId, textPosition: structuredClone(value.textPosition),
    ...(typeof value.textStyleId === "string" ? { textStyleId: value.textStyleId } : {}), textHeight: value.textHeight,
    landingGap: value.landingGap, arrow, landing, associative, ...(anchor ? { anchor } : {}) };
}

export function readHatchAssociation(entity: CadEntity): HatchAssociation | null {
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (!isRecord(value) || value.kind !== "hatch" || !isRecord(value.pattern) || !Array.isArray(value.boundaryHandles)) return null;
  if (value.pattern.type !== "solid" && value.pattern.type !== "line") return null;
  const islandDetection = value.islandDetection === undefined ? "normal" : value.islandDetection;
  if (islandDetection !== "normal" && islandDetection !== "outer" && islandDetection !== "ignore") return null;
  if (!Number.isFinite(value.pattern.angleRad) || !Number.isFinite(value.pattern.scale) || !(Number(value.pattern.scale) > 0) || !isPoint(value.pattern.origin)) return null;
  if (value.boundaryHandles.some((handle) => typeof handle !== "string" || handle.trim().length === 0)) return null;
  const normalizedBoundaryHandles = value.boundaryHandles.map((handle) => (handle as string).toLocaleUpperCase("en-US"));
  if (new Set(normalizedBoundaryHandles).size !== normalizedBoundaryHandles.length) return null;
  return {
    kind: "hatch",
    islandDetection,
    pattern: {
      type: value.pattern.type,
      angleRad: Number(value.pattern.angleRad),
      scale: Number(value.pattern.scale),
      origin: structuredClone(value.pattern.origin),
    },
    boundaryHandles: [...value.boundaryHandles] as string[],
  };
}

export function readTableContract(entity: CadEntity): TableContract | null {
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (entity.kind !== "proxy" || entity.originalType !== "TABLE" || !isRecord(value) || value.kind !== "table" || value.version !== 1) return null;
  if (!isPoint(value.origin) || !Number.isFinite(value.rotationRad) || typeof value.styleId !== "string") return null;
  if (!Array.isArray(value.rows) || !Array.isArray(value.columns) || !Array.isArray(value.cells) || !Array.isArray(value.merges)) return null;
  if (!value.rows.every((row) => isRecord(row) && typeof row.id === "string" && typeof row.height === "number" && Number.isFinite(row.height))) return null;
  if (!value.columns.every((column) => isRecord(column) && typeof column.id === "string" && typeof column.width === "number" && Number.isFinite(column.width))) return null;
  if (!value.cells.every((cell) => isRecord(cell)
    && typeof cell.id === "string" && typeof cell.rowId === "string" && typeof cell.columnId === "string"
    && isTableCellValue(cell.value)
    && (cell.horizontalAlignment === undefined || ["left", "center", "right"].includes(String(cell.horizontalAlignment)))
    && (cell.verticalAlignment === undefined || ["top", "middle", "bottom"].includes(String(cell.verticalAlignment)))
    && isTableCellFormat(cell.format))) return null;
  if (!value.merges.every((merge) => isRecord(merge) && typeof merge.id === "string" && isStringArray(merge.rowIds) && isStringArray(merge.columnIds))) return null;
  return structuredClone(value) as unknown as TableContract;
}
