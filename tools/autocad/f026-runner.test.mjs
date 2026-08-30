import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-026 AutoCAD BREAK runner ratchet", () => {
  it("owns one new desktop process and authenticates cleanup by full identity", async () => {
    const matrix = await source("f026-standard-matrix.ps1");
    const runner = await source("run-f026.mjs");
    expect(matrix).not.toMatch(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu);
    expect(matrix).toContain("[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.3')");
    expect(matrix).toContain("$candidatePid-eq$ExpectedProcessId");
    expect(matrix).toContain("without touching a pre-existing process");
    expect(matrix).toMatch(/Write-OwnedPidSidecar[\s\S]*executableSha256[\s\S]*startTimeSha256/gu);
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toContain("timedOut = true");
    expect(runner).toContain('execFileSync("taskkill.exe"');
    expect(runner).toContain('spawn(acadExecutable, ["/nologo"]');
    expect(runner).toContain('"-ExpectedProcessId", String(acadChild.pid)');
    expect(runner).toContain("const cleanupIdentity = sidecar ?? launchedIdentity");
    expect(runner).toMatch(/finally\s*\{[\s\S]*planAuthenticatedCleanup[\s\S]*restoredProcessSet[\s\S]*rm\(tempRoot/gu);
  });

  it("executes the audited BREAK matrix and independent DXF read-back", async () => {
    const matrix = await source("f026-standard-matrix.ps1");
    const runner = await source("run-f026.mjs");
    for (const contract of ["defaultSelectionFirstAndProjection", "explicitFirstAndProjection", "atPointSplit", "circleDirection", "openPolylineTwoPieces", "closedPolylineComplement", "globalAtomicUndoRedo", "lockedRefused", "rationalSplineTwoPieces"]) expect(matrix).toContain(contract);
    expect(matrix).toContain('"_.BREAK`"');
    expect(matrix).toContain('`"_First`"');
    expect(matrix).toContain('`"@`"');
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath,65)");
    expect(matrix).toContain("$splineDocument.SaveAs($SplineOutputPath,65)");
    expect(runner).toContain("new DxfParser().parseSync");
    expect(runner).toContain("matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256");
    expect(runner).toContain("matrix.splineReadback.sha256 !== matrix.rationalSpline?.outputSha256");
  });
});
