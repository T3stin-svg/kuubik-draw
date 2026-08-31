import { describe, expect, it } from "vitest";
import { createEmptyDocument, preparePeditCommand, readPeditCurveDefinition } from "../src/index.js";

function documentWith(...entities: Parameters<ReturnType<typeof createEmptyDocument>["entities"]["push"]>) {
  const document = createEmptyDocument({ documentId: "F-034-mutation" });
  document.entities.push(...entities);
  return document;
}

describe("F-034 mutation-proven PEDIT ratchet", () => {
  it("kills handle/property loss, source reversal and arc-sign mutants", () => {
    const source = { kind: "line" as const, handle: "10", layerId: "0", appearance: { color: "#123456" }, extensionData: { owner: "F-034" }, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const arc = { kind: "arc" as const, handle: "11", layerId: "0", center: { x: 10, y: 10 }, radius: 10, startAngleRad: -Math.PI / 2, endAngleRad: 0, counterClockwise: true };
    const before = structuredClone([source, arc]);
    const result = preparePeditCommand(documentWith(source, arc), { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 0 }, { type: "reverse" }] });
    expect(result.entity).toMatchObject({ handle: "10", layerId: "0", appearance: source.appearance, extensionData: source.extensionData });
    expect(result.entity.vertices[0]).toMatchObject({ x: 20, y: 10, bulge: expect.closeTo(-Math.tan(Math.PI / 8), 12) });
    expect([source, arc]).toEqual(before);
  });

  it("kills tolerance-boundary, bridge omission, duplicate-delete and hidden-layer mutants", () => {
    const source = { kind: "line" as const, handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    const candidate = { kind: "line" as const, handle: "11", layerId: "0", start: { x: 10.25, y: 0 }, end: { x: 20, y: 0 } };
    const joined = preparePeditCommand(documentWith(source, candidate), {
      handle: "10", actions: [{ type: "join", handles: ["11", "11"], tolerance: 0.25, jointype: "add" }],
    });
    expect(joined.entity.vertices).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.25, y: 0 }, { x: 20, y: 0 }]);
    expect(joined.changes.filter((change) => change.type === "delete")).toEqual([{ type: "delete", handle: "11" }]);

    const hidden = documentWith(source, { ...candidate, layerId: "OFF" });
    hidden.layers.push({ id: "OFF", name: "OFF", visible: false, frozen: false, locked: false, plottable: true });
    expect(preparePeditCommand(hidden, { handle: "10", actions: [{ type: "join", handles: ["11"], tolerance: 1 }] }).rejectedJoins)
      .toEqual([{ handle: "11", reason: "hidden-layer" }]);
  });

  it("kills bulge-split, width-interpolation, curve-frame and Decurve mutants", () => {
    const source = { kind: "polyline" as const, handle: "10", layerId: "0", closed: false, vertices: [
      { x: 0, y: 0, bulge: 1, startWidth: 2, endWidth: 6 }, { x: 10, y: 0 }, { x: 20, y: 5 }, { x: 30, y: 0 },
    ] };
    const split = preparePeditCommand(documentWith(source), { handle: "10", actions: [{ type: "insert-vertex", index: 1, point: { x: 5, y: -5 } }] }).entity;
    expect(split.vertices[0]).toMatchObject({ bulge: expect.closeTo(Math.tan(Math.PI / 8), 12), endWidth: 4 });
    expect(split.vertices[1]).toMatchObject({ bulge: expect.closeTo(Math.tan(Math.PI / 8), 12), startWidth: 4 });

    const curved = preparePeditCommand(documentWith(split), { handle: "10", actions: [{ type: "fit", samplesPerSpan: 2 }, { type: "move-vertex", index: 2, point: { x: 11, y: 3 } }] }).entity;
    expect(readPeditCurveDefinition(curved)?.frameVertices[2]).toMatchObject({ x: 11, y: 3 });
    const straight = preparePeditCommand(documentWith(curved), { handle: "10", actions: [{ type: "decurve" }] }).entity;
    expect(straight.vertices).toEqual(readPeditCurveDefinition(curved)?.frameVertices.map(({ bulge: _bulge, ...vertex }) => vertex));
    expect(readPeditCurveDefinition(straight)).toBeNull();
  });
});
