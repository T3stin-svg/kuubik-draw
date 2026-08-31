import type { CadChange, EntityChange } from "../transaction.js";
import type { CadPoint2, CadProxyEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
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
  styleId: string;
  rows: Array<{ id: string; height: number }>;
  columns: Array<{ id: string; width: number }>;
  cells?: TableCellContract[];
  merges?: TableMergeContract[];
}

export type TableEditOperation =
  | { type: "set-cell"; cellId: string; value: TableCellValue; horizontalAlignment?: TableHorizontalAlignment; verticalAlignment?: TableVerticalAlignment; format?: TableCellFormat }
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
  | { executable: false; code: "missing-table" | "locked-layer"; handle: string };

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
}

function ensureUnique(values: readonly string[], label: string): void {
  if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) throw new RangeError(`${label} ids must be non-empty and unique.`);
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
  if (styles.some((candidate) => candidate.id === style.id || candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Table style already exists: ${style.name}.`);
  return tableStyleChange(document, [...styles, structuredClone(style)]);
}

export function updateTableStyle(document: KDrawDocumentV1, style: TableStyle): CadChange {
  validateTableStyle(document, style);
  const styles = readTableStyles(document);
  const index = styles.findIndex((candidate) => candidate.id === style.id);
  if (index < 0) throw new RangeError(`Unknown table style: ${style.id}.`);
  if (styles.some((candidate, candidateIndex) => candidateIndex !== index && candidate.name.toLocaleUpperCase("en-US") === style.name.toLocaleUpperCase("en-US"))) throw new RangeError(`Table style already exists: ${style.name}.`);
  styles[index] = structuredClone(style);
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
  const style = readTableStyles(document).find((candidate) => candidate.id === styleId);
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
  const indexes = requested.map((id) => allIds.indexOf(id));
  if (indexes.some((index) => index < 0)) throw new RangeError(`${label} references an unknown id.`);
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) throw new RangeError(`${label} must be contiguous.`);
}

function mergeCellIds(contract: TableContract, merge: TableMergeContract): Set<string> {
  const rowIds = new Set(merge.rowIds);
  const columnIds = new Set(merge.columnIds);
  return new Set(contract.cells.filter((cell) => rowIds.has(cell.rowId) && columnIds.has(cell.columnId)).map((cell) => cell.id));
}

function validateTableContract(document: KDrawDocumentV1, contract: TableContract): TableContract {
  finitePoint(contract.origin, "Table origin");
  if (!Number.isFinite(contract.rotationRad)) throw new RangeError("Table rotation must be finite.");
  ensureTableStyle(document, contract.styleId);
  if (!contract.rows.length || !contract.columns.length) throw new RangeError("TABLE requires at least one row and column.");
  ensureUnique(contract.rows.map((row) => row.id), "Table row");
  ensureUnique(contract.columns.map((column) => column.id), "Table column");
  contract.rows.forEach((row) => positive(row.height, `Row ${row.id} height`));
  contract.columns.forEach((column) => positive(column.width, `Column ${column.id} width`));
  ensureUnique(contract.cells.map((cell) => cell.id), "Table cell");
  const rowIds = new Set(contract.rows.map((row) => row.id));
  const columnIds = new Set(contract.columns.map((column) => column.id));
  const coordinates = new Set<string>();
  for (const cell of contract.cells) {
    if (!rowIds.has(cell.rowId) || !columnIds.has(cell.columnId)) throw new RangeError(`Cell ${cell.id} references an unknown row or column.`);
    const coordinate = `${cell.rowId}\0${cell.columnId}`;
    if (coordinates.has(coordinate)) throw new RangeError(`Duplicate table cell coordinate: ${cell.rowId}/${cell.columnId}.`);
    coordinates.add(coordinate);
    validateCellValue(cell.value);
    validateCellFormat(document, cell.format);
    if (cell.horizontalAlignment !== undefined && !["left", "center", "right"].includes(cell.horizontalAlignment)) throw new RangeError("Unsupported cell horizontal alignment.");
    if (cell.verticalAlignment !== undefined && !["top", "middle", "bottom"].includes(cell.verticalAlignment)) throw new RangeError("Unsupported cell vertical alignment.");
  }
  if (contract.cells.length !== contract.rows.length * contract.columns.length) throw new RangeError("TABLE requires exactly one cell per row/column coordinate.");
  ensureUnique(contract.merges.map((merge) => merge.id), "Table merge");
  const occupied = new Set<string>();
  for (const merge of contract.merges) {
    contiguousIds(contract.rows.map((row) => row.id), merge.rowIds, `Merge ${merge.id} rows`);
    contiguousIds(contract.columns.map((column) => column.id), merge.columnIds, `Merge ${merge.id} columns`);
    const cells = mergeCellIds(contract, merge);
    if (cells.size < 2) throw new RangeError(`Merge ${merge.id} must cover at least two cells.`);
    for (const cellId of cells) {
      if (occupied.has(cellId)) throw new RangeError(`Merge ${merge.id} overlaps another merge.`);
      occupied.add(cellId);
    }
  }
  return structuredClone(contract);
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

function tableEntity(document: KDrawDocumentV1, handle: string, layerId: string, contract: TableContract): CadProxyEntity {
  const validated = validateTableContract(document, contract);
  const entity: CadProxyEntity = { kind: "proxy", handle, layerId, originalType: "TABLE", raw: { schemaVersion: 1 }, bounds: tableBounds(validated) };
  return withAnnotationExtension(entity, validated);
}

function defaultValue(): TableCellValue { return { kind: "text", text: "" }; }

export function createTable(document: KDrawDocumentV1, args: CreateTableArgs): CadProxyEntity {
  nonEmpty(args.handle, "Table handle");
  if ([...document.entities, ...document.blocks.flatMap((block) => block.entities)].some((entity) => entity.handle === args.handle)) throw new RangeError(`Duplicate entity handle: ${args.handle}.`);
  ensureWritableLayer(document, args.layerId);
  const provided = args.cells ?? [];
  const rowIds = new Set(args.rows.map((row) => row.id));
  const columnIds = new Set(args.columns.map((column) => column.id));
  const providedCoordinates = provided.map((cell) => `${cell.rowId}\0${cell.columnId}`);
  if (new Set(providedCoordinates).size !== provided.length) throw new RangeError("TABLE contains duplicate cell coordinates.");
  if (provided.some((cell) => !rowIds.has(cell.rowId) || !columnIds.has(cell.columnId))) throw new RangeError("TABLE contains a cell outside its row/column grid.");
  const byCoordinate = new Map(provided.map((cell) => [`${cell.rowId}\0${cell.columnId}`, structuredClone(cell)]));
  const cells: TableCellContract[] = [];
  for (const row of args.rows) for (const column of args.columns) {
    const existing = byCoordinate.get(`${row.id}\0${column.id}`);
    cells.push(existing ?? { id: `${row.id}:${column.id}`, rowId: row.id, columnId: column.id, value: defaultValue() });
  }
  return tableEntity(document, args.handle, args.layerId, {
    kind: "table", version: 1, origin: finitePoint(args.origin, "Table origin"), rotationRad: args.rotationRad ?? 0,
    styleId: args.styleId, rows: structuredClone(args.rows), columns: structuredClone(args.columns), cells, merges: structuredClone(args.merges ?? []),
  });
}

function requireEditableTable(document: KDrawDocumentV1, handle: string): { entity: CadProxyEntity; contract: TableContract } {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  const contract = entity ? readTableContract(entity) : null;
  if (!entity || entity.kind !== "proxy" || !contract) throw new RangeError(`Unknown TABLE: ${handle}.`);
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
      const index = contract.cells.findIndex((cell) => cell.id === operation.cellId);
      if (index < 0) throw new RangeError(`Unknown table cell: ${operation.cellId}.`);
      contract.cells[index] = {
        ...structuredClone(contract.cells[index]!), value: structuredClone(operation.value),
        ...(operation.horizontalAlignment === undefined ? {} : { horizontalAlignment: operation.horizontalAlignment }),
        ...(operation.verticalAlignment === undefined ? {} : { verticalAlignment: operation.verticalAlignment }),
        ...(operation.format === undefined ? {} : { format: structuredClone(operation.format) }),
      };
      continue;
    }
    if (operation.type === "merge") {
      contract.merges.push(structuredClone(operation.merge));
      continue;
    }
    if (operation.type === "unmerge") {
      const before = contract.merges.length;
      contract.merges = contract.merges.filter((merge) => merge.id !== operation.mergeId);
      if (contract.merges.length === before) throw new RangeError(`Unknown table merge: ${operation.mergeId}.`);
      continue;
    }
    if (operation.type === "insert-row") {
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > contract.rows.length) throw new RangeError("Table row insertion index is invalid.");
      if (contract.rows.some((row) => row.id === operation.row.id)) throw new RangeError(`Duplicate table row: ${operation.row.id}.`);
      if (operation.cells.length !== contract.columns.length || new Set(operation.cells.map((cell) => cell.columnId)).size !== contract.columns.length) throw new RangeError("Inserted row requires one cell for every column.");
      contract.rows.splice(operation.index, 0, structuredClone(operation.row));
      contract.cells.push(...operation.cells.map((cell) => ({ id: cell.id, rowId: operation.row.id, columnId: cell.columnId, value: structuredClone(cell.value ?? defaultValue()) })));
      continue;
    }
    if (operation.type === "delete-row") {
      if (cellInMerge(contract, (merge) => merge.rowIds.includes(operation.rowId))) throw new RangeError(`Unmerge row ${operation.rowId} before deletion.`);
      const before = contract.rows.length;
      contract.rows = contract.rows.filter((row) => row.id !== operation.rowId);
      if (contract.rows.length === before) throw new RangeError(`Unknown table row: ${operation.rowId}.`);
      contract.cells = contract.cells.filter((cell) => cell.rowId !== operation.rowId);
      continue;
    }
    if (operation.type === "resize-row") {
      const row = contract.rows.find((candidate) => candidate.id === operation.rowId);
      if (!row) throw new RangeError(`Unknown table row: ${operation.rowId}.`);
      row.height = operation.height;
      continue;
    }
    if (operation.type === "insert-column") {
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > contract.columns.length) throw new RangeError("Table column insertion index is invalid.");
      if (contract.columns.some((column) => column.id === operation.column.id)) throw new RangeError(`Duplicate table column: ${operation.column.id}.`);
      if (operation.cells.length !== contract.rows.length || new Set(operation.cells.map((cell) => cell.rowId)).size !== contract.rows.length) throw new RangeError("Inserted column requires one cell for every row.");
      contract.columns.splice(operation.index, 0, structuredClone(operation.column));
      contract.cells.push(...operation.cells.map((cell) => ({ id: cell.id, rowId: cell.rowId, columnId: operation.column.id, value: structuredClone(cell.value ?? defaultValue()) })));
      continue;
    }
    if (operation.type === "delete-column") {
      if (cellInMerge(contract, (merge) => merge.columnIds.includes(operation.columnId))) throw new RangeError(`Unmerge column ${operation.columnId} before deletion.`);
      const before = contract.columns.length;
      contract.columns = contract.columns.filter((column) => column.id !== operation.columnId);
      if (contract.columns.length === before) throw new RangeError(`Unknown table column: ${operation.columnId}.`);
      contract.cells = contract.cells.filter((cell) => cell.columnId !== operation.columnId);
      continue;
    }
    if (operation.type === "resize-column") {
      const column = contract.columns.find((candidate) => candidate.id === operation.columnId);
      if (!column) throw new RangeError(`Unknown table column: ${operation.columnId}.`);
      column.width = operation.width;
      continue;
    }
    if (operation.type === "apply-style") {
      contract.styleId = operation.styleId;
      continue;
    }
    throw new RangeError(`Unsupported TABLE edit operation: ${(operation as { type?: unknown }).type}.`);
  }
  return { type: "put", entity: tableEntity(document, entity.handle, entity.layerId, contract) };
}

export function tableCellDisplayText(value: TableCellValue): string {
  validateCellValue(value);
  return value.kind === "text" ? value.text : value.fallback;
}

export function evaluateTableCapability(document: KDrawDocumentV1, handle: string): TableCapability {
  const entity = document.entities.find((candidate) => candidate.handle === handle);
  if (!entity || !readTableContract(entity)) return { executable: false, code: "missing-table", handle };
  if (document.layers.find((layer) => layer.id === entity.layerId)?.locked) return { executable: false, code: "locked-layer", handle: entity.layerId };
  return { executable: true, code: "ready" };
}
