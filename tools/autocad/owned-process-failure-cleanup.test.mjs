import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("owned AutoCAD process failure cleanup", () => {
  for (const runner of ["run-f104.mjs", "run-f109-desktop.mjs", "run-f111-desktop.mjs"]) {
    it(`${runner} authenticates identity, recovers one orphan, rejects ambiguity and restores the original set`, async () => {
      const text = await source(runner);
      expect(text).not.toMatch(/forceTimeout|let force\b|setTimeout\(\(\) => \{ try \{ execFileSync\("taskkill\.exe"/u);
      expect(text).toMatch(/setTimeout\(\(\) => \{[\s\S]*timedOut = true;[\s\S]*execFileSync\("taskkill\.exe", \["\/PID", String\((?:child|running)\.pid\), "\/T", "\/F"\][\s\S]*catch \{ (?:child|running)\.kill\(\); \}/u);
      expect(text).toContain("function processIdentity(processId)");
      expect(text).toContain("function identityMatches(sidecar, current)");
      expect(text).toContain("function newAutomationSidecars()");
      expect(text).toMatch(/async function terminate(?:OwnedProcess)?\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)/u);
      expect(text).toContain("typeof sidecar.executablePath !== \"string\"");
      expect(text).toContain("typeof sidecar.startTimeUtc !== \"string\"");
      expect(text).toMatch(/finally\s*\{\s*const cleanupErrors = \[\];[\s\S]*await (?:resolveOwnedSidecar|ownedSidecar)\(\)[\s\S]*orphanCandidates\.length === 1[\s\S]*orphanCandidates\.length > 1[\s\S]*!await terminate(?:OwnedProcess)?\([\s\S]*!await (?:waitForOriginalProcessSet|restoredProcessSet)\(\)[\s\S]*AggregateError\(primaryError \? \[primaryError, \.\.\.cleanupErrors\]/u);
    });
  }

  it("F-104 and shared F-109/F-111 matrices persist executable and start-time identity", async () => {
    for (const matrix of ["f104-vector-output.ps1", "f109-desktop-readback.ps1"]) {
      const text = await source(matrix);
      expect(text).toContain("executablePath =");
      expect(text).toContain("startTimeUtc =");
      expect(text).toContain("owned = $true");
      expect(text).toContain("token = $OwnershipToken");
    }
  });
});
