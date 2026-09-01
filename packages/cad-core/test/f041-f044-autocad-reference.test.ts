import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCadPrecisionInput, resolveCadPrecisionInput } from "../src/precision-input.js";

interface ReferenceCase {
  id: string;
  input: string;
  base: [number, number];
  direction?: [number, number];
  expected: [number, number];
  autoCadLiveStatus: "PASS" | "NOT_RUN";
  reason?: string;
}

const loadReference = async (): Promise<{ schemaVersion: number; cases: ReferenceCase[] }> => JSON.parse(await readFile(
  new URL("./fixtures/autocad-2024-coordinate-reference.json", import.meta.url),
  "utf8",
));

describe("F-041/F-042/F-044 AutoCAD reference pairing fixture", () => {
  it("maps the four live WCS command-line cases through the shared Kuubik double parser", async () => {
    const reference = await loadReference();
    expect(reference.schemaVersion).toBe(1);
    const live = reference.cases.filter(({ autoCadLiveStatus }) => autoCadLiveStatus === "PASS");
    expect(live.map(({ id }) => id)).toEqual(["absolute-plain", "absolute-hash", "relative-cartesian-near-zero", "relative-polar-negative-angle"]);
    for (const item of live) {
      const point = resolveCadPrecisionInput(parseCadPrecisionInput(item.input), { x: item.base[0], y: item.base[1] });
      expect(point.x, item.id).toBeCloseTo(item.expected[0], 12);
      expect(point.y, item.id).toBeCloseTo(item.expected[1], 12);
    }
  });

  it("keeps direct-distance pairing explicit without upgrading the AutoCAD NOT_RUN", async () => {
    const item = (await loadReference()).cases.find(({ id }) => id === "direct-distance-pointer-direction");
    expect(item).toMatchObject({ autoCadLiveStatus: "NOT_RUN" });
    expect(item?.reason).toMatch(/cannot establish.*pointer direction/iu);
    const point = resolveCadPrecisionInput(
      parseCadPrecisionInput(item!.input),
      { x: item!.base[0], y: item!.base[1] },
      { x: item!.direction![0], y: item!.direction![1] },
    );
    expect(point.x).toBeCloseTo(item!.expected[0], 14);
    expect(point.y).toBeCloseTo(item!.expected[1], 14);
    expect(() => resolveCadPrecisionInput(parseCadPrecisionInput(item!.input), { x: 10, y: -20 }, { x: 10, y: -20 })).toThrow("must not be zero");
  });
});
