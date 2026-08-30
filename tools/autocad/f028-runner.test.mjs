import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-028 AutoCAD LENGTHEN runner ratchet", () => {
  it("owns one new desktop process and authenticates cleanup by full identity", async () => {
    const matrix = await source("f028-standard-matrix.ps1");
    const runner = await source("run-f028.mjs");
    const shared = await source("owned-desktop-matrix.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toContain("GetActiveObject('AutoCAD.Application.24.3')");
    expect(matrix).toContain("$preExistingProcessIds-notcontains$automationProcessId");
    expect(matrix).toContain("[uint32]$acadPid=0");
    expect(matrix).not.toMatch(/\[uint32\]\$pid\b/iu);
    expect(matrix).toContain("F-028 refuses to use a pre-existing AutoCAD process");
    expect(matrix).toMatch(/Write-OwnedPidSidecar[\s\S]*executableSha256[\s\S]*startTimeSha256/gu);
    expect(shared).toContain("async function runOwnedDesktopMatrix");
    expect(shared).toContain("planAuthenticatedCleanup(sidecar, newAutomationProcesses())");
    expect(shared).toContain("PID sidecar and AutoCAD COM identity disagreed");
    expect(shared).toMatch(/finally\s*\{[\s\S]*planAuthenticatedCleanup[\s\S]*restoredProcessSet[\s\S]*rm\(tempRoot/gu);
    expect(runner).toContain('rowId: "F-028"');
  });

  it("executes the audited LENGTHEN matrix and independently reads every final DXF entity", async () => {
    const matrix = await source("f028-standard-matrix.ps1");
    const runner = await source("run-f028.mjs");
    for (const contract of ["lineArcPolylineDelta", "ellipseExcludedFromNumericMatrix", "ellipseDynamicChanged", "splineExcludedFromNumericMatrix", "controlSplineDynamicRefused", "deltaFixedEndpoint", "percent150", "total80", "dynamicEndpoint", "totalAngle180", "commandLocalUndo", "atomicUndo", "atomicRedo", "lockedRefused", "offAndFrozenBehaviorMeasured"]) expect(matrix).toContain(contract);
    expect(matrix).toContain('`"_.LENGTHEN`"');
    expect(matrix).toContain("'Delta'{'\"_DElta\"'}");
    expect(matrix).not.toContain("'Delta'{'`\"_DElta`\"'}");
    expect(matrix).not.toContain("' `\"_Undo`\"'");
    expect(matrix).not.toMatch(/\breturn\$/u);
    expect(matrix).not.toContain("$scratch.StartUndoMark()");
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath,65)");
    expect(matrix).toContain("F-028 handle $Handle no longer resolves");
    expect(matrix).toContain("$stage='delta-command-multiple'");
    expect(matrix).toContain("Invoke-Lengthen $scratch 'Delta' 25 $deltaSelections");
    expect(matrix).toContain("if($deltaCommandError){throw $deltaCommandError}");
    expect(runner).toContain("new DxfParser().parseSync");
    expect(runner).toContain("function dxfEntityMatchesNative");
    expect(runner).toContain("states.length === 14");
    expect(runner).toContain("matrix.dxfReadback.fullStateMatchesNative !== true");
    expect(runner).toContain("sharedRunnerSha256: sha256(await readFile(sharedRunnerPath))");
  });
});
