import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-019 native SCALE read-back ratchet", () => {
  it("rejects transient null bounding boxes instead of indexing them", async () => {
    const matrix = await readFile(new URL("f019-standard-matrix.ps1", import.meta.url), "utf8");
    expect(matrix).toMatch(/function Get-Bounds[\s\S]*\$minimum = \$null; \$maximum = \$null[\s\S]*GetBoundingBox/gu);
    expect(matrix).toContain("$minimum.Count -ge 2 -and $maximum.Count -ge 2");
    expect(matrix).toContain("AutoCAD returned an incomplete bounding box.");
    expect(matrix).not.toMatch(/Invoke-ComRetry \{ \$Entity\.GetBoundingBox\([^\n]+\n\s*return/gu);
  });
});
