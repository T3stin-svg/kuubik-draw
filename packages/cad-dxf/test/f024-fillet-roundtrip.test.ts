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
});
