import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareCompleteEllipseCommand, type CompleteEllipseCommandInput } from "../src/ellipse-command.js";
import { CadSession } from "../src/transaction.js";

describe("F-007 ELLIPSE prepared-command wiring", () => {
  it("uses identical preview/commit and one immutable atomic Undo/Redo operation", () => {
    const appearance = { color: "#336699", colorMethod: "trueColor" as const, aciIndex: 7, lineweightMm: 0.35, linetypeScale: 1.25, thickness: -3 };
    const extensionData = { rowId: "F-007", source: { tool: "ELLIPSE" } };
    const input: CompleteEllipseCommandInput = {
      command: "ELLIPSE", handle: "F7", layerId: "ELLIPSE_TEST",
      construction: { mode: "center-major-minor", center: { x: 12.5, y: -30.25 }, majorAxisEnd: { x: 52.5, y: -30.25 }, minorDistance: 15 },
      arc: { mode: "angles", startAngleRad: Math.PI / 6, endAngleRad: Math.PI * 1.75, direction: "clockwise" },
      appearance,
      extensionData,
    };
    const preview = prepareCompleteEllipseCommand(input);
    const commit = prepareCompleteEllipseCommand(input);
    expect(commit).toEqual(preview);
    expect(commit.entities).toEqual([commit.entity]);
    expect(commit.changes).toEqual([{ type: "put", entity: commit.entity }]);

    appearance.color = "#ffffff";
    extensionData.source.tool = "MUTATED";
    input.construction.center.x = 999;
    expect(commit.entity).toMatchObject({
      handle: "F7", layerId: "ELLIPSE_TEST",
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35, linetypeScale: 1.25, thickness: -3 },
      extensionData: { rowId: "F-007", source: { tool: "ELLIPSE" } },
    });
    expect(commit.normalized.center.x).toBe(12.5);

    const document = createEmptyDocument({ documentId: "F-007-atomic" });
    document.layers.push({ id: "ELLIPSE_TEST", name: "ELLIPSE_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-007:1", baseRevision: 0, commandId: "ELLIPSE", args: { variant: "Center-Angle-Clockwise" },
      targetHandles: [], resultHandles: commit.resultHandles,
    }, commit.changes, "2026-08-31T20:40:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    session.undo("2026-08-31T20:40:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:40:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });
});
