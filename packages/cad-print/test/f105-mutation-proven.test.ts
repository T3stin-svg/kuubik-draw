import { describe, expect, it } from "vitest";
import { createF105Document, F105_LAYOUT_IDS } from "../../../parity/fixtures/f105-document.js";
import { exportLayoutsVectorPdf } from "../src/index.js";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("F-105 mutation sensitivity", () => {
  it("changes bytes for order, inclusion and sheet geometry while remaining clone deterministic", () => {
    const document = createF105Document();
    const baseline = exportLayoutsVectorPdf(document, F105_LAYOUT_IDS);
    expect(hex(exportLayoutsVectorPdf(structuredClone(document), F105_LAYOUT_IDS).bytes)).toBe(hex(baseline.bytes));

    const reversed = exportLayoutsVectorPdf(document, [...F105_LAYOUT_IDS].reverse());
    const excluded = exportLayoutsVectorPdf(document, [F105_LAYOUT_IDS[0]]);
    const geometryMutation = structuredClone(document);
    const line = geometryMutation.entities.find((entity) => entity.handle === "30" && entity.kind === "line");
    if (!line || line.kind !== "line") throw new Error("F-105 mutation fixture line is missing.");
    line.end.x += 1000;
    const changed = exportLayoutsVectorPdf(geometryMutation, F105_LAYOUT_IDS);

    expect(hex(reversed.bytes)).not.toBe(hex(baseline.bytes));
    expect(hex(excluded.bytes)).not.toBe(hex(baseline.bytes));
    expect(hex(changed.bytes)).not.toBe(hex(baseline.bytes));
    expect(excluded.pages).toHaveLength(1);
    expect(reversed.pages.map((page) => page.layoutId)).toEqual([...F105_LAYOUT_IDS].reverse());
  });
});
