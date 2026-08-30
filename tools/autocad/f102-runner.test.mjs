import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-102 native page-setup fixture ratchet", () => {
  it("verifies the baseline Layout plot type after AutoCAD regeneration", async () => {
    const source = await readFile(new URL("f102-page-setup.ps1", import.meta.url), "utf8");
    expect(source).toMatch(/Wait-ViewportGeometry[\s\S]*\$paper\.PlotType = 5[\s\S]*\$scratch\.Regen\(1\)[\s\S]*if \(\[int\]\$paper\.PlotType -ne 5\)/u);
    expect(source).toContain("AutoCAD did not retain the baseline Layout plot type.");
    expect(source).toMatch(/\$baseline = Get-PlotSnapshot/u);
  });
});
