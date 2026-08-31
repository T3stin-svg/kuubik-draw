import type { CadChange, EntityChange } from "../transaction.js";
import type { CadAppearance, CadPoint2, CadProxyEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  readTableContract,
  type TableCellContract,
  type TableCellFormat,
  type TableCellValue,
  type TableContract,
  type TableHorizontalAlignment,
  type TableMergeContract,
  type TableVerticalAlignment,
  withAnnotationExtension,
} from "./contracts.js";

export const TABLE_STYLES_EXTENSION_KEY = "kuubik.tableStyles.v1" as const;
const MAX_FIELD_CODE_LENGTH = 4096;
const MAX_CELL_TEXT_LENGTH = 10000;

export interface TableStyle {
  id: string;
  name: string;
  textStyleId?: string;
  textHeight: number;
  cellMargin: number;
  borderWidth: number;
  horizontalAlignment: TableHorizontalAlignment;
  verticalAlignment: TableVerticalAlignment;
}

export interface CreateTableArgs {
  handle: string;
  layerId: string;
  origin: CadPoint2;
  rotationRad?: number;
  appearance?: CadAppearance;
  styleId: string;
  rows: Array<{ id: string; height: number }>;
  columns: Array<{ id: string; width: number }>;
  cells?: TableCellContract[];
  merges?: TableMergeContract[];
}

export type TableEditOperation =
  | { type: "set-cell"; cellId: string; value: TableCellValue; horizontalAlignment?: TableHorizontalAlignment | null; verticalAlignment?: TableVerticalAlignment | null; format?: TableCellFormat | null }
  | { type: "merge"; merge: TableMergeContract }
  | { type: "unmerge"; mergeId: string }
  | { type: "insert-row"; index: number; row: { id: string; height: number }; cells: Array<{ id: string; columnId: string; value?: TableCellValue }> }
  | { type: "delete-row"; rowId: string }
  | { type: "resize-row"; rowId: string; height: number }
  | { type: "insert-column"; index: number; column: { id: string; width: number }; cells: Array<{ id: string; rowId: string; value?: TableCellValue }> }
  | { type: "delete-column"; columnId: string }
  | { type: "resize-column"; columnId: string; width: number }
  | { type: "apply-style"; styleId: string };

export type TableCapability =
  | { executable: true; code: "ready" }
  | { executable: false; code: "missing-table" | "malformed-contract" | "locked-layer" | "off-layer" | "frozen-layer"; handle: string };

function stableIdKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function sameStableId(first: string, second: string): boolean {
  return stableIdKey(first) === stableIdKey(second);
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite.`);
  return value;
}

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${label} must be finite.`);
  return structuredClone(point);
}

function ensureWritableLayer(document: KDrawDocumentV1, layerId: string): void {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new RangeError(`Unknown layer: ${layerId}.`);
  if (layer.locked) throw new RangeError(`Layer is locked: ${layerId}.`);
  if (!layer.visible) throw new RangeError(`Layer is off: ${layerId}.`);
  if (layer.frozen) throw new RangeError(`Layer is frozen: ${layerId}.`);
}

function ensureUnique(values: readonly string[], label: string): void {
  if (values.some((value) => !value.trim()) || new Set(values.map(stableIdKey)).size !== values.length) throw new RangeError(`${label} ids must be non-empty and unique.`);
}

export function readTableStyles(document: KDrawDocumentV1): TableStyle[] {
  const raw = document.metadata.extensions?.[TABLE_STYLES_EXTENSION_KEY];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new TypeError(`${TABLE_STYLES_EXTENSION_KEY} must be an array.`);
  const styles = structuredClone(raw) as TableStyle[];
  styles.forEach((style) => validateTableStyle(document, style));
  ensureUnique(styles.map((style) => style.id), "Table style");
  const names = styles.map((style) => style.name.toLocaleUpperCase("en-US"));
  ensureUnique(names, "Table style name");
  return styles;
}

