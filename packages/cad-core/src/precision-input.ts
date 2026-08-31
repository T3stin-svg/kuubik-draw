import type { CadPoint2 } from "@kuubik/cad-schema";

const NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const CARTESIAN = new RegExp(`^(${NUMBER_SOURCE})\\s*,\\s*(${NUMBER_SOURCE})$`);
const DISTANCE = new RegExp(`^(${NUMBER_SOURCE})$`);

export type CadPrecisionInput =
  | { kind: "absolute-cartesian"; point: CadPoint2 }
  | { kind: "relative-cartesian"; delta: CadPoint2 }
  | { kind: "direct-distance"; distance: number };

export class CadPrecisionInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CadPrecisionInputError";
  }
}

function finiteNumber(source: string, label: string): number {
  const value = Number(source);
  if (!Number.isFinite(value)) throw new CadPrecisionInputError(`${label} must be a finite double-precision number.`);
  return value;
}

/** Strict parser shared by command-line, dynamic-input preview and commit. */
export function parseCadPrecisionInput(source: string): CadPrecisionInput {
  const value = source.trim();
  if (value.length === 0) throw new CadPrecisionInputError("Precision input is empty.");
  const relative = value.startsWith("@");
  const body = relative ? value.slice(1).trim() : value.startsWith("#") ? value.slice(1).trim() : value;
  const cartesian = CARTESIAN.exec(body);
  if (cartesian) {
    const point = { x: finiteNumber(cartesian[1]!, "X"), y: finiteNumber(cartesian[2]!, "Y") };
    return relative ? { kind: "relative-cartesian", delta: point } : { kind: "absolute-cartesian", point };
  }
  if (!relative) {
    const distance = DISTANCE.exec(body);
    if (distance) return { kind: "direct-distance", distance: finiteNumber(distance[1]!, "Distance") };
  }
  throw new CadPrecisionInputError("Expected x,y, @dx,dy or a direct distance.");
}

export function resolveCadPrecisionInput(
  parsed: CadPrecisionInput,
  basePoint: CadPoint2,
  directionPoint?: CadPoint2,
): CadPoint2 {
  if (![basePoint.x, basePoint.y].every(Number.isFinite)) throw new CadPrecisionInputError("Base point must be finite.");
  if (parsed.kind === "absolute-cartesian") return { ...parsed.point };
  if (parsed.kind === "relative-cartesian") return { x: basePoint.x + parsed.delta.x, y: basePoint.y + parsed.delta.y };
  if (!directionPoint || ![directionPoint.x, directionPoint.y].every(Number.isFinite)) {
    throw new CadPrecisionInputError("Direct distance entry requires a finite cursor direction.");
  }
  const dx = directionPoint.x - basePoint.x;
  const dy = directionPoint.y - basePoint.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new CadPrecisionInputError("Direct distance direction must not be zero.");
  return { x: basePoint.x + dx / length * parsed.distance, y: basePoint.y + dy / length * parsed.distance };
}
