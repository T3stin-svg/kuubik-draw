import {
  AUTOCAD_2024_ACI_PALETTE,
  createEmptyDocument,
} from "@kuubik/cad-core";
import {
  assertKDrawDocumentV1,
  type CadAppearance,
  type CadBlockDefinition,
  type CadDimensionStyle,
  type CadEntity,
  type CadHatchLoop,
  type CadLayer,
  type CadLinearUnit,
  type CadLinetype,
  type CadPoint2,
  type CadPolylineVertex,
  type CadTextStyle,
  type KDrawDocumentV1,
} from "@kuubik/cad-schema";

export const MAX_DXF_IMPORT_BYTES = 32 * 1024 * 1024;
export const MAX_DXF_IMPORT_PAIRS = 750_000;
export const MAX_DXF_IMPORT_RECORDS = 100_000;
export const MAX_DXF_RECORD_PAIRS = 16_384;
export const MAX_DXF_ENTITY_VERTICES = 50_000;
export const MAX_DXF_HATCH_LOOPS = 256;
const MAX_DXF_LINE_CHARS = 1_048_576;
const DXF_HANDLE = /^[1-9A-F][0-9A-F]{0,15}$/u;
const BUILTIN_LINETYPES = new Set(["BYBLOCK", "BYLAYER", "CONTINUOUS"]);
const INSUNITS: Readonly<Record<number, CadLinearUnit>> = Object.freeze({
  0: "unitless",
  1: "in",
  2: "ft",
  4: "mm",
  5: "cm",
  6: "m",
});

interface DxfPair {
  code: number;
  value: string;
  line: number;
}

interface DxfRecord {
  type: string;
  pairs: DxfPair[];
}

export interface DxfImportSkippedRecord {
  type: string;
  handle: string | null;
  reason: string;
}

export interface DxfImportReport {
  acadVersion: string;
  codePage: string;
  sourceByteLength: number;
  sourceUnits: CadLinearUnit;
  targetUnits: CadLinearUnit;
  insertionScale: number;
  importedHandles: string[];
  preservedProxyHandles: string[];
  skipped: DxfImportSkippedRecord[];
  warnings: string[];
}

export interface DxfImportResult {
  document: KDrawDocumentV1;
  report: DxfImportReport;
}

export interface DxfImportOptions {
  documentId: string;
  now?: string;
  /** Convert all drawing-unit geometry into these destination units. */
  targetUnits?: CadLinearUnit;
  /** Retain unsupported records as inert proxy entities for forensic read-back. */
  preserveUnsupported?: boolean;
}

export class DxfImportError extends Error {
  constructor(message: string, readonly report?: DxfImportReport) {
    super(message);
    this.name = "DxfImportError";
  }
}

function normalizedName(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function stableId(kind: string, name: string): string {
  return `dxf-${kind}:${encodeURIComponent(normalizedName(name))}`;
}

const SUPPORTED_ENTITY_TYPES = new Set([
  "LINE", "RAY", "XLINE", "CIRCLE", "ARC", "ELLIPSE", "LWPOLYLINE", "SPLINE",
  "TEXT", "MTEXT", "HATCH", "DIMENSION", "INSERT",
]);

const UNIT_TO_MM: Readonly<Record<Exclude<CadLinearUnit, "unitless">, number>> = Object.freeze({
  in: 25.4,
  ft: 304.8,
  mm: 1,
  cm: 10,
  m: 1_000,
});

function insertionScale(source: CadLinearUnit, target: CadLinearUnit): number {
  if (source === target) return 1;
  if (source === "unitless" || target === "unitless") {
    throw new DxfImportError(`DXF unit conversion ${source} -> ${target} requires an explicit unit interpretation outside the audited F-110 path.`);
  }
  return UNIT_TO_MM[source] / UNIT_TO_MM[target];
}

function decodeInput(input: string | Uint8Array): { text: string; byteLength: number } {
  const byteLength = typeof input === "string" ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (byteLength === 0) throw new DxfImportError("DXF file is empty.");
  if (byteLength > MAX_DXF_IMPORT_BYTES) throw new DxfImportError(`DXF file exceeds the ${MAX_DXF_IMPORT_BYTES} byte import limit.`);
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    const headerProbe = new TextDecoder("windows-1252").decode(input);
    const acadVersion = headerProbe.match(/(?:^|\r\n|\r|\n)\s*9\s*(?:\r\n|\r|\n)\$ACADVER\s*(?:\r\n|\r|\n)\s*1\s*(?:\r\n|\r|\n)(AC\d+)/u)?.[1];
    const versionNumber = acadVersion ? Number(acadVersion.slice(2)) : 0;
    try {
      // Autodesk defines DXF R2007 (AC1021) and newer byte streams as UTF-8;
      // earlier ASCII DXF revisions use the declared legacy code page.
      text = new TextDecoder(versionNumber >= 1021 ? "utf-8" : "windows-1252", { fatal: versionNumber >= 1021 }).decode(input);
    } catch {
      throw new DxfImportError(`DXF ${acadVersion ?? "unknown version"} is not valid UTF-8.`);
    }
  }
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfImportError("Binary DXF is not supported by this audited ASCII import path.");
  if (text.includes("\0")) throw new DxfImportError("DXF contains a NUL byte.");
  return { text, byteLength };
}

function parsePairs(text: string): DxfPair[] {
  let logicalLines = 1;
  let lineLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      logicalLines += 1;
      lineLength = 0;
    } else {
      lineLength += 1;
      if (lineLength > MAX_DXF_LINE_CHARS) throw new DxfImportError(`DXF line exceeds the ${MAX_DXF_LINE_CHARS} character limit.`);
    }
    if (logicalLines > MAX_DXF_IMPORT_PAIRS * 2 + 1) throw new DxfImportError(`DXF exceeds the ${MAX_DXF_IMPORT_PAIRS} group-pair limit.`);
  }
  const lines = text.split(/\r\n|\r|\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2 !== 0) throw new DxfImportError(`DXF ends with an unpaired group-code line ${lines.length}.`);
  const pairs: DxfPair[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const rawCode = lines[index]!;
    if (!/^\s*[+-]?\d+\s*$/u.test(rawCode)) throw new DxfImportError(`Invalid DXF group code at line ${index + 1}.`);
    const code = Number(rawCode.trim());
    if (!Number.isSafeInteger(code)) throw new DxfImportError(`DXF group code is outside the safe integer range at line ${index + 1}.`);
    pairs.push({ code, value: lines[index + 1]!, line: index + 1 });
  }
  const last = pairs.at(-1);
  if (!last || last.code !== 0 || last.value.trim().toUpperCase() !== "EOF") throw new DxfImportError("DXF is missing its final EOF record.");
  return pairs;
}

function sections(pairs: readonly DxfPair[]): Map<string, DxfPair[]> {
  const result = new Map<string, DxfPair[]>();
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    if (pair.code !== 0 || normalizedName(pair.value) !== "SECTION") continue;
    const namePair = pairs[index + 1];
    if (!namePair || namePair.code !== 2) throw new DxfImportError(`SECTION at line ${pair.line} has no name.`);
    const name = normalizedName(namePair.value);
    if (result.has(name)) throw new DxfImportError(`DXF contains duplicate ${name} sections.`);
    const body: DxfPair[] = [];
    index += 2;
    while (index < pairs.length && !(pairs[index]!.code === 0 && normalizedName(pairs[index]!.value) === "ENDSEC")) {
      body.push(pairs[index]!);
      index += 1;
    }
    if (index >= pairs.length) throw new DxfImportError(`${name} section is missing ENDSEC.`);
    result.set(name, body);
  }
  return result;
}

function firstPair(pairs: readonly DxfPair[], code: number): DxfPair | undefined {
  return pairs.find((pair) => pair.code === code);
}

