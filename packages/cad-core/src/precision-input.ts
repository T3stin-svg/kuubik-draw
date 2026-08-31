import type { CadLinearUnit, CadPoint2 } from "@kuubik/cad-schema";
import { convertCadLength } from "./units.js";

const LINEAR_UNITS = new Set<CadLinearUnit>(["unitless", "mm", "cm", "m", "in", "ft"]);
const PHYSICAL_UNIT_SOURCE = String.raw`(?:mm|cm|m|in|ft)`;

export type CadPrecisionInput =
  | { kind: "absolute-cartesian"; point: CadPoint2 }
  | { kind: "relative-cartesian"; delta: CadPoint2 }
  | { kind: "absolute-polar"; distance: number; angleRad: number }
  | { kind: "relative-polar"; distance: number; angleRad: number }
  | { kind: "direct-distance"; distance: number };

export interface CadPrecisionInputOptions {
  /** Unit used by document geometry and returned parsed values. */
  documentUnit?: CadLinearUnit;
  /** Unit assumed when a length token has no suffix. Defaults to documentUnit. */
  defaultInputUnit?: CadLinearUnit;
  /** Comma decimals require semicolon between Cartesian coordinates. */
  decimalSeparator?: "." | ",";
  /** Unsuffixed polar angles use degrees by default, matching CAD command input. */
  defaultAngleUnit?: "deg" | "rad";
}

export class CadPrecisionInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CadPrecisionInputError";
  }
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateOptions(options: CadPrecisionInputOptions): Required<CadPrecisionInputOptions> {
  const documentUnit = options.documentUnit ?? options.defaultInputUnit ?? "unitless";
  const defaultInputUnit = options.defaultInputUnit ?? documentUnit;
  if (!LINEAR_UNITS.has(documentUnit) || !LINEAR_UNITS.has(defaultInputUnit)) {
    throw new CadPrecisionInputError("Precision input units are not supported.");
  }
  const decimalSeparator = options.decimalSeparator ?? ".";
  if (decimalSeparator !== "." && decimalSeparator !== ",") {
    throw new CadPrecisionInputError("Decimal separator must be '.' or ','.");
  }
  const defaultAngleUnit = options.defaultAngleUnit ?? "deg";
  if (defaultAngleUnit !== "deg" && defaultAngleUnit !== "rad") {
    throw new CadPrecisionInputError("Angle input unit must be deg or rad.");
  }
  return { documentUnit, defaultInputUnit, decimalSeparator, defaultAngleUnit };
}

function numberSource(decimalSeparator: "." | ","): string {
  const separator = decimalSeparator === "." ? String.raw`\.` : ",";
  return String.raw`[+-]?(?:\d+(?:${separator}\d*)?|${separator}\d+)(?:[eE][+-]?\d+)?`;
}

function finiteNumber(source: string, decimalSeparator: "." | ",", label: string): number {
  const normalized = decimalSeparator === "," ? source.replace(",", ".") : source;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new CadPrecisionInputError(`${label} must be a finite double-precision number.`);
  return canonicalNumber(value);
}

function convertLength(value: number, from: CadLinearUnit, to: CadLinearUnit, label: string): number {
  if (from === to) return canonicalNumber(value);
  if (from === "unitless" || to === "unitless") {
    throw new CadPrecisionInputError(`${label} cannot convert between unitless and physical units.`);
  }
  return canonicalNumber(convertCadLength(value, from, to));
}

function parseLengthToken(source: string, options: Required<CadPrecisionInputOptions>, label: string): number {
  const match = new RegExp(`^(${numberSource(options.decimalSeparator)})\\s*(${PHYSICAL_UNIT_SOURCE})?$`, "i").exec(source.trim());
  if (!match) throw new CadPrecisionInputError(`${label} must be a finite length.`);
  const value = finiteNumber(match[1]!, options.decimalSeparator, label);
  const from = (match[2]?.toLowerCase() as CadLinearUnit | undefined) ?? options.defaultInputUnit;
  return convertLength(value, from, options.documentUnit, label);
}

function parseAngleToken(source: string, options: Required<CadPrecisionInputOptions>): number {
  const match = new RegExp(`^(${numberSource(options.decimalSeparator)})\\s*(deg|rad|°)?$`, "i").exec(source.trim());
  if (!match) throw new CadPrecisionInputError("Angle must be a finite number with optional deg, ° or rad suffix.");
  const value = finiteNumber(match[1]!, options.decimalSeparator, "Angle");
  const unit = match[2]?.toLowerCase() === "rad" ? "rad" : match[2] ? "deg" : options.defaultAngleUnit;
  return canonicalNumber(unit === "rad" ? value : value * Math.PI / 180);
}

