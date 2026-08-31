import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import {
  applyPlineCommandAction,
  preparePlineCommandState,
  startPlineCommand,
} from "../../cad-core/src/pline-command.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-002 PLINE DXF read-back", () => {
  it("roundtrips the committed handle, layer, seam, widths and signed arc bulges", () => {
    let state = startPlineCommand({ handle: "A2", layerId: "PLINE_TEST", start: { x: 100.25, y: -20.5 } });
    state = applyPlineCommandAction(state, { type: "width", startWidth: 1.25, endWidth: 2.5 });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 150.75, y: -20.5 } });
    state = applyPlineCommandAction(state, {
      type: "arc",
      construction: { mode: "angle", end: { x: 175.5, y: 4.25 }, includedAngleRad: -Math.PI / 2 },
    });
    state = applyPlineCommandAction(state, { type: "halfwidth", startHalfWidth: 2, endHalfWidth: 3 });
    state = applyPlineCommandAction(state, { type: "line", end: { x: 100.25, y: 4.25 } });
    state = applyPlineCommandAction(state, { type: "close" });

    const prepared = preparePlineCommandState(state);
    const document = createEmptyDocument({ documentId: "F-002-DXF", now: "2026-08-31T18:10:00.000Z" });
    document.layers.push({ id: "PLINE_TEST", name: "PLINE_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-002:DXF:1",
      baseRevision: 0,
      commandId: "PLINE",
      args: { variants: ["Line", "Arc", "Width", "Halfwidth", "Close"] },
      targetHandles: [],
      resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T18:10:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["A2"], handleMap: { A2: "A2" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-002-DXF-readback", now: "2026-08-31T18:10:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["A2"], skipped: [] });
    expect(imported.document.entities).toEqual([expect.objectContaining({
      kind: "polyline",
      handle: "A2",
      layerId: "dxf-layer:PLINE_TEST",
      closed: true,
      vertices: [
        { x: 100.25, y: -20.5, startWidth: 1.25, endWidth: 2.5 },
        { x: 150.75, y: -20.5, bulge: expect.closeTo(-0.414213562373, 12), startWidth: 1.25, endWidth: 2.5 },
        { x: 175.5, y: 4.25, startWidth: 4, endWidth: 6 },
        { x: 100.25, y: 4.25, startWidth: 4, endWidth: 6 },
      ],
    })]);

    session.undo("2026-08-31T18:10:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T18:10:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