function textValue(pairs: readonly DxfPair[], code: number, label: string, required = true): string | undefined {
  const pair = firstPair(pairs, code);
  if (!pair) {
    if (required) throw new DxfImportError(`${label} is missing DXF group ${code}.`);
    return undefined;
  }
  return pair.value.trim();
}

function numberValue(pairs: readonly DxfPair[], code: number, label: string, required = true): number | undefined {
  const pair = firstPair(pairs, code);
  if (!pair) {
    if (required) throw new DxfImportError(`${label} is missing DXF group ${code}.`);
    return undefined;
  }
  const value = Number(pair.value.trim());
  if (!Number.isFinite(value)) throw new DxfImportError(`${label} has a non-finite DXF group ${code} at line ${pair.line + 1}.`);
  return value;
}

function integerValue(pairs: readonly DxfPair[], code: number, label: string, required = true): number | undefined {
  const value = numberValue(pairs, code, label, required);
  if (value !== undefined && !Number.isInteger(value)) throw new DxfImportError(`${label} DXF group ${code} must be an integer.`);
  return value;
}

function pointValue(pairs: readonly DxfPair[], xCode: number, yCode: number, label: string): CadPoint2 {
  return {
    x: numberValue(pairs, xCode, label)!,
    y: numberValue(pairs, yCode, label)!,
  };
}

function singletonNumberValue(pairs: readonly DxfPair[], code: number, label: string, required = true): number | undefined {
  const matches = pairs.filter((pair) => pair.code === code);
  if (matches.length === 0) {
    if (required) throw new DxfImportError(`${label} is missing DXF group ${code}.`);
    return undefined;
  }
  const values = matches.map((pair) => {
    const value = Number(pair.value.trim());
    if (!Number.isFinite(value)) throw new DxfImportError(`${label} has a non-finite DXF group ${code} at line ${pair.line + 1}.`);
    return value;
  });
  if (values.some((value) => value !== values[0])) throw new DxfImportError(`${label} has conflicting duplicate DXF group ${code}.`);
  return values[0];
}

function auditedPlanarConic(
  pairs: readonly DxfPair[],
  label: string,
  points: ReadonlyArray<{ x: number; y: number; z: number; name: string }>,
): void {
  for (const point of points) {
    singletonNumberValue(pairs, point.x, `${label} ${point.name} X`);
    singletonNumberValue(pairs, point.y, `${label} ${point.name} Y`);
    const z = singletonNumberValue(pairs, point.z, `${label} ${point.name} Z`, false) ?? 0;
    if (Math.abs(z) > 1e-9) throw new DxfImportError(`${label} ${point.name} is non-planar (group ${point.z}).`);
  }
  const extrusionX = singletonNumberValue(pairs, 210, `${label} extrusion X`, false) ?? 0;
  const extrusionY = singletonNumberValue(pairs, 220, `${label} extrusion Y`, false) ?? 0;
  const extrusionZ = singletonNumberValue(pairs, 230, `${label} extrusion Z`, false) ?? 1;
  if (Math.abs(extrusionX) > 1e-9 || Math.abs(extrusionY) > 1e-9 || Math.abs(extrusionZ - 1) > 1e-9) {
    throw new DxfImportError(`${label} OCS extrusion is outside the audited +Z planar subset.`);
  }
}