function cartesianParts(source: string, decimalSeparator: "." | ","): [string, string] | null {
  const delimiter = source.includes(";") ? ";" : decimalSeparator === "." && source.includes(",") ? "," : null;
  if (!delimiter) return null;
  const parts = source.split(delimiter);
  return parts.length === 2 && parts.every((part) => part.trim().length > 0) ? [parts[0]!, parts[1]!] : null;
}

/** Strict unit-aware parser shared by command-line, Dynamic Input, preview and commit. */
export function parseCadPrecisionInput(source: string, inputOptions: CadPrecisionInputOptions = {}): CadPrecisionInput {
  const options = validateOptions(inputOptions);
  const value = source.trim();
  if (value.length === 0) throw new CadPrecisionInputError("Precision input is empty.");
  const relative = value.startsWith("@");
  const explicitAbsolute = value.startsWith("#");
  const body = relative || explicitAbsolute ? value.slice(1).trim() : value;
  if (body.length === 0 || body.startsWith("@") || body.startsWith("#")) {
    throw new CadPrecisionInputError("Precision input has an invalid coordinate prefix.");
  }

  if (body.includes("<")) {
    const parts = body.split("<");
    if (parts.length !== 2 || parts.some((part) => part.trim().length === 0)) {
      throw new CadPrecisionInputError("Polar input must contain one distance<angle pair.");
    }
    const distance = parseLengthToken(parts[0]!, options, "Polar distance");
    const angleRad = parseAngleToken(parts[1]!, options);
    return relative ? { kind: "relative-polar", distance, angleRad } : { kind: "absolute-polar", distance, angleRad };
  }

  const cartesian = cartesianParts(body, options.decimalSeparator);
  if (cartesian) {
    const point = {
      x: parseLengthToken(cartesian[0], options, "X"),
      y: parseLengthToken(cartesian[1], options, "Y"),
    };
    return relative ? { kind: "relative-cartesian", delta: point } : { kind: "absolute-cartesian", point };
  }

  if (!relative && !explicitAbsolute) {
    return { kind: "direct-distance", distance: parseLengthToken(body, options, "Distance") };
  }
  throw new CadPrecisionInputError("Expected x,y, @dx,dy, distance<angle, @distance<angle or a direct distance.");
}

function finitePoint(point: CadPoint2, label: string): CadPoint2 {
  if (![point.x, point.y].every(Number.isFinite)) throw new CadPrecisionInputError(`${label} must be finite.`);
  return { x: canonicalNumber(point.x), y: canonicalNumber(point.y) };
}

function polarPoint(origin: CadPoint2, distance: number, angleRad: number): CadPoint2 {
  if (![distance, angleRad].every(Number.isFinite)) throw new CadPrecisionInputError("Polar distance and angle must be finite.");
  return {
    x: canonicalNumber(origin.x + Math.cos(angleRad) * distance),
    y: canonicalNumber(origin.y + Math.sin(angleRad) * distance),
  };
}

export function resolveCadPrecisionInput(
  parsed: CadPrecisionInput,
  basePoint: CadPoint2,
  directionPoint?: CadPoint2,
): CadPoint2 {
  const base = finitePoint(basePoint, "Base point");
  if (parsed.kind === "absolute-cartesian") return finitePoint(parsed.point, "Absolute point");
  if (parsed.kind === "relative-cartesian") {
    const delta = finitePoint(parsed.delta, "Relative delta");
    return { x: canonicalNumber(base.x + delta.x), y: canonicalNumber(base.y + delta.y) };
  }
  if (parsed.kind === "absolute-polar") return polarPoint({ x: 0, y: 0 }, parsed.distance, parsed.angleRad);
  if (parsed.kind === "relative-polar") return polarPoint(base, parsed.distance, parsed.angleRad);
  if (!Number.isFinite(parsed.distance)) throw new CadPrecisionInputError("Direct distance must be finite.");
  if (parsed.distance === 0) return { ...base };
  if (!directionPoint) throw new CadPrecisionInputError("Direct distance entry requires a finite cursor direction.");
  const direction = finitePoint(directionPoint, "Direct distance direction");
  const dx = direction.x - base.x;
  const dy = direction.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new CadPrecisionInputError("Direct distance direction must not be zero.");
  return {
    x: canonicalNumber(base.x + dx / length * parsed.distance),
    y: canonicalNumber(base.y + dy / length * parsed.distance),
  };
}
