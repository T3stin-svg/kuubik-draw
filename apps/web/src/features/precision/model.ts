import type { CadPoint2, CadUnits } from "@kuubik/cad-schema";
import { resolvePrecisionPoint, type PrecisionRequest, type PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import { formatCadAngle, formatCadLength, withCadDisplayPrecision } from "../../../../../packages/cad-core/src/units.js";

export interface DynamicInputModel {
  point: CadPoint2;
  coordinate: CadPoint2;
  delta: CadPoint2;
  distanceValue: number;
  angleRad: number;
  units: CadUnits;
  x: string;
  y: string;
  distance: string;
  angleDeg: string;
  source: PrecisionResult["source"];
}

const LINEAR_UNITS = new Set(["unitless", "mm", "cm", "m", "in", "ft"]);

function normalizedNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

export function normalizePrecisionUnits(units: CadUnits): CadUnits {
  if (!LINEAR_UNITS.has(units.linear)) throw new TypeError(`Unsupported CAD linear unit ${String(units.linear)}.`);
  return withCadDisplayPrecision(structuredClone(units), units.displayPrecision, units.angularPrecision);
}

export function normalizeDynamicAngle(angleRad: number): number {
  const angle = normalizedNumber(angleRad, "Dynamic angle");
  const fullTurn = Math.PI * 2;
  const normalized = ((angle % fullTurn) + fullTurn) % fullTurn;
  return Math.abs(normalized - fullTurn) <= 1e-14 || Math.abs(normalized) <= 1e-14 ? 0 : normalized;
}

/** Both callers intentionally invoke the same pure function; there is no UI-side geometry predicate. */
export class PrecisionFeatureModel {
  preview(request: PrecisionRequest): PrecisionResult {
    return resolvePrecisionPoint(request);
  }

  commit(request: PrecisionRequest): PrecisionResult {
    return resolvePrecisionPoint(request);
  }

  dynamicInput(request: PrecisionRequest, units: CadUnits): DynamicInputModel {
    const result = resolvePrecisionPoint(request);
    const normalizedUnits = normalizePrecisionUnits(units);
    const point = { x: normalizedNumber(result.point.x, "Dynamic X"), y: normalizedNumber(result.point.y, "Dynamic Y") };
    const dx = normalizedNumber(point.x - request.basePoint.x, "Dynamic delta X");
    const dy = normalizedNumber(point.y - request.basePoint.y, "Dynamic delta Y");
    const distanceValue = normalizedNumber(Math.hypot(dx, dy), "Dynamic distance");
    const angleRad = normalizeDynamicAngle(Math.atan2(dy, dx));
    return {
      point, coordinate: { ...point }, delta: { x: dx, y: dy }, distanceValue, angleRad,
      units: normalizedUnits,
      x: formatCadLength(point.x, normalizedUnits),
      y: formatCadLength(point.y, normalizedUnits),
      distance: formatCadLength(distanceValue, normalizedUnits),
      angleDeg: formatCadAngle(angleRad, normalizedUnits),
      source: result.source,
    };
  }
}
