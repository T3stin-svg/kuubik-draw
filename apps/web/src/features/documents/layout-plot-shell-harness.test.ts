import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import golden from "./layout-plot-shell.golden.json";
import { runLayoutPlotShellHarness } from "./layout-plot-shell-harness.js";

describe("F-096...F-107/F-114/F-115 browser-ready shell harness", () => {
  it("proves layout, viewport, page setup, vector PDF, underlay, undo and recovery wiring", async () => {
    const result = await runLayoutPlotShellHarness(new IDBFactory());
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      vectorPdf: expect.objectContaining({ pages: 1, xrefOffsetsValid: true, stableAcrossReload: true, base64: expect.stringMatching(/^JVBER/u) }),
      underlay: expect.objectContaining({ placementId: "reference-underlay", byteLength: 218, stableAcrossReload: true }),
      recovery: { revision: 12, source: "operation-log", uncleanSessionIds: ["layout-plot-crashed"] },
      undoRedo: {
        renamedRevision: 9,
        undoRevision: 10,
        undoName: "SHEET A",
        redoRevision: 11,
        redoName: "SHEET A - ISSUE 1",
      },
    }));
    expect(result.beforeCrash).toMatchObject({ revision: 12, activeLayoutId: "layout-1" });
    expect(result.afterReload).toMatchObject({ revision: 12, activeLayoutId: "layout-1", canUndo: true, canRedo: false });
    expect(result.afterReload.layouts[1]).toMatchObject({
      name: "SHEET A - ISSUE 1",
      paper: { widthMm: 420, heightMm: 297 },
      viewports: [expect.objectContaining({ scaleLabel: "1:100", locked: true, rectangular: true })],
    });
    expect(result.afterReload.pdfUnderlays).toEqual([expect.objectContaining({ id: "reference-underlay", opacity: 0.65 })]);
    expect(result.afterReload).toEqual(golden);
  });
});
