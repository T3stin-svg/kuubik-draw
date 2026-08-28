import { expect, it } from "vitest";
import { applyAtomicOperation, createEmptyDocument, executeCopy, executeErase, executeMove, executeRectangle, executeRotate } from "../src/index.js";

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

it("kills ERASE duplicate-delete and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "erase-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
  );
  expect(executeErase(document, { targetHandles: ["10", "10", "11"] })).toEqual({
    changes: [{ type: "delete", handle: "10" }],
    erasedHandles: ["10"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
  });
});

it("kills MOVE vector-sign, duplicate-put and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "move-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeMove(document, {
    targetHandles: ["10", "10", "11"],
    basePoint: { x: 100, y: 200 },
    destinationPoint: { x: 600, y: 950 },
  })).toEqual({
    changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } }],
    movedHandles: ["10"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
    delta: { x: 500, y: 750 },
  });
});

it("kills COPY chaining, source-overwrite, duplicate-source and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "copy-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeCopy(document, {
    targetHandles: ["10", "10", "11"],
    basePoint: { x: 100, y: 200 },
    destinationPoints: [{ x: 600, y: 950 }, { x: -200, y: 300 }],
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "line", handle: "12", layerId: "0", start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } },
      { type: "put", entity: { kind: "line", handle: "13", layerId: "0", start: { x: -300, y: 100 }, end: { x: 700, y: 100 } } },
    ],
    sourceHandles: ["10"],
    copiedHandles: ["12", "13"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
    deltas: [{ x: 500, y: 750 }, { x: -300, y: 100 }],
  });
  expect(document.entities[0]).toMatchObject({ handle: "10", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
});

it("kills the COPY block-space handle-collision mutant", () => {
  const document = createEmptyDocument({ documentId: "copy-block-handle-mutation" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
  document.blocks.push({
    id: "b1",
    name: "B1",
    basePoint: { x: 0, y: 0 },
    entities: [{ kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }],
  });
  const result = executeCopy(document, {
    targetHandles: ["10"],
    basePoint: { x: 0, y: 0 },
    destinationPoints: [{ x: 5, y: 0 }],
  });
  expect(result.copiedHandles).toEqual(["12"]);
  expect(result.changes[0]).toMatchObject({ type: "put", entity: { handle: "12" } });
});

it("kills ROTATE sign, Reference-delta, orientation, duplicate-put and locked-layer mutants", () => {
  const document = createEmptyDocument({ documentId: "rotate-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "arc", handle: "10", layerId: "0", appearance: { color: "#f00" }, center: { x: 500, y: 200 }, radius: 30, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true },
    { kind: "text", handle: "11", layerId: "0", position: { x: 1100, y: 200 }, text: "R", height: 20, rotationRad: 0.25 },
    { kind: "line", handle: "12", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeRotate(document, {
    targetHandles: ["10", "10", "11", "12"],
    basePoint: { x: 100, y: 200 },
    angle: { mode: "reference", referenceAngleDeg: 45, newAngleDeg: 135 },
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "arc", handle: "10", layerId: "0", appearance: { color: "#f00" }, center: { x: 100, y: 600 }, radius: 30, startAngleRad: Math.PI / 2, endAngleRad: Math.PI, counterClockwise: true } },
      { type: "put", entity: { kind: "text", handle: "11", layerId: "0", position: { x: 100, y: 1200 }, text: "R", height: 20, rotationRad: 0.25 + Math.PI / 2 } },
    ],
    rotatedHandles: ["10", "11"],
    rejected: [{ handle: "12", reason: "locked-layer" }],
    deltaAngleDeg: 90,
  });
});
