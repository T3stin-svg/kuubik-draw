import { describe, expect, it } from "vitest";
import { prepareCompleteArcCommand } from "../../cad-core/src/arc-command.js";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-005 ARC DXF read-back", () => {
  it("roundtrips clockwise geometry through standard CCW ARC with exact identity and common properties", () => {
    const prepared = prepareCompleteArcCommand({
      command: "ARC", handle: "A5", layerId: "ARC_TEST",
      construction: { mode: "start-end-angle", start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, includedAngleRad: Math.PI * 3 / 2, clockwiseCtrl: true },
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    });
    const document = createEmptyDocument({ documentId: "F-005-DXF", now: "2026-08-31T20:10:00.000Z" });
    document.layers.push({ id: "ARC_TEST", name: "ARC_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({ opId: "F-005:DXF:1", baseRevision: 0, commandId: "ARC", args: { variant: "Start-End-Angle", ctrl: true }, targetHandles: [], resultHandles: prepared.resultHandles }, prepared.changes, "2026-08-31T20:10:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["A5"], handleMap: { A5: "A5" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-005-DXF-readback", now: "2026-08-31T20:10:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["A5"], skipped: [] });
    const readback = imported.document.entities[0];
    expect(readback).toMatchObject({
      kind: "arc", handle: "A5", layerId: "dxf-layer:ARC_TEST",
      center: { x: expect.closeTo(prepared.entity.center.x, 9), y: expect.closeTo(prepared.entity.center.y, 9) },
      radius: expect.closeTo(prepared.entity.radius, 9), counterClockwise: true,
      startAngleRad: expect.closeTo(prepared.entity.endAngleRad, 9),
      endAngleRad: expect.closeTo(prepared.entity.startAngleRad, 9),
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    });
    session.undo("2026-08-31T20:10:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:10:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