function records(pairs: readonly DxfPair[]): DxfRecord[] {
  const result: DxfRecord[] = [];
  let current: DxfRecord | null = null;
  for (const pair of pairs) {
    if (pair.code === 0) {
      if (current) {
        if (current.pairs.length > MAX_DXF_RECORD_PAIRS) throw new DxfImportError(`${current.type} record exceeds the ${MAX_DXF_RECORD_PAIRS} pair limit.`);
        result.push(current);
        if (result.length > MAX_DXF_IMPORT_RECORDS) throw new DxfImportError(`DXF exceeds the ${MAX_DXF_IMPORT_RECORDS} record limit.`);
      }
      current = { type: normalizedName(pair.value), pairs: [] };
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  if (current) {
    if (current.pairs.length > MAX_DXF_RECORD_PAIRS) throw new DxfImportError(`${current.type} record exceeds the ${MAX_DXF_RECORD_PAIRS} pair limit.`);
    result.push(current);
    if (result.length > MAX_DXF_IMPORT_RECORDS) throw new DxfImportError(`DXF exceeds the ${MAX_DXF_IMPORT_RECORDS} record limit.`);
  }
  return result;
}

function tableRecords(tableSection: readonly DxfPair[], tableName: string): DxfRecord[] {
  for (let index = 0; index < tableSection.length; index += 1) {
    if (tableSection[index]!.code !== 0 || normalizedName(tableSection[index]!.value) !== "TABLE") continue;
    const name = tableSection[index + 1];
    if (!name || name.code !== 2) throw new DxfImportError(`TABLE at line ${tableSection[index]!.line} has no name.`);
    let end = index + 2;
    while (end < tableSection.length && !(tableSection[end]!.code === 0 && normalizedName(tableSection[end]!.value) === "ENDTAB")) end += 1;
    if (end >= tableSection.length) throw new DxfImportError(`${normalizedName(name.value)} table is missing ENDTAB.`);
    if (normalizedName(name.value) === normalizedName(tableName)) return records(tableSection.slice(index + 2, end));
    index = end;
  }
  return [];
}

function headerVariables(header: readonly DxfPair[]): Map<string, DxfPair> {
  const result = new Map<string, DxfPair>();
  for (let index = 0; index < header.length; index += 1) {
    const pair = header[index]!;
    if (pair.code !== 9) continue;
    const value = header[index + 1];
    if (!value) throw new DxfImportError(`Header variable ${pair.value.trim()} has no value.`);
    result.set(normalizedName(pair.value), value);
  }
  return result;
}

function requireHeader(headers: ReadonlyMap<string, DxfPair>, name: string): DxfPair {
  const pair = headers.get(name);
  if (!pair) throw new DxfImportError(`DXF header is missing ${name}.`);
  return pair;
}

function uniqueNames(values: readonly { name: string }[], kind: string): void {
  const names = new Set<string>();
  for (const value of values) {
    const normalized = normalizedName(value.name);
    if (!normalized) throw new DxfImportError(`DXF ${kind} has an empty name.`);
    if (names.has(normalized)) throw new DxfImportError(`DXF contains duplicate ${kind} name ${value.name}.`);
    names.add(normalized);
  }
}

function registerHandle(raw: string, used: Set<string>, label: string): string {
  const handle = normalizedName(raw);
  if (!DXF_HANDLE.test(handle)) throw new DxfImportError(`${label} has unsupported handle ${raw}.`);
  if (used.has(handle)) throw new DxfImportError(`DXF contains duplicate global handle ${handle}.`);
  used.add(handle);
  return handle;
}

function registerSectionHandles(pairs: readonly DxfPair[], used: Set<string>, label: string): void {
  for (const pair of pairs) {
    if (pair.code === 5 || pair.code === 105) registerHandle(pair.value.trim(), used, label);
  }
}

function rgbHex(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new DxfImportError(`DXF TrueColor ${value} is outside 0..16777215.`);
  return `#${value.toString(16).padStart(6, "0")}`;
}

function aciHex(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 255) throw new DxfImportError(`DXF ACI ${index} is outside 1..255.`);
  return AUTOCAD_2024_ACI_PALETTE[index - 1]!;
}

function transparencyPercent(raw: number): number {
  if (!Number.isInteger(raw) || raw < 0) throw new DxfImportError(`Invalid DXF transparency value ${raw}.`);
  const alpha = raw & 0xff;
  return Number((100 * (1 - alpha / 255)).toFixed(12));
}

function xdataTransparency(pairs: readonly DxfPair[]): number | undefined {
  for (let index = 0; index < pairs.length - 1; index += 1) {
    if (pairs[index]!.code === 1001 && normalizedName(pairs[index]!.value) === "ACCMTRANSPARENCY") {
      const value = pairs[index + 1]!;
      if (value.code !== 1071) throw new DxfImportError("AcCmTransparency XDATA is missing its 1071 value.");
      const raw = Number(value.value.trim());
      if (!Number.isInteger(raw)) throw new DxfImportError("AcCmTransparency XDATA must be an integer.");
      return transparencyPercent(raw);
    }
  }
  return undefined;
}

function appearance(
  pairs: readonly DxfPair[],
  linetypeIds: ReadonlyMap<string, string>,
  options: { layer: boolean },
): CadAppearance | undefined {
  const rawAci = integerValue(pairs, 62, "appearance", false);
  const index = rawAci === undefined ? undefined : Math.abs(rawAci);
  const trueColor = integerValue(pairs, 420, "appearance", false);
  const linetypeName = textValue(pairs, 6, "appearance", false);
  const linetypeId = linetypeName && !BUILTIN_LINETYPES.has(normalizedName(linetypeName))
    ? linetypeIds.get(normalizedName(linetypeName))
    : undefined;
  if (linetypeName && !BUILTIN_LINETYPES.has(normalizedName(linetypeName)) && !linetypeId) {
    throw new DxfImportError(`Appearance references missing linetype ${linetypeName}.`);
  }
  const rawLineweight = integerValue(pairs, 370, "appearance", false);
  const commonTransparency = integerValue(pairs, 440, "appearance", false);
  const linetypeScale = numberValue(pairs, 48, "appearance", false);
  const thickness = numberValue(pairs, 39, "appearance", false);
  const layerTransparency = options.layer ? xdataTransparency(pairs) : undefined;
  const result: CadAppearance = {};
  if (trueColor !== undefined) {
    result.color = rgbHex(trueColor);
    result.colorMethod = "trueColor";
    if (index !== undefined && index >= 1 && index <= 255) result.aciIndex = index;
  } else if (index !== undefined && index >= 1 && index <= 255) {
    result.color = aciHex(index);
    result.colorMethod = "aci";
    result.aciIndex = index;
  } else if (index !== undefined && index !== 0 && index !== 256) {
    throw new DxfImportError(`Appearance ACI ${index} is unsupported.`);
  }
  if (linetypeId) result.linetypeId = linetypeId;
  if (linetypeScale !== undefined) {
    if (linetypeScale <= 0) throw new DxfImportError("Appearance linetype scale must be greater than zero.");
    result.linetypeScale = linetypeScale;
  }
  if (rawLineweight !== undefined && rawLineweight >= 0) result.lineweightMm = rawLineweight / 100;
  const parsedTransparency = commonTransparency === undefined ? layerTransparency : transparencyPercent(commonTransparency);
  if (parsedTransparency !== undefined) result.transparency = parsedTransparency;
  if (thickness !== undefined) result.thickness = thickness;
  return Object.keys(result).length ? result : undefined;
}

function parseLinetypes(tableSection: readonly DxfPair[]): { values: CadLinetype[]; ids: Map<string, string> } {
  const allRecords = tableRecords(tableSection, "LTYPE").filter((record) => record.type === "LTYPE");
  const values: CadLinetype[] = [];
  const ids = new Map<string, string>();
  for (const record of allRecords) {
    const name = textValue(record.pairs, 2, "linetype")!;
    const normalized = normalizedName(name);
    if (ids.has(normalized)) throw new DxfImportError(`DXF contains duplicate linetype name ${name}.`);
    if (BUILTIN_LINETYPES.has(normalized)) continue;
    const id = stableId("linetype", name);
    const pattern = record.pairs.filter((pair) => pair.code === 49).map((pair) => {
      const value = Number(pair.value.trim());
      if (!Number.isFinite(value)) throw new DxfImportError(`Linetype ${name} contains a non-finite pattern segment.`);
      return value;
    });
    const expectedSegments = integerValue(record.pairs, 73, `linetype ${name}`, false);
    if (expectedSegments !== undefined && expectedSegments !== pattern.length) throw new DxfImportError(`Linetype ${name} segment count does not match group 73.`);
    const description = textValue(record.pairs, 3, `linetype ${name}`, false);
    values.push({ id, name, ...(description ? { description } : {}), pattern });
    ids.set(normalized, id);
  }
  return { values, ids };
}

function parseTextStyles(tableSection: readonly DxfPair[]): { values: CadTextStyle[]; ids: Map<string, string>; handles: Map<string, string> } {
  const values: CadTextStyle[] = [];
  const ids = new Map<string, string>();
  const handles = new Map<string, string>();
  for (const record of tableRecords(tableSection, "STYLE").filter((candidate) => candidate.type === "STYLE")) {
    const name = textValue(record.pairs, 2, "text style")!;
    const normalized = normalizedName(name);
    if (ids.has(normalized)) throw new DxfImportError(`DXF contains duplicate text style name ${name}.`);
    const widthFactor = numberValue(record.pairs, 41, `text style ${name}`, false) ?? 1;
    if (!(widthFactor > 0)) throw new DxfImportError(`Text style ${name} has a non-positive width factor.`);
    const id = stableId("text-style", name);
    const bigFont = textValue(record.pairs, 4, `text style ${name}`, false);
    values.push({
      id,
      name,
      fontFamily: textValue(record.pairs, 3, `text style ${name}`, false) ?? "txt",
      ...(bigFont ? { bigFont } : {}),
      widthFactor,
      obliqueAngleRad: (numberValue(record.pairs, 50, `text style ${name}`, false) ?? 0) * Math.PI / 180,
    });
    ids.set(normalized, id);
    const handle = textValue(record.pairs, 5, `text style ${name}`, false);
    if (handle) handles.set(normalizedName(handle), id);
  }
  uniqueNames(values, "text style");
  return { values, ids, handles };
}

function parseDimensionStyles(
  tableSection: readonly DxfPair[],
  textStyleHandles: ReadonlyMap<string, string>,
): { values: CadDimensionStyle[]; ids: Map<string, string> } {
  const values: CadDimensionStyle[] = [];
  const ids = new Map<string, string>();
  for (const record of tableRecords(tableSection, "DIMSTYLE").filter((candidate) => candidate.type === "DIMSTYLE")) {
    const name = textValue(record.pairs, 2, "dimension style")!;
    const normalized = normalizedName(name);
    if (ids.has(normalized)) throw new DxfImportError(`DXF contains duplicate dimension style name ${name}.`);
    const textStyleHandle = textValue(record.pairs, 340, `dimension style ${name}`, false);
    const textStyleId = textStyleHandle ? textStyleHandles.get(normalizedName(textStyleHandle)) : undefined;
    if (textStyleHandle && !textStyleId) throw new DxfImportError(`Dimension style ${name} references missing text style handle ${textStyleHandle}.`);
    const id = stableId("dimension-style", name);
    const value: CadDimensionStyle = {
      id,
      name,
      ...(textStyleId ? { textStyleId } : {}),
      textHeight: numberValue(record.pairs, 140, `dimension style ${name}`, false) ?? 2.5,
      arrowSize: numberValue(record.pairs, 41, `dimension style ${name}`, false) ?? 2.5,
      extensionOffset: numberValue(record.pairs, 42, `dimension style ${name}`, false) ?? 0.625,
      scale: numberValue(record.pairs, 40, `dimension style ${name}`, false) ?? 1,
    };
    if (!(value.textHeight > 0 && value.arrowSize > 0 && value.scale > 0) || value.extensionOffset < 0) {
      throw new DxfImportError(`Dimension style ${name} contains invalid sizes.`);
    }
    values.push(value);
    ids.set(normalized, id);
  }
  uniqueNames(values, "dimension style");
  return { values, ids };
}

function parseLayers(tableSection: readonly DxfPair[], linetypeIds: ReadonlyMap<string, string>): { values: CadLayer[]; ids: Map<string, string> } {
  const values: CadLayer[] = [];
  const ids = new Map<string, string>();
  for (const record of tableRecords(tableSection, "LAYER").filter((candidate) => candidate.type === "LAYER")) {
    const name = textValue(record.pairs, 2, "layer")!;
    const normalized = normalizedName(name);
    if (ids.has(normalized)) throw new DxfImportError(`DXF contains duplicate layer name ${name}.`);
    const flags = integerValue(record.pairs, 70, `layer ${name}`, false) ?? 0;
    const rawColor = integerValue(record.pairs, 62, `layer ${name}`, false) ?? 7;
    const id = stableId("layer", name);
    const parsedAppearance = appearance(record.pairs, linetypeIds, { layer: true });
    values.push({
      id,
      name,
      visible: rawColor >= 0,
      frozen: (flags & 1) !== 0,
      locked: (flags & 4) !== 0,
      plottable: (integerValue(record.pairs, 290, `layer ${name}`, false) ?? 1) !== 0,
      ...(parsedAppearance ? { appearance: parsedAppearance } : {}),
    });
    ids.set(normalized, id);
  }
  if (!values.length) throw new DxfImportError("DXF contains no LAYER table records.");
  uniqueNames(values, "layer");
  return { values, ids };
}

function parseHandle(record: DxfRecord, used: Set<string>): string {
  const raw = textValue(record.pairs, 5, `${record.type} handle`)!;
  return registerHandle(raw, used, record.type);
}

function entityBase(
  record: DxfRecord,
  layerIds: ReadonlyMap<string, string>,
  linetypeIds: ReadonlyMap<string, string>,
  usedHandles: Set<string>,
): { handle: string; layerId: string; appearance?: CadAppearance } {
  const handle = parseHandle(record, usedHandles);
  const layerName = textValue(record.pairs, 8, `${record.type} ${handle} layer`)!;
  const layerId = layerIds.get(normalizedName(layerName));
  if (!layerId) throw new DxfImportError(`${record.type} ${handle} references missing layer ${layerName}.`);
  const parsedAppearance = appearance(record.pairs, linetypeIds, { layer: false });
  return { handle, layerId, ...(parsedAppearance ? { appearance: parsedAppearance } : {}) };
}

function parsePolyline(record: DxfRecord, base: ReturnType<typeof entityBase>): CadEntity {
  const vertices: CadPolylineVertex[] = [];
  for (let index = 0; index < record.pairs.length; index += 1) {
    if (record.pairs[index]!.code !== 10) continue;
    const x = Number(record.pairs[index]!.value.trim());
    if (!Number.isFinite(x)) throw new DxfImportError(`LWPOLYLINE ${base.handle} has a non-finite vertex X.`);
    const vertex: CadPolylineVertex = { x, y: Number.NaN };
    for (index += 1; index < record.pairs.length && record.pairs[index]!.code !== 10; index += 1) {
      const pair = record.pairs[index]!;
      const value = Number(pair.value.trim());
      if ([20, 40, 41, 42].includes(pair.code) && !Number.isFinite(value)) throw new DxfImportError(`LWPOLYLINE ${base.handle} has a non-finite vertex value.`);
      if (pair.code === 20) vertex.y = value;
      else if (pair.code === 40) vertex.startWidth = value;
      else if (pair.code === 41) vertex.endWidth = value;
      else if (pair.code === 42 && value !== 0) vertex.bulge = value;
    }
    index -= 1;
    if (!Number.isFinite(vertex.y)) throw new DxfImportError(`LWPOLYLINE ${base.handle} vertex has no Y coordinate.`);
    vertices.push(vertex);
    if (vertices.length > MAX_DXF_ENTITY_VERTICES) throw new DxfImportError(`LWPOLYLINE ${base.handle} exceeds the ${MAX_DXF_ENTITY_VERTICES} vertex limit.`);
  }
  const expected = integerValue(record.pairs, 90, `LWPOLYLINE ${base.handle}`)!;
  if (expected !== vertices.length || vertices.length < 2) throw new DxfImportError(`LWPOLYLINE ${base.handle} vertex count is invalid.`);
  const flags = integerValue(record.pairs, 70, `LWPOLYLINE ${base.handle}`, false) ?? 0;
  return { kind: "polyline", ...base, vertices, closed: (flags & 1) !== 0 };
}

function parseHatch(record: DxfRecord, base: ReturnType<typeof entityBase>): CadEntity {
  const pattern = textValue(record.pairs, 2, `HATCH ${base.handle} pattern`)!;
  const solid = normalizedName(pattern) === "SOLID";
  const associative = integerValue(record.pairs, 71, `HATCH ${base.handle}`)!;
  if (associative !== 0) throw new DxfImportError(`HATCH ${base.handle} associative boundary references are outside the audited roundtrip subset.`);
  const solidFill = integerValue(record.pairs, 70, `HATCH ${base.handle}`)!;
  if (solidFill !== (solid ? 1 : 0)) throw new DxfImportError(`HATCH ${base.handle} pattern and solid-fill flag disagree.`);
  const expectedPreamble: Array<{ code: number; value?: string | number; numeric?: boolean }> = [
    { code: 5, value: base.handle },
    { code: 330, value: "1A" },
    { code: 100, value: "AcDbEntity" },
    { code: 8 },
    { code: 100, value: "AcDbHatch" },
    { code: 10, value: 0, numeric: true },
    { code: 20, value: 0, numeric: true },
    { code: 30, value: 0, numeric: true },
    { code: 210, value: 0, numeric: true },
    { code: 220, value: 0, numeric: true },
    { code: 230, value: 1, numeric: true },
    { code: 2, value: pattern },
    { code: 70, value: solidFill, numeric: true },
    { code: 71, value: associative, numeric: true },
    { code: 91 },
  ];
  for (const [index, expected] of expectedPreamble.entries()) {
    const pair = record.pairs[index];
    if (!pair || pair.code !== expected.code) throw new DxfImportError(`HATCH ${base.handle} preamble is outside the audited deterministic subset at group ${expected.code}.`);
    if (expected.value === undefined) continue;
    const actual = expected.numeric ? Number(pair.value.trim()) : pair.value.trim();
    const wanted = expected.numeric ? Number(expected.value) : expected.value;
    if (actual !== wanted) throw new DxfImportError(`HATCH ${base.handle} preamble is outside the audited deterministic subset at group ${expected.code}.`);
  }
  const loopCountPairIndex = expectedPreamble.length - 1;
  const expectedLoopCount = Number(record.pairs[loopCountPairIndex]!.value.trim());
  if (!Number.isInteger(expectedLoopCount) || expectedLoopCount < 1 || expectedLoopCount > MAX_DXF_HATCH_LOOPS) throw new DxfImportError(`HATCH ${base.handle} loop count is outside 1..${MAX_DXF_HATCH_LOOPS}.`);
  const loops: CadHatchLoop[] = [];
  let index = loopCountPairIndex + 1;
  while (loops.length < expectedLoopCount) {
    if (record.pairs[index]?.code !== 92) throw new DxfImportError(`HATCH ${base.handle} loop ${loops.length + 1} does not begin with group 92.`);
    const flags = Number(record.pairs[index]!.value.trim());
    if (!Number.isInteger(flags) || (flags !== 2 && flags !== 3)) throw new DxfImportError(`HATCH ${base.handle} loop flags ${flags} are outside the closed polyline subset.`);
    index += 1;
    if (record.pairs[index]?.code !== 72) throw new DxfImportError(`HATCH ${base.handle} loop has no polyline bulge flag.`);
    const hasBulges = Number(record.pairs[index]!.value.trim());
    if (hasBulges !== 0 && hasBulges !== 1) throw new DxfImportError(`HATCH ${base.handle} polyline bulge flag is outside 0..1.`);
    index += 1;
    if (record.pairs[index]?.code !== 73 || Number(record.pairs[index]!.value.trim()) !== 1) throw new DxfImportError(`HATCH ${base.handle} boundary must be explicitly closed.`);
    index += 1;
    if (record.pairs[index]?.code !== 93) throw new DxfImportError(`HATCH ${base.handle} loop has no vertex count.`);
    const vertexCount = Number(record.pairs[index]!.value.trim());
    if (!Number.isInteger(vertexCount) || vertexCount < 3 || vertexCount > MAX_DXF_ENTITY_VERTICES) throw new DxfImportError(`HATCH ${base.handle} loop vertex count is outside 3..${MAX_DXF_ENTITY_VERTICES}.`);
    index += 1;
    const vertices: Array<CadPoint2 & { bulge?: number }> = [];
    while (vertices.length < vertexCount) {
      if (record.pairs[index]?.code !== 10) throw new DxfImportError(`HATCH ${base.handle} loop vertex ${vertices.length + 1} has no X coordinate.`);
      const x = Number(record.pairs[index]!.value.trim());
      index += 1;
      if (record.pairs[index]?.code !== 20) throw new DxfImportError(`HATCH ${base.handle} loop vertex has no Y coordinate.`);
      const y = Number(record.pairs[index]!.value.trim());
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DxfImportError(`HATCH ${base.handle} loop contains a non-finite vertex.`);
      index += 1;
      let bulge: number | undefined;
      if (hasBulges === 1 && record.pairs[index]?.code === 42) {
        const value = Number(record.pairs[index]!.value.trim());
        if (!Number.isFinite(value)) throw new DxfImportError(`HATCH ${base.handle} loop contains a non-finite bulge.`);
        if (value !== 0) bulge = value;
        index += 1;
      }
      vertices.push({ x, y, ...(bulge !== undefined ? { bulge } : {}) });
    }
    if (record.pairs[index]?.code !== 97 || Number(record.pairs[index]!.value.trim()) !== 0) throw new DxfImportError(`HATCH ${base.handle} associative source handles are outside the audited roundtrip subset.`);
    index += 1;
    loops.push({ vertices, isHole: (flags & 1) === 0 });
  }
  const expectedTail: Array<[number, number]> = [
    [75, 1],
    [76, solid ? 1 : 0],
    ...(!solid ? [[52, 0], [41, 1], [77, 0], [78, 1], [53, 45], [43, 0], [44, 0], [45, 0], [46, 3.175], [79, 0]] as Array<[number, number]> : []),
    [98, 0],
  ];
  for (const [code, value] of expectedTail) {
    const pair = record.pairs[index];
    if (!pair || pair.code !== code || Number(pair.value.trim()) !== value) throw new DxfImportError(`HATCH ${base.handle} pattern definition is outside the audited deterministic subset at group ${code}.`);
    index += 1;
  }
  if (index < record.pairs.length) {
    const autoCadNoGradientTail: Array<[number, string | number]> = [
      [450, 0], [451, 0], [460, 0], [461, 0], [452, 0], [462, 0], [453, 0], [470, ""],
    ];
    for (const [code, value] of autoCadNoGradientTail) {
      const pair = record.pairs[index];
      const actual = typeof value === "number" ? Number(pair?.value.trim()) : pair?.value.trim();
      if (!pair || pair.code !== code || actual !== value) throw new DxfImportError(`HATCH ${base.handle} gradient definition is outside the audited disabled-gradient subset at group ${code}.`);
      index += 1;
    }
  }
  if (index !== record.pairs.length) throw new DxfImportError(`HATCH ${base.handle} contains unconsumed boundary or pattern data.`);
  return {
    kind: "hatch",
    ...base,
    pattern,
    associative: false,
    loops,
  };
}

function unescapeDxfText(value: string, multiline: boolean): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== "\\") {
      result += character;
      continue;
    }
    if (value[index + 1] === "\\") {
      result += "\\";
      index += 1;
      continue;
    }
    const unicode = /^\\U\+([0-9A-F]{4})/iu.exec(value.slice(index));
    if (unicode) {
      result += String.fromCharCode(Number.parseInt(unicode[1]!, 16));
      index += unicode[0].length - 1;
      continue;
    }
    if (multiline && value[index + 1]?.toUpperCase() === "P") {
      result += "\n";
      index += 1;
      continue;
    }
    result += "\\";
  }
  return result;
}

