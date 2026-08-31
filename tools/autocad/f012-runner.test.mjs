import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-012 owned AutoCAD desktop runner ratchet", () => {
  it("creates exactly one authenticated desktop process and restores the original set", async () => {
    const matrix = await source("f012-standard-matrix.ps1");
    const runner = await source("run-f012.mjs");
    const shared = await source("owned-desktop-matrix.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toContain("GetActiveObject('AutoCAD.Application.24.3')");
    expect(matrix).toContain("$preExistingProcessIds -notcontains $automationProcessId");
    expect(matrix).toContain("F-012 refuses to use a pre-existing AutoCAD process");
    expect(matrix).toMatch(/Write-OwnedPidSidecar[\s\S]*executableSha256[\s\S]*startTimeSha256/gu);
    expect(shared).toContain("planAuthenticatedCleanup(sidecar, newAutomationProcesses())");
    expect(runner).toContain('rowId: "F-012"');
  });

  it("executes the measured command subset and independently reads the final DXF", async () => {
    const matrix = await source("f012-standard-matrix.ps1");
    const runner = await source("run-f012.mjs");
    for (const contract of ["commandCreatedFitSpline", "propertiesPreserved", "reverseSwapsEndpoints", "atomicUndo", "atomicRedo", "closeCreatesPeriodicSpline", "openRestoresReversedDirection", "commandLocalUndo", "cvDeleteRemovesPickedControlVertex", "cvDeleteGrevilleKnotMatrix", "cvDeletePreservesRationalWeights", "cvDeleteRepeatedKnotMatrix", "cvDeleteReducesMinimumCubicDegree", "cvDeleteQuadraticGrevilleKnotMatrix", "cvDeletePeriodicExact", "joinLineCreatesC0Spline"]) expect(matrix).toContain(contract);
    expect(matrix).toContain('`"_.SPLINE`"');
    expect(matrix).toContain('`"_.SPLINEDIT`"');
    expect(matrix).toContain('`"_.CVSHOW`"');
    expect(matrix).toContain('`"_Delete`"');
    expect(matrix).toContain('`"_Join`"');
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath, 65)");
    expect(runner).toContain("new DxfParser().parseSync");
    expect(runner).toContain("function dxfMatchesNative");
    expect(runner).toContain("states.length === 2");
    expect(runner).toContain("matrix.dxfReadback.fullStateMatchesNative !== true");
  });
});
