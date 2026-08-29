import type {
  CadAppearance,
  CadDimension,
  CadEntity,
  CadLayer,
  CadLinetype,
  CadPoint2,
  CadTextStyle,
  KDrawDocumentV1,
} from "@kuubik/cad-schema";
import { nearestAciIndex } from "@kuubik/cad-core";

export * from "./import.js";

export interface DxfExportReport {
  emittedHandles: string[];
  handleMap: Readonly<Record<string, string>>;
  skipped: Array<{ handle: string; kind: CadEntity["kind"]; reason: string }>;
}

export interface DxfExportResult {
  text: string;
  bytes: Uint8Array;
  report: DxfExportReport;
}

export interface DxfReadbackSummary {
  acadVersion: string | null;
  entityTypes: Record<string, number>;
  handles: string[];
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

interface Context {
  document: KDrawDocumentV1;
  layers: Map<string, CadLayer>;
  linetypes: Map<string, CadLinetype>;
  textStyles: Map<string, CadTextStyle>;
  dxfTextStyles: CadTextStyle[];
  textStyleHandles: Map<string, string>;
  standardTextStyleHandle: string;
  dimensionStyles: Map<string, string>;
  handleMap: ReadonlyMap<string, string>;
  dimensionBlocks: Map<string, string>;
  infrastructure: InfrastructureHandles;
}

interface InfrastructureHandles {
  linetypes: string[];
  layers: string[];
  textStyles: string[];
  dimensionStyles: string[];
  dimensionBlockRecords: string[];
  dimensionBlockBegins: string[];
  dimensionBlockEnds: string[];
  used: Set<string>;
}

const INSUNITS: Record<KDrawDocumentV1["units"]["linear"], number> = {
  unitless: 0, in: 1, ft: 2, mm: 4, cm: 5, m: 6,
};
const WINDOWS_1252: Readonly<Record<number, number>> = Object.freeze({
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
});
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211] as const;
const STATIC_DXF_HANDLES = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "17", "18", "19", "1A", "1B", "1C", "1D", "2A", "2B",
  "F00", "F01", "F02", "F03",
] as const;
const MAX_DXF_HANDLE = 0xffffffffffffffffn;
const MAX_ALLOCATED_DXF_HANDLE = MAX_DXF_HANDLE - 1n;

function handleText(value: bigint): string {
  if (value <= 0n || value > MAX_DXF_HANDLE) throw new RangeError(`DXF handle is outside the supported 1..${MAX_DXF_HANDLE.toString(16).toUpperCase()} range.`);
  return value.toString(16).toUpperCase();
}

function allocateHandle(used: Set<string>, preferred: bigint): string {
  let candidate = preferred > 0n && preferred <= MAX_ALLOCATED_DXF_HANDLE ? preferred : 1n;
  while (used.has(handleText(candidate))) {
    candidate += 1n;
    if (candidate > MAX_ALLOCATED_DXF_HANDLE) candidate = 1n;
    if (candidate === preferred) throw new RangeError("DXF handle space is exhausted.");
  }
  const value = handleText(candidate);
  used.add(value);
  return value;
}

function createInfrastructureHandles(document: KDrawDocumentV1, dimensionCount: number): InfrastructureHandles {
  const used = new Set<string>(STATIC_DXF_HANDLES);
  const allocateRange = (start: bigint, count: number): string[] =>
    Array.from({ length: count }, (_, index) => allocateHandle(used, start + BigInt(index)));
  const layerCount = document.layers.length + (document.layers.some((layer) => layer.name.toUpperCase() === "0") ? 0 : 1);
  const textStyleCount = document.textStyles.length + (document.textStyles.some((style) => style.name.toUpperCase() === "STANDARD") ? 0 : 1);
  const dimensionStyleCount = document.dimensionStyles.length + (document.dimensionStyles.some((style) => style.name.toUpperCase() === "STANDARD") ? 0 : 1);
  const dimensionBlockRecords = allocateRange(0x602n, dimensionCount);
  const dimensionBlockBegins: string[] = [];
  const dimensionBlockEnds: string[] = [];
  for (let index = 0; index < dimensionCount; index += 1) {
    dimensionBlockBegins.push(allocateHandle(used, 0x700n + BigInt(index * 2)));
    dimensionBlockEnds.push(allocateHandle(used, 0x701n + BigInt(index * 2)));
  }
  return {
    linetypes: allocateRange(0x200n, 3 + document.linetypes.length),
    layers: allocateRange(0x300n, layerCount),
    textStyles: allocateRange(0x400n, textStyleCount),
    dimensionStyles: allocateRange(0x500n, dimensionStyleCount),
    dimensionBlockRecords,
    dimensionBlockBegins,
    dimensionBlockEnds,
    used,
  };
}

function pair(code: number, value: string | number): string {
  return `${String(code).padStart(3, " ")}\r\n${value}\r\n`;
}

function num(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("DXF values must be finite.");
  return Number(value.toPrecision(15)).toString();
}

