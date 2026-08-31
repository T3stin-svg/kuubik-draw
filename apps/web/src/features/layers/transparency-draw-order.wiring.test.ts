import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { resolveCadAppearance } from "../../../../../packages/cad-core/src/plot-style.js";
import { exportSvg } from "../../../../../packages/cad-print/src/index.js";
import { CadCanvasRenderer, type Canvas2DContext } from "../../../../../packages/cad-renderer/src/renderer.js";
import { LayerManagerController } from "./controller.js";
import { LAYER_MANAGER_CAPABILITY, LAYER_MANAGER_CAPABILITY_ROWS, LayerManagerShellAdapter } from "./shell-adapter.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "f080-f086-wiring", now: "2026-08-31T00:00:00Z" });
  document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true, appearance: { transparency: 40 } });
  document.entities = ["A", "B", "C"].map((handle, x) => ({
    kind: "line" as const, handle, layerId: "A", start: { x, y: 0 }, end: { x, y: 10 },
  }));
  document.entities[1]!.appearance = { transparency: 20 };
  return document;
}

function renderingReadback(document: ReturnType<typeof fixture>) {
  const strokes: number[] = [];
  const context: Canvas2DContext = {
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined, arc: () => undefined, ellipse: () => undefined,
    stroke: () => strokes.push(context.globalAlpha), fill: () => undefined, fillText: () => undefined,
    save: () => undefined, restore: () => undefined, scale: () => undefined, rotate: () => undefined,
    translate: () => undefined, clearRect: () => undefined, setLineDash: () => undefined,
    strokeStyle: "#fff", fillStyle: "#fff", lineWidth: 1, globalAlpha: 1, font: "10px sans-serif", textAlign: "left",
  };
  const renderer = new CadCanvasRenderer();
  renderer.setEntities(document.entities);
  renderer.render(context, { world: { minX: -1, minY: -1, maxX: 4, maxY: 11 }, widthPx: 100, heightPx: 100, devicePixelRatio: 1 }, document.layers, null, [], {
    plotStyle: { profile: "color", plotLineweights: true, plotTransparency: true }, pixelsPerMillimeter: 4,
  });
  const svg = exportSvg(document, { widthMm: 297, heightMm: 210, scaleDenominator: 1, origin: { x: 0, y: 0 } }).text;
  return { strokes, svg };
}

describe("F-080/F-086 renderer, print and shell wiring", () => {
  it("routes layer and entity transparency through the typed F-080 capability", () => {
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.transparency]).toEqual(["F-080"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.entityProperties]).toContain("F-080");
    const shell = new LayerManagerShellAdapter(new LayerManagerController(fixture(), { now: () => "2026-08-31T00:01:00Z" }));
    shell.execute({ capability: "layers.transparency", layerIds: ["A"], transparency: 37.125 });
    shell.execute({ capability: "layers.entity-properties", handles: ["B"], patch: { transparency: 62.875 } });
    expect(resolveCadAppearance(shell.document.entities[0]!, shell.document.layers).transparencyPercent).toBe(37.125);
    expect(resolveCadAppearance(shell.document.entities[1]!, shell.document.layers).transparencyPercent).toBe(62.875);
    shell.execute({ capability: "layers.entity-properties", handles: ["B"], patch: { transparency: null } });
    expect(resolveCadAppearance(shell.document.entities[1]!, shell.document.layers).transparencyPercent).toBe(37.125);
    expect(shell.document.entities[1]!.appearance).toBeUndefined();
  });

  it("uses domain opacity in the renderer and exact entity order/opacity in print output", () => {
    const shell = new LayerManagerShellAdapter(new LayerManagerController(fixture()));
    shell.execute({ capability: "layers.draw-order", handles: ["A"], action: "front" });
    const { strokes, svg } = renderingReadback(shell.document as ReturnType<typeof fixture>);
    expect(shell.readDrawOrder()).toEqual({ orderedHandles: ["B", "C", "A"], backHandle: "B", frontHandle: "A" });
    expect([...strokes].sort((left, right) => left - right)).toEqual([0.6, 0.6, 0.8]);
    expect(svg).toContain('data-handle="B" data-source-color="#ffffff" data-plot-color="#000000" data-lineweight-mm="0.25" data-opacity="0.8"');
    expect(svg).toContain('data-handle="A" data-source-color="#ffffff" data-plot-color="#000000" data-lineweight-mm="0.25" data-opacity="0.6"');
    expect(svg.indexOf('data-handle="B"')).toBeLessThan(svg.indexOf('data-handle="C"'));
    expect(svg.indexOf('data-handle="C"')).toBeLessThan(svg.indexOf('data-handle="A"'));
  });

  it("commits one revision, reopens exact JSON order, and restores it with one Undo/Redo", () => {
    const revisions: number[] = [];
    const shell = new LayerManagerShellAdapter(new LayerManagerController(fixture()), { onDocumentChange: (document) => revisions.push(document.revision) });
    const before = shell.document.entities.map((entity) => entity.handle);
    const committed = shell.execute({ capability: "layers.draw-order", handles: ["C", "A"], action: "back" });
    const after = committed.document.entities.map((entity) => entity.handle);
    expect(committed.committed).toMatchObject({ committedRevision: 1, operation: { commandId: "DRAWORDER", baseRevision: 0, targetHandles: ["A", "C"], resultHandles: ["A", "C"] } });
    expect(after).toEqual(["A", "C", "B"]);
    expect(committed.committed.changes).toHaveLength(4);
    const reopened = new LayerManagerShellAdapter(new LayerManagerController(JSON.parse(JSON.stringify(committed.document))));
    expect(reopened.readDrawOrder().orderedHandles).toEqual(after);
    shell.undo();
    expect(shell.document.entities.map((entity) => entity.handle)).toEqual(before);
    shell.redo();
    expect(shell.document.entities.map((entity) => entity.handle)).toEqual(after);
    expect(revisions).toEqual([1, 2, 3]);
  });

  it("does not notify, revise or create history when a locked entity is targeted", () => {
    const document = fixture();
    document.layers[1] = { ...document.layers[1]!, locked: true };
    const revisions: number[] = [];
    const shell = new LayerManagerShellAdapter(new LayerManagerController(document), { onDocumentChange: (value) => revisions.push(value.revision) });
    const before = shell.document;
    expect(() => shell.execute({ capability: "layers.draw-order", handles: ["A"], action: "front" })).toThrow("layer-locked");
    expect(() => shell.execute({ capability: "layers.entity-properties", handles: ["A"], patch: { transparency: 20 } })).toThrow("locked layer");
    expect(shell.document).toEqual(before);
    expect(shell.canUndo).toBe(false);
    expect(revisions).toEqual([]);
  });
});
