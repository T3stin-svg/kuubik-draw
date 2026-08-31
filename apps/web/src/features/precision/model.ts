import type { CadPoint2, CadUnits } from "@kuubik/cad-schema";
import { resolvePrecisionPoint, type PrecisionRequest, type PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import {
  createCadUnitsContract,
  formatCadAngleWithContract,
  formatCadLengthWithContract,
  normalizeCadUnitsContract,
  withCadDisplayPrecision,
  type CadUnitsContractV1,
} from "../../../../../packages/cad-core/src/units.js";

export interface DynamicInputModel {
  point: CadPoint2;
  coordinate: CadPoint2;
  delta: CadPoint2;
  distanceValue: number;
  angleRad: number;
  units: CadUnits;
  unitsContract: CadUnitsContractV1;
  x: string;
  y: string;
  distance: string;
  angle: string;
  /** Compatibility alias; the value follows unitsContract.angleFormat. */
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

export function normalizePrecisionUnitsContract(units: CadUnits | CadUnitsContractV1): CadUnitsContractV1 {
  if ("schemaVersion" in units) return normalizeCadUnitsContract(units);
  return createCadUnitsContract(normalizePrecisionUnits(units));
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

  dynamicInput(request: PrecisionRequest, units: CadUnits | CadUnitsContractV1): DynamicInputModel {
    const result = resolvePrecisionPoint(request);
    const unitsContract = normalizePrecisionUnitsContract(units);
    const normalizedUnits: CadUnits = {
      linear: unitsContract.drawingUnit,
      displayPrecision: unitsContract.lengthPrecision,
      angularPrecision: unitsContract.anglePrecision,
    };
    const point = { x: normalizedNumber(result.point.x, "Dynamic X"), y: normalizedNumber(result.point.y, "Dynamic Y") };
    const dx = normalizedNumber(point.x - request.basePoint.x, "Dynamic delta X");
    const dy = normalizedNumber(point.y - request.basePoint.y, "Dynamic delta Y");
    const distanceValue = normalizedNumber(Math.hypot(dx, dy), "Dynamic distance");
    const angleRad = normalizeDynamicAngle(Math.atan2(dy, dx));
    const angle = formatCadAngleWithContract(angleRad, unitsContract);
    return {
      point, coordinate: { ...point }, delta: { x: dx, y: dy }, distanceValue, angleRad,
      units: normalizedUnits, unitsContract,
      x: formatCadLengthWithContract(point.x, unitsContract),
      y: formatCadLengthWithContract(point.y, unitsContract),
      distance: formatCadLengthWithContract(distanceValue, unitsContract),
      angle, angleDeg: angle,
      source: result.source,
    };
  }
}
