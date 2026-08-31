import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, PeditInputError, preparePeditCommand, readPeditCurveDefinition } from "../src/index.js";

function peditDocument() {
  const document = createEmptyDocument({ documentId: "F-034", now: "2026-08-31T22:00:00.000Z" });
  document.layers.push(
    { id: "PEDIT", name: "PEDIT", visible: true, frozen: false, locked: false, plottable: true },
    { id: "LOCKED", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    { id: "HIDDEN", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
  );
  document.entities.push(
    { kind: "line", handle: "10", layerId: "PEDIT", appearance: { color: "#4a90e2", lineweightMm: 0.5 }, extensionData: { owner: "Reio" }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "arc", handle: "11", layerId: "PEDIT", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true },
    { kind: "line", handle: "12", layerId: "PEDIT", start: { x: 20, y: 10 }, end: { x: 30, y: 10 } },
  );
  return document;
}

describe("F-034 PEDIT command matrix", () => {
  it("matches the versioned line/arc Join and Width golden while preserving source identity", () => {
    const golden = JSON.parse(readFileSync(new URL("./f034-pedit.golden.json", import.meta.url), "utf8"));
    const prepared = preparePeditCommand(peditDocument(), {
      handle: "10",
      actions: [{ type: "join", handles: ["11", "12"], tolerance: 0 }, { type: "width", width: 2 }],
    });
    expect({ version: 1, command: prepared.commandId, joinedHandles: prepared.joinedHandles, vertices: prepared.entity.vertices }).toEqual(golden);
    expect(prepared.entity).toMatchObject({
      handle: "10", layerId: "PEDIT", appearance: { color: "#4a90e2", lineweightMm: 0.5 }, extensionData: { owner: "Reio" },
    });
    expect(prepared.changes).toMatchObject([{ type: "put" }, { type: "delete", handle: "11" }, { type: "delete", handle: "12" }]);
  });

  it("converts an ARC source to an exact signed bulged polyline and retains its properties", () => {
    const document = peditDocument();
    const arc = document.entities.find((entity) => entity.handle === "11")!;
    arc.appearance = { color: "#ff0000", lineweightMm: 0.25 };
    arc.extensionData = { tag: "arc-source" };
    const result = preparePeditCommand(document, { handle: "11", actions: [{ type: "open" }] });
    expect(result.entity).toMatchObject({ handle: "11", layerId: "PEDIT", closed: false, appearance: arc.appearance, extensionData: arc.extensionData });
    expect(result.entity.vertices[0]!.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(result.entity.vertices[1]).toMatchObject({ x: 20, y: 10 });
  });

  it("implements Extend and Add tolerance joins without hiding the bridge distinction", () => {
    const document = peditDocument();
    document.entities = [
      { kind: "line", handle: "10", layerId: "PEDIT", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: "line", handle: "11", layerId: "PEDIT", start: { x: 10.5, y: 0 }, end: { x: 20, y: 0 } },
    ];
    expect(preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 1, jointype: "extend" }] }).entity.vertices)
      .toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 1, jointype: "add" }] }).entity.vertices)
      .toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.5, y: 0 }, { x: 20, y: 0 }]);
    expect(preparePeditCommand(document, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0.1 }] }).rejectedJoins)
      .toEqual([{ handle: "11", reason: "not-contiguous" }]);
  });

  it("splits a bulged arc exactly, edits widths, moves/deletes vertices and straightens a range", () => {
    const document = peditDocument();
    document.entities = [{ kind: "polyline", handle: "10", layerId: "PEDIT", closed: false, vertices: [
      { x: 0, y: 0, bulge: 1, startWidth: 1, endWidth: 3 }, { x: 10, y: 0 }, { x: 20, y: 5 }, { x: 30, y: 0 },
    ] }];
    const split = preparePeditCommand(document, { handle: "10", actions: [{ type: "insert-vertex", index: 1, point: { x: 5, y: -5 } }] }).entity;
    expect(split.vertices).toHaveLength(5);
    expect(split.vertices[0]).toMatchObject({ bulge: expect.closeTo(Math.tan(Math.PI / 8), 12), startWidth: 1, endWidth: 2 });
    expect(split.vertices[1]).toMatchObject({ x: 5, y: -5, bulge: expect.closeTo(Math.tan(Math.PI / 8), 12), startWidth: 2, endWidth: 3 });
    document.entities = [split];
    const edited = preparePeditCommand(document, { handle: "10", actions: [
      { type: "vertex-width", index: 2, startWidth: 4, endWidth: 5 },
      { type: "move-vertex", index: 3, point: { x: 22, y: 7 } },
      { type: "delete-vertex", index: 4 },
      { type: "straighten", fromIndex: 1, toIndex: 3 },
    ] }).entity;
    expect(edited.vertices).toEqual([
      expect.objectContaining({ x: 0, y: 0 }), { x: 5, y: -5 }, { x: 22, y: 7 },
    ]);
    expect(edited.vertices[1]!.bulge).toBeUndefined();
  });

  it("stores a deterministic Fit/Spline frame, refits vertex edits and Decurve restores it", () => {
    const document = peditDocument();
    const frame = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -4 }, { x: 30, y: 0 }];
    document.entities = [{ kind: "polyline", handle: "10", layerId: "PEDIT", closed: false, vertices: frame }];
    const fit = preparePeditCommand(document, { handle: "10", actions: [{ type: "fit", samplesPerSpan: 4 }] }).entity;
    expect(fit.vertices.length).toBeGreaterThan(frame.length);
    expect(readPeditCurveDefinition(fit)).toMatchObject({ mode: "fit", degree: 3, samplesPerSpan: 4, frameVertices: frame });
    document.entities = [fit];
    const edited = preparePeditCommand(document, { handle: "10", actions: [{ type: "edit-vertex", index: 1, point: { x: 10, y: 12 } }, { type: "spline", degree: 2, samplesPerSpan: 3 }] }).entity;
    expect(readPeditCurveDefinition(edited)).toMatchObject({ mode: "spline", degree: 2, frameVertices: [frame[0], { x: 10, y: 12 }, frame[2], frame[3]] });
    document.entities = [edited];
    const decurved = preparePeditCommand(document, { handle: "10", actions: [{ type: "decurve" }] }).entity;
    expect(decurved.vertices).toEqual([frame[0], { x: 10, y: 12 }, frame[2], frame[3]]);
    expect(readPeditCurveDefinition(decurved)).toBeNull();
  });

  it.each([
    ["circle source", (document: ReturnType<typeof peditDocument>) => { document.entities = [{ kind: "circle", handle: "10", layerId: "PEDIT", center: { x: 0, y: 0 }, radius: 5 }]; }, "UNSUPPORTED_ENTITY"],
    ["locked source", (document: ReturnType<typeof peditDocument>) => { document.entities[0]!.layerId = "LOCKED"; }, "LAYER_LOCKED"],
    ["hidden source", (document: ReturnType<typeof peditDocument>) => { document.entities[0]!.layerId = "HIDDEN"; }, "LAYER_HIDDEN"],
    ["missing layer", (document: ReturnType<typeof peditDocument>) => { document.entities[0]!.layerId = "MISSING"; }, "LAYER_NOT_FOUND"],
  ])("fails closed for %s", (_label, mutate, code) => {
    const document = peditDocument();
    mutate(document);
    try {
      preparePeditCommand(document, { handle: "10", actions: [{ type: "open" }] });
      throw new Error("Expected PEDIT to fail closed.");
    } catch (error) {
      expect(error).toBeInstanceOf(PeditInputError);
      expect((error as PeditInputError).code).toBe(code);
    }
  });

  it("is deterministic and finite over a seeded property/fuzz corpus", () => {
    let seed = 0xF034;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let sample = 0; sample < 100; sample += 1) {
      const document = peditDocument();
      const vertices = Array.from({ length: 3 + Math.floor(random() * 8) }, (_unused, index) => ({ x: index * 10, y: (random() - 0.5) * 20 }));
      document.entities = [{ kind: "polyline", handle: "10", layerId: "PEDIT", closed: false, vertices }];
      const actions = [{ type: "width" as const, width: random() * 5 }, { type: "reverse" as const }, { type: "spline" as const, degree: 2 as const, samplesPerSpan: 2 }];
      const first = preparePeditCommand(document, { handle: "10", actions });
      const second = preparePeditCommand(document, { handle: "10", actions });
      expect(first).toEqual(second);
      expect(first.entity.vertices.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y))).toBe(true);
    }
  });
});
