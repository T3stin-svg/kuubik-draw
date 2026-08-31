import {
  assertKDrawDocumentV1,
  type CadLinearUnit,
  type CadUnits,
  type KDrawDocumentV1,
} from "@kuubik/cad-schema";

const METERS_PER_UNIT: Readonly<Record<Exclude<CadLinearUnit, "unitless">, number>> = Object.freeze({
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
});
const LINEAR_UNITS = new Set<CadLinearUnit>(["unitless", "mm", "cm", "m", "in", "ft"]);
const LENGTH_FORMATS = new Set<CadLengthFormat>(["decimal", "engineering", "architectural", "fractional", "scientific"]);
const ANGLE_FORMATS = new Set<CadAngleFormat>(["decimal-degrees", "dms", "grads", "radians", "surveyor"]);
const FULL_TURN = Math.PI * 2;

export const CAD_UNITS_CONTRACT_EXTENSION_KEY = "kuubikDraw.units.v1";

export type CadLengthFormat = "decimal" | "engineering" | "architectural" | "fractional" | "scientific";
export type CadAngleFormat = "decimal-degrees" | "dms" | "grads" | "radians" | "surveyor";

export interface CadUnitsContractV1 {
  schemaVersion: 1;
  drawingUnit: CadLinearUnit;
  insertionUnit: CadLinearUnit;
  lengthFormat: CadLengthFormat;
  lengthPrecision: number;
  angleFormat: CadAngleFormat;
  anglePrecision: number;
  decimalSeparator: "." | ",";
  clockwise: boolean;
  baseAngleRad: number;
}

export interface CadNumberFormatOptions {
  decimalSeparator?: "." | ",";
  trimTrailingZeros?: boolean;
}

export interface CadUnitsChangeOptions {
  existingGeometryPolicy?: "preserve-coordinates";
}

export interface CadUnitsDocumentReadback {
  document: KDrawDocumentV1;
  previous: CadUnitsContractV1;
  current: CadUnitsContractV1;
  coordinatesPreserved: true;
  coordinateScale: 1;
}

export interface CadImportScaleReadback {
  sourceUnit: CadLinearUnit;
  targetUnit: CadLinearUnit;
  factor: number;
  source: "same-unit" | "physical-conversion" | "explicit-scale";
}

