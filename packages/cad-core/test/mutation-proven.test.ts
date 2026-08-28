import { expect, it } from "vitest";
import { applyAtomicOperation, createEmptyDocument } from "../src/index.js";

it("kills the revision-increment mutant", () => {
  const source = createEmptyDocument({ documentId: "mutation" });
  const result = applyAtomicOperation(
    source,
    { opId: "m1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["1"] },
    [{ type: "put", entity: { kind: "line", handle: "1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } }],
  );
  // Changing +1 to +0, +2, or assigning source.revision makes this assertion fail.
  expect(result.document.revision).toBe(source.revision + 1);
  expect(result.document).not.toBe(source);
});
