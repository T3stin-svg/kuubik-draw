import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareRevcloudCommand } from "../src/revcloud-command.js";
import { CadSession } from "../src/transaction.js";

describe("F-011 prepared-command wiring", () => {
  it("clones input/properties and commits one atomic Undo/Redo unit", () => {
    const document = createEmptyDocument({ documentId: "F-011-wiring", now: "2026-08-31T21:10:00.000Z" });
    document.layers.push({ id: "REV", name: "REV", visible: true, frozen: false, locked: false, plottable: true });
    const appearance = { color: "#ff00ff", lineweightMm: 0.5 };
    const extensionData = { rowId: "F-011", nested: { stable: true } };
    const prepared = prepareRevcloudCommand(document, {
      command: "REVCLOUD", handle: "11", layerId: "REV",
      construction: { mode: "polygonal", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 20 }] },
      arcLengths: { minimum: 5, maximum: 10 }, appearance, extensionData,
    });
    appearance.color = "#000000";
    extensionData.nested.stable = false;
    expect(prepared.entity).toMatchObject({ appearance: { color: "#ff00ff" }, extensionData: { rowId: "F-011", nested: { stable: true } } });
    expect(prepared.entity).not.toBe(prepared.entities[0]);
    expect(prepared.entity).not.toBe(prepared.changes[0].entity);

    const session = new CadSession(document);
    session.commit({
      opId: "F-011:1", baseRevision: 0, commandId: "REVCLOUD", args: { mode: "polygonal" },
      targetHandles: prepared.targetHandles, resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T21:10:01.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
    session.undo("2026-08-31T21:10:02.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T21:10:03.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