function precision(value: number, label: string, maximum = 15): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} must be an integer from 0 to ${maximum}.`);
  return value;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

function normalizeAngle(angleRad: number): number {
  const value = finite(angleRad, "Angle");
  const normalized = ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
  return Math.abs(normalized) <= 1e-14 || Math.abs(normalized - FULL_TURN) <= 1e-14 ? 0 : normalized;
}

function linearUnit(value: unknown, label: string): CadLinearUnit {
  if (typeof value !== "string" || !LINEAR_UNITS.has(value as CadLinearUnit)) throw new TypeError(`${label} is not a supported CAD linear unit.`);
  return value as CadLinearUnit;
}

function decimalText(value: number, digits: number, separator: "." | ",", exponential = false): string {
  const rounded = exponential ? value : Number(value.toFixed(digits));
  const text = exponential ? rounded.toExponential(digits) : rounded.toFixed(digits);
  return separator === "," ? text.replace(".", ",") : text;
}

function circularText(value: number, fullTurnValue: number, digits: number, separator: "." | ","): string {
  const rounded = Number(value.toFixed(digits));
  const roundedTurn = Number(fullTurnValue.toFixed(digits));
  return decimalText(rounded >= roundedTurn ? 0 : rounded, digits, separator);
}

function trimZeros(text: string, separator: "." | ","): string {
  const [mantissa, exponent] = text.split(/(?=e)/i);
  const trimmed = mantissa!.includes(separator)
    ? mantissa!.replace(new RegExp(`\\${separator}?0+$`), "")
    : mantissa!;
  return `${trimmed}${exponent ?? ""}`;
}

function numberPattern(separator: "." | ",", signed = true): string {
  const decimal = separator === "." ? String.raw`\.` : ",";
  return `${signed ? "[+-]?" : ""}(?:\\d+(?:${decimal}\\d*)?|${decimal}\\d+)(?:[eE][+-]?\\d+)?`;
}

function parseNumber(source: string, separator: "." | ",", label: string, signed = true): number {
  const text = source.trim();
  if (!new RegExp(`^${numberPattern(separator, signed)}$`).test(text)) throw new TypeError(`${label} is not a valid locale number.`);
  return finite(Number(separator === "," ? text.replace(",", ".") : text), label);
}

function gcd(first: number, second: number): number {
  let a = Math.abs(first);
  let b = Math.abs(second);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function imperialParts(totalInches: number, fractionalPrecision: number): { sign: string; wholeInches: number; numerator: number; denominator: number } {
  const denominator = 2 ** precision(fractionalPrecision, "Fractional precision", 8);
  const sign = totalInches < 0 ? "-" : "";
  const ticks = Math.round(Math.abs(totalInches) * denominator);
  const wholeInches = Math.floor(ticks / denominator);
  const rawNumerator = ticks % denominator;
  const divisor = gcd(rawNumerator, denominator);
  return {
    sign: ticks === 0 ? "" : sign,
    wholeInches,
    numerator: rawNumerator / divisor,
    denominator: denominator / divisor,
  };
}

function fractionText(numerator: number, denominator: number): string {
  return numerator === 0 ? "" : ` ${numerator}/${denominator}`;
}

function physicalLength(value: number, from: CadLinearUnit, to: CadLinearUnit): number {
  if (from === "unitless" || to === "unitless") throw new TypeError("Engineering, architectural and fractional formats require physical drawing units.");
  return convertCadLength(value, from, to);
}

export function convertCadLength(value: number, from: CadLinearUnit, to: CadLinearUnit): number {
  const length = finite(value, "Length");
  if (from === to) return length;
  if (from === "unitless" || to === "unitless") throw new TypeError("Unitless values cannot be converted to physical units.");
  return length * METERS_PER_UNIT[from] / METERS_PER_UNIT[to];
}

export function createCadUnitsContract(
  units: CadUnits,
  overrides: Partial<Omit<CadUnitsContractV1, "schemaVersion" | "drawingUnit" | "lengthPrecision" | "anglePrecision">> = {},
): CadUnitsContractV1 {
  return normalizeCadUnitsContract({
    schemaVersion: 1,
    drawingUnit: units.linear,
    insertionUnit: units.linear,
    lengthFormat: "decimal",
    lengthPrecision: units.displayPrecision,
    angleFormat: "decimal-degrees",
    anglePrecision: units.angularPrecision,
    decimalSeparator: ".",
    clockwise: false,
    baseAngleRad: 0,
    ...overrides,
  });
}

export function normalizeCadUnitsContract(candidate: unknown): CadUnitsContractV1 {
  if (!candidate || typeof candidate !== "object") throw new TypeError("CAD units contract must be an object.");
  const value = candidate as Partial<CadUnitsContractV1>;
  if (value.schemaVersion !== 1) throw new TypeError("CAD units contract schemaVersion must be 1.");
  if (!LENGTH_FORMATS.has(value.lengthFormat as CadLengthFormat)) throw new TypeError("CAD length format is invalid.");
  if (!ANGLE_FORMATS.has(value.angleFormat as CadAngleFormat)) throw new TypeError("CAD angle format is invalid.");
  if (value.decimalSeparator !== "." && value.decimalSeparator !== ",") throw new TypeError("CAD decimal separator must be '.' or ','.");
  if (typeof value.clockwise !== "boolean") throw new TypeError("CAD clockwise flag must be boolean.");
  const lengthPrecision = precision(value.lengthPrecision!, "Length precision");
  if ((value.lengthFormat === "architectural" || value.lengthFormat === "fractional") && lengthPrecision > 8) {
    throw new RangeError("Architectural and fractional precision must be an integer from 0 to 8.");
  }
  return {
    schemaVersion: 1,
    drawingUnit: linearUnit(value.drawingUnit, "Drawing unit"),
    insertionUnit: linearUnit(value.insertionUnit, "Insertion unit"),
    lengthFormat: value.lengthFormat as CadLengthFormat,
    lengthPrecision,
    angleFormat: value.angleFormat as CadAngleFormat,
    anglePrecision: precision(value.anglePrecision!, "Angle precision"),
    decimalSeparator: value.decimalSeparator,
    clockwise: value.clockwise,
    baseAngleRad: normalizeAngle(value.baseAngleRad!),
  };
}

export function readCadUnitsContract(document: KDrawDocumentV1): CadUnitsContractV1 {
  const stored = document.metadata.extensions?.[CAD_UNITS_CONTRACT_EXTENSION_KEY];
  if (stored === undefined) return createCadUnitsContract(document.units);
  const contract = normalizeCadUnitsContract(stored);
  if (contract.drawingUnit !== document.units.linear
    || contract.lengthPrecision !== document.units.displayPrecision
    || contract.anglePrecision !== document.units.angularPrecision) {
    throw new TypeError("Stored CAD units contract disagrees with document.units read-back.");
  }
  return contract;
}

function hasDrawingGeometry(document: KDrawDocumentV1): boolean {
  return document.entities.length > 0
    || document.blocks.some((block) => block.entities.length > 0)
    || document.layouts.some((layout) => (layout.entities?.length ?? 0) > 0 || layout.viewports.length > 0);
}

/** Plans a serializable document update; coordinate arrays remain byte-for-byte equivalent. */
export function planCadUnitsContract(
  document: KDrawDocumentV1,
  candidate: CadUnitsContractV1,
  options: CadUnitsChangeOptions = {},
): CadUnitsDocumentReadback {
  const previous = readCadUnitsContract(document);
  const current = normalizeCadUnitsContract(candidate);
  if (current.drawingUnit !== previous.drawingUnit && hasDrawingGeometry(document)
    && options.existingGeometryPolicy !== "preserve-coordinates") {
    throw new TypeError("Changing drawing units with existing geometry requires existingGeometryPolicy='preserve-coordinates'.");
  }
  const next = structuredClone(document);
  next.units = {
    linear: current.drawingUnit,
    displayPrecision: current.lengthPrecision,
    angularPrecision: current.anglePrecision,
  };
  next.metadata.extensions = {
    ...(next.metadata.extensions ?? {}),
    [CAD_UNITS_CONTRACT_EXTENSION_KEY]: structuredClone(current),
  };
  assertKDrawDocumentV1(next);
  return { document: next, previous, current: readCadUnitsContract(next), coordinatesPreserved: true, coordinateScale: 1 };
}

export function resolveCadImportScale(
  sourceUnit: CadLinearUnit,
  targetUnit: CadLinearUnit,
  explicitScale?: number,
): CadImportScaleReadback {
  const source = linearUnit(sourceUnit, "Import source unit");
  const target = linearUnit(targetUnit, "Import target unit");
  if (explicitScale !== undefined) {
    const factor = finite(explicitScale, "Explicit import scale");
    if (factor <= 0) throw new RangeError("Explicit import scale must be positive.");
    return { sourceUnit: source, targetUnit: target, factor, source: "explicit-scale" };
  }
  if (source === target) return { sourceUnit: source, targetUnit: target, factor: 1, source: "same-unit" };
  if (source === "unitless" || target === "unitless") {
    throw new TypeError("Import between unitless and physical units requires an explicit positive scale.");
  }
  return { sourceUnit: source, targetUnit: target, factor: convertCadLength(1, source, target), source: "physical-conversion" };
}

export function resolveCadInsertionScale(
  sourceUnit: CadLinearUnit | undefined,
  target: CadUnitsContractV1,
  explicitScale?: number,
): CadImportScaleReadback {
  const contract = normalizeCadUnitsContract(target);
  return resolveCadImportScale(sourceUnit ?? contract.insertionUnit, contract.drawingUnit, explicitScale);
}

export function formatCadLengthWithContract(value: number, contractValue: CadUnitsContractV1): string {
  const contract = normalizeCadUnitsContract(contractValue);
  const length = finite(value, "Length");
  if (contract.lengthFormat === "decimal") return decimalText(length, contract.lengthPrecision, contract.decimalSeparator);
  if (contract.lengthFormat === "scientific") return decimalText(length, contract.lengthPrecision, contract.decimalSeparator, true);
  const inches = physicalLength(length, contract.drawingUnit, "in");
  if (contract.lengthFormat === "engineering") {
    const sign = inches < 0 ? "-" : "";
    let feet = Math.floor(Math.abs(inches) / 12);
    let remainder = Number(Math.abs(inches) - feet * 12);
    remainder = Number(remainder.toFixed(contract.lengthPrecision));
    if (remainder >= 12) { feet += 1; remainder = 0; }
    return `${Math.abs(inches) < 0.5 * 10 ** -contract.lengthPrecision ? "" : sign}${feet}'-${decimalText(remainder, contract.lengthPrecision, contract.decimalSeparator)}\"`;
  }
  const parts = imperialParts(inches, contract.lengthPrecision);
  if (contract.lengthFormat === "fractional") {
    return `${parts.sign}${parts.wholeInches}${fractionText(parts.numerator, parts.denominator)}\"`;
  }
  const feet = Math.floor(parts.wholeInches / 12);
  const wholeInches = parts.wholeInches % 12;
  return `${parts.sign}${feet}'-${wholeInches}${fractionText(parts.numerator, parts.denominator)}\"`;
}

