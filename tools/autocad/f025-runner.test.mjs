import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { planAuthenticatedCleanup, processIdentitySetsEqual } from "./process-ownership.mjs";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-025 AutoCAD CHAMFER runner ratchet", () => {
  it("owns and cleans only its isolated AutoCAD process", async () => {
    const matrix = await source("f025-standard-matrix.ps1");
    const runner = await source("run-f025.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).toContain("F-025 refuses to use a pre-existing AutoCAD process.");
    expect(matrix).toContain("Write-OwnedPidSidecar $automationProcessId");
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(sidecar, current)");
    expect(runner).toContain("const preExistingProcesses = acadProcessIdentities()");
    expect(runner).toContain("processIdentitySetsEqual(preExistingProcesses, acadProcessIdentities())");
    expect(runner).toMatch(/finally\s*\{[\s\S]*ownedSidecar\(\)[\s\S]*planAuthenticatedCleanup\(sidecar, newAutomationProcesses\(\)\)[\s\S]*restoredProcessSet\(\)/u);
    expect(runner).toContain("refuses to terminate unauthenticated AutoCAD automation processes and left them untouched");
    expect(runner).not.toMatch(/sidecar\s*=\s*(?:orphanCandidates|newAutomationProcesses\(\)\[)/u);
  });

  it("never assigns or terminates a concurrent unauthenticated AutoCAD automation process", () => {
    const concurrent = { processId: 9001, executablePath: "C:\\Program Files\\Autodesk\\AutoCAD 2024\\acad.exe", startTimeUtc: "2026-08-30T00:00:00.000Z" };
    expect(planAuthenticatedCleanup(null, [concurrent])).toEqual({ terminate: null, refusedProcessIds: [9001] });
    const authenticated = { processId: 7001, executablePath: concurrent.executablePath, startTimeUtc: "2026-08-30T00:01:00.000Z", token: "owned" };
    expect(planAuthenticatedCleanup(authenticated, [authenticated, concurrent])).toEqual({ terminate: authenticated, refusedProcessIds: [9001] });
  });

  it("rejects PID-only and PID-reuse process-set restoration spoofs", () => {
    const expected = [{ processId: 11276, executablePath: "C:\\Program Files\\Autodesk\\AutoCAD 2024\\acad.exe", startTimeUtc: "2026-08-29T02:07:35.000Z" }];
    expect(processIdentitySetsEqual(expected, [{ ...expected[0], executablePath: "c:/program files/autodesk/autocad 2024/acad.exe" }])).toBe(true);
    expect(processIdentitySetsEqual(expected, [{ processId: 11276 }])).toBe(false);
    expect(processIdentitySetsEqual(expected, [{ ...expected[0], startTimeUtc: "2026-08-30T04:00:00.000Z" }])).toBe(false);
    expect(processIdentitySetsEqual(expected, [...expected, { processId: 28304, executablePath: expected[0].executablePath, startTimeUtc: "2026-08-30T04:04:44.000Z" }])).toBe(false);
  });

  it("requires overlap, No Trim, both seam orders and exact second-selection properties", async () => {
    const matrix = await source("f025-standard-matrix.ps1");
    for (const fixture of [
      "F025_POLY_OVERLAP", "F025_POLY_OVERLAP_NOTRIM", "F025_POLY_SHORT_NOTRIM",
      "F025_SEAM_FORWARD", "F025_SEAM_REVERSE", "F025_SAME_PROP", "F025_CROSS_REVERSE_OUT",
      "F025_POLY_ZERO", "F025_PAIR_ZERO", "F025_PAIR_ZERO_SEAM", "F025_PAIR_TOO_SHORT",
    ]) expect(matrix).toContain(fixture);
    for (const check of [
      "polylineOverlapExact", "polylineOverlapNoTrimExact", "polylineShortNoTrimExact",
      "closedSeamBothOrders", "crossLayerCurrentOutput", "secondSelectionProperties",
      "polylineZeroIdentity", "samePolylineZeroIdentity", "selectedPolylineDistanceTooLargeUnchanged",
    ]) expect(matrix).toContain(check);
    expect(matrix).toContain("$crossFirst.EntityTransparency = '50'");
    expect(matrix).toContain("$crossSecond.EntityTransparency = '25'");
    expect(matrix).toContain("$observations.crossLayer.current[0].color -eq 256");
    expect(matrix).toContain("$observations.crossLayer.current[0].lineweight -eq 35");
    expect(matrix).toContain("$observations.crossLayer.current[0].linetype -eq 'ByLayer'");
  });

  it("accepts failed Escape watchdogs only when AutoCAD independently proves idle", async () => {
    const matrix = await source("f025-standard-matrix.ps1");
    expect(matrix).toMatch(/if \(@\(\$exitCodes \| Where-Object \{ \$_ -eq 0 \}\)\.Count -eq 0\) \{[\s\S]*Wait-AcadIdle \$Document 5/u);
    expect(matrix).toContain("Escape watchdogs both failed and AutoCAD remained active");
    expect(matrix).toContain("rejected-pair command was already idle after Escape watchdog failures");
    expect(matrix).not.toContain('Escape watchdogs both failed: $($exitCodes');
  });
});
