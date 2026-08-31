import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

describe("F-052 Dynamic Input fuzz coverage", () => {
  it("rejects 5,000 malformed/non-finite prompts without a revision or commit-ready state", () => {
    const document = createEmptyDocument({ documentId: "dynamic-fuzz" });
    const session = new CadSession(document);
    const shell = new PrecisionLayersShellContract(document, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
      units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
      inputFormat: { decimalSeparator: "," },
      initialPrecision: { dynamicInput: true },
    });
    const coordinate = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input));
    const dynamic = new PrecisionDynamicInputAdapter(coordinate, shell);
    const mutations = ["NaN;0", "Infinity;0", "1,5,2,5", "@1junk;2", "10<bad"];
    for (let index = 0; index < 5_000; index += 1) {
      dynamic.start({ basePoint: { x: index, y: -index }, cursorPoint: { x: 0, y: 0 } }, { x: index % 1920, y: index % 1080 });
      const snapshot = dynamic.previewRaw(`${mutations[index % mutations.length]}_${index}`);
      expect(snapshot).toMatchObject({ status: "retry", commitReady: false, revision: 0, error: expect.any(String) });
      expect(snapshot.result).toBeNull();
    }
    expect(session.document.revision).toBe(0);
    expect(session.canUndo).toBe(false);
  });
});