export function parseCadLengthWithContract(source: string, contractValue: CadUnitsContractV1): number {
  const contract = normalizeCadUnitsContract(contractValue);
  const text = source.trim();
  if (contract.lengthFormat === "decimal" || contract.lengthFormat === "scientific") {
    return parseNumber(text, contract.decimalSeparator, "Length");
  }
  if (contract.drawingUnit === "unitless") throw new TypeError("Imperial length formats require physical drawing units.");
  if (contract.lengthFormat === "engineering") {
    const match = new RegExp(`^([+-])?(\\d+)'\\s*-\\s*(${numberPattern(contract.decimalSeparator, false)})\"$`).exec(text);
    if (!match) throw new TypeError("Engineering length must use feet'-decimal-inches\" syntax.");
    const inches = parseNumber(match[3]!, contract.decimalSeparator, "Engineering inches", false);
    if (inches < 0 || inches >= 12) throw new RangeError("Engineering inches must be in [0, 12)." );
    const total = (Number(match[2]) * 12 + inches) * (match[1] === "-" ? -1 : 1);
    return convertCadLength(total, "in", contract.drawingUnit);
  }
  const architectural = contract.lengthFormat === "architectural";
  const pattern = architectural
    ? /^([+-])?(\d+)'\s*-\s*(\d+)(?:\s+(\d+)\/(\d+))?"$/
    : /^([+-])?(\d+)(?:\s+(\d+)\/(\d+))?"$/;
  const match = pattern.exec(text);
  if (!match) throw new TypeError(`${architectural ? "Architectural" : "Fractional"} length syntax is invalid.`);
  const sign = match[1] === "-" ? -1 : 1;
  const feet = architectural ? Number(match[2]) : 0;
  const whole = Number(match[architectural ? 3 : 2]);
  const numerator = Number(match[architectural ? 4 : 3] ?? 0);
  const denominator = Number(match[architectural ? 5 : 4] ?? 1);
  if (architectural && whole >= 12) throw new RangeError("Architectural inches must be in [0, 12)." );
  if (denominator <= 0 || numerator < 0 || numerator >= denominator || (denominator & (denominator - 1)) !== 0 || denominator > 2 ** contract.lengthPrecision) {
    throw new RangeError("Fraction must use a power-of-two denominator allowed by length precision.");
  }
  const total = sign * (feet * 12 + whole + numerator / denominator);
  return convertCadLength(total, "in", contract.drawingUnit);
}

