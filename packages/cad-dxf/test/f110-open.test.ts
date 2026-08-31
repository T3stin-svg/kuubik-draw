import { createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { exportDxf, importDxf, openDxfDocument } from "../src/index.js";

function sourceDocument() {
  const document = createEmptyDocument({ documentId: "source", units: "mm", now: "2026-08-31T00:00:00Z" });
  document.entities = [
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 25 } },
    { kind: "circle", handle: "11", layerId: "0", center: { x: 50, y: 50 }, radius: 10 },
    { kind: "polyline", handle: "12", layerId: "0", closed: true, vertices: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ] },
  ];
  return document;
}

describe("F-110 DXF open workflow", () => {
  it("opens core entities and units as a new editable Model-space document", () => {
    const exported = exportDxf(sourceDocument());
    const opened = openDxfDocument(exported.bytes, {
      documentId: "opened-drawing",
      fileName: "C:\\Audit\\core-mm.dxf",
      now: "2026-08-31T00:00:00Z",
    });

    expect(opened.readback).toEqual({
      documentId: "opened-drawing",
      title: "core-mm",
      units: "mm",
      modelLayoutId: "model",
      entityCount: 3,
      layerCount: 1,
      importedHandles: ["10", "11", "12"],
      entityKinds: { line: 1, circle: 1, polyline: 1 },
    });
    expect(opened.document.metadata.source).toContain("core-mm.dxf");

    const secondGeneration = exportDxf(opened.document);
    const independentlyParsed = importDxf(secondGeneration.bytes, { documentId: "read-back" });
    expect(independentlyParsed.document.units.linear).toBe("mm");
    expect(independentlyParsed.document.entities).toEqual(opened.document.entities);
  });

  it("fails closed instead of returning a partial document", () => {
    const text = new TextDecoder("windows-1252").decode(exportDxf(sourceDocument()).bytes);
    const lines = text.trimEnd().split(/\r?\n/u);
    const entitiesMarker = lines.indexOf("ENTITIES");
    const entitiesEnd = lines.indexOf("ENDSEC", entitiesMarker);
    lines.splice(entitiesEnd - 1, 0, "0", "POINT", "5", "AA", "8", "0", "10", "1", "20", "2");
    const unsupported = `${lines.join("\r\n")}\r\n`;
    expect(() => openDxfDocument(unsupported, { documentId: "partial", fileName: "partial.dxf" }))
      .toThrow(/refused a partial import/u);
  });

  it("requires an explicit DXF file name", () => {
    const exported = exportDxf(sourceDocument());
    expect(() => openDxfDocument(exported.bytes, { documentId: "bad", fileName: "drawing.pdf" }))
      .toThrow(/\.dxf file name/u);
  });
});