function point(xCode: number, yCode: number, value: CadPoint2): string {
  return pair(xCode, num(value.x)) + pair(yCode, num(value.y)) + pair(yCode + 10, 0);
}

function point2(xCode: number, yCode: number, value: CadPoint2): string {
  return pair(xCode, num(value.x)) + pair(yCode, num(value.y));
}

function normalizedHex(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/iu.test(value)) return value.toLowerCase();
  throw new TypeError(`Unsupported DXF colour: ${value}`);
}

function aci(value: string): number {
  return nearestAciIndex(value);
}

function appearanceAci(appearance: CadAppearance): number | undefined {
  if ((appearance.aciIndex !== undefined || appearance.colorMethod !== undefined) && appearance.color === undefined) {
    throw new TypeError("DXF ACI/color-method metadata requires an RGB color.");
  }
  if (appearance.aciIndex !== undefined) {
    if (!Number.isInteger(appearance.aciIndex) || appearance.aciIndex < 1 || appearance.aciIndex > 255) {
      throw new TypeError("DXF ACI index must be an integer from 1 to 255.");
    }
    return appearance.aciIndex;
  }
  return appearance.color === undefined ? undefined : aci(appearance.color);
}

function rgb(value: string): number {
  return Number.parseInt(normalizedHex(value).slice(1), 16);
}

function lineweight(value: number | undefined): number {
  if (value === undefined) return 25;
  if (!Number.isFinite(value) || value < 0) throw new TypeError("DXF lineweight must be finite and non-negative.");
  const requested = Math.round(value * 100);
  return LINEWEIGHTS.reduce((best, candidate) => Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best);
}

