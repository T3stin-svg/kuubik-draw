import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("F-005 AutoCAD runner contract", () => {
  it("pins ten variants, exact ARC fields and atomic history markers", async () => {
    const runner = await readFile(new URL("./run-f005.mjs", import.meta.url), "utf8");
    const script = await readFile(new URL("../../parity/autocad/F-005.scr", import.meta.url), "utf8");
    for (const variant of [
      "3P",
      "Start-Center-End",
      "Start-Center-Angle",
      "Start-Center-Length",
      "Start-End-Angle",
      "Start-End-Direction",
      "Start-End-Radius",
      "Center-Start-End",
      "Center-Start-Angle",
      "Center-Start-Length",
    ]) expect(runner).toContain(`"${variant}"`);
    expect(runner).toContain('arc.layer !== "ARC_TEST"');
    expect(runner).toContain("result.history.before !== 10 || result.history.undo !== 9 || result.history.redo !== 10");
    expect(runner).toContain("fixtureSha256");
    expect(runner).toContain("scriptSha256");
    expect(script).toContain('(command "_.ARC" \'(10 0) \'(0 10) \'(-10 0))');
    expect(script).toContain('"_Center"');
    expect(script).toContain('"_End"');
    expect(script).toContain('"_Angle"');
    expect(script).toContain('"_Direction"');
    expect(script).toContain('"_Radius"');
    expect(script).toContain('"_Length"');
    expect(script).toContain('(command "_.UNDO" "1")');
    expect(script).toContain('(command "_.REDO")');
    expect(script).toContain("(assoc 5 data)");
    expect(script).toContain("(assoc 8 data)");
    expect(script).toContain("(assoc 10 data)");
    expect(script).toContain("(assoc 40 data)");
    expect(script).toContain("(assoc 50 data)");
    expect(script).toContain("(assoc 51 data)");
  });
});
