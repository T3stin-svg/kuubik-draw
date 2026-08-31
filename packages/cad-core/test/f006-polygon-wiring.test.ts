import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareCompletePolygonCommand, type CompletePolygonCommandInput } from "../src/polygon-command.js";
import { CadSession } from "../src/transaction.js";

describe("F-006 POLYGON prepared-command wiring", () => {
  it("uses one preparation for preview and one immutable atomic Commit/Undo/Redo", () => {
    const appearance = { color: "#336699", colorMethod: "trueColor" as const, aciIndex: 7, lineweightMm: 0.35, linetypeScale: 1.25, thickness: -3 };
    const extensionData = { rowId: "F-006", source: { tool: "POLYGON" } };
    const input: CompletePolygonCommandInput = {
      command: "POLYGON", handle: "F6", layerId: "POLYGON_TEST", sides: 9,
      construction: { mode: "center-circumscribed", center: { x: 12.5, y: -30.25 }, apothem: 40, rotationRad: Math.PI / 8, orientation: "clockwise" },
      appearance,
      extensionData,
    };
    const preview = prepareCompletePolygonCommand(input);
    const commit = prepareCompletePolygonCommand(input);
    expect(commit).toEqual(preview);
    expect(commit).toMatchObject({ commandId: "POLYGON", resultHandles: ["F6"] });
    expect(commit.entities).toEqual([commit.entity]);
    expect(commit.changes).toEqual([{ type: "put", entity: commit.entity }]);

    appearance.color = "#ffffff";
    extensionData.source.tool = "MUTATED";
    input.construction.center.x = 999;
    expect(commit.entity).toMatchObject({
      handle: "F6", layerId: "POLYGON_TEST",
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35, linetypeScale: 1.25, thickness: -3 },
      extensionData: { rowId: "F-006", source: { tool: "POLYGON" } },
    });
    expect(commit.normalized.center.x).toBe(12.5);

    const document = createEmptyDocument({ documentId: "F-006-atomic" });
    document.layers.push({ id: "POLYGON_TEST", name: "POLYGON_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-006:1", baseRevision: 0, commandId: "POLYGON", args: { variant: "Circumscribed", sides: 9 },
      targetHandles: [], resultHandles: commit.resultHandles,
    }, commit.changes, "2026-08-31T20:20:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    session.undo("2026-08-31T20:20:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:20:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });
});
