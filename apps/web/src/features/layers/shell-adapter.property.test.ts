import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerManagerController } from "./controller.js";
import { LAYER_MANAGER_CAPABILITY, LayerManagerShellAdapter } from "./shell-adapter.js";

function seeded(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

describe("Layer Manager seeded property contract", () => {
  it("round-trips 512 atomic multi-layer patches through exact Undo and Redo", () => {
    for (let index = 1; index <= 512; index += 1) {
      const value = seeded(index);
      const document = createEmptyDocument({ documentId: `layer-property-${index}`, now: "2026-08-31T00:00:00Z" });
      document.layers.push(
        { id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true },
        { id: "B", name: "B", visible: true, frozen: false, locked: false, plottable: true },
      );
      document.linetypes.push({ id: "dash", name: "DASHED", pattern: [2, -1] });
      const shell = new LayerManagerShellAdapter(new LayerManagerController(document, { now: () => "2026-08-31T00:01:00Z" }));
      const before = shell.document;
      const color = `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
      const committed = shell.execute({
        capability: LAYER_MANAGER_CAPABILITY.properties,
        layerIds: index % 3 === 0 ? ["A", "B", "A"] : ["A", "B"],
        patch: {
          visible: (value & 1) === 0,
          frozen: (value & 2) !== 0,
          locked: (value & 4) !== 0,
          plottable: (value & 8) === 0,
          color, colorMethod: "trueColor", linetypeId: "dash",
          lineweightMm: ((value % 200) + 1) / 100,
          transparency: value % 91,
        },
      });
      expect(committed.committed).toMatchObject({ committedRevision: 1, operation: { commandId: "LAYER_BATCH_PROPERTIES", baseRevision: 0 } });
      expect(committed.affectedLayerIds).toEqual(["A", "B"]);
      expect(committed.document.layers.filter((layer) => layer.id === "A" || layer.id === "B")).toEqual([
        expect.objectContaining({ appearance: expect.objectContaining({ color }) }),
        expect.objectContaining({ appearance: expect.objectContaining({ color }) }),
      ]);
      const after = committed.document;
      expect(shell.undo()?.document.layers).toEqual(before.layers);
      expect(shell.redo()?.document.layers).toEqual(after.layers);
    }
  });
});
