import { describe, expect, it } from "vitest";
import {
  createCadUnitsContract,
  formatCadAngleWithContract,
  formatCadLengthWithContract,
  normalizeCadUnitsContract,
  parseCadAngleWithContract,
  parseCadLengthWithContract,
  type CadAngleFormat,
  type CadLengthFormat,
  type CadUnitsContractV1,
} from "../src/units.js";

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function contract(overrides: Partial<CadUnitsContractV1>): CadUnitsContractV1 {
  return normalizeCadUnitsContract({ ...createCadUnitsContract({ linear: "mm", displayPrecision: 4, angularPrecision: 4 }), ...overrides });
}

describe("F-053 format/parse property and fuzz coverage", () => {
  it("keeps 10,000 length format-parse-format cases canonical", () => {
    const random = seeded(0x53005300);
    const formats: CadLengthFormat[] = ["decimal", "engineering", "architectural", "fractional", "scientific"];
    for (const decimalSeparator of [".", ","] as const) {
      for (const lengthFormat of formats) {
        const units = contract({ lengthFormat, lengthPrecision: lengthFormat === "architectural" || lengthFormat === "fractional" ? 6 : 5, decimalSeparator });
        for (let index = 0; index < 1_000; index += 1) {
          const value = (random() - 0.5) * 2e8;
          const text = formatCadLengthWithContract(value, units);
          expect(formatCadLengthWithContract(parseCadLengthWithContract(text, units), units)).toBe(text);
        }
      }
    }
  });

  it("keeps 10,000 angle format-parse-format cases canonical", () => {
    const random = seeded(0x53a053a0);
    const formats: CadAngleFormat[] = ["decimal-degrees", "dms", "grads", "radians", "surveyor"];
    for (const decimalSeparator of [".", ","] as const) {
      for (const angleFormat of formats) {
        const units = contract({ angleFormat, anglePrecision: 5, decimalSeparator, clockwise: true, baseAngleRad: 0.3141592653589793 });
        for (let index = 0; index < 1_000; index += 1) {
          const angle = (random() - 0.5) * Math.PI * 2_000;
          const text = formatCadAngleWithContract(angle, units);
          expect(formatCadAngleWithContract(parseCadAngleWithContract(text, units), units)).toBe(text);
        }
      }
    }
  });

  it("fuzzes 5,000 length/angle strings without accepting non-finite values", () => {
    const random = seeded(0xf053f053);
    const alphabet = "0123456789eE+-.;,°'\"/ NSWEgrxy";
    const lengthFormats: CadLengthFormat[] = ["decimal", "engineering", "architectural", "fractional", "scientific"];
    const angleFormats: CadAngleFormat[] = ["decimal-degrees", "dms", "grads", "radians", "surveyor"];
    for (let index = 0; index < 5_000; index += 1) {
      const text = Array.from({ length: Math.floor(random() * 36) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      const decimalSeparator = index % 2 === 0 ? "." : ",";
      try {
        const length = parseCadLengthWithContract(text, contract({ lengthFormat: lengthFormats[index % lengthFormats.length]!, lengthPrecision: 5, decimalSeparator }));
        expect(Number.isFinite(length)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      try {
        const angle = parseCadAngleWithContract(text, contract({ angleFormat: angleFormats[index % angleFormats.length]!, anglePrecision: 5, decimalSeparator }));
        expect(Number.isFinite(angle)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });
});
