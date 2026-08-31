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
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-light-model-readback.json", import.meta.url), "utf8"));
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
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-38/autocad-ribbon-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-2 px boundary tolerance");
    expect(evidence.reference.sha256).toBe("0e014882f8fa7231800f02702c30f4a8697d7fd49ef860b487d0768dbda48640");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.surface).toEqual({ autoCad: "#3b4453", kuubik: "rgb(59, 68, 83)" });
    expect(evidence.panels).toHaveLength(10);
    expect(evidence.panels.every(({ rightDeltaPx }) => Math.abs(rightDeltaPx) <= 2)).toBe(true);
    expect(evidence.iconSource).toBe("original-kuubik-inline-svg");
    expect(evidence.iconography).toHaveLength(35);
    expect(evidence.iconography[0]).toMatchObject({ kind: "line", width: 34, height: 34 });
    const largeKinds = new Set(["line", "text", "insert", "match-properties", "paste", "base-view"]);
    expect(evidence.iconography.every(({ kind, width, height, pathCount }) => {
      const expectedSize = largeKinds.has(kind) ? 34 : 18;
      return width === expectedSize && height === expectedSize && pathCount >= 1;
    })).toBe(true);
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the top application chrome comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-top-chrome.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-top-chrome-readback.json", import.meta.url), "utf8"));
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

  it("keeps the shared bottom chrome comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-bottom-chrome.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-bottom-chrome-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-$Tolerance px tolerance");
    expect(evidence.reference.sha256).toBe("08505f04ee81f68e2adf76aa2cd06a0d5f9d12778ff1391bcd167ddb4cbaf4bc");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.expectedGeometry).toEqual({
      layoutStatus: { x: 0, y: 1043, width: 1920, height: 37 },
      statusbar: { y: 1047, height: 32, bottom: 1079 },
    });
    expect(evidence.surfaces).toEqual({
      separator: { autoCad: "#3b4453", kuubik: "rgb(59, 68, 83)", thicknessPx: 4 },
      content: { autoCad: "#222933", kuubik: "rgb(34, 41, 51)", heightPx: 32 },
      accent: { autoCad: "#0696d7", kuubik: "rgb(6, 150, 215)", thicknessPx: 1 },
    });
    expect(evidence.statusControls.grid).toMatchObject({ disabled: false, pressed: "true" });
    expect(["ortho", "osnap", "otrack", "dyn"].every((name) => evidence.statusControls[name].disabled)).toBe(true);
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the selected Properties and Layer Manager comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-selected-properties.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-selected-properties-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(source).toContain("fixed +/-$Tolerance px tolerance");
    expect(evidence.reference.sha256).toBe("6a9037b0ec7bad08692f2ebdbd3da4b09aa125bde1efc2a3de66223b9c82ef0c");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.actualGeometry).toMatchObject({
      palette: { x: 0, y: 181, width: 680, height: 862, bottom: 1043 },
      layerManager: { y: 181, height: 513, bottom: 694 },
      propertiesHeader: { y: 694, height: 20, bottom: 714 },
      generalHeader: { y: 753, height: 20, bottom: 773 },
      dataHeader: { y: 1023, height: 20, bottom: 1043 },
    });
    expect(evidence.actualGeometry.generalRows).toHaveLength(9);
    expect(evidence.surfaces.propertyValue).toMatchObject({ autoCad: "#3b4453", kuubik: "rgb(59, 68, 83)" });
    expect(evidence.actualFixture).toMatchObject({
      entityKinds: ["circle", "polyline", "text"],
      handles: ["A1", "A2", "A3"],
      selectedHandles: ["A1", "A2", "A3"],
      polyline: { closed: true },
      text: { value: "KUUBIK AUDIT" },
    });
    expect(evidence.actualFixture.circle.center.x).toBeCloseTo(1298, 6);
    expect(evidence.actualFixture.circle.center.y).toBeCloseTo(503, 6);
    expect(evidence.actualFixture.circle.radiusPx).toBeCloseTo(123.5, 6);
    expect(evidence.actualFixture.text.insertion.x).toBeCloseTo(1032, 6);
    expect(evidence.actualFixture.text.insertion.y).toBeCloseTo(134, 6);
    expect(evidence.actualFixture.text.heightPx).toBeCloseTo(75, 6);
    expect(evidence.staleMovePreviewPixels).toBe(0);
    expect(evidence.selectionFeedback).toMatchObject({
      expectedSelectionColor: "#0478ec",
      expectedGripFill: "#007fff",
      expectedGripStroke: "#283747",
    });
    expect(evidence.selectionFeedback.gripCenters).toHaveLength(14);
    expect(evidence.selectionFeedback.gripCenters.every(({ autoCad, kuubik }) => autoCad === "#007fff" && kuubik === "#007fff")).toBe(true);
    expect(evidence.actualViewIndicator).toEqual(evidence.expectedViewIndicator);
    expect(evidence.paletteIconSource).toBe("original-kuubik-inline-svg");
    expect(evidence.paletteIconography).toHaveLength(20);
    expect(evidence.paletteIconography.filter(({ surface }) => surface === "toolbar")).toHaveLength(6);
    expect(evidence.paletteIconography.filter(({ surface }) => surface === "filter-rail")).toHaveLength(2);
    expect(evidence.paletteIconography.filter(({ surface }) => surface === "layer-row")).toHaveLength(9);
    expect(evidence.paletteIconography.filter(({ surface }) => surface === "properties-tools")).toHaveLength(3);
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the active LINE fixture comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-active-drawing.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-active-drawing-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(evidence.reference.sha256).toBe("08505f04ee81f68e2adf76aa2cd06a0d5f9d12778ff1391bcd167ddb4cbaf4bc");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.actualFixture).toMatchObject({ entityKinds: ["circle", "polyline", "text"], handles: ["B1", "B2", "B3"], previewCommand: "LINE", entityCount: 3 });
    expect(evidence.grid).toMatchObject({ verticalRuns: 121, horizontalRuns: 84 });
    expect(evidence.activeUi.ribbon).toEqual({
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(23, 111, 159)",
      borderColor: "rgb(104, 180, 223)",
    });
    expect(evidence.activeUi.commandLine).toMatchObject({ width: 0, height: 0 });
    expect(evidence.status).toBe("PASS");
  });

  it("keeps the Layout/paper-space comparison content-addressed and pixel-private", async () => {
    const source = await readFile(new URL("compare-layout-paper-space.ps1", import.meta.url), "utf8");
    const evidence = JSON.parse(await readFile(new URL("../../evidence/artifacts/visual-shell-wave-37/autocad-layout-paper-space-readback.json", import.meta.url), "utf8"));
    expect(source).toContain("Private AutoCAD layout reference SHA-256 mismatch");
    expect(source).toContain("redistributablePixelsIncluded = $false");
    expect(evidence.reference.sha256).toBe("bda16d92411c9f257c6a481ba901d7cf3f974747652cf6012d0199129c013ada");
    expect(evidence.reference.redistributablePixelsIncluded).toBe(false);
    expect(evidence.actualGeometry).toMatchObject({
      sheet: { x: 727.828125, y: 212, right: 1869.15625, bottom: 1019 },
      printable: { x: 803.046875, y: 237.90625, right: 1795.28125, bottom: 990.21875 },
      viewportFrame: { x: 902.40625, y: 314.59375, right: 1694.5625, bottom: 916.421875 },
    });
    expect(evidence.actualFixture.circle.center.x).toBeCloseTo(1298, 0);
    expect(evidence.actualFixture.circle.center.y).toBeCloseTo(668, 0);
    expect(evidence.actualFixture.circle.radiusPx).toBeCloseTo(95, 0);
    expect(evidence.referenceTextPixels).toMatchObject({ left: 1099, top: 337, right: 1553, bottom: 385 });
    expect(evidence.kuubikTextPixels).toMatchObject({ left: 1099, top: 337, right: 1555, bottom: 385 });
    expect(evidence.layoutTools).toEqual({ compactByDefault: true, openStateVerified: true, pageSetupStillReachable: true });
    expect(evidence.status).toBe("PASS");
  });
});
