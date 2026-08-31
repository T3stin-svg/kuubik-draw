import { describe, expect, it } from "vitest";
import { assertKDrawDocumentV1 } from "@kuubik/cad-schema";
import { createEmptyDocument } from "../src/document.js";
import {
  CAD_UNITS_CONTRACT_EXTENSION_KEY,
  createCadUnitsContract,
  formatCadAngleWithContract,
  formatCadLengthWithContract,
  normalizeCadUnitsContract,
  parseCadAngleWithContract,
  parseCadLengthWithContract,
  planCadUnitsContract,
  readCadUnitsContract,
  resolveCadImportScale,
  resolveCadInsertionScale,
  type CadAngleFormat,
  type CadLengthFormat,
  type CadUnitsContractV1,
} from "../src/units.js";

function contract(overrides: Partial<CadUnitsContractV1> = {}): CadUnitsContractV1 {
  return normalizeCadUnitsContract({
    ...createCadUnitsContract({ linear: "mm", displayPrecision: 3, angularPrecision: 3 }),
    ...overrides,
  });
}

describe("F-053 complete length formatting", () => {
  const cases: Array<[CadLengthFormat, number, string, Partial<CadUnitsContractV1>]> = [
    ["decimal", -1234.5678, "-1234.568", {}],
    ["scientific", 1234.5678, "1.235e+3", {}],
    ["engineering", 381, "1'-3.00\"", { lengthPrecision: 2 }],
    ["architectural", 393.7, "1'-3 1/2\"", { lengthPrecision: 4 }],
    ["fractional", 393.7, "15 1/2\"", { lengthPrecision: 4 }],
  ];

  it.each(cases)("formats and parses %s", (lengthFormat, value, expected, overrides) => {
    const units = contract({ lengthFormat, ...overrides });
    const text = formatCadLengthWithContract(value, units);
    expect(text).toBe(expected);
    expect(formatCadLengthWithContract(parseCadLengthWithContract(text, units), units)).toBe(text);
  });

  it("uses locale commas without making engineering separators ambiguous", () => {
    const decimal = contract({ decimalSeparator: ",", lengthFormat: "decimal", lengthPrecision: 2 });
    expect(formatCadLengthWithContract(12.5, decimal)).toBe("12,50");
    expect(parseCadLengthWithContract("12,50", decimal)).toBe(12.5);
    const engineering = contract({ decimalSeparator: ",", lengthFormat: "engineering", lengthPrecision: 2 });
    expect(formatCadLengthWithContract(393.7, engineering)).toBe("1'-3,50\"");
    expect(parseCadLengthWithContract("1'-3,50\"", engineering)).toBeCloseTo(393.7, 12);
  });

  it("carries rounded inches into feet and rejects malformed fractions", () => {
    const engineering = contract({ drawingUnit: "in", insertionUnit: "in", lengthFormat: "engineering", lengthPrecision: 2 });
    expect(formatCadLengthWithContract(11.999, engineering)).toBe("1'-0.00\"");
    const architectural = contract({ drawingUnit: "in", insertionUnit: "in", lengthFormat: "architectural", lengthPrecision: 3 });
    expect(() => parseCadLengthWithContract("0'-3 1/3\"", architectural)).toThrow("power-of-two");
    expect(() => parseCadLengthWithContract("0'-12\"", architectural)).toThrow("[0, 12)");
  });
});

