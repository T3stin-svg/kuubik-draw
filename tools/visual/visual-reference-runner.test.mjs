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

  it("captures the native popup only from an owned AutoCAD process", async () => {
    const source = await readFile(new URL("capture-autocad-context-menu.ps1", import.meta.url), "utf8");
    expect(source.match(/New-Object\s+-ComObject\s+AutoCAD\.Application\.24\.3/gu)).toHaveLength(1);
    expect(source).not.toContain("GetActiveObject");
    expect(source).toContain("Visual context-menu audit refuses to use a pre-existing AutoCAD process.");
    expect(source).toContain("Test-OwnedProcessIdentity");
    expect(source).toContain("SetCursorPos");
    expect(source).toContain("WindowFromPoint");
    expect(source).toContain("$menuClass -ne '#32768'");
    expect(source).toContain("[int]$menuProcessId -ne $automationProcessId");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("Private AutoCAD reference pixels and process reports must not be written into the public repository.");
    expect(source).toContain("processSetRestored");
  });

  it("keeps the light-model comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-light-model-surface.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-8/autocad-light-model-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-1 px tolerance");
    expect(evidence.reference.sha256).toBe("0e014882f8fa7231800f02702c30f4a8697d7fd49ef860b487d0768dbda48640");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.sampledBackground).toEqual({ autoCad: "#ffffff", kuubik: "#ffffff" });
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the Home ribbon comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-ribbon-surface.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-10/autocad-ribbon-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-2 px boundary tolerance");
    expect(evidence.reference.sha256).toBe("0e014882f8fa7231800f02702c30f4a8697d7fd49ef860b487d0768dbda48640");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.surface).toEqual({ autoCad: "#3b4453", kuubik: "rgb(59, 68, 83)" });
    expect(evidence.panels).toHaveLength(10);
    expect(evidence.panels.every(({ rightDeltaPx }) => Math.abs(rightDeltaPx) <= 2)).toBe(true);
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the top application chrome comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-top-chrome.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-10/autocad-top-chrome-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-$Tolerance px tolerance");
    expect(evidence.reference.sha256).toBe("0e014882f8fa7231800f02702c30f4a8697d7fd49ef860b487d0768dbda48640");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.expectedZones).toEqual({
      titlebar: { y: 0, height: 30 },
      ribbonTabs: { y: 30, height: 22 },
      ribbon: { y: 52, height: 99 },
      documentTabs: { y: 151, height: 30 },
    });
    expect(evidence.actualZones).toMatchObject(evidence.expectedZones);
    expect(evidence.surfaces).toEqual({
      titlebar: { autoCad: "#222933", kuubik: "rgb(34, 41, 51)" },
      ribbonTabs: { autoCad: "#222933", kuubik: "#222933" },
      ribbon: { autoCad: "#3b4453", kuubik: "rgb(59, 68, 83)" },
      documentTabs: { autoCad: "#222933", kuubik: "#222933" },
    });
    expect(evidence.status).toBe("PASS");
  });
});
