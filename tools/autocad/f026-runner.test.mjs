import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-026 AutoCAD BREAK runner ratchet", () => {
  it("owns one new desktop process and authenticates cleanup by full identity", async () => {
    const matrix = await source("f026-standard-matrix.ps1");
    const runner = await source("run-f026.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toContain("GetActiveObject('AutoCAD.Application.24.3')");
    expect(matrix).toContain("$preExistingProcessIds-notcontains$automationProcessId");
    expect(matrix).toContain("refuses to use a pre-existing AutoCAD process");
    expect(matrix).toMatch(/Write-OwnedPidSidecar[\s\S]*executableSha256[\s\S]*startTimeSha256/gu);
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toContain("timedOut = true");
    expect(runner).toContain('execFileSync("taskkill.exe"');
    expect(runner).not.toContain('spawn(acadExecutable, ["/nologo"]');
    expect(runner).not.toContain('"-ExpectedProcessId"');
    expect(runner).toContain("planAuthenticatedCleanup(sidecar, newAutomationProcesses())");
    expect(runner).toContain("F-026 PID sidecar and AutoCAD COM identity disagreed");
    expect(runner).toMatch(/finally\s*\{[\s\S]*planAuthenticatedCleanup[\s\S]*restoredProcessSet[\s\S]*rm\(tempRoot/gu);
  });

  it("executes the audited BREAK matrix and independent DXF read-back", async () => {
    const matrix = await source("f026-standard-matrix.ps1");
    const runner = await source("run-f026.mjs");
    const cross = await readFile(new URL("../parity/check-f026-cross-evidence.mjs", import.meta.url), "utf8");
    for (const contract of ["defaultSelectionFirstAndProjection", "explicitFirstAndProjection", "atPointSplit", "breakAtPointOpenEllipse", "breakAtSignOpenEllipse", "breakAtSignOpenSplineRefused", "breakAtPointOpenSplineRefused", "circleDirection", "openPolylineTwoPieces", "closedPolylineComplement", "globalAtomicUndoRedo", "lockedRefused", "rationalSplineTwoPieces"]) expect(matrix).toContain(contract);
    expect(matrix).toContain('"_.BREAK`"');
    expect(matrix).toContain('"_.BREAKATPOINT`"');
    expect(matrix).toContain('`"_First`"');
    expect(matrix).toContain('`"@`"');
    expect(matrix).toMatch(/function Get-NativeLayerArc[\s\S]*ssget `"_X`"[\s\S]*assoc 5[\s\S]*assoc 50[\s\S]*assoc 51[\s\S]*assoc 62[\s\S]*assoc 370/gu);
    expect(matrix).toMatch(/function Get-NativeSingleEntity[\s\S]*ssget `"_X`"[\s\S]*assoc 5[\s\S]*HandleToObject\(\$handle\)/gu);
    expect(matrix).toContain("nativeDatabaseReadback=$true");
    expect(matrix).toContain("function Test-StateSetExact");
    expect(matrix).toContain("Test-PolylineState");
    expect(matrix).toContain("Test-SplineStateExact");
    expect(matrix).toContain("$splineBreakBefore");
    expect(matrix).toContain("$splineAtPointBefore");
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath,65)");
    expect(matrix).toContain("$splineDocument.SaveAs($SplineOutputPath,65)");
    expect(matrix).toMatch(/pre-command RCW[\s\S]*HandleToObject\(\$handle\)[\s\S]*remained null\|erased/gu);
    expect(runner).toContain("new DxfParser().parseSync");
    expect(runner).toContain("matrix.dxfReadback.sha256 !== matrix.dxfOutputSha256");
    expect(runner).toContain("matrix.splineReadback.sha256 !== matrix.rationalSpline?.outputSha256");
    expect(runner).toContain("processOwnershipSha256: sha256(await readFile(processOwnershipPath))");
    expect(runner).toContain("escapeHelperSha256: sha256(await readFile(escapeHelperPath))");
    expect(cross).toContain('"tools/autocad/process-ownership.mjs": autocad.processOwnershipSha256');
    expect(cross).toContain('"tools/autocad/send-escape.ps1": autocad.escapeHelperSha256');
  });
});
