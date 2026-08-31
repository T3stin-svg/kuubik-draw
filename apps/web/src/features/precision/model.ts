import type { CadPoint2, CadUnits } from "@kuubik/cad-schema";
import { resolvePrecisionPoint, type PrecisionRequest, type PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import { formatCadAngle, formatCadLength } from "../../../../../packages/cad-core/src/units.js";

export interface DynamicInputModel {
  point: CadPoint2;
  x: string;
  y: string;
  distance: string;
  angleDeg: string;
  source: PrecisionResult["source"];
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
    const dx = result.point.x - request.basePoint.x;
    const dy = result.point.y - request.basePoint.y;
    return {
      point: { ...result.point },
      x: formatCadLength(result.point.x, units),
      y: formatCadLength(result.point.y, units),
      distance: formatCadLength(Math.hypot(dx, dy), units),
      angleDeg: formatCadAngle(Math.atan2(dy, dx), units),
      source: result.source,
    };
  }
}
