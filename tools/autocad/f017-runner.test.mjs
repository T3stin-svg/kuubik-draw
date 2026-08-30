import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-017 owned AutoCAD process ratchet", () => {
  it("authenticates and quits only the COM process it created", async () => {
    const matrix = await source("f017-standard-matrix.ps1");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).toContain("GetWindowThreadProcessId");
    expect(matrix).toContain("$preExistingProcessIds -notcontains $automationProcessId");
    expect(matrix).toContain("F-017 refuses to use a pre-existing AutoCAD process.");
    expect(matrix).toMatch(/if \(\$automationProcessOwned -and \$acad\)[\s\S]*\$acad\.Quit\(\)/gu);
  });

  it("revalidates executable and start time before cleanup", async () => {
    const runner = await source("run-f017.mjs");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toMatch(/async function terminateIdentity\(identity\)[\s\S]*identityMatches\(identity, current\)[\s\S]*process\.kill\(identity\.processId\)/gu);
    expect(runner).toContain("function newAutomationSidecars(preExisting)");
    expect(runner).toContain("Get-CimInstance Win32_Process");
    expect(runner).toContain("Name='acad.exe'");
    expect(runner).toContain("/\\/Automation\\s+-Embedding/iu");
    expect(runner).toMatch(/if \(reportedIdentity\) \{[\s\S]*terminateIdentity\(reportedIdentity\)[\s\S]*\} else \{\s*const orphanCandidates = newAutomationSidecars\(preExisting\)/gu);
    expect(runner).not.toMatch(/const orphanCandidates = newAutomationSidecars\(preExisting\);\s*if \(reportedIdentity\)/gu);
    expect(runner).toMatch(/setTimeout\(\(\) => \{[\s\S]*taskkill\.exe[\s\S]*\["\/PID", String\(child\.pid\), "\/T", "\/F"\]/gu);
    expect(runner).not.toMatch(/forceTimeout|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/gu);
    expect(runner).toContain("F-017 refuses ambiguous orphan cleanup");
    expect(runner).toContain("JSON.stringify(current) === JSON.stringify(preExisting)");
    expect(runner).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/gu);
  });
});
