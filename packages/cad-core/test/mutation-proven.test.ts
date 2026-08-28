import { expect, it } from "vitest";
import { applyAtomicOperation, createEmptyDocument, executeRectangle } from "../src/index.js";

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

it("kills RECTANGLE open-path, missing-corner and axis-swap mutants", () => {
  const [change] = executeRectangle({
    handle: "10",
    layerId: "0",
    firstCorner: { x: 100, y: 200 },
    otherCorner: { x: 600, y: 900 },
  });
  expect(change).toEqual({
    type: "put",
    entity: {
      kind: "polyline",
      handle: "10",
      layerId: "0",
      closed: true,
      vertices: [
        { x: 100, y: 200 },
        { x: 600, y: 200 },
        { x: 600, y: 900 },
        { x: 100, y: 900 },
      ],
    },
  });
});
