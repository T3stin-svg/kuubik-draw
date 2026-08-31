import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerManagerController } from "./controller.js";
import { LAYER_MANAGER_CAPABILITY, LayerManagerShellAdapter } from "./shell-adapter.js";

function layerDocument() {
  const document = createEmptyDocument({ documentId: "layer-shell", now: "2026-08-31T00:00:00Z" });
  document.layers.push(
    { id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true },
    { id: "B", name: "B", visible: true, frozen: false, locked: false, plottable: true },
  );
  document.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
  return document;
}

function adapter() {
  return new LayerManagerShellAdapter(new LayerManagerController(layerDocument(), {
    opIdPrefix: "shell-adapter", now: () => "2026-08-31T00:01:00Z",
  }));
}

describe("DOM-independent Layer Manager shell adapter", () => {
  it("creates and activates a layer with exact typed read-back", () => {
    const shell = adapter();
    const created = shell.execute({ capability: LAYER_MANAGER_CAPABILITY.create, name: "Steel", requestedId: "steel" });
    expect(created).toMatchObject({
      capability: "layers.create", affectedLayerIds: ["steel"],
      committed: { committedRevision: 1, operation: { commandId: "LAYER_CREATE", baseRevision: 0 } },
      document: { revision: 1, layers: [{ id: "0" }, { id: "A" }, { id: "B" }, { id: "steel", name: "Steel" }] },
    });
    const current = shell.execute({ capability: LAYER_MANAGER_CAPABILITY.current, layerId: "steel" });
    expect(current.document).toMatchObject({ revision: 2, currentLayerId: "steel" });
    expect(shell.readLayers(["steel"])).toEqual([expect.objectContaining({ id: "steel", name: "Steel" })]);
  });

  it("covers on/off, freeze/thaw, lock/unlock and every appearance property", () => {
    const shell = adapter();
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.visibility, layerIds: ["A"], visible: false });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.visibility, layerIds: ["A"], visible: true });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.freeze, layerIds: ["A"], frozen: true });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.freeze, layerIds: ["A"], frozen: false });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.lock, layerIds: ["A"], locked: true });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.lock, layerIds: ["A"], locked: false });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.color, layerIds: ["A"], color: "#123456", colorMethod: "trueColor" });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.linetype, layerIds: ["A"], linetypeId: "dash" });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.lineweight, layerIds: ["A"], lineweightMm: 0.5 });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.transparency, layerIds: ["A"], transparency: 35 });
    const plotted = shell.execute({ capability: LAYER_MANAGER_CAPABILITY.plot, layerIds: ["A"], plottable: false });
    expect(plotted.document.revision).toBe(11);
    expect(plotted.document.layers.find((layer) => layer.id === "A")).toMatchObject({
      id: "A", visible: true, frozen: false, locked: false, plottable: false,
      appearance: { color: "#123456", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.5, transparency: 35 },
    });
  });

  it("applies a mixed property patch to several layers in one revision and one Undo", () => {
    const shell = adapter();
    const before = shell.document;
    const committed = shell.execute({
      capability: LAYER_MANAGER_CAPABILITY.properties,
      layerIds: ["A", "B", "A"],
      patch: { locked: true, plottable: false, color: "#abcdef", linetypeId: "dash", lineweightMm: 0.35, transparency: 42 },
    });
    expect(committed).toMatchObject({
      affectedLayerIds: ["A", "B"],
      committed: { committedRevision: 1, operation: { commandId: "LAYER_BATCH_PROPERTIES", baseRevision: 0 } },
    });
    expect(committed.committed.changes).toHaveLength(2);
    expect(shell.readLayers(["A", "B"])).toEqual([
      expect.objectContaining({ id: "A", locked: true, plottable: false, appearance: expect.objectContaining({ color: "#abcdef", transparency: 42 }) }),
      expect.objectContaining({ id: "B", locked: true, plottable: false, appearance: expect.objectContaining({ color: "#abcdef", transparency: 42 }) }),
    ]);
    expect(shell.undo()?.document).toEqual({ ...before, revision: 2, metadata: { ...before.metadata, updatedAt: "2026-08-31T00:01:00Z" } });
    expect(shell.redo()?.document.layers).toEqual(committed.document.layers);
  });
});
