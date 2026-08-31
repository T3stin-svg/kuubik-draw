import type { CadEntity, CadPoint2 } from "@kuubik/cad-schema";

export const ANNOTATION_EXTENSION_KEY = "kuubik.annotation.v1" as const;

export type AnchorFeature = "start" | "end" | "center" | "insertion" | "position" | "vertex";

export interface StableEntityAnchor {
  handle: string;
  feature: AnchorFeature;
  vertexIndex?: number;
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
  width: number;
  attachment: "top-left" | "top-center" | "top-right" | "middle-left" | "middle-center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
  lineSpacingFactor: number;
}

export interface MLeaderContract {
  kind: "mleader";
  styleId: string;
  textPosition: CadPoint2;
  textStyleId?: string;
  textHeight: number;
  landingGap: number;
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

export type AnnotationExtension = DimensionAssociation | HatchAssociation | MTextContract | MLeaderContract | TableContract;

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
    if (!["start", "end", "center", "insertion", "position", "vertex"].includes(String(candidate.feature))) return null;
    if (candidate.feature === "vertex" && (!Number.isSafeInteger(candidate.vertexIndex) || (candidate.vertexIndex as number) < 0)) return null;
    anchors.push({
      handle: candidate.handle,
      feature: candidate.feature as AnchorFeature,
      ...(candidate.feature === "vertex" ? { vertexIndex: candidate.vertexIndex as number } : {}),
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

export function readHatchAssociation(entity: CadEntity): HatchAssociation | null {
  const value = entity.extensionData?.[ANNOTATION_EXTENSION_KEY];
  if (!isRecord(value) || value.kind !== "hatch" || !isRecord(value.pattern) || !Array.isArray(value.boundaryHandles)) return null;
  if (value.pattern.type !== "solid" && value.pattern.type !== "line") return null;
  if (!Number.isFinite(value.pattern.angleRad) || !Number.isFinite(value.pattern.scale) || !(Number(value.pattern.scale) > 0) || !isPoint(value.pattern.origin)) return null;
  if (value.boundaryHandles.some((handle) => typeof handle !== "string" || handle.length === 0)) return null;
  return {
    kind: "hatch",
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