function validateTableStyle(document: KDrawDocumentV1, style: TableStyle): void {
  nonEmpty(style.id, "Table style id");
  nonEmpty(style.name, "Table style name");
  positive(style.textHeight, "Table style text height");
  if (!Number.isFinite(style.cellMargin) || style.cellMargin < 0) throw new RangeError("Table style cell margin must be non-negative and finite.");
  if (!Number.isFinite(style.borderWidth) || style.borderWidth < 0) throw new RangeError("Table style border width must be non-negative and finite.");
  if (!["left", "center", "right"].includes(style.horizontalAlignment)) throw new RangeError("Unsupported table horizontal alignment.");
  if (!["top", "middle", "bottom"].includes(style.verticalAlignment)) throw new RangeError("Unsupported table vertical alignment.");
  if (style.textStyleId && !document.textStyles.some((candidate) => candidate.id === style.textStyleId)) throw new RangeError(`Unknown text style: ${style.textStyleId}.`);
}

export function createTableStyle(document: KDrawDocumentV1, style: TableStyle): CadChange {
  validateTableStyle(document, style);
  const styles = readTableStyles(document);
  if (styles.some((candidate) => sameStableId(candidate.id, style.id) || sameStableId(candidate.name, style.name))) throw new RangeError(`Table style already exists: ${style.name}.`);
  return tableStyleChange(document, [...styles, structuredClone(style)]);
}

export function updateTableStyle(document: KDrawDocumentV1, style: TableStyle): CadChange {
  validateTableStyle(document, style);
  const styles = readTableStyles(document);
  const index = styles.findIndex((candidate) => sameStableId(candidate.id, style.id));
  if (index < 0) throw new RangeError(`Unknown table style: ${style.id}.`);
  if (styles.some((candidate, candidateIndex) => candidateIndex !== index && sameStableId(candidate.name, style.name))) throw new RangeError(`Table style already exists: ${style.name}.`);
  styles[index] = { ...structuredClone(style), id: styles[index]!.id };
  return tableStyleChange(document, styles);
}

function tableStyleChange(document: KDrawDocumentV1, styles: TableStyle[]): CadChange {
  return {
    type: "set-metadata",
    metadata: {
      ...structuredClone(document.metadata),
      extensions: {
        ...structuredClone(document.metadata.extensions ?? {}),
        [TABLE_STYLES_EXTENSION_KEY]: structuredClone(styles),
      },
    },
  };
}

function ensureTableStyle(document: KDrawDocumentV1, styleId: string): TableStyle {
  const style = readTableStyles(document).find((candidate) => sameStableId(candidate.id, styleId));
  if (!style) throw new RangeError(`Unknown table style: ${styleId}.`);
  return style;
}

function validateCellValue(value: TableCellValue): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RangeError("Table cell value must be an object.");
  if (value.kind === "text") {
    if (typeof value.text !== "string" || value.text.length > MAX_CELL_TEXT_LENGTH || value.text.includes("\0")) throw new RangeError("Table cell text is invalid or too long.");
    return;
  }
  if (value.kind === "field") {
    if (!value.code.trim() || value.code.length > MAX_FIELD_CODE_LENGTH || value.code.includes("\0")) throw new RangeError("Table field code is invalid or too long.");
    if (typeof value.fallback !== "string" || value.fallback.length > MAX_CELL_TEXT_LENGTH || value.fallback.includes("\0")) throw new RangeError("Table field fallback is invalid or too long.");
    return;
  }
  throw new RangeError("Unsupported table cell value kind.");
}

function validateCellFormat(document: KDrawDocumentV1, format: TableCellFormat | undefined): void {
  if (!format) return;
  if (format.textStyleId && !document.textStyles.some((candidate) => candidate.id === format.textStyleId)) throw new RangeError(`Unknown text style: ${format.textStyleId}.`);
  if (format.textHeight !== undefined) positive(format.textHeight, "Cell text height");
  if (format.color !== undefined && !/^#[0-9a-fA-F]{6}$/u.test(format.color)) throw new RangeError("Cell color must be #RRGGBB.");
}

function contiguousIds(allIds: readonly string[], requested: readonly string[], label: string): void {
  ensureUnique(requested, label);
  const indexes = requested.map((id) => allIds.findIndex((candidate) => sameStableId(candidate, id)));
  if (indexes.some((index) => index < 0)) throw new RangeError(`${label} references an unknown id.`);
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) throw new RangeError(`${label} must be contiguous.`);
}

