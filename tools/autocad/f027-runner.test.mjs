import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-027 AutoCAD STRETCH runner ratchet", () => {
  it("owns one new desktop process and authenticates cleanup by full identity", async () => {
    const matrix = await source("f027-standard-matrix.ps1");
    const runner = await source("run-f027.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toContain("GetActiveObject('AutoCAD.Application.24.3')");
    expect(matrix).toContain("$preExistingProcessIds-notcontains$automationProcessId");
    expect(matrix).toContain("refuses to use a pre-existing AutoCAD process");
    expect(matrix).toMatch(/Write-OwnedPidSidecar[\s\S]*executableSha256[\s\S]*startTimeSha256/gu);
    expect(runner).toContain("async function ownedSidecar()");
    expect(runner).toContain("function identityMatches(expected, current)");
    expect(runner).toMatch(/async function terminate\(sidecar\)[\s\S]*processIdentity\(sidecar\.processId\)[\s\S]*identityMatches\(sidecar, current\)[\s\S]*process\.kill\(sidecar\.processId\)/u);
    expect(runner).toContain("planAuthenticatedCleanup(sidecar,newAutomationProcesses())");
    expect(runner).toContain("F-027 PID sidecar and AutoCAD COM identity disagreed");
    expect(runner).toMatch(/finally\s*\{[\s\S]*planAuthenticatedCleanup[\s\S]*restoredProcessSet[\s\S]*rm\(tempRoot/gu);
  });

  it("executes the audited STRETCH matrix and independent DXF read-back", async () => {
    const matrix = await source("f027-standard-matrix.ps1");
    const runner = await source("run-f027.mjs");
    for (const contract of [
      "sourceStatesExact",
      "crossingWindowEndpoint",
      "crossingPolygonEndpoint",
      "polylineVertexAndProperties",
      "arcCenterNotStretchPoint",
      "wrappedEllipse",
      "ellipseMidpointNoChange",
      "fullEllipseCenterMovesWhole",
      "circleCenterMovesWhole",
      "atomicUndoRedo",
      "lockedLayerNoChange",
      "handlesAndPropertiesPreserved",
    ]) expect(matrix).toContain(contract);
    for (const predicate of ["Test-PolylineState", "Test-ArcState", "Test-CircleState", "Test-EllipseState", "Test-StateSetExact"]) expect(matrix).toContain(predicate);
    expect(matrix).toContain('`"_.STRETCH`"');
    expect(matrix).toContain('`"_Crossing`"');
    expect(matrix).toContain('`"_CPolygon`"');
    expect(matrix).toContain("function Invoke-RejectedStretch");
    expect(matrix).toContain("Start-Process powershell.exe");
    expect(matrix).toContain("-WindowStyle Hidden");
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath,65)");
    expect(runner).toContain("new DxfParser().parseSync");
    expect(runner).toContain("function dxfEntityMatchesNative");
    expect(runner).toContain("function dxfMatchesAllNativeStates");
    expect(runner).toContain("summary.fullStateMatchesNative=dxfMatchesAllNativeStates(summary,matrix)");
    expect(runner).toContain("matrix.dxfReadback.fullStateMatchesNative!==true");
    expect(runner).toContain("matrix.dxfReadback.sha256!==matrix.dxfOutputSha256");
    expect(runner).toContain("processOwnershipSha256:sha256(await readFile(processOwnershipPath))");
    expect(runner).toContain("escapeHelperSha256:sha256(await readFile(escapeHelperPath))");
  });
});
