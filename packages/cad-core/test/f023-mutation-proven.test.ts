import { describe, expect, it } from "vitest";
import { CadSession, createEmptyDocument, executeExtend } from "../src/index.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "F-023-mutation" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 }, appearance: { color: "#09f" }, extensionData: { rowId: "F-023" } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: -10 }, end: { x: 100, y: 10 } },
  );
  return document;
}

describe("F-023 mutation-proven EXTEND ratchet", () => {
  it("kills standalone-command, endpoint, property-loss and source-mutation mutants", () => {
    const document = fixture();
    const before = structuredClone(document);
    expect(executeExtend(document, {
      mode: "standard", boundaryEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({
      targetHandles: ["10"], resultHandles: ["10"],
      steps: [{ action: "extend", intersectionPoints: [{ x: 100, y: 0 }] }],
      changes: [{ type: "put", entity: { handle: "10", start: { x: 20, y: 0 }, end: { x: 100, y: 0 }, appearance: { color: "#09f" }, extensionData: { rowId: "F-023" } } }],
    });
    expect(document).toEqual(before);
  });

  it("kills Quick-boundary, Shift-Trim and no-intersection-delete mutants", () => {
    const document = fixture();
    expect(executeExtend(document, {
      mode: "quick", boundaryEdgeHandles: [], targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({ changes: [{ type: "put", entity: { handle: "10", end: { x: 100, y: 0 } } }] });

    const trimDocument = fixture();
    trimDocument.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 120, y: 0 } };
    expect(executeExtend(trimDocument, {
      mode: "standard", boundaryEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 110, y: 0 }, action: "trim" }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({ steps: [{ action: "trim" }], changes: [{ type: "put", entity: { handle: "10", end: { x: 100, y: 0 } } }] });

    const isolated = fixture();
    isolated.entities = isolated.entities.slice(0, 1);
    expect(executeExtend(isolated, {
      mode: "quick", boundaryEdgeHandles: [], targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({ changes: [], rejected: [{ reason: "no-intersection" }] });
  });

  it("kills split-target and one-sided atomic Undo/Redo mutants", () => {
    const document = createEmptyDocument({ documentId: "F-023-undo-redo-mutation" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 20, y: 20 }, end: { x: 80, y: 20 } },
      { kind: "line", handle: "20", layerId: "0", start: { x: 100, y: -10 }, end: { x: 100, y: 30 } },
    );
    const sourceEntities = structuredClone(document.entities);
    const result = executeExtend(document, {
      mode: "standard", boundaryEdgeHandles: ["20"],
      targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }, { handle: "11", pickPoint: { x: 80, y: 20 } }],
      edgeMode: "no-extend", projectMode: "none",
    });
    const session = new CadSession(document);
    session.commit({
      opId: "F-023-undo-redo-mutation", baseRevision: 0, commandId: "EXTEND", args: {},
      targetHandles: result.targetHandles, resultHandles: result.resultHandles,
    }, result.changes);
    const committedEntities = structuredClone(session.document.entities);
    expect(committedEntities.filter((entity) => entity.handle === "10" || entity.handle === "11")).toMatchObject([
      { handle: "10", end: { x: 100, y: 0 } }, { handle: "11", end: { x: 100, y: 20 } },
    ]);
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(sourceEntities);
    expect(session.redo()).not.toBeNull();
    expect(session.document.revision).toBe(3);
    expect(session.document.entities).toEqual(committedEntities);
  });

  it("kills the previous open-SPLINE rejection and tangent/knot/weight-loss mutants", () => {
    const document = createEmptyDocument({ documentId: "F-023-spline-mutation" });
    document.entities.push(
      {
        kind: "spline", handle: "10", layerId: "0", degree: 3,
        controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
        knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 2, 2], closed: false, periodic: false,
        appearance: { color: "#09f" }, extensionData: { rowId: "F-023" },
      },
      { kind: "line", handle: "20", layerId: "0", start: { x: 6, y: -10 }, end: { x: 6, y: 10 } },
    );
    const before = structuredClone(document);
    expect(executeExtend(document, {
      mode: "standard", boundaryEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 3, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({
      rejected: [],
      steps: [{ action: "extend", intersectionPoints: [{ x: 6.000000000002, y: -3.567997608689 }] }],
      changes: [{ type: "put", entity: {
        kind: "spline", handle: "10", degree: 3,
        controlPoints: [
          { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 },
          { x: 3.621334927543, y: -0.621334927543 },
          { x: 4.628726947271, y: -1.821755493363 },
          { x: 6.000000000002, y: -3.567997608689 },
        ],
        knots: [0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543], weights: [1, 1, 2, 2, 2, 2, 2],
        appearance: { color: "#09f" }, extensionData: { rowId: "F-023" },
      } }],
    });
    expect(document).toEqual(before);
  });
});