function displayAngle(angleRad: number, contract: CadUnitsContractV1): number {
  return normalizeAngle(contract.clockwise ? contract.baseAngleRad - angleRad : angleRad - contract.baseAngleRad);
}

function geometryAngle(displayRad: number, contract: CadUnitsContractV1): number {
  return normalizeAngle(contract.clockwise ? contract.baseAngleRad - displayRad : contract.baseAngleRad + displayRad);
}

function formatDms(angleRad: number, precisionDigits: number, separator: "." | ","): string {
  const scale = 10 ** precisionDigits;
  let totalSeconds = Math.round(angleRad * 180 / Math.PI * 3600 * scale) / scale;
  if (totalSeconds >= 360 * 3600) totalSeconds = 0;
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - degrees * 3600) / 60);
  const seconds = totalSeconds - degrees * 3600 - minutes * 60;
  return `${degrees}°${String(minutes).padStart(2, "0")}'${decimalText(seconds, precisionDigits, separator).padStart(precisionDigits > 0 ? precisionDigits + 3 : 2, "0")}\"`;
}

export function formatCadAngleWithContract(angleRad: number, contractValue: CadUnitsContractV1): string {
  const contract = normalizeCadUnitsContract(contractValue);
  const angle = displayAngle(angleRad, contract);
  if (contract.angleFormat === "decimal-degrees") return circularText(angle * 180 / Math.PI, 360, contract.anglePrecision, contract.decimalSeparator);
  if (contract.angleFormat === "dms") return formatDms(angle, contract.anglePrecision, contract.decimalSeparator);
  if (contract.angleFormat === "grads") return `${circularText(angle * 200 / Math.PI, 400, contract.anglePrecision, contract.decimalSeparator)}g`;
  if (contract.angleFormat === "radians") return `${circularText(angle, FULL_TURN, contract.anglePrecision, contract.decimalSeparator)}r`;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const bearing = Math.atan2(Math.abs(x), Math.abs(y)) * 180 / Math.PI;
  const roundedBearing = Number(bearing.toFixed(contract.anglePrecision));
  const northSouth = roundedBearing === 90 || y >= -1e-14 ? "N" : "S";
  const eastWest = roundedBearing === 0 || x >= -1e-14 ? "E" : "W";
  return `${northSouth} ${decimalText(roundedBearing, contract.anglePrecision, contract.decimalSeparator)}° ${eastWest}`;
}