function mergeCellIds(contract: TableContract, merge: TableMergeContract): Set<string> {
  const rowIds = new Set(merge.rowIds.map(stableIdKey));
  const columnIds = new Set(merge.columnIds.map(stableIdKey));
  return new Set(contract.cells.filter((cell) => rowIds.has(stableIdKey(cell.rowId)) && columnIds.has(stableIdKey(cell.columnId))).map((cell) => cell.id));
}

function validateTableContract(document: KDrawDocumentV1, contract: TableContract): TableContract {
  const normalized = structuredClone(contract);
  finitePoint(normalized.origin, "Table origin");
  if (!Number.isFinite(normalized.rotationRad)) throw new RangeError("Table rotation must be finite.");
  normalized.styleId = ensureTableStyle(document, normalized.styleId).id;
  if (!normalized.rows.length || !normalized.columns.length) throw new RangeError("TABLE requires at least one row and column.");
  ensureUnique(normalized.rows.map((row) => row.id), "Table row");
  ensureUnique(normalized.columns.map((column) => column.id), "Table column");
  normalized.rows.forEach((row) => positive(row.height, `Row ${row.id} height`));
  normalized.columns.forEach((column) => positive(column.width, `Column ${column.id} width`));
  ensureUnique(normalized.cells.map((cell) => cell.id), "Table cell");
  const rowsById = new Map(normalized.rows.map((row) => [stableIdKey(row.id), row]));
  const columnsById = new Map(normalized.columns.map((column) => [stableIdKey(column.id), column]));
  const coordinates = new Set<string>();
  for (const cell of normalized.cells) {
    const row = rowsById.get(stableIdKey(cell.rowId));
    const column = columnsById.get(stableIdKey(cell.columnId));
    if (!row || !column) throw new RangeError(`Cell ${cell.id} references an unknown row or column.`);
    cell.rowId = row.id;
    cell.columnId = column.id;
    const coordinate = `${stableIdKey(cell.rowId)}\0${stableIdKey(cell.columnId)}`;
    if (coordinates.has(coordinate)) throw new RangeError(`Duplicate table cell coordinate: ${cell.rowId}/${cell.columnId}.`);
    coordinates.add(coordinate);
    validateCellValue(cell.value);
    validateCellFormat(document, cell.format);
    if (cell.horizontalAlignment !== undefined && !["left", "center", "right"].includes(cell.horizontalAlignment)) throw new RangeError("Unsupported cell horizontal alignment.");
    if (cell.verticalAlignment !== undefined && !["top", "middle", "bottom"].includes(cell.verticalAlignment)) throw new RangeError("Unsupported cell vertical alignment.");
  }
  if (normalized.cells.length !== normalized.rows.length * normalized.columns.length) throw new RangeError("TABLE requires exactly one cell per row/column coordinate.");
  ensureUnique(normalized.merges.map((merge) => merge.id), "Table merge");
  const occupied = new Set<string>();
  for (const merge of normalized.merges) {
    contiguousIds(normalized.rows.map((row) => row.id), merge.rowIds, `Merge ${merge.id} rows`);
    contiguousIds(normalized.columns.map((column) => column.id), merge.columnIds, `Merge ${merge.id} columns`);
    merge.rowIds = merge.rowIds.map((id) => rowsById.get(stableIdKey(id))!.id);
    merge.columnIds = merge.columnIds.map((id) => columnsById.get(stableIdKey(id))!.id);
    const cells = mergeCellIds(normalized, merge);
    if (cells.size < 2) throw new RangeError(`Merge ${merge.id} must cover at least two cells.`);
    for (const cellId of cells) {
      if (occupied.has(cellId)) throw new RangeError(`Merge ${merge.id} overlaps another merge.`);
      occupied.add(cellId);
    }
  }
  const rowOrder = new Map(normalized.rows.map((row, index) => [row.id, index]));
  const columnOrder = new Map(normalized.columns.map((column, index) => [column.id, index]));
  normalized.cells.sort((first, second) => {
    const rowDifference = rowOrder.get(first.rowId)! - rowOrder.get(second.rowId)!;
    return rowDifference || columnOrder.get(first.columnId)! - columnOrder.get(second.columnId)!;
  });
  return normalized;
}

