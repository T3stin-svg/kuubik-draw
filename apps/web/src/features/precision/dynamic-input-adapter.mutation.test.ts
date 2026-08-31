import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "dynamic-mutation" });
  const session = new CadSession(document);
  const shell = new PrecisionLayersShellContract(document, {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
    units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
    initialPrecision: { dynamicInput: true },
  });
  const coordinate = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input));
  return { dynamic: new PrecisionDynamicInputAdapter(coordinate, shell), shell, session };
}

describe("F-052 Dynamic Input mutation guards", () => {
  it("kills swapped fields, lost relative prefix, premature commit and inactive-field mutations", () => {
    const { dynamic, session } = fixture();
    dynamic.start({ basePoint: { x: 10, y: 20 }, cursorPoint: { x: 1, y: 2 } }, { x: 100, y: 100 });
    expect(() => dynamic.editField("angle", "45")).toThrow("not editable");
    expect(dynamic.editField("x", "3")).toMatchObject({ rawInput: null, commitReady: false, result: { point: { x: 1, y: 2 } } });
    expect(() => dynamic.commit(() => ({ commandId: "MUTANT", changes: [] }))).toThrow("valid preview");
    expect(dynamic.editField("y", "4")).toMatchObject({ rawInput: "@3;4", result: { point: { x: 13, y: 24 } }, commitReady: true });
    expect(session.document.revision).toBe(0);
  });

  it("fails closed when F12 is off and cannot revive a cancelled operation", () => {
    const { dynamic, shell } = fixture();
    dynamic.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 1, y: 1 } }, { x: 0, y: 0 });
    shell.handlePrecisionKey("F12");
    expect(dynamic.snapshot().visible).toBe(false);
    expect(dynamic.handleKey("Tab")).toMatchObject({ handled: false, action: null });
    expect(() => dynamic.editField("x", "1")).toThrow("disabled");
    shell.handlePrecisionKey("F12");
    dynamic.cancel();
    expect(() => dynamic.previewRaw("1;2")).toThrow("no longer active");
  });
});
