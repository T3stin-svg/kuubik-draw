import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-020 native MIRROR read-back ratchet", () => {
  it("requires non-empty handles and independently resolves the resulting entity", async () => {
    const matrix = await readFile(new URL("f020-standard-matrix.ps1", import.meta.url), "utf8");
    expect(matrix).toContain("function Get-EntityByHandle");
    expect(matrix).toContain("$hatchHandle = Get-ComRequiredString");
    expect(matrix).toContain("$blockHandle = Get-ComRequiredString");
    expect(matrix).toContain("$entities.hatch = Get-EntityByHandle $scratch $hatchHandle");
    expect(matrix).toContain("$entities.blockRef = Get-EntityByHandle $scratch $blockHandle");
    expect(matrix).toContain("$minimum.Count -ge 2 -and $maximum.Count -ge 2");
  });
});
