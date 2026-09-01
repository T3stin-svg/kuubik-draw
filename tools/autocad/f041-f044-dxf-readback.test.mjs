import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCoordinateDxf, validateCoordinateDxf } from "./f041-f044-dxf-readback.mjs";

const fixturePath = new URL("../../packages/cad-dxf/test/fixtures/synthetic/F-041-F-042-coordinate-entry.dxf", import.meta.url);
const fixture = async () => readFile(fixturePath);
const expected = [
  { objectName: "AcDbLine", handle: "F411", layer: "F041_PLAIN", start: [1.25, -2.5, 0], end: [3.75, -4.125, 0] },
  { objectName: "AcDbLine", handle: "F412", layer: "F041_HASH", start: [10.25, -20.5, 0], end: [30.75, -40.125, 0] },
  { objectName: "AcDbLine", handle: "F421", layer: "F042_REL_CART", start: [-100.5, 200.25, 0], end: [-100.50000012345679, 200.25000098765433, 0] },
  { objectName: "AcDbLine", handle: "F422", layer: "F042_REL_POLAR", start: [500, -500, 0], end: [603.1466428403594, -567.8406133592102, 0] },
  { objectName: "AcDbPolyline", handle: "F423", layer: "F042_PLINE", vertices: [[987.5, 1003.25, 0], [1237.625, 503, 0], [1166.560768490752, 574.064231509248, 0]], closed: false },
];
const matrix = { observations: { coordinateContext: { insunits: 4, lunits: 2, luprec: 8, aunits: 0, auprec: 8, angbase: 0, angdir: 0 }, redone: expected } };

describe("F-041/F-042/F-044 independent DXF read-back", () => {
  it("reads typed LINE/LWPOLYLINE geometry and the coordinate header", async () => {
    const parsed = parseCoordinateDxf(await fixture());
    expect(parsed.header).toEqual({ $INSUNITS: 4, $LUNITS: 2, $LUPREC: 8, $AUNITS: 0, $AUPREC: 8, $ANGBASE: 0, $ANGDIR: 0 });
    expect(parsed.entities).toHaveLength(5);
    expect(validateCoordinateDxf(await fixture(), matrix)).toMatchObject({ requiredHeaderVariablesExact: true, entityCountExact: true, entityCoordinatesWithinEightUlps: true });
  });

  it("mutation-proves duplicate handles, malformed vertices and non-finite values", async () => {
    const source = (await fixture()).toString("utf8");
    const duplicateHandle = source.replace("5\nF412", "5\nF411");
    const missingVertexY = source.replace("10\n1166.560768490752\n20\n574.064231509248", "10\n1166.560768490752");
    const wrongVertexCount = source.replace("90\n3", "90\n4");
    const nonFinite = source.replace("11\n3.75", "11\n1e999");
    expect(() => parseCoordinateDxf(Buffer.from(duplicateHandle))).toThrow(/repeats handle F411/u);
    expect(() => parseCoordinateDxf(Buffer.from(missingVertexY))).toThrow(/lacks group 20/u);
    expect(() => parseCoordinateDxf(Buffer.from(wrongVertexCount))).toThrow(/vertex count disagrees/u);
    expect(() => parseCoordinateDxf(Buffer.from(nonFinite))).toThrow(/not finite/u);
  });

  it("detects finite header, coordinate and entity-count mutants", async () => {
    const source = (await fixture()).toString("utf8");
    expect(validateCoordinateDxf(Buffer.from(source.replace("$LUPREC\n70\n8", "$LUPREC\n70\n7")), matrix).requiredHeaderVariablesExact).toBe(false);
    expect(validateCoordinateDxf(Buffer.from(source.replace("11\n3.75", "11\n3.7501")), matrix).entityCoordinatesWithinEightUlps).toBe(false);
    const missingEntity = source.replace(/0\nLINE\n5\nF412[\s\S]*?31\n0\n(?=0\nLINE\n5\nF421)/u, "");
    expect(validateCoordinateDxf(Buffer.from(missingEntity), matrix)).toMatchObject({ entityCountExact: false, entityCoordinatesWithinEightUlps: false });
  });
});