function tableBounds(contract: TableContract): { min: CadPoint2; max: CadPoint2 } {
  const width = contract.columns.reduce((sum, column) => sum + column.width, 0);
  const height = contract.rows.reduce((sum, row) => sum + row.height, 0);
  const cosine = Math.cos(contract.rotationRad);
  const sine = Math.sin(contract.rotationRad);
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: -height }, { x: 0, y: -height }].map((point) => ({
    x: contract.origin.x + point.x * cosine - point.y * sine,
    y: contract.origin.y + point.x * sine + point.y * cosine,
  }));
  return {
    min: { x: Math.min(...corners.map((point) => point.x)), y: Math.min(...corners.map((point) => point.y)) },
    max: { x: Math.max(...corners.map((point) => point.x)), y: Math.max(...corners.map((point) => point.y)) },
  };
}

function tableEntity(document: KDrawDocumentV1, handle: string, layerId: string, contract: TableContract, template?: CadProxyEntity): CadProxyEntity {
  const validated = validateTableContract(document, contract);
  const entity: CadProxyEntity = template
    ? { ...structuredClone(template), kind: "proxy", handle, layerId, originalType: "TABLE", raw: structuredClone(template.raw), bounds: tableBounds(validated) }
    : { kind: "proxy", handle, layerId, originalType: "TABLE", raw: { schemaVersion: 1 }, bounds: tableBounds(validated) };
  return withAnnotationExtension(entity, validated);
}

function defaultValue(): TableCellValue { return { kind: "text", text: "" }; }

export function createTable(document: KDrawDocumentV1, args: CreateTableArgs): CadProxyEntity {
  nonEmpty(args.handle, "Table handle");
  if ([...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => sameStableId(entity.handle, args.handle))) throw new RangeError(`Duplicate entity handle: ${args.handle}.`);
  ensureWritableLayer(document, args.layerId);
  const provided = args.cells ?? [];
  const rowsById = new Map(args.rows.map((row) => [stableIdKey(row.id), row]));
  const columnsById = new Map(args.columns.map((column) => [stableIdKey(column.id), column]));
  const providedCoordinates = provided.map((cell) => `${stableIdKey(cell.rowId)}\0${stableIdKey(cell.columnId)}`);
  if (new Set(providedCoordinates).size !== provided.length) throw new RangeError("TABLE contains duplicate cell coordinates.");
  if (provided.some((cell) => !rowsById.has(stableIdKey(cell.rowId)) || !columnsById.has(stableIdKey(cell.columnId)))) throw new RangeError("TABLE contains a cell outside its row/column grid.");
  const byCoordinate = new Map(provided.map((cell) => [`${stableIdKey(cell.rowId)}\0${stableIdKey(cell.columnId)}`, structuredClone(cell)]));
  const cells: TableCellContract[] = [];
  for (const row of args.rows) for (const column of args.columns) {
    const existing = byCoordinate.get(`${stableIdKey(row.id)}\0${stableIdKey(column.id)}`);
    cells.push(existing ? { ...existing, rowId: row.id, columnId: column.id } : { id: `${row.id}:${column.id}`, rowId: row.id, columnId: column.id, value: defaultValue() });
  }
  const entity = tableEntity(document, args.handle, args.layerId, {
    kind: "table", version: 1, origin: finitePoint(args.origin, "Table origin"), rotationRad: args.rotationRad ?? 0,
    styleId: args.styleId, rows: structuredClone(args.rows), columns: structuredClone(args.columns), cells, merges: structuredClone(args.merges ?? []),
  });
  return args.appearance ? { ...entity, appearance: structuredClone(args.appearance) } : entity;
}

