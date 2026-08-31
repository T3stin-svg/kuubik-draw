import { describe, expect, it } from "vitest";
import { CadSnapIndex, CadSnapSelectionCycle, generateCadSnapCandidates } from "../src/snap.js";

describe("complete deterministic OSNAP candidate engine", () => {
  it("generates Extension, Insertion, GeometricCenter and Parallel candidates", () => {
    const line = { kind: "line" as const, handle: "L", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const block = { kind: "blockRef" as const, handle: "B", layerId: "0", blockId: "symbol", insertion: { x: 2, y: 2 }, scale: { x: 1, y: 1 }, rotationRad: 0 };
    const text = { kind: "text" as const, handle: "T", layerId: "0", position: { x: 3, y: 3 }, text: "A", height: 2.5, rotationRad: 0 };
    const polygon = { kind: "polyline" as const, handle: "P", layerId: "0", closed: true, vertices: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] };
    const hatch = { kind: "hatch" as const, handle: "H", layerId: "0", pattern: "SOLID", associative: false, loops: [
      { isHole: false, vertices: [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }] },
      { isHole: true, vertices: [{ x: 6, y: 26 }, { x: 8, y: 26 }, { x: 8, y: 28 }, { x: 6, y: 28 }] },
    ] };
    const candidates = generateCadSnapCandidates([line, block, text, polygon, hatch], {
      modes: ["extension", "insertion", "geometricCenter", "parallel"],
      cursor: { x: 15, y: 10.1 }, aperture: 30, referencePoint: { x: 0, y: 10 },
    });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: "extension", handle: "L", point: { x: 15, y: 0 }, parameter: 1.5 }),
      expect.objectContaining({ mode: "insertion", handle: "B", point: { x: 2, y: 2 } }),
      expect.objectContaining({ mode: "insertion", handle: "T", point: { x: 3, y: 3 } }),
      expect.objectContaining({ mode: "geometricCenter", handle: "P", point: { x: 25, y: 5 } }),
      expect.objectContaining({ mode: "geometricCenter", handle: "H", point: { x: 4.916666666666667, y: 24.916666666666668 } }),
      expect.objectContaining({ mode: "parallel", handle: "L", point: { x: 15, y: 10 } }),
    ]));
  });

  it("extends a trimmed arc only onto its analytical continuation", () => {
    const arc = { kind: "arc" as const, handle: "A", layerId: "0", center: { x: 0, y: 0 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true };
    expect(generateCadSnapCandidates([arc], { modes: ["extension"], cursor: { x: -10, y: 0 }, aperture: 0 })).toEqual([
      expect.objectContaining({ mode: "extension", point: { x: -10, y: 0 }, parameter: Math.PI }),
    ]);
    expect(generateCadSnapCandidates([arc], { modes: ["extension"], cursor: { x: 10, y: 0 }, aperture: 0 })).toEqual([]);
  });

  it("keeps intersection IDs stable across entity order and priority-independent", () => {
    const horizontal = { kind: "line" as const, handle: "B", layerId: "0", start: { x: 0, y: 5 }, end: { x: 10, y: 5 } };
    const vertical = { kind: "line" as const, handle: "A", layerId: "0", start: { x: 5, y: 0 }, end: { x: 5, y: 10 } };
    const options = { modes: ["intersection"] as const, cursor: { x: 5, y: 5 }, aperture: 0 };
    const forward = generateCadSnapCandidates([horizontal, vertical], options)[0]!;
    const reverse = generateCadSnapCandidates([vertical, horizontal], options)[0]!;
    expect(forward.id).toBe(reverse.id);
    expect(forward.key).toBe(forward.id);
    expect(forward.id).toBe("intersection:A:0|B:0:5.0000000000000000,5.0000000000000000");
    expect(forward.id.startsWith(String(forward.priority))).toBe(false);
  });

  it("cycles by stable candidate ID and preserves the active ID across fresh queries", () => {
    const entities = [
      { kind: "line" as const, handle: "A", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line" as const, handle: "B", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
    ];
    const options = { modes: ["endpoint", "midpoint"] as const, cursor: { x: 0, y: 0 }, aperture: 20 };
    const firstQuery = generateCadSnapCandidates(entities, options);
    const cycle = new CadSnapSelectionCycle();
    const initial = cycle.update(firstQuery);
    const next = cycle.cycle(firstQuery);
    expect(initial.count).toBe(firstQuery.length);
    expect(next.index).toBe(1);
    expect(next.candidateId).not.toBe(initial.candidateId);
    expect(cycle.update(generateCadSnapCandidates(structuredClone(entities), options)).candidateId).toBe(next.candidateId);
    expect(cycle.cycle(firstQuery, -1).candidateId).toBe(initial.candidateId);
  });

  it("queries explicitly acquired extension handles outside their finite R-tree bounds", () => {
    const index = new CadSnapIndex();
    index.setEntities([{ kind: "line", handle: "L", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    expect(index.query({ modes: ["extension"], cursor: { x: 50, y: 0 }, aperture: 0 })).toEqual([]);
    expect(index.query({ modes: ["extension"], cursor: { x: 50, y: 0 }, aperture: 0, referenceHandles: ["L"] })).toEqual([
      expect.objectContaining({ id: expect.stringContaining("extension:L"), point: { x: 50, y: 0 }, parameter: 5 }),
    ]);
  });
});
