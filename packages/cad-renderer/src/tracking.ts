import type { CadPoint2 } from "@kuubik/cad-schema";

export interface CadTrackingPoint {
  key: string;
  point: CadPoint2;
  acquiredAt: number;
}

export interface CadTrackingCandidate {
  kind: "otrack";
  point: CadPoint2;
  priority: number;
  key: string;
  acquiredKeys: string[];
}

export class CadObjectTrack {
  readonly #points = new Map<string, CadTrackingPoint>();

  acquire(key: string, point: CadPoint2, acquiredAt = Date.now()): void {
    if (!key || ![point.x, point.y, acquiredAt].every(Number.isFinite)) throw new TypeError("Tracking acquisition must have a key and finite values.");
    this.#points.delete(key);
    this.#points.set(key, { key, point: { ...point }, acquiredAt });
  }

  release(key: string): boolean {
    return this.#points.delete(key);
  }

  clear(): void {
    this.#points.clear();
  }

  get acquired(): CadTrackingPoint[] {
    return [...this.#points.values()].map((item) => structuredClone(item));
  }

  candidates(cursor: CadPoint2, aperture: number, polarAnglesRad: readonly number[] = [0, Math.PI / 2]): CadTrackingCandidate[] {
    if (![cursor.x, cursor.y, aperture].every(Number.isFinite) || aperture < 0) throw new TypeError("Tracking cursor/aperture must be finite and aperture non-negative.");
    const result: CadTrackingCandidate[] = [];
    const lines = this.acquired.flatMap((item) => polarAnglesRad.map((angle, index) => {
      if (!Number.isFinite(angle)) throw new TypeError("Tracking angles must be finite.");
      return { item, index, direction: { x: Math.cos(angle), y: Math.sin(angle) } };
    }));
    for (const line of lines) {
      const relative = { x: cursor.x - line.item.point.x, y: cursor.y - line.item.point.y };
      const scalar = relative.x * line.direction.x + relative.y * line.direction.y;
      const projected = { x: line.item.point.x + scalar * line.direction.x, y: line.item.point.y + scalar * line.direction.y };
      if (Math.hypot(projected.x - cursor.x, projected.y - cursor.y) <= aperture) {
        result.push({ kind: "otrack", point: projected, priority: 100, key: `${line.item.key}:${line.index}`, acquiredKeys: [line.item.key] });
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
        if (Math.hypot(point.x - cursor.x, point.y - cursor.y) <= aperture) result.push({ kind: "otrack", point, priority: 90, key: `${a.item.key}:${a.index}|${b.item.key}:${b.index}`, acquiredKeys: [a.item.key, b.item.key].sort() });
      }
    }
    return result.sort((a, b) => a.priority - b.priority || Math.hypot(a.point.x - cursor.x, a.point.y - cursor.y) - Math.hypot(b.point.x - cursor.x, b.point.y - cursor.y) || a.key.localeCompare(b.key));
  }
}
