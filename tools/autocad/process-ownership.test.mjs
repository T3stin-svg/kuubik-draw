import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("AutoCAD owned-process launch and cleanup ratchet", () => {
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