function symbolName(value: string, kind: string): string {
  const name = value.trim();
  if (!name || name.length > 255 || /[<>\\/":;?*|,=`]/u.test(name) || /[\u0000-\u001f]/u.test(name)) {
    throw new TypeError(`Invalid DXF ${kind} name: ${JSON.stringify(value)}`);
  }
  return name;
}

function escapedText(value: string, multiline: boolean): string {
  const normalized = value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let escaped = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    escaped += codeUnit <= 0x7f ? normalized[index]! : `\\U+${codeUnit.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return multiline ? escaped.replaceAll("\n", "\\P") : escaped.replaceAll("\n", " ");
}

export function encodeDxfWindows1252(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else {
      const encoded = WINDOWS_1252[code];
      if (encoded === undefined) throw new TypeError(`DXF ANSI_1252 cannot encode U+${code.toString(16).toUpperCase().padStart(4, "0")}.`);
      bytes.push(encoded);
    }
  }
  return Uint8Array.from(bytes);
}

function transparency(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 90) {
    throw new TypeError("DXF transparency must be between 0 and 90 percent.");
  }
  return 0x02000000 | Math.round(255 * (1 - value / 100));
}

function fnv(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase();
}

function mapHandles(entities: readonly CadEntity[], used: Set<string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const entity of entities) {
    if (result.has(entity.handle)) throw new TypeError(`Duplicate CAD handle: ${entity.handle}`);
    const original = entity.handle.toUpperCase();
    const exact = /^[1-9A-F][0-9A-F]{0,15}$/u.test(original) ? BigInt(`0x${original}`) : null;
    const preferred = exact !== null && exact <= MAX_ALLOCATED_DXF_HANDLE ? exact : BigInt(`0x${fnv(entity.handle)}`);
    const handle = allocateHandle(used, preferred);
    result.set(entity.handle, handle);
  }
  return result;
}

function uniqueMap<T extends { id: string }>(values: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) throw new TypeError(`Duplicate ${kind} id: ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function layerName(context: Context, id: string): string {
  const layer = context.layers.get(id);
  if (!layer) throw new RangeError(`DXF entity references missing layer: ${id}`);
  return symbolName(layer.name, "layer");
}

function linetypeName(context: Context, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const value = context.linetypes.get(id);
  if (!value) throw new RangeError(`DXF appearance references missing linetype: ${id}`);
  return symbolName(value.name, "linetype");
}

function appearanceRows(context: Context, appearance: CadAppearance | undefined): string {
  if (!appearance) return "";
  let output = "";
  const colorIndex = appearanceAci(appearance);
  if (colorIndex !== undefined) output += pair(62, colorIndex);
  if (appearance.colorMethod === "trueColor") {
    if (appearance.color === undefined) throw new TypeError("DXF TrueColor appearance requires an RGB color.");
    output += pair(420, rgb(appearance.color));
  }
  const linetype = linetypeName(context, appearance.linetypeId);
  if (linetype) output += pair(6, linetype);
  if (appearance.lineweightMm !== undefined) output += pair(370, lineweight(appearance.lineweightMm));
  if (appearance.transparency !== undefined) {
    output += pair(440, transparency(appearance.transparency));
  }
  return output;
}

function header(context: Context, type: string, entity: CadEntity): string {
  const handle = context.handleMap.get(entity.handle);
  if (!handle) throw new TypeError(`Missing allocated DXF handle for CAD entity: ${entity.handle}`);
  return pair(0, type) + pair(5, handle) + pair(330, "1A") +
    pair(100, "AcDbEntity") + pair(8, layerName(context, entity.layerId)) + appearanceRows(context, entity.appearance);
}

function midpoint(first: CadPoint2, second: CadPoint2): CadPoint2 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

const FULL_TURN = Math.PI * 2;

function normalizedRadians(value: number): number {
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function angleOnCounterClockwiseArc(angle: number, start: number, end: number): boolean {
  if (Math.abs(end - start) >= FULL_TURN - 1e-12) return true;
  const sweep = normalizedRadians(end - start);
  const travelled = normalizedRadians(angle - start);
  return travelled <= sweep + 1e-12;
}

function arcExtentPoints(center: CadPoint2, radius: number, start: number, end: number): CadPoint2[] {
  const pointAt = (angle: number): CadPoint2 => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  return [start, end, 0, Math.PI / 2, Math.PI, Math.PI * 1.5]
    .filter((angle, index) => index < 2 || angleOnCounterClockwiseArc(angle, start, end))
    .map(pointAt);
}

function ellipseExtentPoints(center: CadPoint2, major: CadPoint2, ratio: number, start: number, end: number): CadPoint2[] {
  const majorLength = Math.hypot(major.x, major.y);
  const minor = { x: -(major.y / majorLength) * majorLength * ratio, y: (major.x / majorLength) * majorLength * ratio };
  const pointAt = (parameter: number): CadPoint2 => ({
    x: center.x + major.x * Math.cos(parameter) + minor.x * Math.sin(parameter),
    y: center.y + major.y * Math.cos(parameter) + minor.y * Math.sin(parameter),
  });
  const xExtreme = Math.atan2(minor.x, major.x);
  const yExtreme = Math.atan2(minor.y, major.y);
  return [start, end, xExtreme, xExtreme + Math.PI, yExtreme, yExtreme + Math.PI]
    .filter((parameter, index) => index < 2 || angleOnCounterClockwiseArc(parameter, start, end))
    .map(pointAt);
}

function emitDimension(context: Context, entity: CadDimension): { text: string | null; points: CadPoint2[] } {
  if (entity.definitionPoints.length < 2) return { text: null, points: [] };
  const first = entity.definitionPoints[0]!;
  const second = entity.definitionPoints[1]!;
  const definition = entity.definitionPoints[2] ?? midpoint(first, second);
  const textAt = entity.definitionPoints[3] ?? midpoint(first, second);
  const style = context.dimensionStyles.get(entity.styleId);
  if (!style) throw new RangeError(`DXF dimension references missing style: ${entity.styleId}`);
  const block = context.dimensionBlocks.get(entity.handle)!;
  const measurement = Math.hypot(second.x - first.x, second.y - first.y);
  const aligned = entity.dimensionKind === "aligned";
  if (!aligned && entity.dimensionKind !== "linear") return { text: null, points: [] };
  let output = header(context, "DIMENSION", entity) + pair(100, "AcDbDimension") + pair(2, block) +
    point(10, 20, definition) + point(11, 21, textAt) + pair(70, aligned ? 1 : 0) +
    pair(1, escapedText(entity.overrideText ?? "<>", false)) + pair(3, style) + pair(42, num(measurement));
  // The subclass marker must precede every subclass-specific point group. AutoCAD rejects the inverse order.
  output += pair(100, aligned ? "AcDbAlignedDimension" : "AcDbRotatedDimension") +
    point(13, 23, first) + point(14, 24, second);
  if (!aligned) output += pair(50, num(Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI));
  return { text: output, points: [...entity.definitionPoints] };
}

function emitHatch(context: Context, entity: Extract<CadEntity, { kind: "hatch" }>): { text: string | null; points: CadPoint2[] } {
  if (!entity.loops.length || entity.loops.some((loop) => loop.vertices.length < 3)) {
    throw new TypeError(`DXF HATCH ${entity.handle} requires every boundary loop to contain at least three vertices.`);
  }
  const loops = entity.loops;
  const solid = entity.pattern.trim().toUpperCase() === "SOLID";
  let output = header(context, "HATCH", entity) + pair(100, "AcDbHatch") + point(10, 20, { x: 0, y: 0 }) +
    pair(210, 0) + pair(220, 0) + pair(230, 1) + pair(2, solid ? "SOLID" : symbolName(entity.pattern, "hatch pattern")) +
    pair(70, solid ? 1 : 0) + pair(71, 0) + pair(91, loops.length);
  for (const loop of loops) {
    output += pair(92, loop.isHole ? 2 : 3) + pair(72, 0) + pair(73, 1) + pair(93, loop.vertices.length);
    for (const vertex of loop.vertices) output += pair(10, num(vertex.x)) + pair(20, num(vertex.y));
    output += pair(97, 0);
  }
  output += pair(75, 1) + pair(76, solid ? 1 : 0);
  if (!solid) {
    output += pair(52, 0) + pair(41, 1) + pair(77, 0) + pair(78, 1) + pair(53, 45) +
      pair(43, 0) + pair(44, 0) + pair(45, 0) + pair(46, 3.175) + pair(79, 0);
  }
  return { text: output + pair(98, 0), points: loops.flatMap((loop) => loop.vertices) };
}

function emitEntity(context: Context, entity: CadEntity): { text: string | null; points: CadPoint2[] } {
  switch (entity.kind) {
    case "line": return { text: header(context, "LINE", entity) + pair(100, "AcDbLine") + point(10, 20, entity.start) + point(11, 21, entity.end), points: [entity.start, entity.end] };
    case "circle": return entity.radius > 0 ? {
      text: header(context, "CIRCLE", entity) + pair(100, "AcDbCircle") + point(10, 20, entity.center) + pair(40, num(entity.radius)),
      points: [{ x: entity.center.x - entity.radius, y: entity.center.y - entity.radius }, { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }],
    } : { text: null, points: [] };
    case "arc": {
      if (!(entity.radius > 0)) return { text: null, points: [] };
      const start = entity.counterClockwise ? entity.startAngleRad : entity.endAngleRad;
      const end = entity.counterClockwise ? entity.endAngleRad : entity.startAngleRad;
      return {
        text: header(context, "ARC", entity) + pair(100, "AcDbCircle") + point(10, 20, entity.center) + pair(40, num(entity.radius)) +
          pair(100, "AcDbArc") + pair(50, num(normalizedRadians(start) * 180 / Math.PI)) + pair(51, num(normalizedRadians(end) * 180 / Math.PI)),
        points: arcExtentPoints(entity.center, entity.radius, start, end),
      };
    }
    case "ellipse": {
      const majorLength = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
      if (!(majorLength > 0) || !(entity.ratio > 0 && entity.ratio <= 1)) return { text: null, points: [] };
      return {
        text: header(context, "ELLIPSE", entity) + pair(100, "AcDbEllipse") + point(10, 20, entity.center) + point(11, 21, entity.majorAxis) +
          pair(40, num(entity.ratio)) + pair(41, num(entity.startParameter)) + pair(42, num(entity.endParameter)),
        points: ellipseExtentPoints(entity.center, entity.majorAxis, entity.ratio, entity.startParameter, entity.endParameter),
      };
    }
    case "polyline": {
      if (entity.vertices.length < 2) return { text: null, points: [] };
      let text = header(context, "LWPOLYLINE", entity) + pair(100, "AcDbPolyline") + pair(90, entity.vertices.length) + pair(70, entity.closed ? 1 : 0);
      for (const vertex of entity.vertices) {
        text += pair(10, num(vertex.x)) + pair(20, num(vertex.y));
        if (vertex.startWidth !== undefined) text += pair(40, num(vertex.startWidth));
        if (vertex.endWidth !== undefined) text += pair(41, num(vertex.endWidth));
        if (vertex.bulge !== undefined && vertex.bulge !== 0) text += pair(42, num(vertex.bulge));
      }
      return { text, points: entity.vertices };
    }
    case "spline": {
      const last = entity.controlPoints.length - 1;
      if (
        !Number.isInteger(entity.degree) || entity.degree < 1 || last < entity.degree
        || entity.knots.length !== last + entity.degree + 2
        || entity.controlPoints.some((value) => !Number.isFinite(value.x) || !Number.isFinite(value.y))
        || entity.knots.some((value, index) => !Number.isFinite(value) || (index > 0 && value < entity.knots[index - 1]!))
        || (entity.weights !== undefined && (entity.weights.length !== entity.controlPoints.length || entity.weights.some((value) => !Number.isFinite(value) || !(value > 0))))
      ) throw new TypeError(`DXF SPLINE ${entity.handle} has invalid degree, knots, control points or weights.`);
      const flags = (entity.closed ? 1 : 0) | (entity.periodic ? 2 : 0) | (entity.weights ? 4 : 0) | 8;
      let text = header(context, "SPLINE", entity) + pair(100, "AcDbSpline") + pair(210, 0) + pair(220, 0) + pair(230, 1)
        + pair(70, flags) + pair(71, entity.degree) + pair(72, entity.knots.length) + pair(73, entity.controlPoints.length) + pair(74, 0)
        + pair(42, 1e-7) + pair(43, 1e-7) + pair(44, 1e-10);
      for (const knot of entity.knots) text += pair(40, num(knot));
      if (entity.weights) for (const weight of entity.weights) text += pair(41, num(weight));
      for (const controlPoint of entity.controlPoints) text += point(10, 20, controlPoint);
      return { text, points: entity.controlPoints };
    }
    case "text":
    case "mtext": {
      if (!(entity.height > 0)) return { text: null, points: [] };
      const style = entity.styleId ? context.textStyles.get(entity.styleId) : undefined;
      if (entity.styleId && !style) throw new RangeError(`DXF text references missing style: ${entity.styleId}`);
      const styleName = style ? symbolName(style.name, "text style") : "Standard";
      const text = entity.kind === "text"
        ? header(context, "TEXT", entity) + pair(100, "AcDbText") + point(10, 20, entity.position) + pair(40, num(entity.height)) +
          pair(1, escapedText(entity.text, false)) + pair(50, num(entity.rotationRad * 180 / Math.PI)) + pair(7, styleName) + pair(100, "AcDbText")
        : header(context, "MTEXT", entity) + pair(100, "AcDbMText") + point(10, 20, entity.position) + pair(40, num(entity.height)) +
          pair(41, 0) + pair(71, 1) + pair(1, escapedText(entity.text, true)) + pair(7, styleName) + pair(50, num(entity.rotationRad));
      return { text, points: [entity.position] };
    }
    case "dimension": return emitDimension(context, entity);
    case "hatch": return emitHatch(context, entity);
    case "leader":
    case "blockRef":
    case "proxy": return { text: null, points: [] };
  }
}

function linetypeTable(document: KDrawDocumentV1, handles: readonly string[]): string {
  const builtIns: CadLinetype[] = [
    { id: "builtin-byblock", name: "ByBlock", pattern: [] },
    { id: "builtin-bylayer", name: "ByLayer", pattern: [] },
    { id: "builtin-continuous", name: "Continuous", pattern: [] },
  ];
  const values = [...builtIns];
  const names = new Set(builtIns.map((value) => value.name.toUpperCase()));
  for (const item of document.linetypes) {
    const name = symbolName(item.name, "linetype");
    if (names.has(name.toUpperCase())) throw new TypeError(`Duplicate DXF linetype name: ${name}`);
    names.add(name.toUpperCase()); values.push(item);
  }
  let text = pair(0, "TABLE") + pair(2, "LTYPE") + pair(5, "2") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, values.length);
  values.forEach((item, index) => {
    if (item.pattern.some((value) => !Number.isFinite(value))) throw new TypeError(`Invalid DXF linetype pattern: ${item.id}`);
    text += pair(0, "LTYPE") + pair(5, handles[index]!) + pair(330, "2") + pair(100, "AcDbSymbolTableRecord") +
      pair(100, "AcDbLinetypeTableRecord") + pair(2, symbolName(item.name, "linetype")) + pair(70, 0) + pair(3, item.description ?? "") +
      pair(72, 65) + pair(73, item.pattern.length) + pair(40, num(item.pattern.reduce((sum, value) => sum + Math.abs(value), 0)));
    for (const value of item.pattern) text += pair(49, num(value)) + pair(74, 0);
  });
  return text + pair(0, "ENDTAB");
}

function layerTable(context: Context): string {
  const values: CadLayer[] = [...context.document.layers];
  if (!values.some((layer) => layer.name.toUpperCase() === "0")) {
    values.unshift({ id: "builtin-layer-0", name: "0", visible: true, frozen: false, locked: false, plottable: true });
  }
  const names = new Set<string>();
  let text = pair(0, "TABLE") + pair(2, "LAYER") + pair(5, "1") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, values.length);
  values.forEach((layer, index) => {
    const name = symbolName(layer.name, "layer");
    if (names.has(name.toUpperCase())) throw new TypeError(`Duplicate DXF layer name: ${name}`);
    names.add(name.toUpperCase());
    const appearance = layer.appearance;
    const color = appearance === undefined ? 7 : appearanceAci(appearance) ?? 7;
    text += pair(0, "LAYER") + pair(5, context.infrastructure.layers[index]!) + pair(330, "1") + pair(100, "AcDbSymbolTableRecord") +
      pair(100, "AcDbLayerTableRecord") + pair(2, name) + pair(70, (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0)) +
      pair(62, layer.visible ? color : -color) + (appearance?.colorMethod === "trueColor" && appearance.color ? pair(420, rgb(appearance.color)) : "") +
      pair(6, linetypeName(context, appearance?.linetypeId) ?? "Continuous") + pair(290, layer.plottable ? 1 : 0) +
      pair(370, appearance?.lineweightMm === undefined ? -3 : lineweight(appearance.lineweightMm)) + pair(390, "F03") +
      // AutoCAD 2024 stores layer transparency as registered XDATA, not as the
      // common entity group 440 used by graphical entities.
      (appearance?.transparency === undefined ? "" : pair(1001, "AcCmTransparency") + pair(1071, transparency(appearance.transparency)));
  });
  return text + pair(0, "ENDTAB");
}

function styleTable(context: Context): string {
  const values = context.dxfTextStyles;
  const names = new Set<string>();
  let text = pair(0, "TABLE") + pair(2, "STYLE") + pair(5, "5") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, values.length);
  values.forEach((style, index) => {
    const name = symbolName(style.name, "text style");
    if (names.has(name.toUpperCase())) throw new TypeError(`Duplicate DXF text style name: ${name}`);
    if (!(style.widthFactor > 0)) throw new TypeError(`Invalid DXF text width factor: ${style.id}`);
    names.add(name.toUpperCase());
    text += pair(0, "STYLE") + pair(5, context.infrastructure.textStyles[index]!) + pair(330, "5") + pair(100, "AcDbSymbolTableRecord") +
      pair(100, "AcDbTextStyleTableRecord") + pair(2, name) + pair(70, 0) + pair(40, 0) + pair(41, num(style.widthFactor)) +
      pair(50, num(style.obliqueAngleRad * 180 / Math.PI)) + pair(71, 0) + pair(42, 2.5) + pair(3, style.fontFamily || "txt") + pair(4, style.bigFont ?? "");
  });
  return text + pair(0, "ENDTAB");
}

