import { describe, expect, it } from "vitest";
import type { CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  DuplicateOperationError,
  NoOpOperationError,
  RevisionConflictError,
  applyAtomicOperation,
  createEmptyDocument,
  replaceDrawingContent,
  replaceDrawingContentPreservingLayouts,
} from "../src/index.js";

const line = {
  kind: "line" as const,
  handle: "10",
  layerId: "0",
  start: { x: 0.125, y: 0 },
  end: { x: 100.5, y: 0 },
};

function operation(baseRevision = 0): CadOperation {
  return {
    opId: "op-1",
    baseRevision,
    commandId: "LINE",
    args: { start: line.start, end: line.end },
    targetHandles: [],
    resultHandles: [line.handle],
  };
}

describe("atomic document transaction", () => {
  it("commits all changes in one revision and leaves its input untouched", () => {
    const source = createEmptyDocument({ documentId: "d", now: "2026-08-28T00:00:00Z" });
    const snapshot = structuredClone(source);
    const result = applyAtomicOperation(source, operation(), [{ type: "put", entity: line }], "2026-08-28T00:01:00Z");
    expect(source).toEqual(snapshot);
    expect(result.document.revision).toBe(1);
    expect(result.document.entities).toEqual([line]);
    expect(result.committed.inverseChanges).toEqual([{ type: "delete", handle: "10" }]);
  });

  it("rejects stale revisions before changing geometry", () => {
    const source = createEmptyDocument({ documentId: "d" });
    expect(() => applyAtomicOperation(source, operation(4), [{ type: "put", entity: line }])).toThrow(
      RevisionConflictError,
    );
    expect(source.entities).toEqual([]);
  });

  it("makes a multi-entity command one undo/redo step", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "d" }));
    const second = { ...line, handle: "11", start: { x: 0, y: 10 }, end: { x: 100, y: 10 } };
    session.commit(
      { ...operation(), resultHandles: ["10", "11"] },
      [
        { type: "put", entity: line },
        { type: "put", entity: second },
      ],
    );
    expect(session.document.entities).toHaveLength(2);
    session.undo();
    expect(session.document.entities).toHaveLength(0);
    session.redo();
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
  });

  it("forks a live session without losing its multi-command undo history", () => {
    const first = new CadSession(createEmptyDocument({ documentId: "fork" }));
    first.commit(operation(), [{ type: "put", entity: line }]);
    const fork = first.fork();
    fork.commit(
      { ...operation(1), opId: "op-2", resultHandles: ["11"] },
      [{ type: "put", entity: { ...line, handle: "11" } }],
    );
    expect(fork.document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
    expect(fork.nextUndoCommandId).toBe("LINE");
    fork.undo();
    expect(fork.nextRedoCommandId).toBe("LINE");
    fork.undo();
    expect(fork.document.entities).toEqual([]);
    expect(first.document.entities.map((entity) => entity.handle)).toEqual(["10"]);
  });

  it("rejects semantic no-ops without incrementing revision", () => {
    const source = createEmptyDocument({ documentId: "d" });
    expect(() => applyAtomicOperation(source, operation(), [])).toThrow(NoOpOperationError);
    expect(source.revision).toBe(0);
  });

  it("records and consumes an explicit undo marker without changing geometry", () => {
    const source = createEmptyDocument({ documentId: "undo-marker" });
    source.entities.push(line);
    const session = new CadSession(source);
    const markerOperation = { ...operation(), commandId: "SCALE", targetHandles: ["10"], resultHandles: [] };
    session.commit(markerOperation, [{ type: "undo-mark" }]);
    expect(session.document).toMatchObject({ revision: 1, entities: [line] });
    expect(session.canUndo).toBe(true);
    expect(session.undo()?.changes).toEqual([{ type: "undo-mark" }]);
    expect(session.document).toMatchObject({ revision: 2, entities: [line] });
    expect(session.canRedo).toBe(true);
  });

  it("rejects an already-applied opId after session recovery", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "d" }), ["op-1"]);
    expect(() => session.commit(operation(), [{ type: "put", entity: line }])).toThrow(DuplicateOperationError);
    expect(session.document.revision).toBe(0);
  });

  it("commits layer creation/current-layer/lock changes atomically and undoes them", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "layers" }));
    const layer = { id: "layer-1", name: "Layer 1", visible: true, frozen: false, locked: false, plottable: true };
    session.commit(
      { opId: "layer-new", baseRevision: 0, commandId: "LAYER_NEW", args: {}, targetHandles: [], resultHandles: [] },
      [{ type: "put-layer", layer }, { type: "set-current-layer", layerId: layer.id }],
    );
    expect(session.document.currentLayerId).toBe("layer-1");
    expect(session.document.layers).toContainEqual(layer);
    session.commit(
      { opId: "layer-lock", baseRevision: 1, commandId: "LAYER_LOCK", args: {}, targetHandles: [], resultHandles: [] },
      [{ type: "put-layer", layer: { ...layer, locked: true } }],
    );
    expect(session.document.layers.find((candidate) => candidate.id === layer.id)?.locked).toBe(true);
    session.undo();
    expect(session.document.layers.find((candidate) => candidate.id === layer.id)?.locked).toBe(false);
  });

  it("rejects an invalid layout collection at the atomic transaction boundary", () => {
    const source = createEmptyDocument({ documentId: "layout-boundary" });
    const sourceSnapshot = structuredClone(source);
    const paper = {
      id: "layout-1",
      name: "Layout 1",
      kind: "paper" as const,
      viewports: [],
      entities: [],
    };
    const invalidLayouts = [paper, source.layouts[0]!];
    expect(() => applyAtomicOperation(
      source,
      { ...operation(), commandId: "LAYOUT_SET" },
      [{ type: "set-layouts", layouts: invalidLayouts }],
    )).toThrow(/model layout must remain first/i);
    expect(source).toEqual(sourceSnapshot);
  });

  it("replaces all drawing content in one import revision and restores it with one undo/redo", () => {
    const source = createEmptyDocument({ documentId: "drawing-import", now: "2026-08-29T08:00:00Z" });
    source.entities = [line];
    const imported = createEmptyDocument({ documentId: "external", now: "2026-08-29T08:01:00Z", units: "m" });
    imported.layers = [
      { id: "imported", name: "IMPORTED", visible: true, frozen: false, locked: false, plottable: true },
    ];
    imported.currentLayerId = "imported";
    imported.linetypes = [{ id: "dash", name: "DASHED", pattern: [1, -0.5] }];
    imported.textStyles = [{ id: "txt", name: "Standard", fontFamily: "txt", widthFactor: 1, obliqueAngleRad: 0 }];
    imported.dimensionStyles = [{ id: "dim", name: "Standard", textStyleId: "txt", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 }];
    imported.entities = [{ kind: "circle", handle: "AA", layerId: "imported", center: { x: 5, y: 6 }, radius: 2 }];

    const session = new CadSession(source);
    session.commit(
      { opId: "dxfin", baseRevision: 0, commandId: "DXFIN", args: {}, targetHandles: ["10"], resultHandles: ["AA"] },
      [replaceDrawingContent(imported)],
    );
    expect(session.document).toMatchObject({
      revision: 1,
      units: { linear: "m" },
      currentLayerId: "imported",
      entities: imported.entities,
      layers: imported.layers,
      linetypes: imported.linetypes,
      textStyles: imported.textStyles,
      dimensionStyles: imported.dimensionStyles,
    });
    expect(session.document.layouts).toEqual(source.layouts);
    session.undo();
    expect(session.document).toMatchObject({ revision: 2, units: source.units, entities: source.entities, layers: source.layers });
    session.redo();
    expect(session.document).toMatchObject({ revision: 3, units: imported.units, entities: imported.entities, layers: imported.layers });
  });

  it("retains and deterministically remaps paper-space dependencies and colliding handles in the same import undo step", () => {
    const source = createEmptyDocument({ documentId: "paper-import", now: "2026-08-29T08:00:00Z" });
    source.linetypes.push({ id: "paper-lt", name: "PAPER DASH", pattern: [2, -1] });
    source.textStyles.push({ id: "paper-txt", name: "PAPER TEXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    source.layers.push({ id: "dxf-layer:JOONED", name: "PAPER TITLE", visible: true, frozen: false, locked: false, plottable: true, appearance: { linetypeId: "paper-lt" } });
    source.blocks.push({
      id: "title-block",
      name: "TITLE BLOCK",
      basePoint: { x: 0, y: 0 },
      entities: [{ kind: "text", handle: "1001", layerId: "dxf-layer:JOONED", position: { x: 10, y: 10 }, text: "SHEET", height: 3, rotationRad: 0, styleId: "paper-txt" }],
    });
    source.layouts.push({
      id: "sheet",
      name: "Sheet",
      kind: "paper",
      paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [{ id: "vp", center: { x: 100, y: 80 }, width: 180, height: 120, viewCenter: { x: 0, y: 0 }, viewHeight: 5000, twistAngleRad: 0, locked: true, layerOverrides: { "dxf-layer:JOONED": { frozen: true, linetypeId: "paper-lt" } } }],
      entities: [{ kind: "blockRef", handle: "1000", layerId: "dxf-layer:JOONED", blockId: "title-block", insertion: { x: 10, y: 10 }, scale: { x: 1, y: 1 }, rotationRad: 0 }],
    });
    const imported = createEmptyDocument({ documentId: "external", now: "2026-08-29T08:01:00Z" });
    imported.layers = [{ id: "dxf-layer:JOONED", name: "JOONED", visible: true, frozen: false, locked: false, plottable: true }];
    imported.currentLayerId = "dxf-layer:JOONED";
    imported.entities = [
      { kind: "line", handle: "1000", layerId: "dxf-layer:JOONED", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: "line", handle: "1001", layerId: "dxf-layer:JOONED", start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
    ];

    const session = new CadSession(source);
    session.commit(
      { opId: "paper-dxfin", baseRevision: 0, commandId: "DXFIN", args: {}, targetHandles: [], resultHandles: ["1000", "1001"] },
      replaceDrawingContentPreservingLayouts(source, imported),
    );
    const paper = session.document.layouts.find((layout) => layout.id === "sheet")!;
    const paperEntity = paper.entities![0]!;
    expect(paperEntity.handle).not.toBe("1000");
    expect(session.document.entities.map((entity) => entity.handle)).toEqual(["1000", "1001"]);
    expect(session.document.layers.find((layer) => layer.id === paperEntity.layerId)).toMatchObject({ name: "PAPER TITLE", appearance: { linetypeId: expect.stringContaining("paper-lt") } });
    expect(session.document.blocks.find((block) => block.id === (paperEntity.kind === "blockRef" ? paperEntity.blockId : ""))?.entities[0]).toMatchObject({ kind: "text", text: "SHEET", styleId: expect.stringContaining("paper-txt") });
    expect(Object.keys(paper.viewports[0]!.layerOverrides ?? {})).toEqual([paperEntity.layerId]);
    session.undo();
    expect(session.document.layouts).toEqual(source.layouts);
    session.redo();
    expect(session.document.layouts.find((layout) => layout.id === "sheet")).toEqual(paper);
  });

  it("duplicates a shallow-equal paper layer when its same-id linetype has different imported semantics", () => {
    const source = createEmptyDocument({ documentId: "paper-layer-dependency", now: "2026-08-29T08:00:00Z" });
    source.linetypes.push({ id: "shared-lt", name: "SHARED", pattern: [2, -1] });
    const paperLayer = { id: "paper-layer", name: "PAPER", visible: true, frozen: false, locked: false, plottable: true, appearance: { linetypeId: "shared-lt" } } as const;
    source.layers.push(structuredClone(paperLayer));
    source.layouts.push({
      id: "sheet",
      name: "Sheet",
      kind: "paper",
      paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [],
      entities: [{ kind: "line", handle: "2000", layerId: "paper-layer", start: { x: 10, y: 10 }, end: { x: 100, y: 10 } }],
    });
    const imported = createEmptyDocument({ documentId: "external", now: "2026-08-29T08:01:00Z" });
    imported.linetypes.push({ id: "shared-lt", name: "SHARED", pattern: [1, -1] });
    imported.layers.push(structuredClone(paperLayer));

    const session = new CadSession(source);
    session.commit(
      { opId: "paper-layer-dxfin", baseRevision: 0, commandId: "DXFIN", args: {}, targetHandles: [], resultHandles: [] },
      replaceDrawingContentPreservingLayouts(source, imported),
    );

    const retainedEntity = session.document.layouts.find((layout) => layout.id === "sheet")!.entities![0]!;
    expect(retainedEntity.layerId).not.toBe("paper-layer");
    const retainedLayer = session.document.layers.find((layer) => layer.id === retainedEntity.layerId)!;
    expect(retainedLayer.name).toMatch(/^PAPER \[paper \d+\]$/u);
    expect(retainedLayer.appearance?.linetypeId).not.toBe("shared-lt");
    expect(session.document.linetypes.find((linetype) => linetype.id === retainedLayer.appearance?.linetypeId)?.pattern).toEqual([2, -1]);
    expect(session.document.layers.find((layer) => layer.id === "paper-layer")?.appearance?.linetypeId).toBe("shared-lt");
    expect(session.document.linetypes.find((linetype) => linetype.id === "shared-lt")?.pattern).toEqual([1, -1]);
  });

  it("duplicates colliding paper blocks and dimension styles after transitive text-style remapping", () => {
    const source = createEmptyDocument({ documentId: "paper-block-dependency", now: "2026-08-29T08:00:00Z" });
    source.textStyles.push({ id: "shared-text", name: "SHARED TEXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    source.dimensionStyles.push({ id: "shared-dim", name: "SHARED DIM", textStyleId: "shared-text", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 });
    source.blocks.push({
      id: "shared-block",
      name: "SHARED BLOCK",
      basePoint: { x: 0, y: 0 },
      entities: [{ kind: "dimension", handle: "3000", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }], styleId: "shared-dim" }],
    });
    source.layouts.push({
      id: "sheet",
      name: "Sheet",
      kind: "paper",
      paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [],
      entities: [{ kind: "blockRef", handle: "3001", layerId: "0", blockId: "shared-block", insertion: { x: 10, y: 10 }, scale: { x: 1, y: 1 }, rotationRad: 0 }],
    });
    const imported = createEmptyDocument({ documentId: "external", now: "2026-08-29T08:01:00Z" });
    imported.textStyles.push({ id: "shared-text", name: "SHARED TEXT", fontFamily: "txt", widthFactor: 1, obliqueAngleRad: 0 });
    imported.dimensionStyles = structuredClone(source.dimensionStyles);
    imported.blocks = structuredClone(source.blocks);

    const session = new CadSession(source);
    session.commit(
      { opId: "paper-block-dxfin", baseRevision: 0, commandId: "DXFIN", args: {}, targetHandles: [], resultHandles: [] },
      replaceDrawingContentPreservingLayouts(source, imported),
    );

    const retainedReference = session.document.layouts.find((layout) => layout.id === "sheet")!.entities![0]!;
    expect(retainedReference.kind).toBe("blockRef");
    const retainedBlockId = retainedReference.kind === "blockRef" ? retainedReference.blockId : "";
    expect(retainedBlockId).not.toBe("shared-block");
    const retainedDimension = session.document.blocks.find((block) => block.id === retainedBlockId)!.entities[0]!;
    expect(retainedDimension.kind).toBe("dimension");
    const retainedDimensionStyleId = retainedDimension.kind === "dimension" ? retainedDimension.styleId : "";
    expect(retainedDimensionStyleId).not.toBe("shared-dim");
    const retainedDimensionStyle = session.document.dimensionStyles.find((style) => style.id === retainedDimensionStyleId)!;
    expect(retainedDimensionStyle.textStyleId).not.toBe("shared-text");
    expect(session.document.textStyles.find((style) => style.id === retainedDimensionStyle.textStyleId)?.fontFamily).toBe("Arial");
    expect(session.document.textStyles.find((style) => style.id === "shared-text")?.fontFamily).toBe("txt");
  });

  it("remaps both sides of a colliding nested paper-block cycle without reusing imported definitions", () => {
    const source = createEmptyDocument({ documentId: "paper-block-cycle", now: "2026-08-29T08:00:00Z" });
    source.blocks = [
      { id: "cycle-a", name: "CYCLE A", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "4000", layerId: "0", blockId: "cycle-b", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
      { id: "cycle-b", name: "CYCLE B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "blockRef", handle: "4001", layerId: "0", blockId: "cycle-a", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0 }] },
    ];
    source.layouts.push({
      id: "sheet",
      name: "Sheet",
      kind: "paper",
      paper: { widthMm: 297, heightMm: 210, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
      viewports: [],
      entities: [{ kind: "blockRef", handle: "4002", layerId: "0", blockId: "cycle-a", insertion: { x: 10, y: 10 }, scale: { x: 1, y: 1 }, rotationRad: 0 }],
    });
    const imported = createEmptyDocument({ documentId: "external", now: "2026-08-29T08:01:00Z" });
    imported.blocks = structuredClone(source.blocks);

    const session = new CadSession(source);
    session.commit(
      { opId: "paper-cycle-dxfin", baseRevision: 0, commandId: "DXFIN", args: {}, targetHandles: [], resultHandles: [] },
      replaceDrawingContentPreservingLayouts(source, imported),
    );

    const retainedReference = session.document.layouts.find((layout) => layout.id === "sheet")!.entities![0]!;
    expect(retainedReference.kind).toBe("blockRef");
    const retainedAId = retainedReference.kind === "blockRef" ? retainedReference.blockId : "";
    expect(retainedAId).not.toBe("cycle-a");
    const retainedAReference = session.document.blocks.find((block) => block.id === retainedAId)!.entities[0]!;
    expect(retainedAReference.kind).toBe("blockRef");
    const retainedBId = retainedAReference.kind === "blockRef" ? retainedAReference.blockId : "";
    expect(retainedBId).not.toBe("cycle-b");
    const retainedBReference = session.document.blocks.find((block) => block.id === retainedBId)!.entities[0]!;
    expect(retainedBReference).toMatchObject({ kind: "blockRef", blockId: retainedAId });
  });

  it("refuses a unit change while retained paper-space content would become dimensionally ambiguous", () => {
    const source = createEmptyDocument({ documentId: "unit-policy" });
    source.layouts.push({ id: "sheet", name: "Sheet", kind: "paper", viewports: [{ id: "vp", center: { x: 100, y: 80 }, width: 180, height: 120, viewCenter: { x: 1000, y: 1000 }, viewHeight: 5000, twistAngleRad: 0, locked: true }], entities: [] });
    const imported = createEmptyDocument({ documentId: "external", units: "m" });
    expect(() => replaceDrawingContentPreservingLayouts(source, imported)).toThrow(/units m cannot replace mm model units while unit-sensitive layout state exists/i);
    expect(source.revision).toBe(0);
  });

  it("refuses a unit change while an explicit model-space page setup retains drawing-unit coordinates", () => {
    const source = createEmptyDocument({ documentId: "model-page-setup-units" });
    source.layouts[0]!.pageSetup = {
      mediaName: "ISO_A4",
      orientation: "portrait",
      plotArea: { kind: "window", window: { x: 10, y: 20, width: 100, height: 200 } },
      plotScale: { mode: "custom", paperUnits: 1, drawingUnits: 50 },
      centerPlot: false,
      plotOriginMm: { x: 5, y: 6 },
    };
    const imported = createEmptyDocument({ documentId: "external", units: "m" });
    expect(() => replaceDrawingContentPreservingLayouts(source, imported)).toThrow(/unit-sensitive layout state exists/i);
    expect(source.layouts[0]!.pageSetup?.plotArea).toEqual({ kind: "window", window: { x: 10, y: 20, width: 100, height: 200 } });
  });
});
