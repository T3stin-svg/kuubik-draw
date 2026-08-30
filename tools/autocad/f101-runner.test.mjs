import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-101 AutoCAD owned-process ratchet", () => {
  it("authenticates the scratch process and preserves the user's original process set", async () => {
    const runner = await readFile(new URL("run-f101.mjs", import.meta.url), "utf8");
    const matrix = await readFile(new URL("f101-viewport-lock.ps1", import.meta.url), "utf8");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toContain("executablePath = $automationExecutablePath");
    expect(matrix).toContain("startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')");
    expect(matrix).toMatch(/if \(\$owned -and \$acad\)[^{]*\{[^}]*\$acad\.Quit\(\)/gu);
    expect(runner).toContain("function acadProcessIdentities()");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toContain("function newAutomationSidecars()");
    expect(runner).toContain("Get-CimInstance Win32_Process");
    expect(runner).toContain("Name='acad.exe'");
    expect(runner).toContain("/\\/Automation\\s+-Embedding/iu");
    expect(runner).toContain("async function terminateOwnedProcess(ownership)");
    expect(runner).toContain("async function restoredProcessSet()");
    expect(runner).toContain("JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)");
    expect(runner).toContain("preExistingProcessIds.has(sidecar.processId)");
    expect(runner).toContain("process identity changed");
    expect(runner).toContain("multiple unauthenticated AutoCAD automation processes");
    expect(runner).toMatch(/timedOut = true;[\s\S]*taskkill\.exe[\s\S]*\["\/PID", String\(child\.pid\), "\/T", "\/F"\]/gu);
    expect(runner).not.toMatch(/forceTimeout|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/gu);
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*!await terminateOwnedProcess\(ownership\)[\s\S]*!await restoredProcessSet\(\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/gu);
    expect(runner).not.toContain("waitForNoResidualAcadProcesses");
  });

  it("retries transient null viewport COM values before indexing coordinates", async () => {
    const matrix = await readFile(new URL("f101-viewport-lock.ps1", import.meta.url), "utf8");
    expect(matrix).toContain("function Invoke-NonNullCom");
    expect(matrix).toContain('$viewport = Invoke-NonNullCom { $Document.HandleToObject($Handle) } "viewport handle $Handle"');
    expect(matrix).toContain('target = Get-Point2 (Invoke-NonNullCom { $viewport.Target } "viewport $Handle target")');
    expect(matrix).toContain("viewCenter = Get-Point2 (Invoke-NonNullCom { $Document.GetVariable('VIEWCTR') } 'VIEWCTR')");
    expect(matrix).not.toContain("target = Get-Point2 (Invoke-ComRetry { $viewport.Target })");
  });
});
