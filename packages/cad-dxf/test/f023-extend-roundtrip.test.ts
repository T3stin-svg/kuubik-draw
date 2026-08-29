import { describe, expect, it } from "vitest";
import type { CadSpline } from "@kuubik/cad-schema";
import { createEmptyDocument, extendCadEntity } from "@kuubik/cad-core";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-023 EXTEND DXF roundtrip", () => {
  it("preserves the exact AutoCAD-style rational SPLINE extension span", () => {
    const source: CadSpline = {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 2, 2], closed: false, periodic: false,
      appearance: { color: "#40a0ff", lineweightMm: 0.5 }, extensionData: { rowId: "F-023" },
    };
    const boundary = { kind: "line" as const, handle: "20", layerId: "0", start: { x: 6, y: -10 }, end: { x: 6, y: 10 } };
    const result = extendCadEntity(source, { x: 3, y: 0 }, [boundary]);
    expect(result.reason).toBeNull();
    const document = createEmptyDocument({ documentId: "F-023-DXF", now: "2026-08-29T12:30:00.000Z" });
    document.entities = [result.entity!, boundary];
    const exported = exportDxf(document);
    expect(exported.report.skipped).toEqual([]);
    const imported = importDxf(exported.bytes, { documentId: "F-023-DXF-readback", now: "2026-08-29T12:30:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities[0]).toMatchObject({
      kind: "spline", handle: "10", degree: 3,
      controlPoints: [
        { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 },
        { x: 3.621334927543, y: -0.621334927543 },
        { x: 4.628726947271, y: -1.821755493363 },
        { x: 6.000000000002, y: -3.567997608689 },
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543], weights: [1, 1, 2, 2, 2, 2, 2], closed: false, periodic: false,
    });
  });
});
