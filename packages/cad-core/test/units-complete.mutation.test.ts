import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import {
  createCadUnitsContract,
  formatCadAngleWithContract,
  normalizeCadUnitsContract,
  planCadUnitsContract,
  resolveCadImportScale,
} from "../src/units.js";

describe("F-053 mutation guards", () => {
  it("kills coordinate-rescale and silent reinterpretation mutations", () => {
    const document = createEmptyDocument({ documentId: "units-mutation" });
    document.entities = [{ kind: "circle", handle: "A", layerId: "0", center: { x: 123.456, y: -789.012 }, radius: 42.5 }];
    const before = structuredClone(document.entities);
    const next = normalizeCadUnitsContract({ ...createCadUnitsContract(document.units), drawingUnit: "m", insertionUnit: "m" });
    expect(() => planCadUnitsContract(document, next)).toThrow("preserve-coordinates");
    const planned = planCadUnitsContract(document, next, { existingGeometryPolicy: "preserve-coordinates" });
    expect(planned.document.entities).toEqual(before);
    expect(planned.coordinateScale).toBe(1);
  });

  it("kills inverted import scale and ignored clockwise/base-angle mutations", () => {
    expect(resolveCadImportScale("m", "mm").factor).toBe(1000);
    const units = normalizeCadUnitsContract({
      ...createCadUnitsContract({ linear: "mm", displayPrecision: 3, angularPrecision: 3 }),
      clockwise: true, baseAngleRad: Math.PI / 2,
    });
    expect(formatCadAngleWithContract(0, units)).toBe("90.000");
    expect(formatCadAngleWithContract(Math.PI, units)).toBe("270.000");
  });
});
