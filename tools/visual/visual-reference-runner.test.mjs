import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AutoCAD visual-reference runner ratchet", () => {
  it("uses a fresh owned process and keeps Autodesk pixels outside the public repo", async () => {
    const source = await readFile(new URL("capture-autocad-command-history.ps1", import.meta.url), "utf8");
    expect(source.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(source).not.toContain("GetActiveObject");
    expect(source).toContain("Visual audit refuses to use a pre-existing AutoCAD process.");
    expect(source).toContain("Test-OwnedProcessIdentity");
    expect(source).toContain("processSetRestored");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("Private AutoCAD reference pixels and process reports must not be written into the public repository.");
    expect(source).toContain("_.TEXTSCR");
    expect(source).toContain("GetVisibleTopLevelWindows");
    expect(source).toContain("Owned AutoCAD TEXTSCR window was not uniquely resolved");
    expect(source).toContain("$historyWindow[0].hwnd");
    expect(source).toContain("GetDpiForWindow");
    expect(source).toContain("windowsDpiScalePercent");
    expect(source).toContain("originalWindow");
    expect(source).toMatch(/finally\s*\{\s*\[void\]\[VisualAuditWindowProcess\]::MoveWindow/gu);
  });
});
