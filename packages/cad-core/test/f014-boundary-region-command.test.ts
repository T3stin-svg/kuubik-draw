import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BoundaryRegionInputError,
  createEmptyDocument,
  prepareBoundaryCommand,
  prepareRegionCommand,
} from "../src/index.js";

function arcLineDocument() {
  const document = createEmptyDocument({ documentId: "F-014-arc-line", now: "2026-09-01T01:00:00.000Z" });
  document.layers.push({ id: "REGION", name: "REGION", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "REGION", appearance: { color: "#4a90e2", lineweightMm: 0.5 }, extensionData: { owner: "Reio" }, start: { x: -10, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "arc", handle: "11", layerId: "REGION", center: { x: 0, y: 0 }, radius: 10, startAngleRad: 0, endAngleRad: Math.PI, counterClockwise: true },
  );
  return document;
}

function nestedDocument() {
  const document = createEmptyDocument({ documentId: "F-014-nested" });
  document.entities.push(
    { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 50, y: 50 }, radius: 20 },
    { kind: "circle", handle: "30", layerId: "0", center: { x: 50, y: 50 }, radius: 5 },
  );
  return document;
}

function expectCode(action: () => unknown, code: BoundaryRegionInputError["code"]): void {
  try {
    action();
    throw new Error("Expected REGION/BOUNDARY to fail closed.");
  } catch (error) {
    expect(error).toBeInstanceOf(BoundaryRegionInputError);
    expect((error as BoundaryRegionInputError).code).toBe(code);
  }
}

