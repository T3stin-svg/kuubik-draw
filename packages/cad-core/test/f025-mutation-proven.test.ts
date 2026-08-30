import { describe, expect, it } from "vitest";
import {
  CadSession,
  chamferCadEntityPair,
  chamferCadPolyline,
  chamferCadPolylineSegmentPair,
  createEmptyDocument,
  executeChamfer,
} from "../src/index.js";

const first = { kind: "line" as const, handle: "10", layerId: "0", appearance: { color: "#09f" }, extensionData: { rowId: "F-025" }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } };
const second = { kind: "line" as const, handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };
const secondWithProperties = { ...second, appearance: { color: "#0f0", linetypeId: "dashed", lineweightMm: 0.35, transparency: 25 } };

describe("F-025 mutation-proven CHAMFER ratchet", () => {
  it("kills ordered-distance, picked-ray, property-loss and source-mutation mutants", () => {
    const before = [structuredClone(first), structuredClone(second)];
    const result = chamferCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim");
    expect(result).toMatchObject({
      reason: null, intersection: { x: 0, y: 0 }, effectiveDistances: [10, 20],
      chamferPoints: [{ x: -10, y: 0 }, { x: 0, y: 20 }],
      firstEntity: { end: { x: -10, y: 0 }, appearance: { color: "#09f" }, extensionData: { rowId: "F-025" } },
      secondEntity: { start: { x: 0, y: 20 } },
      line: { start: { x: -10, y: 0 }, end: { x: 0, y: 20 } },
    });
    expect([first, second]).toEqual(before);
  });

  it("kills Angle conversion, swapped-line and invalid-angle mutants", () => {
    const angle = chamferCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, { method: "angle", firstDistance: 10, angleDeg: 30 }, "trim");
    expect(angle.effectiveDistances).toEqual([10, 5.773502691896]);
    expect(angle.line).toEqual({ kind: "line", start: { x: -10, y: 0 }, end: { x: 0, y: 5.773502691896 } });
    expect(chamferCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, { method: "angle", firstDistance: 10, angleDeg: 90 }, "trim")).toMatchObject({ reason: "invalid-angle", line: null });
  });

  it("kills No Trim, Shift sharp-corner and parallel acceptance mutants", () => {
    const noTrim = chamferCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, { method: "distance", firstDistance: 10, secondDistance: 20 }, "no-trim");
    expect(noTrim).toMatchObject({ firstEntity: first, secondEntity: second, line: { start: { x: -10, y: 0 }, end: { x: 0, y: 20 } } });
    const sharp = chamferCadEntityPair({ ...first, end: { x: -10, y: 0 } }, { x: -50, y: 0 }, { ...second, start: { x: 0, y: 10 } }, { x: 0, y: 50 }, { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim");
    expect(sharp).toMatchObject({ line: null, firstEntity: { end: { x: 0, y: 0 } }, secondEntity: { start: { x: 0, y: 0 } } });
    expect(chamferCadEntityPair(first, { x: -50, y: 0 }, { ...first, handle: "20", start: { x: -100, y: 10 }, end: { x: 0, y: 10 } }, { x: -50, y: 10 }, { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim")).toMatchObject({ reason: "parallel", line: null });
  });

  it("kills Polyline all-corner, short-segment and No Trim source-loss mutants", () => {
    const rectangle = { kind: "polyline" as const, handle: "10", layerId: "0", closed: true, appearance: { color: "#0f0" }, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const trimmed = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim");
    expect(trimmed).toMatchObject({ reason: null, chamferCount: 4, skippedVertices: [], entity: { handle: "10", appearance: { color: "#0f0" } } });
    expect(trimmed.entity?.vertices).toEqual([{ x: 20, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 90 }, { x: 80, y: 100 }, { x: 10, y: 100 }, { x: 0, y: 80 }, { x: 0, y: 10 }]);
    const noTrim = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 10, secondDistance: 20 }, "no-trim");
    expect(noTrim.entity).toEqual(rectangle);
    expect(noTrim.lines).toHaveLength(4);
    const tooShort = chamferCadPolyline({ ...rectangle, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] }, { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim");
    expect(tooShort).toMatchObject({ chamferCount: 0, skippedVertices: [0, 1, 2, 3] });
    const overlap = { ...rectangle, vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }] };
    expect(chamferCadPolyline(overlap, { method: "distance", firstDistance: 20, secondDistance: 20 }, "trim")).toMatchObject({
      chamferCount: 2, skippedVertices: [0, 2], entity: { vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 }] },
    });
    expect(chamferCadPolyline(overlap, { method: "distance", firstDistance: 20, secondDistance: 20 }, "no-trim")).toMatchObject({ chamferCount: 4, skippedVertices: [], lines: expect.any(Array) });
    const forward = chamferCadPolylineSegmentPair(overlap, 3, { x: 0, y: 10 }, 0, { x: 10, y: 0 }, { method: "distance", firstDistance: 5, secondDistance: 10 }, "trim");
    const reverse = chamferCadPolylineSegmentPair(overlap, 0, { x: 10, y: 0 }, 3, { x: 0, y: 10 }, { method: "distance", firstDistance: 5, secondDistance: 10 }, "trim");
    expect(forward.joinedPolyline?.vertices).toEqual([{ x: 10, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 5 }]);
    expect(reverse.joinedPolyline?.vertices).toEqual([{ x: 5, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 10 }]);

    const zero = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim");
    const zeroPair = chamferCadPolylineSegmentPair(rectangle, 3, { x: 0, y: 10 }, 0, { x: 10, y: 0 }, { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim");
    expect(zero).toMatchObject({ entity: rectangle, chamferCount: 4, lines: [] });
    expect(zero.entity?.vertices).toHaveLength(4);
    expect(zeroPair).toMatchObject({ joinedPolyline: rectangle, line: null });
    expect(zeroPair.joinedPolyline?.vertices).toHaveLength(4);
  });

  it("kills selected-polyline bounds and over-broad standalone LINE rejection mutants", () => {
    const rectangle = { kind: "polyline" as const, handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const short = { ...rectangle, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] };
    expect(chamferCadPolylineSegmentPair(short, 0, { x: 2, y: 0 }, 1, { x: 5, y: 2 }, { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim"))
      .toMatchObject({ reason: "distance-too-large", firstEntity: null, secondEntity: null });
    expect(chamferCadEntityPair(
      { ...first, start: { x: -100, y: 0 }, end: { x: -10, y: 0 } }, { x: -50, y: 0 },
      { ...second, start: { x: 0, y: 10 }, end: { x: 0, y: 100 } }, { x: 0, y: 50 },
      { method: "distance", firstDistance: 200, secondDistance: 200 }, "trim",
    )).toMatchObject({ reason: null, firstEntity: { end: { x: -200, y: 0 } }, secondEntity: { start: { x: 0, y: 200 } } });
  });

  it("kills split-Multiple, unstable-handle, locked-layer and hidden-layer rejection mutants", () => {
    const document = createEmptyDocument({ documentId: "F-025-mutation" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "off", name: "OFF", visible: false, frozen: true, locked: false, plottable: true },
    );
    document.entities.push(
      { ...first, layerId: "locked" }, { ...second, layerId: "locked" },
      { ...first, handle: "30", layerId: "off", start: { x: 100, y: 0 }, end: { x: 200, y: 0 } },
      { ...second, handle: "40", layerId: "off", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    );
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
      ],
    });
    expect(result).toMatchObject({ rejected: [{ sourceIndex: 0, reason: "locked-layer" }], sourceHandles: ["30", "40"], resultHandles: ["30", "40", "41"], createdHandles: ["41"], multiple: true });
  });

  it("kills one-sided atomic Undo/Redo and created-line appearance mutants", () => {
    const document = createEmptyDocument({ documentId: "F-025-atomic" });
    document.entities.push(first, secondWithProperties, { ...first, handle: "30", start: { x: 100, y: 0 }, end: { x: 200, y: 0 } }, { ...secondWithProperties, handle: "40", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } });
    const source = structuredClone(document.entities);
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
      ],
    });
    expect(result).toMatchObject({ createdHandles: ["41", "42"], rejected: [] });
    expect(result.changes.filter((change) => change.type === "put" && ["41", "42"].includes(change.entity.handle))).toEqual([
      { type: "put", entity: expect.objectContaining({ handle: "41", layerId: "0", appearance: { lineweightMm: 0.35, transparency: 25 } }) },
      { type: "put", entity: expect.objectContaining({ handle: "42", layerId: "0", appearance: { lineweightMm: 0.35, transparency: 25 } }) },
    ]);
    for (const change of result.changes.filter((candidate) => candidate.type === "put" && ["41", "42"].includes(candidate.entity.handle))) {
      if (change.type !== "put") continue;
      expect(change.entity.appearance).not.toHaveProperty("color");
      expect(change.entity.appearance).not.toHaveProperty("linetypeId");
    }
    const session = new CadSession(document);
    session.commit({ opId: "F-025-atomic", baseRevision: 0, commandId: "CHAMFER", args: {}, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    const committed = structuredClone(session.document.entities);
    expect(session.undo()).not.toBeNull(); expect(session.document.entities).toEqual(source);
    expect(session.redo()).not.toBeNull(); expect(session.document.entities).toEqual(committed);
  });
});