function parseSpline(record: DxfRecord, base: Omit<Extract<CadEntity, { kind: "spline" }>, "kind" | "degree" | "controlPoints" | "knots" | "weights" | "closed" | "periodic">): CadEntity {
  const label = `SPLINE ${base.handle}`;
  const normalX = singletonNumberValue(record.pairs, 210, `${label} normal X`, false) ?? 0;
  const normalY = singletonNumberValue(record.pairs, 220, `${label} normal Y`, false) ?? 0;
  const normalZ = singletonNumberValue(record.pairs, 230, `${label} normal Z`, false) ?? 1;
  if (Math.abs(normalX) > 1e-9 || Math.abs(normalY) > 1e-9 || Math.abs(normalZ - 1) > 1e-9) {
    throw new DxfImportError(`${label} normal is outside the audited +Z planar subset.`);
  }
  const flags = integerValue(record.pairs, 70, `${label} flags`)!;
  const degree = integerValue(record.pairs, 71, `${label} degree`)!;
  const knotCount = integerValue(record.pairs, 72, `${label} knot count`)!;
  const controlPointCount = integerValue(record.pairs, 73, `${label} control-point count`)!;
  const fitPointCount = integerValue(record.pairs, 74, `${label} fit-point count`, false) ?? 0;
  if (flags < 0 || (flags & ~15) !== 0) throw new DxfImportError(`${label} flags ${flags} are outside the 2D planar subset.`);
  if (!Number.isInteger(degree) || degree < 1 || degree > 16) throw new DxfImportError(`${label} degree is outside 1..16.`);
  if (!Number.isInteger(controlPointCount) || controlPointCount <= degree || controlPointCount > MAX_DXF_ENTITY_VERTICES) throw new DxfImportError(`${label} control-point count is invalid.`);
  if (knotCount !== controlPointCount + degree + 1) throw new DxfImportError(`${label} knot count does not match control points plus degree plus one.`);
  if (fitPointCount !== 0) throw new DxfImportError(`${label} fit points are outside the audited control-point subset.`);
  const numericPairs = (code: number, field: string): number[] => record.pairs.filter((pair) => pair.code === code).map((pair) => {
    const value = Number(pair.value.trim());
    if (!Number.isFinite(value)) throw new DxfImportError(`${label} ${field} contains a non-finite value at line ${pair.line + 1}.`);
    return value;
  });
  const knots = numericPairs(40, "knots");
  if (knots.length !== knotCount || knots.some((knot, index) => index > 0 && knot < knots[index - 1]!)) throw new DxfImportError(`${label} knots are missing, unsorted or inconsistent with group 72.`);
  if (!(knots[controlPointCount]! - knots[degree]! > 0)) throw new DxfImportError(`${label} has an empty parameter domain.`);
  const x = numericPairs(10, "control-point X values");
  const y = numericPairs(20, "control-point Y values");
  const z = numericPairs(30, "control-point Z values");
  if (x.length !== controlPointCount || y.length !== controlPointCount || (z.length !== 0 && z.length !== controlPointCount)) throw new DxfImportError(`${label} control-point groups do not match group 73.`);
  if (z.some((value) => Math.abs(value) > 1e-9)) throw new DxfImportError(`${label} contains non-planar control points.`);
  const weights = numericPairs(41, "weights");
  const rational = (flags & 4) !== 0;
  if ((rational && weights.length !== controlPointCount) || (!rational && weights.length !== 0) || weights.some((weight) => !(weight > 0))) throw new DxfImportError(`${label} rational flag and positive weights are inconsistent.`);
  const controlPoints = x.map((xCoordinate, index) => ({ x: xCoordinate, y: y[index]! }));
  return {
    kind: "spline", ...base, degree, controlPoints, knots,
    ...(rational ? { weights } : {}),
    closed: (flags & 1) !== 0,
    periodic: (flags & 2) !== 0,
  };
}

