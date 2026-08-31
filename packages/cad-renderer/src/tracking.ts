import type { CadPoint2 } from "@kuubik/cad-schema";

export interface CadTrackingPoint {
  key: string;
  point: CadPoint2;
  acquiredAt: number;
}

export interface CadTrackingCandidate {
  id: string;
  kind: "otrack";
  mode: "polar-extension" | "intersection";
  point: CadPoint2;
  priority: number;
  key: string;
  acquiredKeys: string[];
  angleRad?: number;
}

export interface CadTrackingMutationReadback {
  changed: boolean;
  acquired: CadTrackingPoint[];
}

function normalizedLineAngle(angle: number): number {
  if (!Number.isFinite(angle)) throw new TypeError("Tracking angles must be finite.");
  const halfTurn = Math.PI;
  const normalized = ((angle % halfTurn) + halfTurn) % halfTurn;
  return Math.abs(normalized - halfTurn) <= 1e-14 || Math.abs(normalized) <= 1e-14 ? 0 : normalized;
}

function angleKey(angle: number): string {
  return normalizedLineAngle(angle).toPrecision(17);
}

export class CadObjectTrack {
  readonly #points = new Map<string, CadTrackingPoint>();

  acquire(key: string, point: CadPoint2, acquiredAt = Date.now()): CadTrackingPoint {
    if (!key || ![point.x, point.y, acquiredAt].every(Number.isFinite)) throw new TypeError("Tracking acquisition must have a key and finite values.");
    this.#points.delete(key);
    const acquired = { key, point: { ...point }, acquiredAt };
    this.#points.set(key, acquired);
    return structuredClone(acquired);
  }

  release(key: string): boolean {
    return this.#points.delete(key);
  }

  releaseReadback(key: string): CadTrackingMutationReadback {
    return { changed: this.release(key), acquired: this.acquired };
  }

  clear(): void {
    this.#points.clear();
  }

  clearReadback(): CadTrackingMutationReadback {
    const changed = this.#points.size > 0;
    this.clear();
    return { changed, acquired: [] };
  }

  get acquired(): CadTrackingPoint[] {
    return [...this.#points.values()].sort((a, b) => a.key.localeCompare(b.key)).map((item) => structuredClone(item));
  }

  candidates(cursor: CadPoint2, aperture: number, polarAnglesRad: readonly number[] = [0, Math.PI / 2]): CadTrackingCandidate[] {
    if (![cursor.x, cursor.y, aperture].every(Number.isFinite) || aperture < 0) throw new TypeError("Tracking cursor/aperture must be finite and aperture non-negative.");
    const result: CadTrackingCandidate[] = [];
    const angles = [...new Map(polarAnglesRad.map((angle) => {
      const normalized = normalizedLineAngle(angle);
      return [angleKey(normalized), normalized] as const;
    })).values()].sort((a, b) => a - b);
    const lines = this.acquired.flatMap((item) => angles.map((angle) => ({
      item, angle, lineId: `${item.key}:${angleKey(angle)}`, direction: { x: Math.cos(angle), y: Math.sin(angle) },
    }))).sort((a, b) => a.lineId.localeCompare(b.lineId));
    for (const line of lines) {
      const relative = { x: cursor.x - line.item.point.x, y: cursor.y - line.item.point.y };
      const scalar = relative.x * line.direction.x + relative.y * line.direction.y;
      const projected = { x: line.item.point.x + scalar * line.direction.x, y: line.item.point.y + scalar * line.direction.y };
      if (Math.hypot(projected.x - cursor.x, projected.y - cursor.y) <= aperture) {
        const id = `otrack:polar:${line.lineId}`;
        result.push({ id, kind: "otrack", mode: "polar-extension", point: projected, priority: 100, key: id, acquiredKeys: [line.item.key], angleRad: line.angle });
      }
    }
    for (let first = 0; first < lines.length; first += 1) {
      for (let second = first + 1; second < lines.length; second += 1) {
        const a = lines[first]!;
        const b = lines[second]!;
        if (a.item.key === b.item.key) continue;
        const determinant = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
        if (Math.abs(determinant) <= 1e-12) continue;
        const delta = { x: b.item.point.x - a.item.point.x, y: b.item.point.y - a.item.point.y };
        const scalar = (delta.x * b.direction.y - delta.y * b.direction.x) / determinant;
        const point = { x: a.item.point.x + scalar * a.direction.x, y: a.item.point.y + scalar * a.direction.y };
        if (Math.hypot(point.x - cursor.x, point.y - cursor.y) <= aperture) {
          const lineIds = [a.lineId, b.lineId].sort();
          const id = `otrack:intersection:${lineIds.join("|")}`;
          result.push({ id, kind: "otrack", mode: "intersection", point, priority: 90, key: id, acquiredKeys: [a.item.key, b.item.key].sort() });
        }
      }
    }
    return [...new Map(result.map((candidate) => [candidate.id, candidate])).values()]
      .sort((a, b) => a.priority - b.priority || Math.hypot(a.point.x - cursor.x, a.point.y - cursor.y) - Math.hypot(b.point.x - cursor.x, b.point.y - cursor.y) || a.id.localeCompare(b.id));
  }
}
