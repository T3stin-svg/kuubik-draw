import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function createLayerContract() {
  const document = createEmptyDocument({ documentId: "shell-mutation", now: "2026-08-31T00:00:00Z" });
  document.entities = ["A", "B", "C"].map((handle, x) => ({ kind: "line" as const, handle, layerId: "0", start: { x, y: 0 }, end: { x, y: 1 } }));
  return new PrecisionLayersShellContract(document, {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.2 },
    units: { linear: "mm", displayPrecision: 3, angularPrecision: 2 },
    layerController: { opIdPrefix: "mutation", now: () => "2026-08-31T00:01:00Z" },
  });
}

describe("precision/layers shell mutation guards", () => {
  it("kills split-transaction and missing read-back mutations with exact Undo/Redo", () => {
    const contract = createLayerContract();
    const committed = contract.executeLayer({ type: "create", name: "Steel", requestedId: "steel" });
    expect(committed).toMatchObject({ document: { revision: 1, layers: [{ id: "0" }, { id: "steel" }] }, committed: { committedRevision: 1 } });
    expect(contract.undoLayer()).toMatchObject({ document: { revision: 2, layers: [{ id: "0" }] } });
    expect(contract.redoLayer()).toMatchObject({ document: { revision: 3, layers: [{ id: "0" }, { id: "steel" }] } });

    const revision = contract.document.revision;
    expect(() => contract.executeLayer({ type: "appearance", layerId: "steel", patch: { transparency: 91 } })).toThrow("0..90");
    expect(contract.document.revision).toBe(revision);
  });

  it("restores exact draw order in one Undo and reindexes after every read-back", () => {
    const contract = createLayerContract();
    contract.executeLayer({ type: "draw-order", handles: ["A"], action: "front" });
    expect(contract.document.entities.map((entity) => entity.handle)).toEqual(["B", "C", "A"]);
    expect(contract.select({ x: 0, y: 0 }, 0.1).map((hit) => hit.handle)).toEqual(["A"]);
    contract.undoLayer();
    expect(contract.document.entities.map((entity) => entity.handle)).toEqual(["A", "B", "C"]);
    contract.redoLayer();
    expect(contract.document.entities.map((entity) => entity.handle)).toEqual(["B", "C", "A"]);
  });
});