function parseEntity(
  record: DxfRecord,
  layerIds: ReadonlyMap<string, string>,
  linetypeIds: ReadonlyMap<string, string>,
  textStyleIds: ReadonlyMap<string, string>,
  dimensionStyleIds: ReadonlyMap<string, string>,
  blockIds: ReadonlyMap<string, string>,
  usedHandles: Set<string>,
): CadEntity | null {
  const base = entityBase(record, layerIds, linetypeIds, usedHandles);
  if ((integerValue(record.pairs, 67, `${record.type} ${base.handle}`, false) ?? 0) !== 0) return null;
  switch (record.type) {
    case "LINE":
      return { kind: "line", ...base, start: pointValue(record.pairs, 10, 20, `LINE ${base.handle} start`), end: pointValue(record.pairs, 11, 21, `LINE ${base.handle} end`) };
    case "RAY":
    case "XLINE": {
      const label = `${record.type} ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [
        { x: 10, y: 20, z: 30, name: "base point" },
        { x: 11, y: 21, z: 31, name: "direction" },
      ]);
      const direction = pointValue(record.pairs, 11, 21, `${label} direction`);
      if (!(Math.hypot(direction.x, direction.y) > 0)) throw new DxfImportError(`${label} direction must be non-zero.`);
      return {
        kind: record.type === "RAY" ? "ray" : "xline",
        ...base,
        basePoint: pointValue(record.pairs, 10, 20, `${label} base point`),
        direction,
      };
    }
    case "CIRCLE": {
      const label = `CIRCLE ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [{ x: 10, y: 20, z: 30, name: "center" }]);
      const radius = singletonNumberValue(record.pairs, 40, `${label} radius`)!;
      if (!(radius > 0)) throw new DxfImportError(`CIRCLE ${base.handle} radius must be positive.`);
      return { kind: "circle", ...base, center: pointValue(record.pairs, 10, 20, `CIRCLE ${base.handle} center`), radius };
    }
    case "ARC": {
      const label = `ARC ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [{ x: 10, y: 20, z: 30, name: "center" }]);
      const radius = singletonNumberValue(record.pairs, 40, `${label} radius`)!;
      if (!(radius > 0)) throw new DxfImportError(`ARC ${base.handle} radius must be positive.`);
      const startAngleRad = singletonNumberValue(record.pairs, 50, `${label} start angle`)! * Math.PI / 180;
      const endAngleRad = singletonNumberValue(record.pairs, 51, `${label} end angle`)! * Math.PI / 180;
      return {
        kind: "arc",
        ...base,
        center: pointValue(record.pairs, 10, 20, `ARC ${base.handle} center`),
        radius,
        startAngleRad,
        endAngleRad,
        counterClockwise: true,
      };
    }
    case "ELLIPSE": {
      const label = `ELLIPSE ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [
        { x: 10, y: 20, z: 30, name: "center" },
        { x: 11, y: 21, z: 31, name: "major axis" },
      ]);
      const majorAxis = pointValue(record.pairs, 11, 21, `ELLIPSE ${base.handle} major axis`);
      const ratio = singletonNumberValue(record.pairs, 40, `${label} ratio`)!;
      if (!(Math.hypot(majorAxis.x, majorAxis.y) > 0)) throw new DxfImportError(`ELLIPSE ${base.handle} major axis must be non-zero.`);
      if (!(ratio > 0 && ratio <= 1)) throw new DxfImportError(`ELLIPSE ${base.handle} ratio must be greater than zero and at most one.`);
      return {
        kind: "ellipse",
        ...base,
        center: pointValue(record.pairs, 10, 20, `ELLIPSE ${base.handle} center`),
        majorAxis,
        ratio,
        startParameter: singletonNumberValue(record.pairs, 41, `${label} start parameter`, false) ?? 0,
        endParameter: singletonNumberValue(record.pairs, 42, `${label} end parameter`, false) ?? Math.PI * 2,
      };
    }
    case "LWPOLYLINE":
      return parsePolyline(record, base);
    case "SPLINE":
      return parseSpline(record, base);
    case "TEXT": {
      const styleName = textValue(record.pairs, 7, `TEXT ${base.handle} style`, false) ?? "Standard";
      const styleId = textStyleIds.get(normalizedName(styleName));
      if (!styleId) throw new DxfImportError(`TEXT ${base.handle} references missing style ${styleName}.`);
      const height = numberValue(record.pairs, 40, `TEXT ${base.handle} height`)!;
      if (!(height > 0)) throw new DxfImportError(`TEXT ${base.handle} height must be positive.`);
      return {
        kind: "text",
        ...base,
        position: pointValue(record.pairs, 10, 20, `TEXT ${base.handle} insertion`),
        text: unescapeDxfText(firstPair(record.pairs, 1)?.value ?? "", false),
        height,
        rotationRad: (numberValue(record.pairs, 50, `TEXT ${base.handle} rotation`, false) ?? 0) * Math.PI / 180,
        styleId,
      };
    }
    case "MTEXT": {
      const label = `MTEXT ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [{ x: 10, y: 20, z: 30, name: "insertion" }]);
      const directionX = singletonNumberValue(record.pairs, 11, `${label} direction X`, false);
      const directionY = singletonNumberValue(record.pairs, 21, `${label} direction Y`, false);
      const directionZ = singletonNumberValue(record.pairs, 31, `${label} direction Z`, false) ?? 0;
      const rotationDegrees = singletonNumberValue(record.pairs, 50, `${label} rotation`, false);
      if ((directionX === undefined) !== (directionY === undefined)) throw new DxfImportError(`${label} direction vector requires both group 11 and group 21.`);
      if (directionX !== undefined && rotationDegrees !== undefined) throw new DxfImportError(`${label} cannot combine group-50 and direction-vector rotation.`);
      if (Math.abs(directionZ) > 1e-9) throw new DxfImportError(`${label} direction vector is outside the audited planar subset.`);
      if (directionX !== undefined && !(Math.hypot(directionX, directionY!) > 1e-12)) throw new DxfImportError(`${label} direction vector must be non-zero.`);
      const rotationRad = directionX === undefined ? (rotationDegrees ?? 0) * Math.PI / 180 : Math.atan2(directionY!, directionX);
      const styleName = textValue(record.pairs, 7, `${label} style`, false) ?? "Standard";
      const styleId = textStyleIds.get(normalizedName(styleName));
      if (!styleId) throw new DxfImportError(`${label} references missing style ${styleName}.`);
      const height = singletonNumberValue(record.pairs, 40, `${label} height`)!;
      if (!(height > 0)) throw new DxfImportError(`${label} height must be positive.`);
      const width = singletonNumberValue(record.pairs, 41, `${label} width`, false) ?? 0;
      if (width < 0) throw new DxfImportError(`${label} width must be non-negative.`);
      const attachment = integerValue(record.pairs, 71, `${label} attachment`, false) ?? 1;
      if (attachment < 1 || attachment > 9) throw new DxfImportError(`${label} attachment must be in 1..9.`);
      const chunks = record.pairs.filter((pair) => pair.code === 3 || pair.code === 1);
      if (!chunks.some((pair) => pair.code === 1)) throw new DxfImportError(`${label} is missing its final group 1 text chunk.`);
      return {
        kind: "mtext",
        ...base,
        position: pointValue(record.pairs, 10, 20, `${label} insertion`),
        text: unescapeDxfText(chunks.map((pair) => pair.value).join(""), true),
        height,
        rotationRad,
        styleId,
        extensionData: { "kuubik.dxf.mtext.v1": { width, attachment } },
      };
    }
    case "HATCH":
      return parseHatch(record, base);
    case "DIMENSION": {
      const rawKind = (integerValue(record.pairs, 70, `DIMENSION ${base.handle} type`)! & 7);
      if (rawKind !== 0 && rawKind !== 1) throw new DxfImportError(`DIMENSION ${base.handle} type ${rawKind} is outside the F-111 linear/aligned scope.`);
      const styleName = textValue(record.pairs, 3, `DIMENSION ${base.handle} style`)!;
      const styleId = dimensionStyleIds.get(normalizedName(styleName));
      if (!styleId) throw new DxfImportError(`DIMENSION ${base.handle} references missing style ${styleName}.`);
      const override = firstPair(record.pairs, 1)?.value;
      return {
        kind: "dimension",
        ...base,
        dimensionKind: rawKind === 1 ? "aligned" : "linear",
        definitionPoints: [
          pointValue(record.pairs, 13, 23, `DIMENSION ${base.handle} first extension`),
          pointValue(record.pairs, 14, 24, `DIMENSION ${base.handle} second extension`),
          pointValue(record.pairs, 10, 20, `DIMENSION ${base.handle} definition`),
          pointValue(record.pairs, 11, 21, `DIMENSION ${base.handle} text`),
        ],
        styleId,
        ...(override && override !== "<>" ? { overrideText: unescapeDxfText(override, false) } : {}),
      };
    }
    case "INSERT": {
      const label = `INSERT ${base.handle}`;
      auditedPlanarConic(record.pairs, label, [{ x: 10, y: 20, z: 30, name: "insertion" }]);
      const blockName = textValue(record.pairs, 2, `${label} block`)!;
      const blockId = blockIds.get(normalizedName(blockName));
      if (!blockId) throw new DxfImportError(`${label} references missing block ${blockName}.`);
      const scaleX = singletonNumberValue(record.pairs, 41, `${label} X scale`, false) ?? 1;
      const scaleY = singletonNumberValue(record.pairs, 42, `${label} Y scale`, false) ?? 1;
      const scaleZ = singletonNumberValue(record.pairs, 43, `${label} Z scale`, false) ?? 1;
      if (!(scaleX !== 0 && scaleY !== 0) || Math.abs(scaleZ - 1) > 1e-9) {
        throw new DxfImportError(`${label} requires non-zero planar X/Y scale and Z scale 1.`);
      }
      const columns = integerValue(record.pairs, 70, `${label} column count`, false) ?? 1;
      const rows = integerValue(record.pairs, 71, `${label} row count`, false) ?? 1;
      if (columns !== 1 || rows !== 1) throw new DxfImportError(`${label} MINSERT arrays are outside the audited single-reference subset.`);
      return {
        kind: "blockRef",
        ...base,
        blockId,
        insertion: pointValue(record.pairs, 10, 20, `${label} insertion`),
        scale: { x: scaleX, y: scaleY },
        rotationRad: (singletonNumberValue(record.pairs, 50, `${label} rotation`, false) ?? 0) * Math.PI / 180,
      };
    }
    default:
      return null;
  }
}

function preserveProxyRecord(
  record: DxfRecord,
  layerIds: ReadonlyMap<string, string>,
  linetypeIds: ReadonlyMap<string, string>,
  usedHandles: Set<string>,
): CadEntity | null {
  if (!firstPair(record.pairs, 5) || !firstPair(record.pairs, 8)) return null;
  const base = entityBase(record, layerIds, linetypeIds, usedHandles);
  return {
    kind: "proxy",
    ...base,
    originalType: record.type,
    raw: { pairs: record.pairs.map((pair) => ({ code: pair.code, value: pair.value })) },
  };
}

function parseBlocks(
  blockSection: readonly DxfPair[] | undefined,
  layerIds: ReadonlyMap<string, string>,
  linetypeIds: ReadonlyMap<string, string>,
  textStyleIds: ReadonlyMap<string, string>,
  dimensionStyleIds: ReadonlyMap<string, string>,
  usedHandles: Set<string>,
  report: DxfImportReport,
  preserveUnsupported: boolean,
): { values: CadBlockDefinition[]; ids: Map<string, string> } {
  if (!blockSection) return { values: [], ids: new Map() };
  const all = records(blockSection);
  const ids = new Map<string, string>();
  for (const record of all.filter((candidate) => candidate.type === "BLOCK")) {
    const name = textValue(record.pairs, 2, "BLOCK name")!;
    const normalized = normalizedName(name);
    if (ids.has(normalized)) throw new DxfImportError(`DXF contains duplicate block name ${name}.`);
    ids.set(normalized, stableId("block", name));
  }
  const values: CadBlockDefinition[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const begin = all[index]!;
    if (begin.type !== "BLOCK") continue;
    const beginHandle = textValue(begin.pairs, 5, "BLOCK handle")!;
    registerHandle(beginHandle, usedHandles, "BLOCK");
    const name = textValue(begin.pairs, 2, "BLOCK name")!;
    const id = ids.get(normalizedName(name))!;
    const basePoint = pointValue(begin.pairs, 10, 20, `BLOCK ${name} base point`);
    const ignoredAutoCadBlock = /^\*(?:MODEL_SPACE|PAPER_SPACE|D\d+)$/iu.test(name);
    const blockEntities: CadEntity[] = [];
    let closed = false;
    for (index += 1; index < all.length; index += 1) {
      const record = all[index]!;
      if (record.type === "ENDBLK") {
        const endHandle = textValue(record.pairs, 5, `BLOCK ${name} ENDBLK handle`)!;
        registerHandle(endHandle, usedHandles, `BLOCK ${name} ENDBLK`);
        closed = true;
        break;
      }
      if (record.type === "BLOCK") throw new DxfImportError(`BLOCK ${name} is missing ENDBLK.`);
      const rawHandle = textValue(record.pairs, 5, `${record.type} handle`, false) ?? null;
      if (ignoredAutoCadBlock) {
        if (rawHandle) registerHandle(rawHandle, usedHandles, `${record.type} in ${name}`);
        continue;
      }
      if (!SUPPORTED_ENTITY_TYPES.has(record.type)) {
        let proxy: CadEntity | null = null;
        if (preserveUnsupported) proxy = preserveProxyRecord(record, layerIds, linetypeIds, usedHandles);
        else if (rawHandle) registerHandle(rawHandle, usedHandles, record.type);
        report.skipped.push({ type: record.type, handle: rawHandle, reason: `DXF block ${name} contains an entity outside the F-110 audited import subset.` });
        if (proxy) {
          blockEntities.push(proxy);
          report.preservedProxyHandles.push(proxy.handle);
        }
        continue;
      }
      const parsed = parseEntity(record, layerIds, linetypeIds, textStyleIds, dimensionStyleIds, ids, usedHandles);
      if (!parsed) {
        report.skipped.push({ type: record.type, handle: rawHandle, reason: `DXF block ${name} contains a paper-space-only entity.` });
        continue;
      }
      blockEntities.push(parsed);
      report.importedHandles.push(parsed.handle);
    }
    if (!closed) throw new DxfImportError(`BLOCK ${name} is missing ENDBLK.`);
    // AutoCAD-owned Model/Paper and anonymous dimension blocks are represented
    // by typed layouts/dimensions, not duplicated as editable user blocks.
    if (!ignoredAutoCadBlock) values.push({ id, name, basePoint, entities: blockEntities });
  }
  uniqueNames(values, "block");
  return { values, ids };
}

function scaledPoint(point: CadPoint2, factor: number): CadPoint2 {
  return { x: point.x * factor, y: point.y * factor };
}

function scaleEntity(entity: CadEntity, factor: number): CadEntity {
  const next = structuredClone(entity);
  if (factor === 1) return next;
  if (next.kind === "proxy") throw new DxfImportError(`DXF proxy ${next.handle} cannot be insertion-scaled without a licensed semantic adapter.`);
  if (next.appearance?.thickness !== undefined) next.appearance.thickness *= factor;
  switch (next.kind) {
    case "line": next.start = scaledPoint(next.start, factor); next.end = scaledPoint(next.end, factor); break;
    case "ray":
    case "xline": next.basePoint = scaledPoint(next.basePoint, factor); break;
    case "circle": next.center = scaledPoint(next.center, factor); next.radius *= factor; break;
    case "arc": next.center = scaledPoint(next.center, factor); next.radius *= factor; break;
    case "ellipse": next.center = scaledPoint(next.center, factor); next.majorAxis = scaledPoint(next.majorAxis, factor); break;
    case "polyline": next.vertices = next.vertices.map((vertex) => ({
      ...vertex,
      x: vertex.x * factor,
      y: vertex.y * factor,
      ...(vertex.startWidth === undefined ? {} : { startWidth: vertex.startWidth * factor }),
      ...(vertex.endWidth === undefined ? {} : { endWidth: vertex.endWidth * factor }),
    })); break;
    case "spline": next.controlPoints = next.controlPoints.map((point) => scaledPoint(point, factor)); break;
    case "text":
    case "mtext": next.position = scaledPoint(next.position, factor); next.height *= factor; {
      const mtext = next.extensionData?.["kuubik.dxf.mtext.v1"];
      if (mtext && typeof mtext === "object" && typeof (mtext as { width?: unknown }).width === "number") {
        next.extensionData = { ...next.extensionData, "kuubik.dxf.mtext.v1": { ...mtext, width: (mtext as { width: number }).width * factor } };
      }
      break;
    }
    case "dimension": next.definitionPoints = next.definitionPoints.map((point) => scaledPoint(point, factor)); break;
    case "hatch": next.loops = next.loops.map((loop) => ({ ...loop, vertices: loop.vertices.map((point) => scaledPoint(point, factor)) })); break;
    case "blockRef": next.insertion = scaledPoint(next.insertion, factor); break;
    case "leader": next.vertices = next.vertices.map((point) => scaledPoint(point, factor)); break;
  }
  return next;
}

export function importDxf(input: string | Uint8Array, options: DxfImportOptions): DxfImportResult {
  if (!options.documentId.trim()) throw new DxfImportError("DXF import requires a document id.");
  const decoded = decodeInput(input);
  const parsedPairs = parsePairs(decoded.text);
  const parsedSections = sections(parsedPairs);
  const header = parsedSections.get("HEADER");
  const tables = parsedSections.get("TABLES");
  const entitySection = parsedSections.get("ENTITIES");
  if (!header || !tables || !entitySection) throw new DxfImportError("DXF must contain HEADER, TABLES and ENTITIES sections.");
  const usedHandles = new Set<string>();
  registerSectionHandles(tables, usedHandles, "DXF table record");
  const blockSection = parsedSections.get("BLOCKS");
  const objectSection = parsedSections.get("OBJECTS");
  if (objectSection) registerSectionHandles(objectSection, usedHandles, "DXF object record");
  const headers = headerVariables(header);
  const acadVersion = requireHeader(headers, "$ACADVER").value.trim();
  const codePage = requireHeader(headers, "$DWGCODEPAGE").value.trim();
  if (normalizedName(codePage) !== "ANSI_1252") throw new DxfImportError(`DXF code page ${codePage} is outside the audited ANSI_1252 path.`);
  const rawUnits = Number(requireHeader(headers, "$INSUNITS").value.trim());
  const sourceUnits = INSUNITS[rawUnits];
  if (!sourceUnits) throw new DxfImportError(`DXF INSUNITS ${rawUnits} is unsupported.`);
  const targetUnits = options.targetUnits ?? sourceUnits;
  const scale = insertionScale(sourceUnits, targetUnits);

  const linetypes = parseLinetypes(tables);
  const textStyles = parseTextStyles(tables);
  const dimensionStyles = parseDimensionStyles(tables, textStyles.handles);
  const layers = parseLayers(tables, linetypes.ids);
  const currentLayerName = requireHeader(headers, "$CLAYER").value.trim();
  const currentLayerId = layers.ids.get(normalizedName(currentLayerName));
  if (!currentLayerId) throw new DxfImportError(`DXF current layer ${currentLayerName} is missing from the LAYER table.`);

  const report: DxfImportReport = {
    acadVersion,
    codePage,
    sourceByteLength: decoded.byteLength,
    sourceUnits,
    targetUnits,
    insertionScale: scale,
    importedHandles: [],
    preservedProxyHandles: [],
    skipped: [],
    warnings: [],
  };
  if (scale !== 1) report.warnings.push(`Applied deterministic insertion scale ${scale} for ${sourceUnits} -> ${targetUnits}.`);
  const blocks = parseBlocks(
    blockSection,
    layers.ids,
    linetypes.ids,
    textStyles.ids,
    dimensionStyles.ids,
    usedHandles,
    report,
    options.preserveUnsupported ?? false,
  );
  const entities: CadEntity[] = [];
  for (const record of records(entitySection)) {
    if (["ENDSEC", "EOF"].includes(record.type)) continue;
    const rawHandle = textValue(record.pairs, 5, `${record.type} handle`, false) ?? null;
    if (!SUPPORTED_ENTITY_TYPES.has(record.type)) {
      let proxy: CadEntity | null = null;
      if (options.preserveUnsupported) proxy = preserveProxyRecord(record, layers.ids, linetypes.ids, usedHandles);
      else if (rawHandle) registerHandle(rawHandle, usedHandles, record.type);
      report.skipped.push({ type: record.type, handle: rawHandle, reason: "DXF entity type is outside the F-111 audited import subset." });
      if (proxy) {
        entities.push(proxy);
        report.importedHandles.push(proxy.handle);
        report.preservedProxyHandles.push(proxy.handle);
      }
      continue;
    }
    const parsed = parseEntity(record, layers.ids, linetypes.ids, textStyles.ids, dimensionStyles.ids, blocks.ids, usedHandles);
    if (!parsed) {
      report.skipped.push({ type: record.type, handle: rawHandle, reason: "Paper-space entities are outside the F-111 model-space import subset." });
      continue;
    }
    entities.push(parsed);
    report.importedHandles.push(parsed.handle);
  }

  const scaledLayers = layers.values.map((layer) => {
    const next = structuredClone(layer);
    if (scale !== 1 && next.appearance?.thickness !== undefined) next.appearance.thickness *= scale;
    return next;
  });
  const scaledLinetypes = linetypes.values.map((linetype) => ({ ...structuredClone(linetype), pattern: linetype.pattern.map((value) => value * scale) }));
  const scaledDimensionStyles = dimensionStyles.values.map((style) => ({
    ...structuredClone(style),
    textHeight: style.textHeight * scale,
    arrowSize: style.arrowSize * scale,
    extensionOffset: style.extensionOffset * scale,
  }));
  const scaledBlocks = blocks.values.map((block) => ({
    ...structuredClone(block),
    basePoint: scaledPoint(block.basePoint, scale),
    entities: block.entities.map((entity) => scaleEntity(entity, scale)),
  }));
  const document = createEmptyDocument({ documentId: options.documentId, ...(options.now ? { now: options.now } : {}), units: targetUnits });
  document.currentLayerId = currentLayerId;
  document.entities = entities.map((entity) => scaleEntity(entity, scale));
  document.layers = scaledLayers;
  document.linetypes = scaledLinetypes;
  document.textStyles = textStyles.values;
  document.dimensionStyles = scaledDimensionStyles;
  document.blocks = scaledBlocks;
  document.metadata.source = `DXF ${acadVersion} ${codePage}`;
  assertKDrawDocumentV1(document);
  return { document, report };
}
