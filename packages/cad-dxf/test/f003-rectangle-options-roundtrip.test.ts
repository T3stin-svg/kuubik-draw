import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../cad-core/src/document.js";
import { prepareRectangleCommand } from "../../cad-core/src/rectangle-command.js";
import { CadSession } from "../../cad-core/src/transaction.js";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-003 RECTANGLE options DXF read-back", () => {
  it("roundtrips rotated fillet geometry, winding, handle, layer, widths and Thickness", () => {
    const prepared = prepareRectangleCommand({
      command: "RECTANGLE",
      handle: "A3",
      layerId: "RECT_TEST",
      construction: {
        mode: "area",
        firstCorner: { x: 125.25, y: -200.5 },
        area: 60_000,
        knownDimension: { axis: "length", value: 300 },
        direction: { length: 1, width: -1 },
      },
      rotationRad: Math.PI / 6,
      filletRadius: 20,
      width: 3.5,
      thickness: 8,
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
    });
    const document = createEmptyDocument({ documentId: "F-003-options-DXF", now: "2026-08-31T18:40:00.000Z" });
    document.layers.push({ id: "RECT_TEST", name: "RECT_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({
      opId: "F-003:DXF:1",
      baseRevision: 0,
      commandId: "RECTANGLE",
      args: { variants: ["Area", "Rotation", "Fillet", "Width", "Thickness"] },
      targetHandles: [],
      resultHandles: prepared.resultHandles,
    }, prepared.changes, "2026-08-31T18:40:01.000Z");

    const exported = exportDxf(session.document);
    expect(exported.report).toMatchObject({ emittedHandles: ["A3"], handleMap: { A3: "A3" }, skipped: [] });
    const imported = importDxf(exported.bytes, { documentId: "F-003-options-DXF-readback", now: "2026-08-31T18:40:02.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["A3"], skipped: [] });
    const entity = imported.document.entities[0];
    expect(entity).toMatchObject({
      kind: "polyline",
      handle: "A3",
      layerId: "dxf-layer:RECT_TEST",
      closed: true,
      appearance: { color: "#336699", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35, thickness: 8 },
    });
    if (entity?.kind !== "polyline") throw new Error("Expected RECTANGLE LWPOLYLINE read-back.");
    expect(entity.vertices).toHaveLength(8);
    expect(entity.vertices.filter((point) => point.bulge! < 0)).toHaveLength(4);
    expect(entity.vertices.every((point) => point.startWidth === 3.5 && point.endWidth === 3.5)).toBe(true);
    for (let index = 0; index < entity.vertices.length; index += 1) {
      expect(entity.vertices[index]!.x).toBeCloseTo(prepared.entity.vertices[index]!.x, 9);
      expect(entity.vertices[index]!.y).toBeCloseTo(prepared.entity.vertices[index]!.y, 9);
      expect(entity.vertices[index]!.bulge ?? 0).toBeCloseTo(prepared.entity.vertices[index]!.bulge ?? 0, 9);
    }

    session.undo("2026-08-31T18:40:03.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T18:40:04.000Z");
    expect(session.document.entities).toEqual(prepared.entities);
  });
});
