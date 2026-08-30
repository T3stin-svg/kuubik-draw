import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("F-100 AutoCAD process-set ratchet", () => {
  it("preserves the user's pre-existing AutoCAD process set", async () => {
    const runner = await readFile(new URL("run-f100.mjs", import.meta.url), "utf8");
    const matrix = await readFile(new URL("f100-viewport-view.ps1", import.meta.url), "utf8");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
    expect(matrix).toContain("executablePath = $automationExecutablePath");
    expect(matrix).toContain("startTimeUtc = $automationProcess.StartTime.ToUniversalTime().ToString('o')");
    expect(matrix).toContain("automationProcessIdentity = $automationProcessIdentity");
    expect(runner).toContain("function acadProcessIdentities()");
    expect(runner).toContain("const preExistingProcesses = acadProcessIdentities()");
    expect(runner).toContain("const preExistingProcessIds = new Set(preExistingProcesses.map");
    expect(runner).toContain("async function waitForRestoredProcessSet()");
    expect(runner).toContain("JSON.stringify(acadProcessIdentities()) === JSON.stringify(preExistingProcesses)");
    expect(runner).not.toContain("function acadProcessIds()");
    expect(runner).not.toContain('acadProcessIds().join("|")');
    expect(runner).toContain("function processIdentity(processId)");
    expect(runner).toContain("function identityMatches(sidecar, current)");
    expect(runner).toContain("function newAutomationSidecars()");
    expect(runner).toContain("Get-CimInstance Win32_Process");
    expect(runner).toContain("Name='acad.exe'");
    expect(runner).toContain("/\\/Automation\\s+-Embedding/iu");
    expect(runner).toContain("typeof sidecar.executablePath === \"string\"");
    expect(runner).toContain("typeof sidecar.startTimeUtc === \"string\"");
    expect(runner).toMatch(/timedOut = true;[\s\S]*taskkill\.exe[\s\S]*\["\/PID", String\(child\.pid\), "\/T", "\/F"\]/gu);
    expect(runner).not.toMatch(/forceTimeout|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/gu);
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*!await terminateOwnedProcess\(ownedIdentity\)[\s\S]*!await waitForRestoredProcessSet\(\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/gu);
    expect(runner).not.toContain("waitForNoResidualAcadProcesses");
  });
});
