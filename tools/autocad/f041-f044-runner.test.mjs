import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = async (name) => readFile(new URL(name, import.meta.url), "utf8");

describe("F-041/F-042/F-044 owned AutoCAD coordinate runner", () => {
  it("creates one authenticated 24.3 process and leaves pre-existing processes untouched", async () => {
    const matrix = await source("f041-f042-f044-coordinate-matrix.ps1");
    const shared = await source("owned-desktop-matrix.mjs");
    expect(matrix.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(matrix).not.toMatch(/GetActiveObject|GetObject\s*\(/gu);
    expect(matrix).toContain("refuses to use a pre-existing AutoCAD process");
    expect(matrix).toContain("Write-OwnedPidSidecar $automationProcessId");
    expect(matrix).toContain("$scratch.Close($false)");
    expect(matrix).toMatch(/if \(\$owned -and \$acad\)[^{]*\{ try \{ Invoke-ComRetry \{ \$acad\.Quit\(\) \}/u);
    expect(shared).toContain("planAuthenticatedCleanup(sidecar, newAutomationProcesses())");
    expect(shared).toContain("processIdentitySetsEqual(preExistingProcesses, acadProcessIdentities())");
  });

  it("issues exact absolute, #absolute, relative Cartesian, relative polar, PLINE and MOVE tokens", async () => {
    const matrix = await source("f041-f042-f044-coordinate-matrix.ps1");
    for (const token of [
      "123456.789012345,-98765.4321098765", "#30.75,-40.125",
      "@-0.000000123456789,0.000000987654321", "@123.456789<-33.333333",
      "@250.125,-500.25", "@100.5<135", "@-12.5,3.25",
    ]) expect(matrix).toContain(token);
    for (const check of ["absolutePlainCartesian", "absoluteHashCartesian", "relativeCartesian", "relativePolar", "plineAndRelativeMove", "atomicUndoRemovedMatrix", "atomicRedoRestoredMatrix"]) expect(matrix).toContain(check);
    expect(matrix).toContain("$scratch.StartUndoMark()");
    expect(matrix).toContain('$scratch.SendCommand("_.UNDO`n1`n")');
    expect(matrix).toContain('$scratch.SendCommand("_.REDO`n")');
  });

  it("pins WCS, saves a scratch DXF and refuses UI-only claims", async () => {
    const matrix = await source("f041-f042-f044-coordinate-matrix.ps1");
    const runner = await source("run-f041-f042-f044.mjs");
    expect(matrix).toContain('$scratch.SendCommand("_.UCS`n_World`n")');
    expect(matrix).toContain("directDistancePointerDirection");
    expect(matrix).toContain("escapeKeyCancel");
    expect(matrix).toContain("nonWorldUcsCoordinateEntry");
    expect(matrix).not.toMatch(/SendKeys|PostMessage|send-escape\.ps1|mouse_event|keybd_event/gu);
    expect(matrix).not.toMatch(/SetVariable\('DYNMODE'|SetVariable\('DYNPICOORDS'/gu);
    expect(matrix).toContain("dynamicInputProfileChanged = $false");
    expect(matrix).toContain("$scratch.SaveAs($DxfOutputPath, 65)");
    expect(runner).toContain("validateCoordinateDxf");
    expect(runner).toContain("certificationAuthority: false");
    expect(runner).toContain('matrix.status !== "PARTIAL"');
  });
});
