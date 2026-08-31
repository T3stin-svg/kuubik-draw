import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-053 AutoCAD UNITS owned-process runner ratchet", () => {
  it("creates exactly one owned 24.3 COM process and never attaches to a user process", async () => {
    const matrix = await source("f053-units-matrix.ps1");
    const runner = await source("run-f053.mjs");
    const shared = await source("owned-desktop-matrix.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/GetActiveObject|GetObject\s*\(/gu);
    expect(matrix).toContain("F-053 refuses to use a pre-existing AutoCAD process");
    expect(matrix).toContain("$preExistingProcessIds -notcontains $automationProcessId");
    expect(matrix).toContain("Write-OwnedPidSidecar $automationProcessId");
    expect(matrix).toContain("executableSha256");
    expect(matrix).toContain("startTimeSha256");
    expect(matrix).toContain("$scratch.Close($false)");
    expect(matrix).toMatch(/if \(\$owned -and \$acad\)[^{]*\{ try \{ Invoke-ComRetry \{ \$acad\.Quit\(\) \}/u);
    expect(shared).toContain("planAuthenticatedCleanup(sidecar, newAutomationProcesses())");
    expect(shared).toContain("processIdentitySetsEqual(preExistingProcesses, acadProcessIdentities())");
    expect(runner).toContain('rowId: "F-053"');
  });

  it("uses only a blank scratch drawing and independently reads the saved DXF", async () => {
    const matrix = await source("f053-units-matrix.ps1");
    const runner = await source("run-f053.mjs");
    expect(matrix).toContain("F-053 refuses a non-blank initial document in the owned process");
    expect(matrix).toContain("$candidate.FullName");
    expect(matrix).toContain("$candidate.ModelSpace.Count");
    expect(matrix).toContain("userDocumentTouched = $false");
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath, 65)");
    expect(runner).toContain("validateF053Dxf");
    expect(runner).toContain("requiredHeaderVariablesExact");
    expect(runner).toContain("geometryCoordinatesWithinEightUlps");
    expect(runner).toContain("matrix.dxfReadback?.sha256 !== matrix.dxfOutputSha256");
  });

  it("measures the bounded UNITS matrix and leaves unsupported dialog claims NOT_RUN", async () => {
    const matrix = await source("f053-units-matrix.ps1");
    const runner = await source("run-f053.mjs");
    for (const variable of ["INSUNITS", "LUNITS", "LUPREC", "AUNITS", "AUPREC", "ANGDIR", "ANGBASE"]) {
      expect(matrix).toContain(`'${variable}'`);
    }
    for (const contract of ["existingGeometryCoordinatesPreserved", "atomicUndo", "atomicRedo", "noOpSettingsAndGeometryUnchanged", "invalidLuprecRejected", "invalidInsunitsRejected"]) {
      expect(matrix).toContain(contract);
    }
    expect(matrix).toContain("$scratch.StartUndoMark()");
    expect(matrix).toContain("$scratch.EndUndoMark()");
    expect(matrix).toContain('$scratch.SendCommand("_.UNDO`n1`n")');
    expect(matrix).toContain('$scratch.SendCommand("_.REDO`n")');
    expect(matrix).toContain("separateDrawingAndInsertionUnitFields");
    expect(matrix).toContain("modalUnitsDialogCancel");
    expect(matrix).not.toMatch(/\[System\.Windows\.Forms\.SendKeys\]|New-Object\s+-ComObject\s+WScript\.Shell|mouse_event\s*\(|keybd_event\s*\(/gu);
    expect(runner).toContain("certificationAuthority: false");
    expect(runner).toContain('matrix.status !== "PARTIAL"');
    expect(runner).toContain("remainingCertificationRequirements");
  });
});