describe("F-014 complete BOUNDARY/REGION matrix", () => {
  it("matches the exact line-plus-ARC bulge golden and preserves explicit result identity", () => {
    const golden = JSON.parse(readFileSync(new URL("./f014-boundary-region.golden.json", import.meta.url), "utf8"));
    const result = prepareBoundaryCommand(arcLineDocument(), {
      handle: "20", layerId: "REGION", seedPoint: { x: 0, y: 5 }, sourceHandles: ["11", "10"], output: "polyline",
      appearance: { color: "#ff0000", lineweightMm: 0.25 }, extensionData: { command: "BOUNDARY" },
    });
    expect({ version: 1, command: result.commandId, targetHandles: result.targetHandles, resultHandle: result.entity.handle, vertices: result.entity.kind === "polyline" ? result.entity.vertices : null }).toEqual(golden);
    expect(result.entity).toMatchObject({
      kind: "polyline", handle: "20", layerId: "REGION", closed: true,
      appearance: { color: "#ff0000", lineweightMm: 0.25 }, extensionData: { command: "BOUNDARY" },
    });
    expect(result.loops[0]).toMatchObject({ signedArea: expect.closeTo(Math.PI * 50, 9), nestingDepth: 0, isIsland: false });
  });

  it("classifies three deterministic nested levels with alternating orientation", () => {
    const input = {
      handle: "40", layerId: "0", seedPoint: { x: 10, y: 10 }, sourceHandles: ["30", "10", "20"],
      islandDetection: true, output: "region" as const,
    };
    const first = prepareBoundaryCommand(nestedDocument(), input);
    const second = prepareBoundaryCommand(nestedDocument(), { ...input, sourceHandles: ["20", "30", "10"] });
    expect(first).toEqual(second);
    expect(first.loops.map((loop) => ({ depth: loop.nestingDepth, island: loop.isIsland, sign: Math.sign(loop.signedArea) }))).toEqual([
      { depth: 0, island: false, sign: 1 },
      { depth: 1, island: true, sign: -1 },
      { depth: 2, island: false, sign: 1 },
    ]);
    expect(first.entity).toMatchObject({ kind: "proxy", handle: "40", layerId: "0", originalType: "ACDBREGION", raw: { schema: "kuubik-region-v2" } });
  });

  it("creates separate deterministic REGION proxies from line/arc, circle and bulged-polyline loops", () => {
    const document = arcLineDocument();
    document.entities.push(
      { kind: "circle", handle: "20", layerId: "0", appearance: { color: "#00ff00" }, center: { x: 40, y: 0 }, radius: 5 },
      { kind: "polyline", handle: "30", layerId: "0", appearance: { color: "#0000ff" }, closed: true, vertices: [{ x: 60, y: 0, bulge: 1 }, { x: 70, y: 0, bulge: 1 }] },
    );
    const result = prepareRegionCommand(document, { targetHandles: ["30", "11", "20", "10"], resultHandles: ["40", "41", "42"] });
    expect(result).toMatchObject({ commandId: "REGION", targetHandles: ["10", "11", "20", "30"], resultHandles: ["40", "41", "42"], rejected: [] });
    expect(result.entities.map((entity) => ({ handle: entity.handle, layerId: entity.layerId, color: entity.appearance?.color }))).toEqual([
      { handle: "40", layerId: "REGION", color: "#4a90e2" },
      { handle: "41", layerId: "0", color: "#00ff00" },
      { handle: "42", layerId: "0", color: "#0000ff" },
    ]);
    expect(result.changes.slice(0, 4)).toEqual(["10", "11", "20", "30"].map((handle) => ({ type: "delete", handle })));
  });

  it("retains a single closed source handle when requested and supports DELOBJ=0 semantics", () => {
    const document = nestedDocument();
    const retained = prepareRegionCommand(document, { targetHandles: ["20"], resultHandles: ["20"] });
    expect(retained.changes).toMatchObject([{ type: "delete", handle: "20" }, { type: "put", entity: { handle: "20", layerId: "0" } }]);
    const copied = prepareRegionCommand(document, { targetHandles: ["20"], resultHandles: ["40"], deleteSource: false });
    expect(copied.changes).toMatchObject([{ type: "put", entity: { handle: "40" } }]);
  });

  it("fails closed for open, self-intersecting, non-finite, unsupported and crossing geometry", () => {
    const open = createEmptyDocument({ documentId: "F-014-open" });
    open.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expectCode(() => prepareRegionCommand(open, { targetHandles: ["10"], resultHandles: ["20"] }), "OPEN_BOUNDARY");

    const bowtie = createEmptyDocument({ documentId: "F-014-self" });
    bowtie.entities.push({ kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }] });
    expectCode(() => prepareRegionCommand(bowtie, { targetHandles: ["10"], resultHandles: ["20"] }), "SELF_INTERSECTION");

    const nonFinite = createEmptyDocument({ documentId: "F-014-nan" });
    nonFinite.entities.push({ kind: "circle", handle: "10", layerId: "0", center: { x: Number.NaN, y: 0 }, radius: 5 });
    expectCode(() => prepareRegionCommand(nonFinite, { targetHandles: ["10"], resultHandles: ["20"] }), "NON_FINITE_GEOMETRY");

    const unsupported = createEmptyDocument({ documentId: "F-014-unsupported" });
    unsupported.entities.push({ kind: "ellipse", handle: "10", layerId: "0", center: { x: 0, y: 0 }, majorAxis: { x: 10, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 });
    expectCode(() => prepareRegionCommand(unsupported, { targetHandles: ["10"], resultHandles: ["20"] }), "UNSUPPORTED_ENTITY");

    const crossing = createEmptyDocument({ documentId: "F-014-crossing" });
    crossing.entities.push(
      { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 10 },
      { kind: "circle", handle: "11", layerId: "0", center: { x: 10, y: 0 }, radius: 10 },
    );
    expectCode(() => prepareRegionCommand(crossing, { targetHandles: ["10", "11"], resultHandles: ["20", "21"] }), "CROSSING_INTERSECTION");
  });

  it("rejects missing, locked and colliding resources before returning changes", () => {
    const document = nestedDocument();
    document.layers.push({ id: "LOCKED", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true });
    document.entities[0]!.layerId = "LOCKED";
    expectCode(() => prepareRegionCommand(document, { targetHandles: ["10"], resultHandles: ["40"] }), "LAYER_LOCKED");
    expectCode(() => prepareRegionCommand(document, { targetHandles: ["MISSING"], resultHandles: ["40"] }), "ENTITY_NOT_FOUND");
    expectCode(() => prepareRegionCommand(nestedDocument(), { targetHandles: ["20"], resultHandles: ["10"] }), "HANDLE_COLLISION");
  });

  it("is invariant to seeded rectangle edge order/direction and remains finite", () => {
    let seed = 0xF014;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let sample = 0; sample < 100; sample += 1) {
      const x = (random() - 0.5) * 1000;
      const y = (random() - 0.5) * 1000;
      const width = 1 + random() * 100;
      const height = 1 + random() * 100;
      const edges = [
        [{ x, y }, { x: x + width, y }],
        [{ x: x + width, y }, { x: x + width, y: y + height }],
        [{ x: x + width, y: y + height }, { x, y: y + height }],
        [{ x, y: y + height }, { x, y }],
      ] as const;
      const document = createEmptyDocument({ documentId: `F-014-property-${sample}` });
      document.entities.push(...[2, 0, 3, 1].map((edgeIndex, index) => {
        const edge = edges[edgeIndex]!;
        const reversed = index % 2 === 0;
        return { kind: "line" as const, handle: `${10 + edgeIndex}`, layerId: "0", start: { ...(reversed ? edge[1] : edge[0]) }, end: { ...(reversed ? edge[0] : edge[1]) } };
      }));
      const input = { handle: "20", layerId: "0", seedPoint: { x: x + width / 2, y: y + height / 2 }, sourceHandles: ["13", "10", "12", "11"], output: "polyline" as const };
      const first = prepareBoundaryCommand(document, input);
      const second = prepareBoundaryCommand(document, { ...input, sourceHandles: [...input.sourceHandles].reverse() });
      expect(first).toEqual(second);
      expect(first.loops[0]!.vertices.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y))).toBe(true);
      expect(first.loops[0]!.signedArea).toBeCloseTo(width * height, 7);
    }
  });
});
