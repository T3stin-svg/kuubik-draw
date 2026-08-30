import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("F-109 desktop native closure stabilization", () => {
  it("requires two consecutive exact-golden post-read snapshots and commits only that Closed value", async () => {
    const source = await readFile(new URL("./f109-desktop-readback.ps1", import.meta.url), "utf8");
    expect(source).toContain("[Parameter(Mandatory = $true)][string]$ExpectedPath");
    expect(source).toContain("Test-ExactPolylineClosureSnapshot $currentSnapshot $expectedPolylineClosures");
    expect(source).toContain("if ($currentMatchesExpected -and $null -ne $previousExpectedSnapshot)");
    expect(source).toContain("$previousExpectedSnapshot = if ($currentMatchesExpected) { $currentSnapshot } else { $null }");
    expect(source).toContain("for ($closurePass = 0; $closurePass -lt 8; $closurePass += 1)");
    expect(source).toContain("polylineClosurePasses = [object[]]$polylineClosurePasses.ToArray()");
    expect(source).not.toContain("polylineClosurePasses = @($polylineClosurePasses)");
    expect(source).toContain("$polylineClosuresAfterFirstRegen = [ordered]@{}");
    expect(source).toContain("$polylineClosuresAfterRegen = [ordered]@{}");
    expect(source).toContain("$nativeRecords[$handle].closed = [bool]$polylineClosuresAfterRegen[$handle]");
    expect(source).toMatch(/polylineClosureStable\s*=\s*\$polylineClosureStable\s+-and\s+\(Test-ExactPolylineClosureSnapshot \$polylineClosuresAfterFirstRegen \$expectedPolylineClosures\)\s+-and\s+\(Test-ExactPolylineClosureSnapshot \$polylineClosuresAfterRegen \$expectedPolylineClosures\)/u);
    expect((source.match(/Invoke-ComRetry \{ \$document\.Regen\(1\) \} \| Out-Null/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("passes the fixed expected manifest and rejects non-golden stable closures in the Node runner", async () => {
    for (const runner of ["run-f109-desktop.mjs", "run-f111-desktop.mjs"]) {
      const source = await readFile(new URL(`./${runner}`, import.meta.url), "utf8");
      expect(source).toContain('"-ExpectedPath", expectedPath');
      expect(source).toContain("JSON.stringify(matrix.polylineClosuresAfterFirstRegen) !== JSON.stringify(expected.nativePolylineClosedByHandle)");
      expect(source).toContain("JSON.stringify(matrix.polylineClosuresAfterRegen) !== JSON.stringify(expected.nativePolylineClosedByHandle)");
    }
  });
});
