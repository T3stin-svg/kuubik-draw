import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeFillet } from "@kuubik/cad-core";
import { exportDxf, importDxf } from "../src/index.js";

describe("F-024 FILLET DXF roundtrip", () => {
  it("preserves trimmed source properties, tangent ARC geometry and Polyline bulges", () => {
    const document = createEmptyDocument({ documentId: "F-024-DXF", now: "2026-08-29T15:20:00.000Z" });
    document.entities = [
      { kind: "line", handle: "10", layerId: "0", appearance: { color: "#40a0ff", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5 }, extensionData: { rowId: "F-024" }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
      { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
      { kind: "polyline", handle: "30", layerId: "0", closed: true, vertices: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 50 }, { x: 200, y: 50 }] },
    ];
    const pair = executeFillet(document, { mode: "pairs", radius: 10, trimMode: "trim", pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }] });
    const pairDocument = structuredClone(document);
    pair.changes.forEach((change) => { if (change.type === "put") {
      const index = pairDocument.entities.findIndex((entity) => entity.handle === change.entity.handle);
      if (index >= 0) pairDocument.entities[index] = change.entity; else pairDocument.entities.push(change.entity);
    } });
    const polyline = executeFillet(pairDocument, { mode: "polyline", radius: 5, polylineHandles: ["30"] });
    polyline.changes.forEach((change) => { if (change.type === "put") pairDocument.entities[pairDocument.entities.findIndex((entity) => entity.handle === change.entity.handle)] = change.entity; });

    const exported = exportDxf(pairDocument);
    expect(exported.report.skipped).toEqual([]);
    const imported = importDxf(exported.bytes, { documentId: "F-024-DXF-readback", now: "2026-08-29T15:20:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", end: { x: -10, y: 0 }, appearance: { color: "#40a0ff", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5 } });
    expect(imported.document.entities.find((entity) => entity.handle === "31")).toMatchObject({ kind: "arc", center: { x: -10, y: 10 }, radius: 10 });
    const rounded = imported.document.entities.find((entity) => entity.handle === "30");
    expect(rounded).toMatchObject({ kind: "polyline", closed: true });
    expect(rounded?.kind === "polyline" ? rounded.vertices : []).toHaveLength(8);
    expect(rounded?.kind === "polyline" ? rounded.vertices.filter((vertex) => Math.abs(vertex.bulge ?? 0) > 0) : []).toHaveLength(4);
  });

  it("roundtrips same-polyline segment fillets and variable widths exactly", () => {
    const document = createEmptyDocument({ documentId: "F-024-polyline-DXF", now: "2026-08-29T15:30:00.000Z" });
    document.entities = [{
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      appearance: { color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 4 },
        { x: 100, y: 0, startWidth: 4, endWidth: 6 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    }];
    const result = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstSegment: 0, firstPickPoint: { x: 80, y: 0 }, secondHandle: "10", secondSegment: 1, secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(result).toMatchObject({ rejected: [], resultHandles: ["10"], createdHandles: [] });
    const output = structuredClone(document);
    result.changes.forEach((change) => { if (change.type === "put") output.entities[0] = change.entity; });
    const imported = importDxf(exportDxf(output).bytes, { documentId: "F-024-polyline-DXF-readback", now: "2026-08-29T15:30:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities).toEqual([expect.objectContaining({
      kind: "polyline", handle: "10", closed: true,
      appearance: expect.objectContaining({ color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 }),
      vertices: [
        { x: 0, y: 0, startWidth: 2, endWidth: 3.8 },
        { x: 90, y: 0, bulge: 0.414213562373, startWidth: 3.8, endWidth: 4.2 },
        { x: 100, y: 10, startWidth: 4.2, endWidth: 6 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    })]);
  });

  it("roundtrips the AutoCAD-live full ellipse and rational spline FILLET outputs", () => {
    const document = createEmptyDocument({ documentId: "F-024-parametric-DXF", now: "2026-08-29T17:25:00.000Z" });
    document.entities = [
      { kind: "line", handle: "10", layerId: "0", start: { x: -200, y: 0 }, end: { x: 0, y: 0 } },
      { kind: "ellipse", handle: "20", layerId: "0", center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
      { kind: "line", handle: "30", layerId: "0", start: { x: 100, y: 200 }, end: { x: 300, y: 200 } },
      { kind: "spline", handle: "40", layerId: "0", degree: 3, controlPoints: [{ x: 300, y: 200 }, { x: 300, y: 240 }, { x: 360, y: 260 }, { x: 400, y: 300 }], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 2, 3, 4], closed: false, periodic: false },
    ];
    const result = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim", multiple: true,
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -20, y: 0 }, secondHandle: "20", secondPickPoint: { x: 2, y: 10 } },
        { firstHandle: "30", firstPickPoint: { x: 280, y: 200 }, secondHandle: "40", secondPickPoint: { x: 302, y: 210 } },
      ],
    });
    expect(result.rejected).toEqual([]);
    const output = structuredClone(document);
    result.changes.forEach((change) => {
      if (change.type !== "put") return;
      const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
      if (index >= 0) output.entities[index] = change.entity;
      else output.entities.push(change.entity);
    });

    const imported = importDxf(exportDxf(output).bytes, { documentId: "F-024-parametric-DXF-readback", now: "2026-08-29T17:25:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities.map((entity) => [entity.handle, entity.kind])).toEqual([
      ["10", "line"], ["20", "ellipse"], ["30", "line"], ["40", "spline"], ["41", "arc"], ["42", "arc"],
    ]);
    expect(imported.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", end: { x: expect.closeTo(-8.557770070555, 9), y: 0 } });
    expect(imported.document.entities.find((entity) => entity.handle === "20")).toEqual(expect.objectContaining({ kind: "ellipse", center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5 }));
    expect(imported.document.entities.find((entity) => entity.handle === "40")).toMatchObject({
      kind: "spline", degree: 3, weights: expect.any(Array),
      controlPoints: [
        { x: expect.closeTo(300.695133809593, 9), y: expect.closeTo(208.281263088522, 9) },
        { x: expect.any(Number), y: expect.any(Number) },
        { x: expect.any(Number), y: expect.any(Number) },
        { x: 400, y: 300 },
      ],
    });
    expect(imported.document.entities.find((entity) => entity.handle === "41")).toMatchObject({ kind: "arc", center: { x: expect.closeTo(-8.557770070476, 9), y: expect.closeTo(10.000000000267, 9) }, radius: 10 });
    expect(imported.document.entities.find((entity) => entity.handle === "42")).toMatchObject({ kind: "arc", center: { x: expect.closeTo(290.843943859683, 9), y: expect.closeTo(210, 9) }, radius: 10 });
  });

  it("roundtrips AutoCAD-compatible RAY/XLINE records with exact base, direction and appearance groups", () => {
    const document = createEmptyDocument({ documentId: "F-024-construction-DXF", now: "2026-08-29T21:40:00.000Z" });
    document.entities = [
      {
        kind: "ray", handle: "10", layerId: "0", basePoint: { x: 0, y: 4600 }, direction: { x: 4, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      },
      {
        kind: "xline", handle: "20", layerId: "0", basePoint: { x: 100, y: 4810 }, direction: { x: 0, y: 3 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      },
    ];
    const exported = exportDxf(document);
    expect(exported.report).toMatchObject({ emittedHandles: ["10", "20"], skipped: [] });
    const text = exported.text.replaceAll("\r\n", "\n");
    expect(text).toContain("0\nRAY\n  5\n10\n330\n1A\n100\nAcDbEntity\n  8\n0\n 62\n1\n370\n50\n100\nAcDbRay\n 10\n0\n 20\n4600\n 30\n0\n 11\n4\n 21\n0\n 31\n0\n");
    expect(text).toContain("0\nXLINE\n  5\n20\n330\n1A\n100\nAcDbEntity\n  8\n0\n 62\n1\n370\n50\n100\nAcDbXline\n 10\n100\n 20\n4810\n 30\n0\n 11\n0\n 21\n3\n 31\n0\n");

    const imported = importDxf(exported.bytes, { documentId: "F-024-construction-DXF-readback", now: "2026-08-29T21:40:01.000Z" });
    expect(imported.report).toMatchObject({ importedHandles: ["10", "20"], skipped: [] });
    expect(imported.document.entities).toEqual([
      expect.objectContaining({
        kind: "ray", handle: "10", layerId: "dxf-layer:0", basePoint: { x: 0, y: 4600 }, direction: { x: 4, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      }),
      expect.objectContaining({
        kind: "xline", handle: "20", layerId: "dxf-layer:0", basePoint: { x: 100, y: 4810 }, direction: { x: 0, y: 3 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      }),
    ]);
  });
});