function dimstyleTable(context: Context): string {
  const values = [...context.document.dimensionStyles];
  if (!values.some((value) => value.name.toUpperCase() === "STANDARD")) values.unshift({ id: "builtin-standard", name: "Standard", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 });
  const names = new Set<string>();
  let text = pair(0, "TABLE") + pair(2, "DIMSTYLE") + pair(5, "4") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, values.length) + pair(100, "AcDbDimStyleTable");
  values.forEach((style, index) => {
    const name = symbolName(style.name, "dimension style");
    if (names.has(name.toUpperCase())) throw new TypeError(`Duplicate DXF dimension style name: ${name}`);
    if (!(style.textHeight > 0 && style.arrowSize > 0 && style.scale > 0) || style.extensionOffset < 0) throw new TypeError(`Invalid DXF dimension style: ${style.id}`);
    const textStyleHandle = style.textStyleId === undefined ? context.standardTextStyleHandle : context.textStyleHandles.get(style.textStyleId);
    if (!textStyleHandle) throw new RangeError(`DXF dimension style references missing text style: ${style.textStyleId}`);
    names.add(name.toUpperCase());
    text += pair(0, "DIMSTYLE") + pair(105, context.infrastructure.dimensionStyles[index]!) + pair(330, "4") + pair(100, "AcDbSymbolTableRecord") +
      pair(100, "AcDbDimStyleTableRecord") + pair(2, name) + pair(70, 0) + pair(40, num(style.scale)) + pair(41, num(style.arrowSize)) +
      pair(42, num(style.extensionOffset)) + pair(140, num(style.textHeight)) + pair(147, num(style.textHeight * 0.25)) + pair(271, 2) + pair(278, 46) + pair(340, textStyleHandle) + pair(371, -1) + pair(372, -1);
  });
  return text + pair(0, "ENDTAB");
}

