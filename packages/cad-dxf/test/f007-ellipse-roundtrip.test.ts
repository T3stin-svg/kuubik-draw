import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { prepareCompleteEllipseCommand } from "../../cad-core/src/ellipse-command.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-007 ELLIPSE DXF read-back", () => {
  it("roundtrips rotated clockwise arc locus, identity and common properties", () => {
    const rotation = Math.PI / 5;
    const prepared = prepareCompleteEllipseCommand({
      command: "ELLIPSE", handle: "F7", layerId: "ELLIPSE_TEST",
      construction: {
        mode: "center-major-minor", center: { x: 125.25, y: -200.5 },
        majorAxisEnd: { x: 125.25 + 80 * Math.cos(rotation), y: -200.5 + 80 * Math.sin(rotation) },
        minorDistance: 30,
      },
      arc: { mode: "angles", startAngleRad: Math.PI / 7, endAngleRad: Math.PI * 1.4, direction: "clockwise" },
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25 },
    });
    const document = createEmptyDocument({ documentId: "F-007-DXF", now: "2026-08-31T20:50:00.000Z" });
    document.layers.push({ id: "ELLIPSE_TEST", name: "ELLIPSE_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-007:DXF:1", baseRevision: 0, commandId: "ELLIPSE", args: { variant: "Elliptical-Arc-Angle-Clockwise" },
      targetHandles: [], resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T20:50:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["F7"], handleMap: { F7: "F7" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-007-DXF-readback", now: "2026-08-31T20:50:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["F7"], skipped: [] });
    const readback = imported.document.entities[0];
    expect(readback).toMatchObject({
      kind: "ellipse", handle: "F7", layerId: "dxf-layer:ELLIPSE_TEST",
      center: { x: expect.closeTo(prepared.entity.center.x, 9), y: expect.closeTo(prepared.entity.center.y, 9) },
      majorAxis: { x: expect.closeTo(prepared.entity.majorAxis.x, 9), y: expect.closeTo(prepared.entity.majorAxis.y, 9) },
      ratio: expect.closeTo(prepared.entity.ratio, 9),
      startParameter: expect.closeTo(prepared.entity.startParameter, 9),
      endParameter: expect.closeTo(prepared.entity.endParameter, 9),
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25 },
    });
    session.undo("2026-08-31T20:50:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:50:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
