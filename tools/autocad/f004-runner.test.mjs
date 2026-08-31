import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("F-004 AutoCAD runner contract", () => {
  it("pins all variants, exact entity read-back and atomic history markers", async () => {
    const runner = await readFile(new URL("./run-f004.mjs", import.meta.url), "utf8");
    const script = await readFile(new URL("../../parity/autocad/F-004.scr", import.meta.url), "utf8");
    expect(runner).toContain('variants: ["Center-Radius", "Center-Diameter", "2P", "3P", "TTR", "TTT"]');
    expect(runner).toContain('circle.layer !== "CIRCLE_TEST"');
    expect(runner).toContain("result.history.before !== 6 || result.history.undo !== 5 || result.history.redo !== 6");
    expect(runner).toContain("const tttRadius = 20 - 10 * Math.SQRT2");
    expect(runner).toContain("fixtureSha256");
    expect(runner).toContain("scriptSha256");
    expect(script).toContain('(command "_.CIRCLE" "_TTR"');
    expect(script).toContain('(command "_.CIRCLE" "_3P" "_TAN"');
    expect(script).toContain('(command "_.UNDO" "1")');
    expect(script).toContain('(command "_.REDO")');
    expect(script).toContain("(assoc 5 data)");
    expect(script).toContain("(assoc 8 data)");
    expect(script).toContain("(assoc 10 data)");
    expect(script).toContain("(assoc 40 data)");
  });
});