function emptyTable(name: "VIEW" | "UCS", handle: string): string {
  return pair(0, "TABLE") + pair(2, name) + pair(5, handle) + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, 0) + pair(0, "ENDTAB");
}

function viewportTable(): string {
  return pair(0, "TABLE") + pair(2, "VPORT") + pair(5, "8") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, 1) +
    pair(0, "VPORT") + pair(5, "17") + pair(330, "8") + pair(100, "AcDbSymbolTableRecord") + pair(100, "AcDbViewportTableRecord") +
    pair(2, "*Active") + pair(70, 0) + point2(10, 20, { x: 0, y: 0 }) + point2(11, 21, { x: 1, y: 1 }) +
    point2(12, 22, { x: 0, y: 0 }) + point2(13, 23, { x: 0, y: 0 }) + point2(14, 24, { x: 0.5, y: 0.5 }) +
    point2(15, 25, { x: 0.5, y: 0.5 }) + point2(16, 26, { x: 0, y: 0 }) + pair(36, 1) + point2(17, 27, { x: 0, y: 0 }) +
    pair(37, 0) + pair(40, 1000) + pair(41, 1.34) + pair(42, 50) + pair(43, 0) + pair(44, 0) + pair(50, 0) + pair(51, 0) +
    pair(71, 0) + pair(72, 1000) + pair(73, 1) + pair(74, 3) + pair(75, 0) + pair(76, 0) + pair(77, 0) + pair(78, 0) + pair(281, 0) + pair(0, "ENDTAB");
}