function requireEditableTable(document: KDrawDocumentV1, handle: string): { entity: CadProxyEntity; contract: TableContract } {
  const entity = document.entities.find((candidate) => sameStableId(candidate.handle, handle));
  const contract = entity ? readTableContract(entity) : null;
  if (!entity || entity.kind !== "proxy" || entity.originalType !== "TABLE") throw new RangeError(`Unknown TABLE: ${handle}.`);
  if (!contract) throw new RangeError(`Malformed TABLE contract: ${entity.handle}.`);
  ensureWritableLayer(document, entity.layerId);
  return { entity, contract: validateTableContract(document, contract) };
}

function cellInMerge(contract: TableContract, predicate: (merge: TableMergeContract) => boolean): boolean {
  return contract.merges.some(predicate);
}

export function editTable(document: KDrawDocumentV1, handle: string, operations: readonly TableEditOperation[]): EntityChange {
  if (!operations.length) throw new RangeError("TABLE edit requires at least one operation.");
  const { entity, contract } = requireEditableTable(document, handle);
  for (const operation of operations) {
    if (operation.type === "set-cell") {
      const index = contract.cells.findIndex((cell) => sameStableId(cell.id, operation.cellId));
      if (index < 0) throw new RangeError(`Unknown table cell: ${operation.cellId}.`);
      const cell = { ...structuredClone(contract.cells[index]!), value: structuredClone(operation.value) };
      if (operation.horizontalAlignment === null) delete cell.horizontalAlignment;
      else if (operation.horizontalAlignment !== undefined) cell.horizontalAlignment = operation.horizontalAlignment;
      if (operation.verticalAlignment === null) delete cell.verticalAlignment;
      else if (operation.verticalAlignment !== undefined) cell.verticalAlignment = operation.verticalAlignment;
      if (operation.format === null) delete cell.format;
      else if (operation.format !== undefined) cell.format = structuredClone(operation.format);
      contract.cells[index] = cell;
      continue;
    }
    if (operation.type === "merge") {
      contract.merges.push(structuredClone(operation.merge));
      continue;
    }
    if (operation.type === "unmerge") {
      const before = contract.merges.length;
      contract.merges = contract.merges.filter((merge) => !sameStableId(merge.id, operation.mergeId));
      if (contract.merges.length === before) throw new RangeError(`Unknown table merge: ${operation.mergeId}.`);
      continue;
    }
    if (operation.type === "insert-row") {
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > contract.rows.length) throw new RangeError("Table row insertion index is invalid.");
      if (contract.rows.some((row) => sameStableId(row.id, operation.row.id))) throw new RangeError(`Duplicate table row: ${operation.row.id}.`);
      if (operation.cells.length !== contract.columns.length || new Set(operation.cells.map((cell) => stableIdKey(cell.columnId))).size !== contract.columns.length) throw new RangeError("Inserted row requires one cell for every column.");
      contract.rows.splice(operation.index, 0, structuredClone(operation.row));
      contract.cells.push(...operation.cells.map((cell) => {
        const column = contract.columns.find((candidate) => sameStableId(candidate.id, cell.columnId));
        if (!column) throw new RangeError(`Inserted row references unknown column: ${cell.columnId}.`);
        return { id: cell.id, rowId: operation.row.id, columnId: column.id, value: structuredClone(cell.value ?? defaultValue()) };
      }));
      continue;
    }
    if (operation.type === "delete-row") {
      if (cellInMerge(contract, (merge) => merge.rowIds.some((id) => sameStableId(id, operation.rowId)))) throw new RangeError(`Unmerge row ${operation.rowId} before deletion.`);
      const before = contract.rows.length;
      const row = contract.rows.find((candidate) => sameStableId(candidate.id, operation.rowId));
      contract.rows = contract.rows.filter((candidate) => !sameStableId(candidate.id, operation.rowId));
      if (contract.rows.length === before) throw new RangeError(`Unknown table row: ${operation.rowId}.`);
      contract.cells = contract.cells.filter((cell) => !sameStableId(cell.rowId, row!.id));
      continue;
    }
    if (operation.type === "resize-row") {
      const row = contract.rows.find((candidate) => sameStableId(candidate.id, operation.rowId));
      if (!row) throw new RangeError(`Unknown table row: ${operation.rowId}.`);
      row.height = operation.height;
      continue;
    }
    if (operation.type === "insert-column") {
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > contract.columns.length) throw new RangeError("Table column insertion index is invalid.");
      if (contract.columns.some((column) => sameStableId(column.id, operation.column.id))) throw new RangeError(`Duplicate table column: ${operation.column.id}.`);
      if (operation.cells.length !== contract.rows.length || new Set(operation.cells.map((cell) => stableIdKey(cell.rowId))).size !== contract.rows.length) throw new RangeError("Inserted column requires one cell for every row.");
      contract.columns.splice(operation.index, 0, structuredClone(operation.column));
      contract.cells.push(...operation.cells.map((cell) => {
        const row = contract.rows.find((candidate) => sameStableId(candidate.id, cell.rowId));
        if (!row) throw new RangeError(`Inserted column references unknown row: ${cell.rowId}.`);
        return { id: cell.id, rowId: row.id, columnId: operation.column.id, value: structuredClone(cell.value ?? defaultValue()) };
      }));
      continue;
    }
    if (operation.type === "delete-column") {
      if (cellInMerge(contract, (merge) => merge.columnIds.some((id) => sameStableId(id, operation.columnId)))) throw new RangeError(`Unmerge column ${operation.columnId} before deletion.`);
      const before = contract.columns.length;
      const column = contract.columns.find((candidate) => sameStableId(candidate.id, operation.columnId));
      contract.columns = contract.columns.filter((candidate) => !sameStableId(candidate.id, operation.columnId));
      if (contract.columns.length === before) throw new RangeError(`Unknown table column: ${operation.columnId}.`);
      contract.cells = contract.cells.filter((cell) => !sameStableId(cell.columnId, column!.id));
      continue;
    }
    if (operation.type === "resize-column") {
      const column = contract.columns.find((candidate) => sameStableId(candidate.id, operation.columnId));
      if (!column) throw new RangeError(`Unknown table column: ${operation.columnId}.`);
      column.width = operation.width;
      continue;
    }
    if (operation.type === "apply-style") {
      contract.styleId = ensureTableStyle(document, operation.styleId).id;
      continue;
    }
    throw new RangeError(`Unsupported TABLE edit operation: ${(operation as { type?: unknown }).type}.`);
  }
  return { type: "put", entity: tableEntity(document, entity.handle, entity.layerId, contract, entity) };
}

export function tableCellDisplayText(value: TableCellValue): string {
  validateCellValue(value);
  return value.kind === "text" ? value.text : value.fallback;
}

export function evaluateTableCapability(document: KDrawDocumentV1, handle: string): TableCapability {
  const entity = document.entities.find((candidate) => sameStableId(candidate.handle, handle));
  if (!entity || entity.kind !== "proxy" || entity.originalType !== "TABLE") return { executable: false, code: "missing-table", handle };
  const contract = readTableContract(entity);
  if (!contract) return { executable: false, code: "malformed-contract", handle: entity.handle };
  try { validateTableContract(document, contract); } catch { return { executable: false, code: "malformed-contract", handle: entity.handle }; }
  const layer = document.layers.find((candidate) => candidate.id === entity.layerId);
  if (!layer) return { executable: false, code: "malformed-contract", handle: entity.handle };
  if (layer?.locked) return { executable: false, code: "locked-layer", handle: entity.layerId };
  if (layer && !layer.visible) return { executable: false, code: "off-layer", handle: entity.layerId };
  if (layer?.frozen) return { executable: false, code: "frozen-layer", handle: entity.layerId };
  return { executable: true, code: "ready" };
}
