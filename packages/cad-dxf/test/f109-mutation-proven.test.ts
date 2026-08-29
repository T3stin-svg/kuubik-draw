import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createF109Document } from "../../../parity/fixtures/f109-document.js";
import { exportDxf } from "../src/index.js";
import { normalizeF109HatchTopology } from "../../../tools/parity/f109-semantics.mjs";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function alignedSubclassIsOrdered(text: string): boolean {
  const start = text.indexOf("\r\nDIMENSION\r\n");
  const end = text.indexOf("\r\n  0\r\n", start + 2);
  const record = text.slice(start, end < 0 ? undefined : end);
  const marker = record.indexOf("\r\n100\r\nAcDbAlignedDimension\r\n");
  return marker > 0 && record.indexOf("\r\n 13\r\n") > marker && !record.includes("\r\n 50\r\n");
}

describe("F-109 mutation-proven ratchet", () => {
  it("kills the AutoCAD-rejected aligned DIMENSION subclass-order mutant", () => {
    const baseline = exportDxf(createF109Document()).text;
    expect(alignedSubclassIsOrdered(baseline)).toBe(true);
    const marker = "100\r\nAcDbAlignedDimension\r\n";
    const mutant = baseline.replace(marker, "").replace(" 13\r\n0\r\n", ` 13\r\n0\r\n${marker}`);
    expect(sha256(mutant)).not.toBe(sha256(baseline));
    expect(alignedSubclassIsOrdered(mutant)).toBe(false);
  });

  it("changes exact bytes when layer style or hatch topology mutates", () => {
    const document = createF109Document();
    const baseline = sha256(exportDxf(document).text);
    const layerMutation = structuredClone(document);
    layerMutation.layers.find((layer) => layer.name === "SEINAD")!.appearance!.lineweightMm = 0.7;
    expect(sha256(exportDxf(layerMutation).text)).not.toBe(baseline);
    const baselineHatch = document.entities.find((entity) => entity.kind === "hatch");
    const hatchMutation = structuredClone(document);
    const hatch = hatchMutation.entities.find((entity) => entity.kind === "hatch");
    if (!baselineHatch || baselineHatch.kind !== "hatch" || !hatch || hatch.kind !== "hatch") throw new Error("F-109 hatch fixture is missing.");
    hatch.loops[0]!.vertices[1]!.x += 25;
    expect(sha256(exportDxf(hatchMutation).text)).not.toBe(baseline);
    const toNativeRecord = (value: typeof hatch) => ({
      loops: value.loops.map((loop) => ({ flags: loop.isHole ? 2 : 3, closed: true, vertices: loop.vertices.map((vertex) => [vertex.x, vertex.y, 0]) })),
    });
    expect(normalizeF109HatchTopology(toNativeRecord(baselineHatch))).not.toEqual(normalizeF109HatchTopology(toNativeRecord(hatch)));
  });
});