function appIdTable(document: KDrawDocumentV1): string {
  const hasLayerTransparency = document.layers.some((layer) => layer.appearance?.transparency !== undefined);
  return pair(0, "TABLE") + pair(2, "APPID") + pair(5, "3") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, hasLayerTransparency ? 2 : 1) +
    pair(0, "APPID") + pair(5, "2A") + pair(330, "3") + pair(100, "AcDbSymbolTableRecord") +
    pair(100, "AcDbRegAppTableRecord") + pair(2, "ACAD") + pair(70, 0) +
    (hasLayerTransparency
      ? pair(0, "APPID") + pair(5, "2B") + pair(330, "3") + pair(100, "AcDbSymbolTableRecord") +
        pair(100, "AcDbRegAppTableRecord") + pair(2, "AcCmTransparency") + pair(70, 0)
      : "") + pair(0, "ENDTAB");
}

function blockTable(names: readonly string[], infrastructure: InfrastructureHandles): string {
  let text = pair(0, "TABLE") + pair(2, "BLOCK_RECORD") + pair(5, "9") + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, names.length + 2);
  ["*Model_Space", "*Paper_Space", ...names].forEach((name, index) => {
    const handle = index === 0 ? "1A" : index === 1 ? "1B" : infrastructure.dimensionBlockRecords[index - 2]!;
    text += pair(0, "BLOCK_RECORD") + pair(5, handle) + pair(330, "9") + pair(100, "AcDbSymbolTableRecord") + pair(100, "AcDbBlockTableRecord") + pair(2, name);
  });
  return text + pair(0, "ENDTAB");
}

