import type { CadLinearUnit, CadUnits } from "@kuubik/cad-schema";

const METERS_PER_UNIT: Readonly<Record<Exclude<CadLinearUnit, "unitless">, number>> = Object.freeze({
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
});

function precision(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new RangeError(`${label} must be an integer from 0 to 15.`);
  return value;
}

export function convertCadLength(value: number, from: CadLinearUnit, to: CadLinearUnit): number {
  if (!Number.isFinite(value)) throw new TypeError("Length must be finite.");
  if (from === to) return value;
  if (from === "unitless" || to === "unitless") throw new TypeError("Unitless values cannot be converted to physical units.");
  return value * METERS_PER_UNIT[from] / METERS_PER_UNIT[to];
}

export interface CadNumberFormatOptions {
  decimalSeparator?: "." | ",";
  trimTrailingZeros?: boolean;
}

/** Formats a copy of the value; it never rounds or mutates stored geometry. */
export function formatCadLength(
  value: number,
  units: CadUnits,
  displayUnit: CadLinearUnit = units.linear,
  options: CadNumberFormatOptions = {},
): string {
  const converted = convertCadLength(value, units.linear, displayUnit);
  let text = converted.toFixed(precision(units.displayPrecision, "Display precision"));
  if (options.trimTrailingZeros && text.includes(".")) text = text.replace(/\.?0+$/, "");
  return options.decimalSeparator === "," ? text.replace(".", ",") : text;
}

export function formatCadAngle(angleRad: number, units: CadUnits, options: CadNumberFormatOptions = {}): string {
  if (!Number.isFinite(angleRad)) throw new TypeError("Angle must be finite.");
  let text = (angleRad * 180 / Math.PI).toFixed(precision(units.angularPrecision, "Angular precision"));
  if (options.trimTrailingZeros && text.includes(".")) text = text.replace(/\.?0+$/, "");
  return options.decimalSeparator === "," ? text.replace(".", ",") : text;
}

export function withCadDisplayPrecision(units: CadUnits, displayPrecision: number, angularPrecision: number): CadUnits {
  return { ...units, displayPrecision: precision(displayPrecision, "Display precision"), angularPrecision: precision(angularPrecision, "Angular precision") };
}
