import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../../../../../packages/cad-core/src/layer-policy.js";
import { LayerManagerController } from "./controller.js";
import { LAYER_MANAGER_CAPABILITY, LAYER_MANAGER_CAPABILITY_ROWS, LayerManagerShellAdapter } from "./shell-adapter.js";

describe("F-072..F-079 complete shell wiring", () => {
  it("routes the exact feature rows and exposes complete CRUD capabilities", () => {
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.create]).toEqual(["F-072"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.rename]).toEqual(["F-072"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.delete]).toEqual(["F-072"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.current]).toEqual(["F-072"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.visibility]).toEqual(["F-073"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.lock]).toEqual(["F-074"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.freeze]).toEqual(["F-075"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.color]).toEqual(["F-076"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.linetype]).toEqual(["F-077"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.lineweight]).toEqual(["F-078"]);
    expect(LAYER_MANAGER_CAPABILITY_ROWS[LAYER_MANAGER_CAPABILITY.plot]).toEqual(["F-079"]);

    const shell = new LayerManagerShellAdapter(new LayerManagerController(createEmptyDocument({ documentId: "crud-wiring" })));
    shell.execute({ capability: "layers.create", name: "A", requestedId: "A" });
    shell.execute({ capability: "layers.rename", layerId: "A", name: "Renamed" });
    shell.execute({ capability: "layers.current", layerId: "A" });
    shell.execute({ capability: "layers.current", layerId: "0" });
    const deleted = shell.execute({ capability: "layers.delete", layerId: "A" });
    expect(deleted).toMatchObject({ capability: "layers.delete", affectedLayerIds: ["A"], document: { currentLayerId: "0", layers: [{ id: "0" }] } });
  });

  it("commits multi-entity overrides once and reopens the exact ByLayer result after Undo/Redo", () => {
    const document = createEmptyDocument({ documentId: "entity-property-wiring", now: "2026-08-31T00:00:00Z" });
    document.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
    document.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true, appearance: { color: "#112233", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.5 } });
    document.entities = ["10", "11", "12"].map((handle, index) => ({ kind: "line" as const, handle, layerId: "0", start: { x: index, y: 0 }, end: { x: index, y: 1 } }));
    const writes: number[] = [];
    const shell = new LayerManagerShellAdapter(new LayerManagerController(document, { now: () => "2026-08-31T00:01:00Z" }), { onDocumentChange: (value) => writes.push(value.revision) });
    const committed = shell.execute({
      capability: "layers.entity-properties", handles: ["10", "11", "12", "10"],
      patch: { layerId: "A", color: null, linetypeId: null, lineweightMm: null },
    });
    expect(committed).toMatchObject({
      capability: "layers.entity-properties", affectedLayerIds: ["A"],
      committed: { committedRevision: 1, operation: { commandId: "ENTITY_LAYER_PROPERTIES", targetHandles: ["10", "11", "12"], resultHandles: ["10", "11", "12"] } },
    });
    expect(writes).toEqual([1]);
    const index = createCadLayerPropertyIndex(committed.document.layers, committed.document.linetypes);
    expect(committed.document.entities.map((entity) => resolveCadEntityLayerProperties(entity, index))).toEqual([
      expect.objectContaining({ layerId: "A", color: "#112233", linetypeId: "dash", lineweightMm: 0.5 }),
      expect.objectContaining({ layerId: "A", color: "#112233", linetypeId: "dash", lineweightMm: 0.5 }),
      expect.objectContaining({ layerId: "A", color: "#112233", linetypeId: "dash", lineweightMm: 0.5 }),
    ]);
    shell.undo();
    expect(shell.document.entities.every((entity) => entity.layerId === "0")).toBe(true);
    shell.redo();
    expect(shell.document.entities.every((entity) => entity.layerId === "A")).toBe(true);
    expect(writes).toEqual([1, 2, 3]);
  });
});