describe("F-053 complete angle formatting", () => {
  const cases: Array<[CadAngleFormat, number, string, Partial<CadUnitsContractV1>]> = [
    ["decimal-degrees", Math.PI / 3, "60.000", {}],
    ["dms", Math.PI * 60.5 / 180, "60°30'00.00\"", { anglePrecision: 2 }],
    ["grads", Math.PI / 2, "100.000g", {}],
    ["radians", Math.PI / 2, "1.571r", {}],
    ["surveyor", Math.PI / 4, "N 45.000° E", {}],
    ["surveyor", Math.PI * 3 / 4, "N 45.000° W", {}],
    ["surveyor", Math.PI * 5 / 4, "S 45.000° W", {}],
    ["surveyor", Math.PI * 7 / 4, "S 45.000° E", {}],
  ];

  it.each(cases)("formats and parses %s", (angleFormat, value, expected, overrides) => {
    const units = contract({ angleFormat, ...overrides });
    const text = formatCadAngleWithContract(value, units);
    expect(text).toBe(expected);
    expect(formatCadAngleWithContract(parseCadAngleWithContract(text, units), units)).toBe(text);
  });

  it("applies clockwise and base-angle transforms symmetrically", () => {
    const units = contract({ clockwise: true, baseAngleRad: Math.PI / 2, angleFormat: "decimal-degrees", anglePrecision: 4 });
    expect(formatCadAngleWithContract(0, units)).toBe("90.0000");
    expect(parseCadAngleWithContract("90.0000", units)).toBe(0);
    const comma = contract({ angleFormat: "dms", anglePrecision: 2, decimalSeparator: "," });
    expect(formatCadAngleWithContract(Math.PI / 6, comma)).toBe("30°00'00,00\"");
    expect(parseCadAngleWithContract("30°00'00,00\"", comma)).toBeCloseTo(Math.PI / 6, 14);
  });

  it("canonicalizes values that round across a full-turn or surveyor axis", () => {
    for (const angleFormat of ["decimal-degrees", "grads", "radians", "surveyor"] as const) {
      const units = contract({ angleFormat, anglePrecision: 2 });
      const text = formatCadAngleWithContract(Math.PI * 2 - 1e-8, units);
      expect(formatCadAngleWithContract(parseCadAngleWithContract(text, units), units)).toBe(text);
    }
  });
});

describe("F-053 document and import contracts", () => {
  it("persists exact serialization read-back without changing existing coordinates", () => {
    const document = createEmptyDocument({ documentId: "units-readback" });
    document.entities = [{ kind: "line", handle: "A", layerId: "0", start: { x: 1.25, y: -2.5 }, end: { x: 3.75, y: 4.5 } }];
    const geometry = JSON.stringify({ entities: document.entities, blocks: document.blocks, layouts: document.layouts });
    const next = contract({
      drawingUnit: "m", insertionUnit: "cm", lengthFormat: "scientific", lengthPrecision: 6,
      angleFormat: "radians", anglePrecision: 7, decimalSeparator: ",", clockwise: true, baseAngleRad: 0.25,
    });
    expect(() => planCadUnitsContract(document, next)).toThrow("preserve-coordinates");
    const readback = planCadUnitsContract(document, next, { existingGeometryPolicy: "preserve-coordinates" });
    expect(readback).toMatchObject({ current: next, coordinatesPreserved: true, coordinateScale: 1 });
    expect(JSON.stringify({ entities: readback.document.entities, blocks: readback.document.blocks, layouts: readback.document.layouts })).toBe(geometry);
    expect(document.units.linear).toBe("mm");

    const serialized = JSON.stringify(readback.document);
    const reopened = JSON.parse(serialized);
    assertKDrawDocumentV1(reopened);
    expect(readCadUnitsContract(reopened)).toEqual(next);
    expect(reopened.metadata.extensions[CAD_UNITS_CONTRACT_EXTENSION_KEY]).toEqual(next);
  });

  it("keeps legacy fields and extension fail-closed when serialized state disagrees", () => {
    const document = createEmptyDocument({ documentId: "units-mismatch" });
    document.metadata.extensions = { [CAD_UNITS_CONTRACT_EXTENSION_KEY]: contract({ lengthPrecision: 2 }) };
    expect(() => readCadUnitsContract(document)).toThrow("disagrees");
    expect(readCadUnitsContract(createEmptyDocument({ documentId: "units-fallback" }))).toEqual(createCadUnitsContract({ linear: "mm", displayPrecision: 4, angularPrecision: 6 }));
  });

  it("resolves insertion/import scale or refuses ambiguous unitless conversion", () => {
    expect(resolveCadImportScale("m", "mm")).toEqual({ sourceUnit: "m", targetUnit: "mm", factor: 1000, source: "physical-conversion" });
    expect(resolveCadImportScale("mm", "m")).toEqual({ sourceUnit: "mm", targetUnit: "m", factor: 0.001, source: "physical-conversion" });
    expect(resolveCadImportScale("cm", "cm")).toEqual({ sourceUnit: "cm", targetUnit: "cm", factor: 1, source: "same-unit" });
    expect(() => resolveCadImportScale("unitless", "mm")).toThrow("explicit positive scale");
    expect(resolveCadImportScale("unitless", "mm", 25.4)).toEqual({ sourceUnit: "unitless", targetUnit: "mm", factor: 25.4, source: "explicit-scale" });
    expect(resolveCadInsertionScale(undefined, contract({ drawingUnit: "mm", insertionUnit: "m" }))).toMatchObject({ factor: 1000, sourceUnit: "m" });
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => resolveCadImportScale("m", "mm", value)).toThrow();
  });
});