export function parseCadAngleWithContract(source: string, contractValue: CadUnitsContractV1): number {
  const contract = normalizeCadUnitsContract(contractValue);
  const text = source.trim();
  let displayRad: number;
  if (contract.angleFormat === "decimal-degrees") {
    displayRad = parseNumber(text, contract.decimalSeparator, "Decimal angle") * Math.PI / 180;
  } else if (contract.angleFormat === "dms") {
    const match = new RegExp(`^(\\d+)°(\\d{1,2})'(${numberPattern(contract.decimalSeparator, false)})\"$`).exec(text);
    if (!match) throw new TypeError("DMS angle syntax is invalid.");
    const degrees = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = parseNumber(match[3]!, contract.decimalSeparator, "DMS seconds", false);
    if (degrees >= 360 || minutes >= 60 || seconds >= 60) throw new RangeError("DMS angle components are outside their ranges.");
    displayRad = (degrees + minutes / 60 + seconds / 3600) * Math.PI / 180;
  } else if (contract.angleFormat === "grads") {
    if (!text.endsWith("g")) throw new TypeError("Grad angle must end with g.");
    displayRad = parseNumber(text.slice(0, -1), contract.decimalSeparator, "Grad angle") * Math.PI / 200;
  } else if (contract.angleFormat === "radians") {
    if (!text.endsWith("r")) throw new TypeError("Radian angle must end with r.");
    displayRad = parseNumber(text.slice(0, -1), contract.decimalSeparator, "Radian angle");
  } else {
    const match = new RegExp(`^([NS])\\s+(${numberPattern(contract.decimalSeparator, false)})°\\s+([EW])$`, "i").exec(text);
    if (!match) throw new TypeError("Surveyor angle must use N/S bearing E/W syntax.");
    const bearing = parseNumber(match[2]!, contract.decimalSeparator, "Surveyor bearing", false);
    if (bearing < 0 || bearing > 90) throw new RangeError("Surveyor bearing must be in [0, 90] degrees.");
    const ns = match[1]!.toUpperCase();
    const ew = match[3]!.toUpperCase();
    const degrees = ns === "N" ? (ew === "E" ? 90 - bearing : 90 + bearing) : (ew === "W" ? 270 - bearing : 270 + bearing);
    displayRad = degrees * Math.PI / 180;
  }
  return geometryAngle(displayRad, contract);
}

/** Backwards-compatible decimal formatter over the legacy schema fields. */
export function formatCadLength(
  value: number,
  units: CadUnits,
  displayUnit: CadLinearUnit = units.linear,
  options: CadNumberFormatOptions = {},
): string {
  const converted = convertCadLength(value, units.linear, displayUnit);
  let text = decimalText(converted, precision(units.displayPrecision, "Display precision"), options.decimalSeparator ?? ".");
  if (options.trimTrailingZeros) text = trimZeros(text, options.decimalSeparator ?? ".");
  return text;
}

/** Backwards-compatible decimal-degree formatter over the legacy schema fields. */
export function formatCadAngle(angleRad: number, units: CadUnits, options: CadNumberFormatOptions = {}): string {
  let text = decimalText(finite(angleRad, "Angle") * 180 / Math.PI, precision(units.angularPrecision, "Angular precision"), options.decimalSeparator ?? ".");
  if (options.trimTrailingZeros) text = trimZeros(text, options.decimalSeparator ?? ".");
  return text;
}

export function withCadDisplayPrecision(units: CadUnits, displayPrecision: number, angularPrecision: number): CadUnits {
  return { ...units, displayPrecision: precision(displayPrecision, "Display precision"), angularPrecision: precision(angularPrecision, "Angular precision") };
}
