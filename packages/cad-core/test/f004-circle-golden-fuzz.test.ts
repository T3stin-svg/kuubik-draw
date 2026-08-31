import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CircleCommandInputError,
  prepareCompleteCircleCommand,
  type CompleteCircleConstruction,
} from "../src/circle-command.js";

interface CircleGolden {
  schemaVersion: number;
  rowId: string;
  cases: Array<{
    name: string;
    construction: CompleteCircleConstruction;
    expected: { center: { x: number; y: number }; radius: number };
  }>;
}

describe("F-004 versioned golden and malformed-input fuzz", () => {
  it("matches the versioned Center/2P/3P golden", () => {
    const golden = JSON.parse(readFileSync(new URL("./f004-circle.golden.json", import.meta.url), "utf8")) as CircleGolden;
    expect(golden).toMatchObject({ schemaVersion: 1, rowId: "F-004" });
    for (const [index, entry] of golden.cases.entries()) {
      const prepared = prepareCompleteCircleCommand({
        command: "CIRCLE", handle: `G${index}`, layerId: "0", construction: entry.construction,
      });
      expect(prepared.entity.center.x, entry.name).toBeCloseTo(entry.expected.center.x, 12);
      expect(prepared.entity.center.y, entry.name).toBeCloseTo(entry.expected.center.y, 12);
      expect(prepared.entity.radius, entry.name).toBeCloseTo(entry.expected.radius, 12);
    }
  });

  it("fails closed for every non-finite coordinate/radius mutation without returning changes", () => {
    const invalid = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const [index, value] of invalid.entries()) {
      const attempts = [
        () => prepareCompleteCircleCommand({ command: "CIRCLE", handle: `F${index}A`, layerId: "0", construction: { mode: "center-radius", center: { x: value, y: 0 }, radius: 1 } }),
        () => prepareCompleteCircleCommand({ command: "CIRCLE", handle: `F${index}B`, layerId: "0", construction: { mode: "center-radius", center: { x: 0, y: 0 }, radius: value } }),
        () => prepareCompleteCircleCommand({ command: "CIRCLE", handle: `F${index}C`, layerId: "0", construction: { mode: "2p", first: { x: 0, y: 0 }, second: { x: value, y: 1 } } }),
        () => prepareCompleteCircleCommand({ command: "CIRCLE", handle: `F${index}D`, layerId: "0", construction: { mode: "3p", first: { x: 1, y: 0 }, second: { x: 0, y: 1 }, third: { x: value, y: 0 } } }),
        () => prepareCompleteCircleCommand({ command: "CIRCLE", handle: `F${index}E`, layerId: "0", construction: { mode: "ttr", first: { kind: "line", start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }, second: { kind: "circle", center: { x: value, y: 0 }, radius: 2 }, radius: 1 } }),
      ];
      for (const attempt of attempts) expect(attempt).toThrow(CircleCommandInputError);
    }
  });
});
