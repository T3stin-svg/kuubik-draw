import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerManagerController } from "./controller.js";
import {
  LAYER_MANAGER_CAPABILITY,
  LAYER_MANAGER_CAPABILITY_ROWS,
  LayerManagerShellAdapter,
} from "./shell-adapter.js";

function mutationDocument() {
  const document = createEmptyDocument({ documentId: "layer-shell-mutation", now: "2026-08-31T00:00:00Z" });
  document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
  document.entities = ["A", "B", "C"].map((handle, x) => ({
    kind: "line" as const, handle, layerId: "A", start: { x, y: 0 }, end: { x, y: 1 },
  }));
  return document;
}

describe("Layer Manager shell mutation guards", () => {
  it("rejects a late invalid layer without committing the earlier planned patch", () => {
    const changed: number[] = [];
    const shell = new LayerManagerShellAdapter(new LayerManagerController(mutationDocument()), {
      onDocumentChange: (document) => changed.push(document.revision),
    });
    const before = shell.document;
    expect(() => shell.execute({
      capability: LAYER_MANAGER_CAPABILITY.properties,
      layerIds: ["A", "0"],
      patch: { color: "#123456", frozen: true },
    })).toThrow("Current layer cannot be frozen");
    expect(shell.document).toEqual(before);
    expect(changed).toEqual([]);
    expect(shell.canUndo).toBe(false);
  });

  it("kills split-operation and inexact history mutations", () => {
    const shell = new LayerManagerShellAdapter(new LayerManagerController(mutationDocument(), { now: () => "2026-08-31T00:01:00Z" }));
    const before = shell.document;
    const committed = shell.execute({
      capability: LAYER_MANAGER_CAPABILITY.properties,
      layerIds: ["A", "0"],
      patch: { locked: true, transparency: 25 },
    });
    expect(committed.committed).toMatchObject({ committedRevision: 1, operation: { commandId: "LAYER_BATCH_PROPERTIES", baseRevision: 0 } });
    expect(committed.committed.changes).toHaveLength(2);
    const after = committed.document;
    expect(shell.undo()).toMatchObject({ document: { revision: 2 } });
    expect(shell.document.layers).toEqual(before.layers);
    expect(shell.redo()).toMatchObject({ document: { revision: 3 } });
    expect(shell.document.layers).toEqual(after.layers);
  });

  it("uses a typed draw-order capability while leaving F-086 as conflict metadata", () => {
    const shell = new LayerManagerShellAdapter(new LayerManagerController(mutationDocument()));
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.drawOrder]).toEqual(["F-086"]);
    expect(shell.canExecute(LAYER_MANAGER_CAPABILITY.drawOrder, "model")).toBe(true);
    expect(shell.canExecute(LAYER_MANAGER_CAPABILITY.drawOrder, "paper")).toBe(false);
    const committed = shell.execute({ capability: LAYER_MANAGER_CAPABILITY.drawOrder, handles: ["A"], action: "front" });
    expect(committed).toMatchObject({ capability: "layers.draw-order", affectedLayerIds: [], committed: { operation: { commandId: "DRAWORDER" } } });
    expect(committed.document.entities.map((entity) => entity.handle)).toEqual(["B", "C", "A"]);
  });
});
