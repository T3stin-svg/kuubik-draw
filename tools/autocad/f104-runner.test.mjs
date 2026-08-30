import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("F-104 native viewport stabilization", () => {
  it("requires exact locked, displayed and clip state before capturing the pre-save snapshot", async () => {
    const source = await readFile(new URL("./f104-vector-output.ps1", import.meta.url), "utf8");
    expect(source).toContain("$firstSnapshot.displayLocked -and $secondSnapshot.displayLocked");
    expect(source).toContain("$firstSnapshot.viewportOn -and $secondSnapshot.viewportOn");
    expect(source).toContain("-and -not $firstSnapshot.clipped -and $secondSnapshot.clipped");
    expect(source).toMatch(/\$beforeSave\s*=\s*Get-StableF104LayoutSnapshot/u);
    expect(source).toContain("function Get-LayoutBlockEntities");
    expect(source).toContain("$block.Item($index)");
    expect(source).not.toContain("$Layout.Block | Where-Object");
  });
});
