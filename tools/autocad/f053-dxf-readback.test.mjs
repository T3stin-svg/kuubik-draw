import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseF053Dxf, validateF053Dxf } from "./f053-dxf-readback.mjs";

const fixturePath = new URL("../../packages/cad-dxf/test/fixtures/synthetic/F-053-units-header.dxf", import.meta.url);
const fixture = async () => readFile(fixturePath);
const matrix = {
  observations: {
    committed: { insunits: 6, lunits: 2, luprec: 8, aunits: 0, auprec: 8, angbase: Math.PI / 3, angdir: 1 },
    geometry: {
      committed: {
        handle: "F53",
        start: [-123456789.12345679, 0.000000123456789, 0],
        end: [987654321.9876543, -0.000000987654321, 0],
      },
    },
  },
};

describe("F-053 independent DXF header read-back", () => {
  it("reads every UNITS header variable and exact double geometry from the synthetic fixture", async () => {
    const parsed = parseF053Dxf(await fixture());
    expect(parsed.header).toEqual({
      $INSUNITS: 6, $LUNITS: 2, $LUPREC: 8, $AUNITS: 0, $AUPREC: 8,
      $ANGBASE: 60, $ANGDIR: 1,
    });
    expect(parsed.lines).toEqual([matrix.observations.geometry.committed]);
    expect(validateF053Dxf(await fixture(), matrix)).toMatchObject({ requiredHeaderVariablesExact: true, geometryCoordinatesWithinEightUlps: true });
  });

  it("mutation-proves duplicate, missing, wrong-code and non-finite header rejection", async () => {
    const source = (await fixture()).toString("utf8");
    const duplicate = source.replace("9\n$LUNITS", "9\n$INSUNITS\n70\n6\n9\n$LUNITS");
    const missing = source.replace("9\n$ANGBASE\n50\n60\n", "");
    const wrongCode = source.replace("$AUPREC\n70\n8", "$AUPREC\n40\n8");
    const nonFinite = source.replace("$LUPREC\n70\n8", "$LUPREC\n70\n1e999");
    expect(() => parseF053Dxf(Buffer.from(duplicate))).toThrow(/repeats \$INSUNITS/u);
    expect(() => parseF053Dxf(Buffer.from(missing))).toThrow(/\$ANGBASE is missing/u);
    expect(() => parseF053Dxf(Buffer.from(wrongCode))).toThrow(/\$AUPREC requires group 70/u);
    expect(() => parseF053Dxf(Buffer.from(nonFinite))).toThrow(/not finite/u);
  });

  it("detects a finite geometry mutant independently of the native matrix", async () => {
    const mutated = (await fixture()).toString("utf8").replace("987654321.9876543", "987654320.9876543");
    expect(validateF053Dxf(Buffer.from(mutated), matrix)).toMatchObject({
      requiredHeaderVariablesExact: true,
      geometryCoordinatesWithinEightUlps: false,
    });
  });
});