function block(name: string, record: string, begin: string, end: string): string {
  return pair(0, "BLOCK") + pair(5, begin) + pair(330, record) + pair(100, "AcDbEntity") + pair(8, 0) + pair(100, "AcDbBlockBegin") +
    pair(2, name) + pair(70, 0) + point(10, 20, { x: 0, y: 0 }) + pair(3, name) + pair(1, "") + pair(0, "ENDBLK") +
    pair(5, end) + pair(330, record) + pair(100, "AcDbEntity") + pair(8, 0) + pair(100, "AcDbBlockEnd");
}

function blocks(names: readonly string[], infrastructure: InfrastructureHandles): string {
  let text = pair(0, "SECTION") + pair(2, "BLOCKS") + block("*Model_Space", "1A", "18", "19") + block("*Paper_Space", "1B", "1C", "1D");
  names.forEach((name, index) => { text += block(name, infrastructure.dimensionBlockRecords[index]!, infrastructure.dimensionBlockBegins[index]!, infrastructure.dimensionBlockEnds[index]!); });
  return text + pair(0, "ENDSEC");
}

function objectsSection(): string {
  return pair(0, "SECTION") + pair(2, "OBJECTS") +
    pair(0, "DICTIONARY") + pair(5, "F00") + pair(330, 0) + pair(100, "AcDbDictionary") + pair(281, 1) +
    pair(3, "ACAD_GROUP") + pair(350, "F01") + pair(3, "ACAD_PLOTSTYLENAME") + pair(350, "F02") +
    pair(0, "DICTIONARY") + pair(5, "F01") + pair(330, "F00") + pair(100, "AcDbDictionary") + pair(281, 1) +
    pair(0, "ACDBDICTIONARYWDFLT") + pair(5, "F02") + pair(330, "F00") + pair(100, "AcDbDictionary") + pair(281, 1) +
    pair(3, "Normal") + pair(350, "F03") + pair(100, "AcDbDictionaryWithDefault") + pair(340, "F03") +
    pair(0, "ACDBPLACEHOLDER") + pair(5, "F03") + pair(330, "F02") + pair(0, "ENDSEC");
}

function bounds(points: readonly CadPoint2[]): DxfReadbackSummary["extents"] {
  if (!points.length) return null;
  const result = { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
  for (const value of points) {
    result.minX = Math.min(result.minX, value.x);
    result.minY = Math.min(result.minY, value.y);
    result.maxX = Math.max(result.maxX, value.x);
    result.maxY = Math.max(result.maxY, value.y);
  }
  return result;
}

export function exportDxf(document: KDrawDocumentV1): DxfExportResult {
  const dimensionEntities = document.entities.filter((entity): entity is CadDimension => entity.kind === "dimension");
  const infrastructure = createInfrastructureHandles(document, dimensionEntities.length);
  const handleMap = mapHandles(document.entities, infrastructure.used);
  const dimensionBlocks = new Map(dimensionEntities.map((entity, index) => [entity.handle, `*D${index + 1}`]));
  const dimensionStyles = new Map(document.dimensionStyles.map((style) => [style.id, symbolName(style.name, "dimension style")]));
  if (!dimensionStyles.size) dimensionStyles.set("Standard", "Standard");
  const dxfTextStyles = [...document.textStyles];
  if (!dxfTextStyles.some((value) => value.name.toUpperCase() === "STANDARD")) dxfTextStyles.unshift({ id: "builtin-standard", name: "Standard", fontFamily: "txt", widthFactor: 1, obliqueAngleRad: 0 });
  const textStyleHandles = new Map(dxfTextStyles.map((style, index) => [style.id, infrastructure.textStyles[index]!]));
  const standardTextStyle = dxfTextStyles.find((style) => style.name.toUpperCase() === "STANDARD")!;
  const context: Context = { document, layers: uniqueMap(document.layers, "layer"), linetypes: uniqueMap(document.linetypes, "linetype"), textStyles: uniqueMap(document.textStyles, "text style"), dxfTextStyles, textStyleHandles, standardTextStyleHandle: textStyleHandles.get(standardTextStyle.id)!, dimensionStyles, handleMap, dimensionBlocks, infrastructure };
  if (!context.layers.has(document.currentLayerId)) throw new RangeError(`Current layer does not exist: ${document.currentLayerId}`);
  const emittedHandles: string[] = [];
  const skipped: DxfExportReport["skipped"] = [];
  let entityText = "";
  for (const entity of document.entities) {
    const output = emitEntity(context, entity);
    if (output.text) { entityText += output.text; emittedHandles.push(entity.handle); }
    else skipped.push({ handle: entity.handle, kind: entity.kind, reason: "DXF adapter not implemented for this entity kind." });
  }
  const names = [...dimensionBlocks.values()];
  const maximumHandle = [...infrastructure.used].reduce((maximum, value) => {
    const current = BigInt(`0x${value}`);
    return current > maximum ? current : maximum;
  }, 0n);
  const handseed = handleText(maximumHandle + 1n);
  const fileHeader = pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, "AC1018") + pair(9, "$DWGCODEPAGE") + pair(3, "ANSI_1252") +
    pair(9, "$INSUNITS") + pair(70, INSUNITS[document.units.linear]) + pair(9, "$MEASUREMENT") + pair(70, ["mm", "cm", "m"].includes(document.units.linear) ? 1 : 0) +
    pair(9, "$CLAYER") + pair(8, layerName(context, document.currentLayerId)) + pair(9, "$HANDSEED") + pair(5, handseed) + pair(0, "ENDSEC");
  const tables = pair(0, "SECTION") + pair(2, "TABLES") + viewportTable() + linetypeTable(document, infrastructure.linetypes) + layerTable(context) + styleTable(context) +
    emptyTable("VIEW", "7") + emptyTable("UCS", "6") + appIdTable(document) + dimstyleTable(context) + blockTable(names, infrastructure) + pair(0, "ENDSEC");
  const classes = pair(0, "SECTION") + pair(2, "CLASSES") + pair(0, "ENDSEC");
  const text = fileHeader + classes + tables + blocks(names, infrastructure) + pair(0, "SECTION") + pair(2, "ENTITIES") + entityText +
    pair(0, "ENDSEC") + objectsSection() + pair(0, "EOF");
  return { text, bytes: encodeDxfWindows1252(text), report: { emittedHandles, handleMap: Object.fromEntries(handleMap), skipped } };
}

