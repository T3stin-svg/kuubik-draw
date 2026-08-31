import { describe, expect, it } from "vitest";
import {
  CadPrecisionInputError,
  parseCadPrecisionInput,
  resolveCadPrecisionInput,
} from "../src/precision-input.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe("F-041/F-042/F-044 typed precision golden contract", () => {
  it("parses absolute, relative, polar and direct-distance input into document units", () => {
    expect(parseCadPrecisionInput("#1.25m,-20cm", { documentUnit: "mm" })).toEqual({
      kind: "absolute-cartesian", point: { x: 1250, y: -200 },
    });
    expect(parseCadPrecisionInput("@1,5m;-250,25mm", { documentUnit: "mm", decimalSeparator: "," })).toEqual({
      kind: "relative-cartesian", delta: { x: 1500, y: -250.25 },
    });
    expect(parseCadPrecisionInput("@2m<-90", { documentUnit: "mm" })).toEqual({
      kind: "relative-polar", distance: 2000, angleRad: -Math.PI / 2,
    });
    expect(parseCadPrecisionInput("2ft<3.141592653589793rad", { documentUnit: "mm" })).toEqual({
      kind: "absolute-polar", distance: 609.6, angleRad: Math.PI,
    });
    expect(parseCadPrecisionInput("-2ft", { documentUnit: "mm" })).toEqual({
      kind: "direct-distance", distance: -609.6,
    });
  });

  it("resolves signed and zero distances without rounding or a fake direction", () => {
    expect(resolveCadPrecisionInput({ kind: "direct-distance", distance: 0 }, { x: 12.5, y: -4.25 })).toEqual({ x: 12.5, y: -4.25 });
    expect(resolveCadPrecisionInput({ kind: "direct-distance", distance: -5 }, { x: 1, y: 1 }, { x: 4, y: 5 })).toEqual({ x: -2, y: -3 });
    const polar = resolveCadPrecisionInput(parseCadPrecisionInput("@2<-90"), { x: 10, y: 20 });
    expect(polar.x).toBeCloseTo(10, 14);
    expect(polar.y).toBeCloseTo(18, 14);
    expect(parseCadPrecisionInput("-0")).toEqual({ kind: "direct-distance", distance: 0 });
  });

  it("fails closed on ambiguous locale, mixed units and malformed coordinates", () => {
    expect(() => parseCadPrecisionInput("1,5,2,5", { documentUnit: "mm", decimalSeparator: "," })).toThrow("finite length");
    expect(() => parseCadPrecisionInput("1.5;2.5", { documentUnit: "mm", decimalSeparator: "," })).toThrow("finite length");
    expect(() => parseCadPrecisionInput("10mm", { documentUnit: "unitless" })).toThrow("unitless");
    expect(() => parseCadPrecisionInput("@1<2<3")).toThrow("one distance<angle");
    expect(() => parseCadPrecisionInput("#12")).toThrow("Expected");
  });

  it("round-trips 3,000 seeded dot/comma locale coordinate pairs without precision drift", () => {
    const random = seeded(0x600dcaad);
    for (let index = 0; index < 3_000; index += 1) {
      const x = (random() - 0.5) * 2e9;
      const y = (random() - 0.5) * 2e9;
      const dotX = x.toPrecision(17);
      const dotY = y.toPrecision(17);
      expect(parseCadPrecisionInput(`${dotX},${dotY}`)).toEqual({ kind: "absolute-cartesian", point: { x, y } });
      expect(parseCadPrecisionInput(`${dotX.replace(".", ",")};${dotY.replace(".", ",")}`, { decimalSeparator: "," })).toEqual({
        kind: "absolute-cartesian", point: { x, y },
      });
    }
  });

  it("fuzzes 5,000 arbitrary input strings without accepting non-finite geometry", () => {
    const random = seeded(0xf022f022);
    const alphabet = "0123456789eE+-.;,<>@#mcftradin° xyz";
    for (let index = 0; index < 5_000; index += 1) {
      const source = Array.from({ length: Math.floor(random() * 36) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      try {
        const parsed = parseCadPrecisionInput(source, { documentUnit: "mm", decimalSeparator: index % 2 === 0 ? "." : "," });
        const point = resolveCadPrecisionInput(parsed, { x: 1, y: -1 }, { x: 2, y: 3 });
        expect([point.x, point.y]).toSatisfy((values: number[]) => values.every(Number.isFinite));
      } catch (error) {
        expect(error).toBeInstanceOf(CadPrecisionInputError);
      }
    }
  });
});
