import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-098 native paper setup read-back ratchet", () => {
  it("requires two exact A3/mm reads and a read-only reopen verification", async () => {
    const matrix = await readFile(new URL("f098-paper-space.ps1", import.meta.url), "utf8");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toContain("function Get-StableA3PaperSnapshot");
    expect(matrix).toMatch(/Get-StableA3PaperSnapshot[\s\S]*consecutiveExactReads[\s\S]*-ge 2/gu);
    expect(matrix).toContain("$beforeSaveReadback = Get-StableA3PaperSnapshot $scratch $true");
    expect(matrix).toContain("$afterReopenReadback = Get-StableA3PaperSnapshot $reopened $false");
    expect(matrix).toContain("$beforeSaveReadback.stable -and $afterReopenReadback.stable");
  });

  it("authenticates executable/start time and restores the exact AutoCAD process set", async () => {
    const runner = await readFile(new URL("run-f098.mjs", import.meta.url), "utf8");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toMatch(/async function terminateOwnedProcess\(ownership\)[\s\S]*identityMatches\(ownership, current\)[\s\S]*process\.kill\(ownership\.processId\)/gu);
    expect(runner).toContain("function newAutomationSidecars()");
    expect(runner).toContain("Get-CimInstance Win32_Process");
    expect(runner).toContain("Name='acad.exe'");
    expect(runner).toContain("/\\/Automation\\s+-Embedding/iu");
    expect(runner).toMatch(/timedOut = true;[\s\S]*taskkill\.exe[\s\S]*\["\/PID", String\(child\.pid\), "\/T", "\/F"\]/gu);
    expect(runner).not.toMatch(/forceTimeout|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/gu);
    expect(runner).toContain("multiple unauthenticated AutoCAD automation processes");
    expect(runner).toContain("JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)");
    expect(runner).toContain("processSetRestored");
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*!await terminateOwnedProcess\(ownership\)[\s\S]*!await restoredProcessSet\(\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/gu);
  });
});
