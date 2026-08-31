import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function adapterFor(shell: PrecisionLayersShellContract) {
  const coordinate = new PrecisionCoordinateEntryAdapter(new CadSession(shell.document), (input) => shell.preparePointer(input));
  return new PrecisionDynamicInputAdapter(coordinate, shell);
}

describe("F-052 Dynamic Input wiring", () => {
  it("uses the ORTHO-before-POLAR and OSNAP-before-OTRACK pointer pipeline", () => {
    const document = createEmptyDocument({ documentId: "dynamic-priority" });
    document.entities = [
      { kind: "line", handle: "horizontal", layerId: "0", start: { x: -20, y: 0 }, end: { x: 25, y: 0 } },
      { kind: "line", handle: "vertical", layerId: "0", start: { x: 10, y: -15 }, end: { x: 10, y: 20 } },
    ];
    const shell = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 5, gridSpacingY: 5, aperture: 1 },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
      initialPrecision: { ortho: true, polar: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
    });
    const acquisition = shell.querySnap({ x: -20, y: 0 }).find((candidate) => candidate.mode === "endpoint" && candidate.handle === "horizontal")!;
    shell.acquireTracking(acquisition, 1);
    const dynamic = adapterFor(shell);
    dynamic.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 4 } }, { x: 500, y: 400 }, "direct-distance");
    const snapshot = dynamic.editField("distance", "12");
    expect(snapshot).toMatchObject({
      rawInput: "12", commitReady: true,
      result: { source: "osnap", point: { x: 10, y: 0 } },
    });
    expect(snapshot.result?.point).toEqual(snapshot.result?.coordinate);
    shell.executePrecisionCommand("ORTHO OFF");
    shell.executePrecisionCommand("OSNAP OFF");
    shell.setViewportSnapAperture(10, 100);
    const committed = dynamic.commit((point) => ({
      commandId: "DYNAMIC_PRIORITY_COMMIT",
      changes: [{ type: "put", entity: { kind: "line", handle: "committed", layerId: "0", start: { x: 0, y: 0 }, end: point } }],
    }));
    expect(committed.preview).toEqual(committed.pointCommit);
    expect(committed.pointCommit.point).toEqual(snapshot.result?.point);
  });

  it("keeps CSS overlay fixed while viewport scale changes the world snap aperture", () => {
    const document = createEmptyDocument({ documentId: "dynamic-zoom" });
    document.entities = [{ kind: "line", handle: "L", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }];
    const shell = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 999, aperturePixels: 10, worldUnitsPerCssPixel: 0.1 },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
      initialPrecision: { osnap: true, dynamicInput: true },
    });
    shell.executePrecisionCommand("OSNAP END");
    const dynamic = adapterFor(shell);
    const context = { basePoint: { x: -5, y: 0 }, cursorPoint: { x: 0.5, y: 0 } };
    expect(dynamic.start(context, { x: 700, y: 350 })).toMatchObject({
      overlay: { leftCssPx: 716, topCssPx: 368 }, result: { source: "osnap", point: { x: 0, y: 0 } },
    });
    shell.setViewportSnapAperture(10, 0.01);
    expect(dynamic.updatePointer(context, { x: 700, y: 350 })).toMatchObject({
      overlay: { leftCssPx: 716, topCssPx: 368 }, result: { source: "cursor", point: { x: 0.5, y: 0 } },
    });
    dynamic.previewRaw("@1;2");
    shell.setViewportSnapAperture(10, 10);
    expect(dynamic.updatePointer(context, { x: 700, y: 350 }).result?.point).toEqual({ x: -4, y: 2 });
  });
});
