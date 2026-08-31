import { assertKDrawDocumentV1, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import golden from "./layers-complete.golden.json";
import { createEmptyDocument } from "../src/document.js";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties } from "../src/layer-policy.js";
import {
  planCreateLayer,
  planDeleteLayer,
  planRenameLayer,
  planSetEntityLayerProperties,
  planSetLayerToggle,
  readCadLayerContract,
} from "../src/layers.js";
import { CadSession } from "../src/transaction.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "layers-complete", now: "2026-08-31T00:00:00Z" });
  document.linetypes = [
    { id: "continuous", name: "Continuous", pattern: [] },
    { id: "dash", name: "DASHED", pattern: [2, -1] },
  ];
  document.layers.push({
    id: "steel", name: "Steel", visible: true, frozen: false, locked: false, plottable: true,
    appearance: { color: "#336699", colorMethod: "trueColor", linetypeId: "dash", linetypeScale: 2, lineweightMm: 0.5, transparency: 25 },
  });
  document.entities = [
    { kind: "line", handle: "10", layerId: "steel", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { kind: "line", handle: "11", layerId: "steel", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "continuous", linetypeScale: 0.5, lineweightMm: 0.7, transparency: 40 }, start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
  ];
  return document;
}

const operation = (baseRevision: number, commandId: string, handles: string[] = []) => ({
  opId: `${commandId}:${baseRevision}`, baseRevision, commandId, args: {}, targetHandles: handles, resultHandles: handles,
});

describe("F-072..F-079 complete layer contract", () => {
  it("pins Layer 0 and canonical non-plottable Defpoints rules", () => {
    const document = createEmptyDocument({ documentId: "special-layers" });
    const defpoints = planCreateLayer(document, "defpoints");
    expect(defpoints.changes).toEqual([{ type: "put-layer", layer: {
      id: "Defpoints", name: "Defpoints", visible: true, frozen: false, locked: false, plottable: false,
    } }]);
    const session = new CadSession(document);
    session.commit(operation(0, defpoints.commandId), defpoints.changes);
    expect(() => planRenameLayer(session.document, "0", "Default")).toThrow(/Layer 0/u);
    expect(() => planDeleteLayer(session.document, "0")).toThrow(/Layer 0/u);
    expect(() => planRenameLayer(session.document, "Defpoints", "Points")).toThrow(/Defpoints/u);
    expect(() => planDeleteLayer(session.document, "Defpoints")).toThrow(/Defpoints/u);
    expect(() => planSetLayerToggle(session.document, "Defpoints", "plottable", true)).toThrow(/non-plottable/u);

    const imported = structuredClone(session.document);
    imported.layers[0] = { ...imported.layers[0]!, id: "layer-0" };
    imported.currentLayerId = "layer-0";
    expect(() => planRenameLayer(imported, "layer-0", "Default")).toThrow(/Layer 0/u);
  });

  it("rejects duplicate, reserved, control and non-canonical system names deterministically", () => {
    const document = createEmptyDocument({ documentId: "layer-names" });
    document.layers.push({ id: "steel", name: "ŠtEEL", visible: true, frozen: false, locked: false, plottable: true });
    expect(() => planCreateLayer(document, "šteel")).toThrow(/already exists/u);
    for (const name of ["", "A/B", "A,B", "A\u0000B", "A|B", "A?B"]) {
      expect(() => planCreateLayer(document, name)).toThrow(/reserved|empty/u);
    }
    expect(() => planRenameLayer(document, "steel", "Defpoints")).toThrow(/canonical system layer/u);
    expect(() => planCreateLayer(document, "Defpoints", "custom-defpoints")).toThrow(/canonical layer id/u);
  });

  it("matches golden ByLayer inheritance and complete entity overrides", () => {
    const document = fixture();
    const index = createCadLayerPropertyIndex(document.layers, document.linetypes);
    expect(resolveCadEntityLayerProperties(document.entities[0]!, index)).toEqual(golden.byLayer);
    expect(resolveCadEntityLayerProperties(document.entities[1]!, index)).toEqual(golden.overridden);
  });

  it("commits a multi-entity layer/property update as one exact Undo/Redo step", () => {
    const source = fixture();
    source.layers.push({ id: "target", name: "Target", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(source);
    const before = session.document;
    const planned = planSetEntityLayerProperties(session.document, ["10", "11", "10"], {
      layerId: "target", clearOverrides: true, color: "#abcdef", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.35,
    });
    expect(planned.targetHandles).toEqual(["10", "11"]);
    expect(planned.changes).toHaveLength(2);
    const committed = session.commit(operation(0, planned.commandId, planned.targetHandles), planned.changes, "2026-08-31T00:01:00Z");
    expect(committed.committedRevision).toBe(1);
    expect(session.document.entities).toEqual([
      expect.objectContaining({ handle: "10", layerId: "target", appearance: { color: "#abcdef", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.35 } }),
      expect.objectContaining({ handle: "11", layerId: "target", appearance: { color: "#abcdef", colorMethod: "trueColor", linetypeId: "dash", lineweightMm: 0.35 } }),
    ]);
    const after = session.document;
    session.undo("2026-08-31T00:02:00Z");
    expect(session.document.entities).toEqual(before.entities);
    session.redo("2026-08-31T00:03:00Z");
    expect(session.document.entities).toEqual(after.entities);
  });

  it("fails closed for locked sources/destinations, late missing handles and orphan linetypes", () => {
    const document = fixture();
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    const before = structuredClone(document);
    expect(() => planSetEntityLayerProperties(document, ["10"], { layerId: "locked" })).toThrow(/Target layer .* locked/u);
    expect(() => planSetEntityLayerProperties(document, ["10", "MISSING"], { lineweightMm: 0.9 })).toThrow(/MISSING/u);
    expect(document).toEqual(before);
    document.layers.find((layer) => layer.id === "steel")!.appearance!.linetypeId = "orphan";
    expect(() => readCadLayerContract(document)).toThrow(/Linetype orphan/u);
  });

  it("survives persisted JSON read-back without aliases to caller data", () => {
    const source = fixture();
    const reopened = JSON.parse(JSON.stringify(source)) as KDrawDocumentV1;
    assertKDrawDocumentV1(reopened);
    const readback = readCadLayerContract(reopened);
    expect(readback).toEqual({ currentLayerId: source.currentLayerId, layers: source.layers, linetypes: source.linetypes, entities: source.entities });
    readback.layers[0]!.name = "changed clone";
    expect(reopened.layers[0]!.name).toBe("0");
  });
});
