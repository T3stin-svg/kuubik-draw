import type { CadLine, CadPolyline } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { CadCommandInputError, createEmptyDocument, executeAlign, resolveCadCommand } from "../src/index.js";

const line: CadLine = {
  kind: "line",
  handle: "10",
  layerId: "0",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  appearance: { color: "#ff0000", lineweightMm: 0.35 },
  extensionData: { rowId: "F-029" },
};

describe("F-029 ALIGN", () => {
  it("resolves AL/ALIGN and translates with one source/destination pair", () => {
    expect(resolveCadCommand("al")?.id).toBe("ALIGN");
    expect(resolveCadCommand("ALIGN")?.id).toBe("ALIGN");
    const document = createEmptyDocument({ documentId: "align-one" });
    document.entities.push(line);
    const result = executeAlign(document, {
      targetHandles: ["10"],
      pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 50, y: 25 } }],
      scaleToFit: true,
    });
    expect(result).toMatchObject({
      pointPairCount: 1,
      scaleToFit: false,
      angleRad: 0,
      scaleFactor: 1,
      translation: { x: 50, y: 25 },
      sourceHandles: ["10"],
      resultHandles: ["10"],
      rejected: [],
    });
    expect(result.changes).toEqual([{ type: "put", entity: { ...line, start: { x: 50, y: 25 }, end: { x: 150, y: 25 } } }]);
    expect(document.entities).toEqual([line]);
  });

  it("rotates two point pairs around the first source and preserves size when Scale is No", () => {
    const document = createEmptyDocument({ documentId: "align-rotate" });
    document.entities.push(line);
    const result = executeAlign(document, {
      targetHandles: ["10"],
      pointPairs: [
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 200, y: 300 } },
        { sourcePoint: { x: 100, y: 0 }, destinationPoint: { x: 200, y: 500 } },
      ],
      scaleToFit: false,
    });
    expect(result.angleRad).toBeCloseTo(Math.PI / 2, 12);
    expect(result.scaleFactor).toBe(1);
    expect(result.changes[0]).toMatchObject({
      type: "put",
      entity: { kind: "line", handle: "10", start: { x: 200, y: 300 }, end: { x: 200, y: 400 } },
    });
  });

  it("uniformly scales with two point pairs and preserves polyline widths and properties", () => {
    const polyline: CadPolyline = {
      kind: "polyline", handle: "20", layerId: "0", closed: false,
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }],
      appearance: { color: "#00ff00" }, extensionData: { retained: true },
    };
    const document = createEmptyDocument({ documentId: "align-scale" });
    document.entities.push(polyline);
    const result = executeAlign(document, {
      targetHandles: ["20"],
      pointPairs: [
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 10, y: 20 } },
        { sourcePoint: { x: 100, y: 0 }, destinationPoint: { x: 10, y: 220 } },
      ],
      scaleToFit: true,
    });
    expect(result.scaleFactor).toBeCloseTo(2, 12);
    expect(result.changes).toEqual([{
      type: "put",
      entity: {
        ...polyline,
        vertices: [
          { x: 10, y: 20, startWidth: 4, endWidth: 8 },
          { x: 10, y: 220, startWidth: 8, endWidth: 12 },
        ],
      },
    }]);
  });

  it("reports no-change, locked, missing and unsupported targets without partial mutation", () => {
    const document = createEmptyDocument({ documentId: "align-reject" });
    document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      line,
      { ...line, handle: "11", layerId: "locked" },
      { kind: "proxy", handle: "12", layerId: "0", originalType: "ACAD_PROXY_ENTITY", payloadBase64: "AA==" },
    );
    const result = executeAlign(document, {
      targetHandles: ["10", "11", "12", "missing"],
      pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 0, y: 0 } }],
      scaleToFit: false,
    });
    expect(result.changes).toEqual([]);
    expect(result.noChangeHandles).toEqual(["10"]);
    expect(result.rejected).toEqual([
      { handle: "11", reason: "locked-layer" },
      { handle: "12", reason: "unsupported-entity" },
      { handle: "missing", reason: "missing" },
    ]);
    expect(document.entities[0]).toEqual(line);
  });

  it("fails closed for missing targets and degenerate second point pairs", () => {
    const document = createEmptyDocument({ documentId: "align-invalid" });
    expect(() => executeAlign(document, { targetHandles: [], pointPairs: [{ sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 1, y: 1 } }], scaleToFit: false })).toThrow(CadCommandInputError);
    expect(() => executeAlign(document, {
      targetHandles: ["10"],
      pointPairs: [
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 0, y: 0 } },
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 10, y: 0 } },
      ],
      scaleToFit: true,
    })).toThrow(/source points must be distinct/);
    expect(() => executeAlign(document, {
      targetHandles: ["10"],
      pointPairs: [
        { sourcePoint: { x: 0, y: 0 }, destinationPoint: { x: 0, y: 0 } },
        { sourcePoint: { x: 10, y: 0 }, destinationPoint: { x: 0, y: 0 } },
      ],
      scaleToFit: false,
    })).toThrow(/destination points must be distinct/);
  });
});
