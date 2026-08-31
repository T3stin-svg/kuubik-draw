import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerManagerController } from "./controller.js";

describe("atomic Layer Manager controller", () => {
  it("commits CRUD/current/toggles/appearance as one revision each with read-back", () => {
    const source = createEmptyDocument({ documentId: "layer-controller", now: "2026-08-31T00:00:00Z" });
    source.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
    const controller = new LayerManagerController(source, { opIdPrefix: "test", now: () => "2026-08-31T00:01:00Z" });
    controller.execute({ type: "create", name: "Steel", requestedId: "steel" });
    controller.execute({ type: "rename", layerId: "steel", name: "Steel main" });
    controller.execute({ type: "toggle", layerId: "steel", property: "locked", value: true });
    controller.execute({ type: "toggle", layerId: "steel", property: "visible", value: false });
    controller.execute({ type: "toggle", layerId: "steel", property: "visible", value: true });
    controller.execute({ type: "toggle", layerId: "steel", property: "frozen", value: true });
    controller.execute({ type: "toggle", layerId: "steel", property: "frozen", value: false });
    controller.execute({ type: "toggle", layerId: "steel", property: "plottable", value: false });
    controller.execute({ type: "appearance", layerId: "steel", patch: { color: "#123456", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.5, transparency: 35 } });
    controller.execute({ type: "current", layerId: "steel" });
    expect(source.revision).toBe(0);
    expect(controller.document).toMatchObject({
      revision: 10,
      currentLayerId: "steel",
      layers: [{ id: "0" }, { id: "steel", name: "Steel main", visible: true, frozen: false, locked: true, plottable: false,
        appearance: { color: "#123456", linetypeId: "dash", lineweightMm: 0.5, transparency: 35 } }],
    });
    expect(controller.canUndo).toBe(true);
    controller.undo();
    expect(controller.document.currentLayerId).toBe("0");
    controller.redo();
    expect(controller.document.currentLayerId).toBe("steel");
  });

  it("plans failures without partial mutation and deletes only unreferenced non-current layers", () => {
    const source = createEmptyDocument({ documentId: "layer-rollback" });
    const controller = new LayerManagerController(source);
    controller.execute({ type: "create", name: "A", requestedId: "A" });
    const revision = controller.document.revision;
    expect(() => controller.execute({ type: "appearance", layerId: "A", patch: { transparency: 91 } })).toThrow("0..90");
    expect(controller.document.revision).toBe(revision);
    controller.execute({ type: "delete", layerId: "A" });
    expect(controller.document.layers.map((layer) => layer.id)).toEqual(["0"]);
  });

  it("commits draw order as one operation and one undo restores exact order", () => {
    const source = createEmptyDocument({ documentId: "draw-order" });
    source.entities = ["A", "B", "C", "D"].map((handle, x) => ({ kind: "line" as const, handle, layerId: "0", start: { x, y: 0 }, end: { x, y: 1 } }));
    const controller = new LayerManagerController(source, { now: () => "2026-08-31T00:00:00Z" });
    const result = controller.execute({ type: "draw-order", handles: ["B", "C"], action: "front" });
    expect(result.committed.operation).toMatchObject({ commandId: "DRAWORDER", targetHandles: ["B", "C"], resultHandles: ["B", "C"] });
    expect(result.document.entities.map((entity) => entity.handle)).toEqual(["A", "D", "B", "C"]);
    controller.undo();
    expect(controller.document.entities.map((entity) => entity.handle)).toEqual(["A", "B", "C", "D"]);
  });
});
