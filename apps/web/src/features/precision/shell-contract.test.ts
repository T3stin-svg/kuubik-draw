import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function contractDocument() {
  const document = createEmptyDocument({ documentId: "precision-layers-shell", now: "2026-08-31T00:00:00Z" });
  document.layers = [
    { id: "normal", name: "normal", visible: true, frozen: false, locked: false, plottable: true },
    { id: "locked", name: "locked", visible: true, frozen: false, locked: true, plottable: true },
    { id: "hidden", name: "hidden", visible: false, frozen: false, locked: false, plottable: true },
    { id: "frozen", name: "frozen", visible: true, frozen: true, locked: false, plottable: true },
  ];
  document.currentLayerId = "normal";
  document.entities = [
    { kind: "line", handle: "normal", layerId: "normal", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "line", handle: "locked", layerId: "locked", start: { x: 20, y: 0 }, end: { x: 30, y: 0 } },
    { kind: "line", handle: "hidden", layerId: "hidden", start: { x: 40, y: 0 }, end: { x: 50, y: 0 } },
    { kind: "line", handle: "frozen", layerId: "frozen", start: { x: 60, y: 0 }, end: { x: 70, y: 0 } },
    { kind: "line", handle: "cross-a", layerId: "normal", start: { x: 5, y: -5 }, end: { x: 5, y: 5 } },
    { kind: "line", handle: "endpoint", layerId: "normal", start: { x: 5, y: 0 }, end: { x: 8, y: 3 } },
  ];
  return document;
}

function createContract() {
  return new PrecisionLayersShellContract(contractDocument(), {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
    units: { linear: "mm", displayPrecision: 4, angularPrecision: 3 },
    initialPrecision: { osnap: true, otrack: true, dynamicInput: true },
    layerController: { opIdPrefix: "shell", now: () => "2026-08-31T00:01:00Z" },
  });
}

describe("DOM-free precision/layers shell contract", () => {
  it("prepares one immutable pointer frame for preview, commit and Dynamic Input", () => {
    const contract = createContract();
    const prepared = contract.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 5.1, y: 0 } });
    const preview = prepared.preview();
    contract.executePrecisionCommand("OSNAP OFF");
    contract.executePrecisionCommand("SNAP ON");
    const commit = prepared.commit();
    const dynamic = prepared.dynamicInput();
    expect(preview).toEqual(commit);
    expect(dynamic.point).toEqual(commit.point);
    expect(commit).toMatchObject({ source: "osnap", point: { x: 5, y: 0 } });
  });

  it("orders OSNAP modes deterministically and lets OSNAP win over OTRACK", () => {
    const contract = createContract();
    const ordered = contract.querySnap({ x: 5, y: 0 });
    expect(ordered.slice(0, 4).map((candidate) => candidate.mode)).toEqual(["endpoint", "midpoint", "midpoint", "intersection"]);
    expect(ordered.map((candidate) => candidate.priority)).toEqual([...ordered.map((candidate) => candidate.priority)].sort((a, b) => a - b));

    const acquisition = contract.querySnap({ x: 0, y: 0 }).find((candidate) => candidate.handle === "normal" && candidate.mode === "endpoint")!;
    contract.acquireTracking(acquisition, 1);
    const prepared = contract.preparePointer({ basePoint: { x: -1, y: 0 }, cursorPoint: { x: 0.1, y: 0 } });
    expect(prepared.request.objectSnapCandidates).not.toHaveLength(0);
    expect(prepared.request.trackingCandidates).not.toHaveLength(0);
    expect(prepared.commit().source).toBe("osnap");
  });

  it("applies the common locked/hidden/frozen policy to selection, snap and edit", () => {
    const contract = createContract();
    expect(contract.select({ x: 20, y: 0 }, 0.1).map((hit) => hit.handle)).toEqual(["locked"]);
    expect(contract.querySnap({ x: 20, y: 0 }).some((candidate) => candidate.handle === "locked")).toBe(true);
    expect(contract.participates(contract.document.entities.find((entity) => entity.handle === "locked")!, "edit")).toBe(false);
    for (const handle of ["hidden", "frozen"]) {
      const entity = contract.document.entities.find((candidate) => candidate.handle === handle)!;
      if (entity.kind !== "line") throw new TypeError("Layer policy fixture must remain a line.");
      expect(contract.select(entity.start, 0.1)).toEqual([]);
      expect(contract.querySnap(entity.start).some((candidate) => candidate.handle === handle)).toBe(false);
      expect(contract.participates(entity, "render")).toBe(false);
    }
  });

  it("queues typed shell intents and delegates precision rows through one adapter", () => {
    const contract = createContract();
    expect(contract.commandAdapter.canExecute("F-072", "paper")).toBe(true);
    expect(contract.commandAdapter.canExecute("F-086", "paper")).toBe(false);
    contract.commandAdapter.execute("F-072");
    contract.commandAdapter.setPrecisionMode("F-045", true);
    expect(contract.takeLayerIntents()).toEqual([{ action: "create", rowId: "F-072" }]);
    expect(contract.commandAdapter.precisionMode("F-045")).toBe(true);
  });
});
