import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("AutoCAD owned-process launch and cleanup ratchet", () => {
  it("F-022 authenticates executable/start-time identity, recovers early ownership and releases global input", async () => {
    const matrix = await source("f022-standard-matrix.ps1");
    const helper = await source("f022-shift-click.ps1");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).toContain("Get-OwnedAcadIdentity");
    expect(matrix).toContain("executableSha256");
    expect(matrix).toContain("startTimeSha256");
      expect(matrix).toContain("hatch.AppendOuterLoop(new IAcadEntity[] { loop })");
      expect(matrix).toContain("[F022HatchInterop]::AppendOuterLoop($hatch,$hatchLoop)");
    expect(matrix).toMatch(/if \(\$acad -and -not \$owned\)[\s\S]*GetWindowThreadProcessId[\s\S]*Write-OwnedPidSidecar/gu);
    expect(matrix).toMatch(/if \(\$owned -and \$acad\)[^{]*\{[^}]*\$acad\.Quit\(\)/gu);
    expect(helper).toContain("GetForegroundWindow");
    expect(helper).toContain("expectedProcessId");
    expect(helper).toMatch(/finally\s*\{\s*try\s*\{[\s\S]*MOUSEEVENTF_LEFTUP[\s\S]*finally\s*\{[\s\S]*VK_SHIFT/gu);
    expect(helper).toContain("SafeKeyPress");
    expect(helper).not.toMatch(/Send\(Key\([^\n]+false\),\s*Key\([^\n]+true\)/gu);
  });

  it("F-022 runner revalidates PID, executable path and start time before every termination", async () => {
    const runner = await source("run-f022.mjs");
    expect(runner).toContain("function processIdentity(processId)");
    expect(runner).toMatch(/Get-Process -Id \$\{processId\}[\s\S]*exit 0/gu);
    expect(runner).toContain("function identityMatches(sidecar, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toMatch(/finally\s*\{[\s\S]*await ownedSidecar\(\)[\s\S]*await terminate\(sidecar\)[\s\S]*await rm\(/u);
  });

  for (const script of ["f019-standard-matrix.ps1", "f020-standard-matrix.ps1", "f021-standard-matrix.ps1", "f109-aci-palette.ps1", "f109-desktop-readback.ps1"]) {
    it(`${script} activates COM once and authenticates the PID before work`, async () => {
      const text = await source(script);
      expect(text.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
      expect(text).not.toMatch(/Invoke-ComRetry\s*\{\s*New-Object\s+-ComObject/gu);
      expect(text).toMatch(/GetWindowThreadProcessId/gu);
      expect(text).toMatch(/processId\s*=\s*\$(?:automationProcessId|candidate);\s*owned\s*=\s*\$true;\s*token\s*=\s*\$OwnershipToken/gu);
    });
  }

  for (const runner of ["run-f019.mjs", "run-f020.mjs", "run-f021.mjs", "run-f109-aci-palette.mjs", "run-f109-desktop.mjs", "run-f111-desktop.mjs"]) {
    it(`${runner} kills a timed-out child tree and always cleans an authenticated PID`, async () => {
      const text = await source(runner);
      expect(text).toContain("timedOut = true");
      expect(text).toContain('execFileSync("taskkill.exe"');
      expect(text).toContain("await ownedPid()");
      expect(text).toMatch(/finally\s*\{[\s\S]*await terminate\(processId\)[\s\S]*await rm\(/u);
    });
  }
});
