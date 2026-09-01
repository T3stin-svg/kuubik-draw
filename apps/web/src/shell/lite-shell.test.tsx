import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CadShell } from "./CadShell.js";
import { RibbonTool } from "./RibbonTool.js";
import { StatusBar } from "./StatusBar.js";
import { TitleBar } from "./TitleBar.js";

describe("Kuubik Draw Lite v1 shell", () => {
  it("publishes the fixed Lite profile and visible 20-feature badge", () => {
    const shell = renderToStaticMarkup(<CadShell workspace="drafting"><span>drawing</span></CadShell>);
    expect(shell).toContain('data-product-profile="kuubik-draw-lite-v1"');
    expect(shell).toContain('data-scope-size="20"');

    const title = renderToStaticMarkup(<TitleBar
      documentName="local.kdraw"
      canUndo={false}
      canRedo={false}
      workspace="drafting"
      storageState="ready"
      onWorkspaceChange={() => undefined}
      onOpenDxf={() => undefined}
      onSaveKDraw={() => undefined}
      onExportDxf={() => undefined}
      onUndo={() => undefined}
      onRedo={() => undefined}
    />);
    expect(title).toContain('data-testid="lite-profile-badge"');
    expect(title).toContain("LITE V1 · 20 funktsiooni");
  });

  it("keeps selected commands active and unselected commands visibly disabled", () => {
    const selected = renderToStaticMarkup(<RibbonTool rowId="F-001" label="Line" icon="line" available onClick={() => undefined} />);
    expect(selected).toContain('data-scope-selected="true"');
    expect(selected).not.toContain("disabled=\"\"");

    const unselected = renderToStaticMarkup(<RibbonTool rowId="F-003" label="Rectangle" icon="rectangle" available onClick={() => undefined} />);
    expect(unselected).toContain('data-scope-selected="false"');
    expect(unselected).toContain('data-state-reason="Pole Lite v1 töövoos"');
    expect(unselected).toContain("disabled=\"\"");
  });

  it("leaves only the selected endpoint/midpoint OSNAP toggle active", () => {
    const markup = renderToStaticMarkup(<StatusBar
      coordinates="0.0000, 0.0000, 0.0000"
      precision={{ grid: true, ortho: true, osnap: true, otrack: true, dyn: true }}
      precisionSource="runtime"
      activeSpace="MODEL"
      onPrecisionToggle={() => undefined}
    />);
    expect(markup).toMatch(/data-status-control="osnap"[^>]*data-feature-row="F-048"[^>]*data-scope-selected="true"/u);
    expect(markup).toMatch(/data-status-control="grid"[^>]*data-scope-selected="false"[^>]*disabled=""/u);
    expect(markup).toMatch(/data-status-control="ortho"[^>]*data-scope-selected="false"[^>]*disabled=""/u);
    expect(markup).toMatch(/data-status-control="otrack"[^>]*data-scope-selected="false"[^>]*disabled=""/u);
    expect(markup).toMatch(/data-status-control="dyn"[^>]*data-scope-selected="false"[^>]*disabled=""/u);
  });
});
