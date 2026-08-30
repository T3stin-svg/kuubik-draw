import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-099 native viewport read-back ratchet", () => {
  it("index-reads the layout block and requires two exact viewport snapshots", async () => {
    const matrix = await readFile(new URL("f099-multiple-viewports.ps1", import.meta.url), "utf8");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toContain("function Get-LayoutBlockEntities");
    expect(matrix).toMatch(/Get-LayoutBlockEntities[\s\S]*\$block\.Count[\s\S]*\$block\.Item\(\$index\)/gu);
    expect(matrix).toContain("function Get-StableViewportSnapshot");
    expect(matrix).toMatch(/Get-StableViewportSnapshot[\s\S]*consecutiveExactReads[\s\S]*-ge 2/gu);
    expect(matrix).toContain("$beforeSaveReadback.stable -and $afterReopenReadback.stable -and $afterDeleteReadback.stable");
  });
});
