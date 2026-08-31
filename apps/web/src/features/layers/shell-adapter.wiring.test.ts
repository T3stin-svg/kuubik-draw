import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { exportSvg } from "../../../../../packages/cad-print/src/index.js";
import { CadSelectionIndex } from "../../../../../packages/cad-renderer/src/selection-index.js";
import { CadSnapIndex } from "../../../../../packages/cad-renderer/src/snap.js";
import { PrecisionLayersShellContract } from "../precision/shell-contract.js";
import { LayerManagerController } from "./controller.js";
import { LAYER_MANAGER_CAPABILITY, LayerManagerShellAdapter } from "./shell-adapter.js";

function participationDocument() {
  const document = createEmptyDocument({ documentId: "layer-shell-wiring", now: "2026-08-31T00:00:00Z" });
  document.layers = [
    { id: "normal", name: "normal", visible: true, frozen: false, locked: false, plottable: true },
    { id: "locked", name: "locked", visible: true, frozen: false, locked: false, plottable: true },
    { id: "off", name: "off", visible: true, frozen: false, locked: false, plottable: true },
    { id: "frozen", name: "frozen", visible: true, frozen: false, locked: false, plottable: true },
  ];
  document.currentLayerId = "normal";
  document.entities = document.layers.map((layer, index) => ({
    kind: "line" as const, handle: layer.id, layerId: layer.id,
    start: { x: 0, y: index * 10 }, end: { x: 5, y: index * 10 },
  }));
  return document;
}

describe("Layer Manager consumer wiring", () => {
  it("drives selection, snap, modify and print from the same locked/off/frozen policy", () => {
    const shell = new LayerManagerShellAdapter(new LayerManagerController(participationDocument()));
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.lock, layerIds: ["locked"], locked: true });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.visibility, layerIds: ["off"], visible: false });
    shell.execute({ capability: LAYER_MANAGER_CAPABILITY.freeze, layerIds: ["frozen"], frozen: true });
    const document = shell.document;
    const selection = new CadSelectionIndex();
    const snap = new CadSnapIndex();
    selection.setEntities(document.entities);
    snap.setEntities(document.entities);
    const selected = document.entities.filter((entity, index) => selection.pick({ x: 0, y: index * 10 }, 0.1, shell.eligibility("select")).some((hit) => hit.handle === entity.handle)).map((entity) => entity.handle);
    const snapped = document.entities.filter((entity, index) => snap.query({ modes: ["endpoint"], cursor: { x: 0, y: index * 10 }, aperture: 0.1 }, shell.eligibility("snap")).some((hit) => hit.handle === entity.handle)).map((entity) => entity.handle);
    const editable = document.entities.filter(shell.eligibility("edit")).map((entity) => entity.handle);
    expect(selected).toEqual(["normal", "locked"]);
    expect(snapped).toEqual(selected);
    expect(editable).toEqual(["normal"]);
    const svg = exportSvg(document, { widthMm: 297, heightMm: 210, scaleDenominator: 1, origin: { x: 0, y: 0 } }).text;
    expect(document.entities.map((entity) => [entity.handle, svg.includes(`data-handle="${entity.handle}"`)])).toEqual([
      ["normal", true], ["locked", true], ["off", false], ["frozen", false],
    ]);
  });

  it("reindexes the composed precision shell after a typed layer capability commit and history read-back", () => {
    const contract = new PrecisionLayersShellContract(participationDocument(), {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.2 },
      units: { linear: "mm", displayPrecision: 3, angularPrecision: 2 },
      initialPrecision: { osnap: true },
    });
    expect(contract.select({ x: 0, y: 0 }, 0.1).map((hit) => hit.handle)).toEqual(["normal"]);
    contract.executeLayerCapability({ capability: LAYER_MANAGER_CAPABILITY.visibility, layerIds: ["normal"], visible: false });
    expect(contract.select({ x: 0, y: 0 }, 0.1)).toEqual([]);
    expect(contract.querySnap({ x: 0, y: 0 })).toEqual([]);
    contract.undoLayer();
    expect(contract.select({ x: 0, y: 0 }, 0.1).map((hit) => hit.handle)).toEqual(["normal"]);
  });
});
