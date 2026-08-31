import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

describe("precision/layers caller wiring", () => {
  it("connects command intent, atomic controller, spatial candidates and prepared point end-to-end", () => {
    const onLayerIntent = vi.fn();
    const document = createEmptyDocument({ documentId: "wiring" });
    document.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }];
    const contract = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.2 },
      units: { linear: "mm", displayPrecision: 3, angularPrecision: 2 },
      initialPrecision: { osnap: true, otrack: true },
      onLayerIntent,
    });
    contract.commandAdapter.execute("F-072");
    expect(onLayerIntent).toHaveBeenCalledWith({ action: "create", rowId: "F-072" });
    expect(contract.executeLayer({ type: "create", name: "A", requestedId: "A" }).document.layers.at(-1)?.id).toBe("A");

    const snap = contract.querySnap({ x: 0, y: 0 })[0]!;
    contract.acquireTracking(snap, 1);
    const pointer = contract.preparePointer({ basePoint: { x: -1, y: 0 }, cursorPoint: { x: 0.1, y: 0 } });
    expect(pointer.request.objectSnapCandidates?.[0]).toMatchObject({ kind: "endpoint", priority: 0 });
    expect(pointer.request.trackingCandidates?.[0]).toMatchObject({ kind: "otrack" });
    expect(pointer.preview()).toEqual(pointer.commit());
  });
});