export function readDxfSummary(text: string): DxfReadbackSummary {
  const lines = text.replaceAll("\r", "").split("\n");
  const pairs: Array<{ code: number; value: string }> = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index]?.trim() ?? "", 10);
    if (Number.isInteger(code)) pairs.push({ code, value: lines[index + 1]?.trim() ?? "" });
  }
  const entityTypes: Record<string, number> = {};
  const handles: string[] = [];
  const points: CadPoint2[] = [];
  let acadVersion: string | null = null;
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index]?.code === 9 && pairs[index]?.value === "$ACADVER") acadVersion = pairs[index + 1]?.value ?? null;
  }
  const entitiesMarker = pairs.findIndex((item, index) => item.code === 2 && item.value === "ENTITIES" && pairs[index - 1]?.code === 0 && pairs[index - 1]?.value === "SECTION");
  if (entitiesMarker >= 0) {
    let index = entitiesMarker + 1;
    while (index < pairs.length) {
      if (pairs[index]?.code !== 0) { index += 1; continue; }
      const type = pairs[index]!.value;
      if (type === "ENDSEC") break;
      const record: Array<{ code: number; value: string }> = [];
      index += 1;
      while (index < pairs.length && pairs[index]!.code !== 0) record.push(pairs[index++]!);
      entityTypes[type] = (entityTypes[type] ?? 0) + 1;
      const value = (code: number, fallback = Number.NaN): number => {
        const found = record.find((item) => item.code === code);
        return found ? Number(found.value) : fallback;
      };
      const pointValue = (xCode: number, yCode: number): CadPoint2 | null => {
        const x = value(xCode); const y = value(yCode);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      };
      const handle = record.find((item) => item.code === 5)?.value;
      if (handle) handles.push(handle);
      if (type === "LINE") {
        const start = pointValue(10, 20); const end = pointValue(11, 21);
        if (start) points.push(start); if (end) points.push(end);
      } else if (type === "CIRCLE") {
        const center = pointValue(10, 20); const radius = value(40);
        if (center && Number.isFinite(radius)) points.push({ x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius });
      } else if (type === "ARC") {
        const center = pointValue(10, 20); const radius = value(40); const start = value(50) * Math.PI / 180; const end = value(51) * Math.PI / 180;
        if (center && Number.isFinite(radius) && Number.isFinite(start) && Number.isFinite(end)) points.push(...arcExtentPoints(center, radius, start, end));
      } else if (type === "ELLIPSE") {
        const center = pointValue(10, 20); const major = pointValue(11, 21); const ratio = value(40); const start = value(41, 0); const end = value(42, FULL_TURN);
        if (center && major && Math.hypot(major.x, major.y) > 0 && Number.isFinite(ratio)) points.push(...ellipseExtentPoints(center, major, ratio, start, end));
      } else if (type === "LWPOLYLINE") {
        for (let pairIndex = 0; pairIndex < record.length; pairIndex += 1) {
          if (record[pairIndex]!.code !== 10 || record[pairIndex + 1]?.code !== 20) continue;
          points.push({ x: Number(record[pairIndex]!.value), y: Number(record[pairIndex + 1]!.value) });
        }
      } else {
        for (const [xCode, yCode] of [[10, 20], [11, 21], [13, 23], [14, 24]] as const) {
          const point = pointValue(xCode, yCode);
          if (point) points.push(point);
        }
      }
    }
  }
  return { acadVersion, entityTypes, handles, extents: bounds(points) };
}
