import { describe, expect, it } from "vitest";
import { prepareCompleteCircleCommand } from "../../cad-core/src/circle-command.js";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-004 tangent CIRCLE DXF read-back", () => {
  it("roundtrips TTT center/radius, handle, layer and exact common properties", () => {
    const inradius = 20 - 10 * Math.SQRT2;
    const prepared = prepareCompleteCircleCommand({
      command: "CIRCLE", handle: "C4", layerId: "CIRCLE_TEST",
      construction: {
        mode: "ttt",
        first: { kind: "line", start: { x: 0, y: -10 }, end: { x: 0, y: 30 }, pickPoint: { x: 0, y: inradius } },
        second: { kind: "line", start: { x: -10, y: 0 }, end: { x: 30, y: 0 }, pickPoint: { x: inradius, y: 0 } },
        third: { kind: "line", start: { x: 20, y: 0 }, end: { x: 0, y: 20 }, pickPoint: { x: 10, y: 10 } },
      },
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    });
    const document = createEmptyDocument({ documentId: "F-004-DXF", now: "2026-08-31T19:10:00.000Z" });
    document.layers.push({ id: "CIRCLE_TEST", name: "CIRCLE_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-004:DXF:1", baseRevision: 0, commandId: "CIRCLE",
      args: { variant: "Tan-Tan-Tan" }, targetHandles: [], resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T19:10:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["C4"], handleMap: { C4: "C4" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-004-DXF-readback", now: "2026-08-31T19:10:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["C4"], skipped: [] });
    expect(imported.document.entities).toEqual([expect.objectContaining({
      kind: "circle", handle: "C4", layerId: "dxf-layer:CIRCLE_TEST",
      center: { x: expect.closeTo(inradius, 9), y: expect.closeTo(inradius, 9) },
      radius: expect.closeTo(inradius, 9),
      appearance: { color: "#2f80ed", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, linetypeScale: 1.25, thickness: -3 },
    })]);
    session.undo("2026-08-31T19:10:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T19:10:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
