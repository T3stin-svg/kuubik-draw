import type { CadPoint2 } from "@kuubik/cad-schema";
import { parseCadPrecisionInput, resolveCadPrecisionInput, type CadPrecisionInput } from "./precision-input.js";

export interface PrecisionCandidate {
  point: CadPoint2;
  kind: string;
  priority: number;
  key?: string;
}

export interface PrecisionModes {
  ortho?: boolean;
  polar?: { incrementRad: number; additionalAnglesRad?: readonly number[] };
  grid?: { spacingX: number; spacingY: number; origin?: CadPoint2 };
  aperture?: number;
}

export interface PrecisionRequest {
  basePoint: CadPoint2;
  cursorPoint: CadPoint2;
  input?: string | CadPrecisionInput;
  modes?: PrecisionModes;
  objectSnapCandidates?: readonly PrecisionCandidate[];
  trackingCandidates?: readonly PrecisionCandidate[];
}

export interface PrecisionResult {
  point: CadPoint2;
  source: "typed-cartesian" | "typed-polar" | "direct-distance" | "osnap" | "otrack" | "grid" | "ortho" | "polar" | "cursor";
  stages: ReadonlyArray<{ stage: string; point: CadPoint2 }>;
  parsedInput?: CadPrecisionInput;
}

/** Converts a CSS-pixel snap aperture into document-space units without rounding. */
export function worldApertureFromCssPixels(aperturePixels: number, worldUnitsPerCssPixel: number): number {
  if (!Number.isFinite(aperturePixels) || aperturePixels < 0) {
    throw new TypeError("Snap aperture pixels must be finite and non-negative.");
  }
  if (!Number.isFinite(worldUnitsPerCssPixel) || worldUnitsPerCssPixel <= 0) {
    throw new TypeError("Viewport world units per CSS pixel must be finite and positive.");
  }
  return aperturePixels * worldUnitsPerCssPixel;
}

function finitePoint(point: CadPoint2, label: string): void {
  if (![point.x, point.y].every(Number.isFinite)) throw new TypeError(`${label} must be finite.`);
}

function angleDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function constrainedDirection(base: CadPoint2, cursor: CadPoint2, modes: PrecisionModes): { point: CadPoint2; source: PrecisionResult["source"] } {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { point: { ...cursor }, source: "cursor" };
  const angle = Math.atan2(dy, dx);
  if (modes.ortho) {
    const snapped = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : Math.PI) : (dy >= 0 ? Math.PI / 2 : -Math.PI / 2);
    return { point: { x: base.x + Math.cos(snapped) * distance, y: base.y + Math.sin(snapped) * distance }, source: "ortho" };
  }
  if (modes.polar) {
    const increment = modes.polar.incrementRad;
    if (!Number.isFinite(increment) || increment <= 0 || increment > Math.PI * 2) throw new TypeError("Polar increment must be finite and positive.");
    const multiples = Math.round(angle / increment) * increment;
    const angles = [multiples, ...(modes.polar.additionalAnglesRad ?? [])];
    angles.forEach((candidate) => { if (!Number.isFinite(candidate)) throw new TypeError("Polar angles must be finite."); });
    angles.sort((first, second) => angleDistance(angle, first) - angleDistance(angle, second) || first - second);
    const snapped = angles[0]!;
    return { point: { x: base.x + Math.cos(snapped) * distance, y: base.y + Math.sin(snapped) * distance }, source: "polar" };
  }
  return { point: { ...cursor }, source: "cursor" };
}

function gridPoint(point: CadPoint2, grid: NonNullable<PrecisionModes["grid"]>): CadPoint2 {
  if (![grid.spacingX, grid.spacingY].every((value) => Number.isFinite(value) && value > 0)) throw new TypeError("Grid spacing must be finite and positive.");
  const origin = grid.origin ?? { x: 0, y: 0 };
  finitePoint(origin, "Grid origin");
  return {
    x: origin.x + Math.round((point.x - origin.x) / grid.spacingX) * grid.spacingX,
    y: origin.y + Math.round((point.y - origin.y) / grid.spacingY) * grid.spacingY,
  };
}

function bestCandidate(candidates: readonly PrecisionCandidate[], target: CadPoint2, aperture: number): PrecisionCandidate | null {
  if (!Number.isFinite(aperture) || aperture < 0) throw new TypeError("Snap aperture must be finite and non-negative.");
  return candidates
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.point.x - target.x, candidate.point.y - target.y) }))
    .filter(({ candidate, distance }) => [candidate.point.x, candidate.point.y, candidate.priority, distance].every(Number.isFinite) && distance <= aperture)
    .sort((a, b) => a.candidate.priority - b.candidate.priority || a.distance - b.distance || (a.candidate.key ?? "").localeCompare(b.candidate.key ?? "") || a.candidate.point.x - b.candidate.point.x || a.candidate.point.y - b.candidate.point.y)[0]?.candidate ?? null;
}

/** Deterministic preview/commit pipeline. Explicit Cartesian input bypasses cursor aids. */
export function resolvePrecisionPoint(request: PrecisionRequest): PrecisionResult {
  finitePoint(request.basePoint, "Base point");
  finitePoint(request.cursorPoint, "Cursor point");
  const modes = request.modes ?? {};
  const parsedInput = typeof request.input === "string" ? parseCadPrecisionInput(request.input) : request.input;
  if (parsedInput?.kind === "absolute-cartesian" || parsedInput?.kind === "relative-cartesian"
    || parsedInput?.kind === "absolute-polar" || parsedInput?.kind === "relative-polar") {
    const source = parsedInput.kind.endsWith("polar") ? "typed-polar" : "typed-cartesian";
    return { point: resolveCadPrecisionInput(parsedInput, request.basePoint), source, stages: [], parsedInput };
  }
  if (parsedInput?.kind === "direct-distance" && parsedInput.distance === 0) {
    const point = resolveCadPrecisionInput(parsedInput, request.basePoint);
    return { point, source: "direct-distance", stages: [{ stage: "direct-distance", point }], parsedInput };
  }
  const constrained = constrainedDirection(request.basePoint, request.cursorPoint, modes);
  const stages: Array<{ stage: string; point: CadPoint2 }> = [{ stage: constrained.source, point: constrained.point }];
  let point = parsedInput ? resolveCadPrecisionInput(parsedInput, request.basePoint, constrained.point) : constrained.point;
  let source: PrecisionResult["source"] = parsedInput ? "direct-distance" : constrained.source;
  stages.push({ stage: source, point });
  if (modes.grid) {
    point = gridPoint(point, modes.grid);
    source = "grid";
    stages.push({ stage: "grid", point });
  }
  const aperture = modes.aperture ?? 0;
  const snap = bestCandidate(request.objectSnapCandidates ?? [], point, aperture);
  if (snap) {
    point = { ...snap.point };
    source = "osnap";
    stages.push({ stage: `osnap:${snap.kind}`, point });
  } else {
    const track = bestCandidate(request.trackingCandidates ?? [], point, aperture);
    if (track) {
      point = { ...track.point };
      source = "otrack";
      stages.push({ stage: `otrack:${track.kind}`, point });
    }
  }
  return { point, source, stages, ...(parsedInput ? { parsedInput } : {}) };
}
