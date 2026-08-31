import type { CadPoint2 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { prepareCompleteEllipseCommand } from "../src/ellipse-command.js";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function implicitValue(point: CadPoint2, center: CadPoint2, majorAxis: CadPoint2, ratio: number): number {
  const major = Math.hypot(majorAxis.x, majorAxis.y);
  const ux = majorAxis.x / major;
  const uy = majorAxis.y / major;
  const relative = { x: point.x - center.x, y: point.y - center.y };
  const alongMajor = (relative.x * ux + relative.y * uy) / major;
  const alongMinor = (relative.x * -uy + relative.y * ux) / (major * ratio);
  return alongMajor ** 2 + alongMinor ** 2;
}

describe("F-007 ELLIPSE deterministic fuzz", () => {
  it("keeps 256 seeded constructions finite and both requested arc endpoints on the ellipse", () => {
    const random = seeded(0xf0072024);
    for (let index = 0; index < 256; index += 1) {
      const center = { x: (random() - 0.5) * 1e6, y: (random() - 0.5) * 1e6 };
      const firstRadius = 0.1 + random() * 1e5;
      const otherRadius = 0.1 + random() * 1e5;
      const rotation = (random() - 0.5) * Math.PI * 20;
      const axis = { x: firstRadius * Math.cos(rotation), y: firstRadius * Math.sin(rotation) };
      const construction = index % 2 === 0
        ? {
          mode: "axis-endpoints" as const,
          firstAxisEnd: { x: center.x - axis.x, y: center.y - axis.y },
          secondAxisEnd: { x: center.x + axis.x, y: center.y + axis.y },
          otherAxisDistance: otherRadius,
        }
        : {
          mode: "center-major-minor" as const,
          center,
          majorAxisEnd: { x: center.x + axis.x, y: center.y + axis.y },
          minorDistance: Math.min(firstRadius, otherRadius),
        };
      const start = (random() - 0.5) * Math.PI * 40;
      const sweep = 1e-4 + random() * (Math.PI * 2 - 2e-4);
      const prepared = prepareCompleteEllipseCommand({
        command: "ELLIPSE", handle: `FZ${index}`, layerId: "0", construction,
        arc: index % 3 === 0
          ? { mode: "angles", startAngleRad: start, endAngleRad: start + sweep, direction: index % 4 === 0 ? "clockwise" : "counter-clockwise" }
          : { mode: "parameters", startParameter: start, endParameter: start + sweep, direction: index % 4 === 0 ? "clockwise" : "counter-clockwise" },
      });
      expect(Number.isFinite(prepared.entity.center.x)).toBe(true);
      expect(Number.isFinite(prepared.entity.center.y)).toBe(true);
      expect(Number.isFinite(prepared.entity.majorAxis.x)).toBe(true);
      expect(Number.isFinite(prepared.entity.majorAxis.y)).toBe(true);
      expect(prepared.entity.ratio).toBeGreaterThan(0);
      expect(prepared.entity.ratio).toBeLessThanOrEqual(1);
      expect(implicitValue(prepared.normalized.requestedStartPoint, prepared.entity.center, prepared.entity.majorAxis, prepared.entity.ratio)).toBeCloseTo(1, 7);
      expect(implicitValue(prepared.normalized.requestedEndPoint, prepared.entity.center, prepared.entity.majorAxis, prepared.entity.ratio)).toBeCloseTo(1, 7);
    }
  });
});
