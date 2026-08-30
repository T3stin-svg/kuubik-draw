import { describe, expect, it } from "vitest";
import { createEmptyDocument, executeChamfer } from "@kuubik/cad-core";
import { exportDxf, importDxf } from "../src/index.js";

function applyChanges<T extends ReturnType<typeof createEmptyDocument>>(document: T, changes: ReturnType<typeof executeChamfer>["changes"]): T {
  const output = structuredClone(document);
  for (const change of changes) {
    if (change.type !== "put") continue;
    const index = output.entities.findIndex((entity) => entity.handle === change.entity.handle);
    if (index >= 0) output.entities[index] = change.entity;
    else output.entities.push(change.entity);
  }
  return output;
}

describe("F-025 CHAMFER DXF roundtrip", () => {
  it("preserves ordered Distance geometry, handles and AutoCAD second-source non-colour properties", () => {
    const document = createEmptyDocument({ documentId: "F-025-DXF", now: "2026-08-30T01:00:00.000Z" });
    document.entities = [
      {
        kind: "line", handle: "10", layerId: "0",
        appearance: { color: "#40a0ff", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5 },
        extensionData: { rowId: "F-025", role: "first" },
        start: { x: -100, y: 0 }, end: { x: 0, y: 0 },
      },
      {
        kind: "line", handle: "20", layerId: "0",
        appearance: { color: "#00ff00", colorMethod: "trueColor", aciIndex: 3, lineweightMm: 0.35, transparency: 25 },
        start: { x: 0, y: 0 }, end: { x: 0, y: 100 },
      },
    ];
    const result = executeChamfer(document, {
      mode: "pairs",
      specification: { method: "distance", firstDistance: 10, secondDistance: 20 },
      trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
    });
    expect(result).toMatchObject({ rejected: [], sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], createdHandles: ["21"] });

    const exported = exportDxf(applyChanges(document, result.changes));
    expect(exported.report.skipped).toEqual([]);
    const imported = importDxf(exported.bytes, { documentId: "F-025-DXF-readback", now: "2026-08-30T01:00:01.000Z" });
    expect(imported.report.skipped).toEqual([]);
    expect(imported.document.entities).toEqual([
      expect.objectContaining({
        kind: "line", handle: "10", start: { x: -100, y: 0 }, end: { x: -10, y: 0 },
        appearance: expect.objectContaining({ color: "#40a0ff", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5 }),
      }),
      expect.objectContaining({
        kind: "line", handle: "20", start: { x: 0, y: 20 }, end: { x: 0, y: 100 },
        appearance: expect.objectContaining({ color: "#00ff00", colorMethod: "trueColor", aciIndex: 3, lineweightMm: 0.35, transparency: 25.098039215686 }),
      }),
      {
        kind: "line", handle: "21", start: { x: -10, y: 0 }, end: { x: 0, y: 20 },
        layerId: "dxf-layer:0", appearance: { lineweightMm: 0.35, transparency: 25.098039215686 },
      },
    ]);
  });

  it("roundtrips Polyline trim and No Trim outputs without replacing the source handle", () => {
    const document = createEmptyDocument({ documentId: "F-025-polyline-DXF", now: "2026-08-30T01:10:00.000Z" });
    document.entities = [{
      kind: "polyline", handle: "10", layerId: "0", closed: true,
      appearance: { color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 },
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    }];
    const trimmed = executeChamfer(document, {
      mode: "polyline",
      specification: { method: "distance", firstDistance: 10, secondDistance: 10 },
      trimMode: "trim",
      polylineHandles: ["10"],
    });
    const trimmedDocument = applyChanges(document, trimmed.changes);
    const trimmedReadback = importDxf(exportDxf(trimmedDocument).bytes, { documentId: "F-025-polyline-trim-readback", now: "2026-08-30T01:10:01.000Z" });
    expect(trimmedReadback.report.skipped).toEqual([]);
    expect(trimmedReadback.document.entities).toEqual([expect.objectContaining({
      kind: "polyline", handle: "10", closed: true,
      appearance: expect.objectContaining({ color: "#abcdef", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35 }),
      vertices: [
        { x: 10, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 90 },
        { x: 90, y: 100 }, { x: 10, y: 100 }, { x: 0, y: 90 }, { x: 0, y: 10 },
      ],
    })]);

    const noTrim = executeChamfer(document, {
      mode: "polyline",
      specification: { method: "distance", firstDistance: 10, secondDistance: 10 },
      trimMode: "no-trim",
      polylineHandles: ["10"],
    });
    const noTrimReadback = importDxf(exportDxf(applyChanges(document, noTrim.changes)).bytes, { documentId: "F-025-polyline-no-trim-readback", now: "2026-08-30T01:10:02.000Z" });
    expect(noTrimReadback.report.skipped).toEqual([]);
    expect(noTrimReadback.document.entities.map((entity) => [entity.handle, entity.kind])).toEqual([
      ["10", "polyline"], ["11", "line"], ["12", "line"], ["13", "line"], ["14", "line"],
    ]);
    expect(noTrimReadback.document.entities[0]).toMatchObject({ kind: "polyline", closed: true, vertices: document.entities[0]?.kind === "polyline" ? document.entities[0].vertices : [] });
  });

  it("roundtrips AutoCAD overlap skips and the closed seam in both selection orders", () => {
    const source = createEmptyDocument({ documentId: "F-025-polyline-edge-DXF", now: "2026-08-30T01:15:00.000Z" });
    source.entities = [{ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }] }];
    const overlap = executeChamfer(source, {
      mode: "polyline", specification: { method: "distance", firstDistance: 20, secondDistance: 20 }, trimMode: "trim", polylineHandles: ["10"],
    });
    const overlapReadback = importDxf(exportDxf(applyChanges(source, overlap.changes)).bytes, { documentId: "F-025-overlap-readback", now: "2026-08-30T01:15:01.000Z" });
    expect(overlapReadback.document.entities).toEqual([expect.objectContaining({
      kind: "polyline", handle: "10", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 }],
    })]);

    const seam = (firstSegment: number, secondSegment: number) => executeChamfer(source, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstSegment, firstPickPoint: firstSegment === 3 ? { x: 0, y: 10 } : { x: 10, y: 0 }, secondHandle: "10", secondSegment, secondPickPoint: secondSegment === 3 ? { x: 0, y: 10 } : { x: 10, y: 0 } }],
    });
    const forwardReadback = importDxf(exportDxf(applyChanges(source, seam(3, 0).changes)).bytes, { documentId: "F-025-seam-forward-readback", now: "2026-08-30T01:15:02.000Z" });
    const reverseReadback = importDxf(exportDxf(applyChanges(source, seam(0, 3).changes)).bytes, { documentId: "F-025-seam-reverse-readback", now: "2026-08-30T01:15:03.000Z" });
    expect(forwardReadback.document.entities[0]).toMatchObject({ kind: "polyline", handle: "10", closed: true, vertices: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 10 }] });
    expect(reverseReadback.document.entities[0]).toMatchObject({ kind: "polyline", handle: "10", closed: true, vertices: [{ x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 20 }] });
  });

  it("roundtrips CHAMFER RAY/XLINE Trim conversions and No Trim construction records", () => {
    const document = createEmptyDocument({ documentId: "F-025-construction-DXF", now: "2026-08-30T01:20:00.000Z" });
    document.entities = [
      {
        kind: "ray", handle: "10", layerId: "0", basePoint: { x: -100, y: 0 }, direction: { x: 4, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      },
      {
        kind: "xline", handle: "20", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 3 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      },
    ];
    const args = {
      mode: "pairs" as const,
      specification: { method: "distance" as const, firstDistance: 10, secondDistance: 20 },
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
    };

    const trim = executeChamfer(document, { ...args, trimMode: "trim" });
    const trimmedExport = exportDxf(applyChanges(document, trim.changes));
    expect(trimmedExport.report).toMatchObject({ emittedHandles: ["10", "20", "21"], skipped: [] });
    const trimmedReadback = importDxf(trimmedExport.bytes, { documentId: "F-025-construction-trim-readback", now: "2026-08-30T01:20:01.000Z" });
    expect(trimmedReadback.report.skipped).toEqual([]);
    expect(trimmedReadback.document.entities).toEqual([
      expect.objectContaining({
        kind: "line", handle: "10", start: { x: -100, y: 0 }, end: { x: -10, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      }),
      expect.objectContaining({
        kind: "ray", handle: "20", basePoint: { x: 0, y: 20 }, direction: { x: 0, y: 1 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, lineweightMm: 0.5 },
      }),
      {
        kind: "line", handle: "21", start: { x: -10, y: 0 }, end: { x: 0, y: 20 },
        layerId: "dxf-layer:0", appearance: { lineweightMm: 0.5 },
      },
    ]);

    const noTrim = executeChamfer(document, { ...args, trimMode: "no-trim" });
    const noTrimExport = exportDxf(applyChanges(document, noTrim.changes));
    expect(noTrimExport.report).toMatchObject({ emittedHandles: ["10", "20", "21"], skipped: [] });
    const text = noTrimExport.text.replaceAll("\r\n", "\n");
    expect(text).toContain("0\nRAY\n  5\n10\n");
    expect(text).toContain("0\nXLINE\n  5\n20\n");
    const noTrimReadback = importDxf(noTrimExport.bytes, { documentId: "F-025-construction-no-trim-readback", now: "2026-08-30T01:20:02.000Z" });
    expect(noTrimReadback.report.skipped).toEqual([]);
    expect(noTrimReadback.document.entities.map((entity) => `${entity.handle}:${entity.kind}`)).toEqual(["10:ray", "20:xline", "21:line"]);
    expect(noTrimReadback.document.entities[0]).toMatchObject({ basePoint: { x: -100, y: 0 }, direction: { x: 4, y: 0 } });
    expect(noTrimReadback.document.entities[1]).toMatchObject({ basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 3 } });
  });
});
