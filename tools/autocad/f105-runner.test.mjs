import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-105 AutoCAD batch-publish ratchet", () => {
  it("creates each paper entity once and requires stable exact layout text", async () => {
    const matrix = await readFile(new URL("f105-batch-publish.ps1", import.meta.url), "utf8");
    const runner = await readFile(new URL("run-f105.mjs", import.meta.url), "utf8");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toContain("function Get-StableLayoutSnapshot");
    expect(matrix).toContain("two identical exact read-backs");
    expect(matrix).toContain("Creation is intentionally single-shot");
    expect(matrix.match(/\.Block\.AddText\(/gu)).toHaveLength(2);
    expect(matrix.match(/\.Block\.AddCircle\(/gu)).toHaveLength(1);
    expect(matrix.match(/\.Block\.AddLine\(/gu)).toHaveLength(1);
    expect(matrix).toContain("exactSingleTextPerLayout");
    expect(matrix).toContain("automationProcessIdentity = $automationProcessIdentity");
    expect(matrix).toMatch(/if \(\$owned -and \$acad\)[^{]*\{[^}]*\$acad\.Quit\(\)/gu);
    expect(runner).toContain("function acadProcessIdentities()");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function newAutomationSidecars()");
    expect(runner).toContain("Get-CimInstance Win32_Process");
    expect(runner).toContain("Name='acad.exe'");
    expect(runner).toContain("/\\/Automation\\s+-Embedding/iu");
    expect(runner).toContain("process identity changed");
    expect(runner).toContain("multiple unauthenticated AutoCAD automation processes");
    expect(runner).toContain("JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)");
    expect(runner).toMatch(/timedOut = true;[\s\S]*taskkill\.exe[\s\S]*\["\/PID", String\(running\.pid\), "\/T", "\/F"\]/gu);
    expect(runner).not.toMatch(/let force\b|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/gu);
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*!await terminate\(ownership\)[\s\S]*!await restoredProcessSet\(\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/gu);
  });
});
