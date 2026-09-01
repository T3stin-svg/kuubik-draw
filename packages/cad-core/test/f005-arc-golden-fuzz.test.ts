import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ArcCommandInputError,
  prepareCompleteArcCommand,
  type CompleteArcConstruction,
} from "../src/arc-command.js";

interface ArcGolden {
  schemaVersion: number;
  rowId: string;
  cases: Array<{
    name: string;
    construction: CompleteArcConstruction;
    expected: { center: { x: number; y: number }; radius: number; sweepRad: number; counterClockwise: boolean };
  }>;
}

describe("F-005 versioned golden and malformed-input fuzz", () => {
  it("matches all ten AutoCAD ARC construction families", () => {
    const golden = JSON.parse(readFileSync(new URL("./f005-arc.golden.json", import.meta.url), "utf8")) as ArcGolden;
    expect(golden).toMatchObject({ schemaVersion: 1, rowId: "F-005" });
    golden.cases.forEach((entry, index) => {
      const prepared = prepareCompleteArcCommand({ command: "ARC", handle: `G${index}`, layerId: "0", construction: entry.construction });
      expect(prepared.selected.center.x, entry.name).toBeCloseTo(entry.expected.center.x, 10);
      expect(prepared.selected.center.y, entry.name).toBeCloseTo(entry.expected.center.y, 10);
      expect(prepared.selected.radius, entry.name).toBeCloseTo(entry.expected.radius, 10);
      expect(prepared.selected.sweepRad, entry.name).toBeCloseTo(entry.expected.sweepRad, 10);
      expect(prepared.selected.counterClockwise, entry.name).toBe(entry.expected.counterClockwise);
    });
  });

  it("toggles signed angle direction with Ctrl without changing sweep magnitude", () => {
    for (const [includedAngleRad, clockwiseCtrl, expectedCounterClockwise] of [
      [Math.PI / 3, false, true],
      [-Math.PI / 3, false, false],
      [Math.PI / 3, true, false],
      [-Math.PI / 3, true, true],
    ] as const) {
      const prepared = prepareCompleteArcCommand({
        command: "ARC", handle: `${includedAngleRad}:${clockwiseCtrl}`, layerId: "0",
        construction: { mode: "start-center-angle", start: { x: 10, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad, clockwiseCtrl },
      });
      expect(prepared.entity.counterClockwise).toBe(expectedCounterClockwise);
      expect(prepared.selected.sweepRad).toBeCloseTo(Math.PI / 3, 12);
    }
  });

  it("fails closed for non-finite point, angle, tangent, length and radius mutations", () => {
    for (const [index, value] of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].entries()) {
      const attempts = [
        () => prepareCompleteArcCommand({ command: "ARC", handle: `F${index}A`, layerId: "0", construction: { mode: "3p", start: { x: value, y: 0 }, point: { x: 0, y: 1 }, end: { x: -1, y: 0 } } }),
        () => prepareCompleteArcCommand({ command: "ARC", handle: `F${index}B`, layerId: "0", construction: { mode: "start-center-angle", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, includedAngleRad: value } }),
        () => prepareCompleteArcCommand({ command: "ARC", handle: `F${index}C`, layerId: "0", construction: { mode: "start-end-direction", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, tangentDirectionRad: value } }),
        () => prepareCompleteArcCommand({ command: "ARC", handle: `F${index}D`, layerId: "0", construction: { mode: "start-center-length", start: { x: 1, y: 0 }, center: { x: 0, y: 0 }, chordLength: value } }),
        () => prepareCompleteArcCommand({ command: "ARC", handle: `F${index}E`, layerId: "0", construction: { mode: "start-end-radius", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, radius: value } }),
      ];
      attempts.forEach((attempt) => expect(attempt).toThrow(ArcCommandInputError));
    }
  });
});
