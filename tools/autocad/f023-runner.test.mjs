import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-023 AutoCAD EXTEND runner ratchet", () => {
  it("preserves single-shot COM ownership and authenticated cleanup", async () => {
    const matrix = await source("f023-standard-matrix.ps1");
    const runner = await source("run-f023.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toMatch(/if\(\$acad -and -not\$owned\)[\s\S]*GetWindowThreadProcessId[\s\S]*Write-OwnedPidSidecar/gu);
    expect(matrix).toMatch(/if\(\$owned -and \$acad\)[^{]*\{[^}]*\$acad\.Quit\(\)/gu);
    expect(runner).toContain("timedOut = true");
    expect(runner).toContain('execFileSync("taskkill.exe"');
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(sidecar, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toMatch(/finally\s*\{[\s\S]*await ownedSidecar\(\)[\s\S]*await terminate\(sidecar\)[\s\S]*await rm\(tempRoot, \{ recursive: true, force: true \}\)/u);
  });

  it("rejects transient spline metadata until the exact native topology stabilizes", async () => {
    const matrix = await source("f023-standard-matrix.ps1");
    expect(matrix).toContain("function Wait-ForExactModelSpaceCount");
    expect(matrix).toContain("Wait-ForExactModelSpaceCount $splineDocument 2 'F-023 rational SPLINE fixture'");
    expect(matrix).toMatch(/Wait-ForExactModelSpaceCount[\s\S]*\$Document\.Regen\(1\)[\s\S]*ModelSpace\.Count[\s\S]*-eq \$ExpectedCount/gu);
    expect(matrix).toContain("function Get-StableSplineStates");
    expect(matrix).toContain("$rationalBefore=@(Get-StableSplineStates $splineDocument 4 8)");
    expect(matrix).toContain("$rationalAfter=@(Get-StableSplineStates $splineDocument 7 11)");
    expect(matrix).toMatch(/Get-StableSplineStates[\s\S]*\$Document\.Regen\(1\)[\s\S]*details\.degree -eq 3[\s\S]*ExpectedControlPointCount[\s\S]*ExpectedKnotCount/gu);
  });
});
