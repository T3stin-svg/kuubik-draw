import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import {
  applyInteractiveRevcloudAction,
  prepareRevcloudCommand,
  revcloudInputFromInteractiveState,
  startInteractiveRevcloudCommand,
} from "../src/revcloud-command.js";
import { createControlVertexSpline } from "../src/spline.js";

function documentWithLayer() {
  const document = createEmptyDocument({ documentId: "F-011", now: "2026-08-31T21:00:00.000Z" });
  document.layers.push({ id: "REV", name: "REV", visible: true, frozen: false, locked: false, plottable: true });
  return document;
}

describe("F-011 complete REVCLOUD command", () => {
  it("matches the deterministic rectangular golden", () => {
    const prepared = prepareRevcloudCommand(documentWithLayer(), {
      command: "REVCLOUD", handle: "11", layerId: "REV",
      construction: { mode: "rectangular", firstCorner: { x: 0, y: 0 }, oppositeCorner: { x: 40, y: 20 } },
      arcLengths: { minimum: 10, maximum: 20 },
      appearance: { color: "#ff0000", lineweightMm: 0.35 },
      extensionData: { rowId: "F-011" },
    });
    expect(prepared.entity).toEqual({
      kind: "polyline", handle: "11", layerId: "REV", closed: true,
      appearance: { color: "#ff0000", lineweightMm: 0.35 },
      extensionData: {
        rowId: "F-011",
        kuubikRevcloud: {
          version: 1, mode: "rectangular", arcLengthMinimum: 10, arcLengthMaximum: 20,
          approximateChordLength: 15, direction: "normal", style: "normal",
        },
      },
      vertices: [
        { x: 0, y: 0, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 15, y: 0, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 30, y: 0, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 40, y: 5, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 40, y: 20, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 25, y: 20, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 10, y: 20, bulge: expect.closeTo(0.5205670505517462, 14) },
        { x: 0, y: 15, bulge: expect.closeTo(0.5205670505517462, 14) },
      ],
    });
    expect(prepared).toMatchObject({
      commandId: "REVCLOUD", targetHandles: [], resultHandles: ["11"],
      normalized: { mode: "rectangular", sourceHandle: null, direction: "normal", winding: "counter-clockwise", vertexCount: 8, closed: true },
    });
  });

  it("supports Polygonal and Freehand Close, Undo and Reverse without hidden mutation", () => {
    let state = startInteractiveRevcloudCommand({
      mode: "polygonal", handle: "12", layerId: "REV", arcLengths: { minimum: 5, maximum: 10 },
    });
    for (const point of [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }]) {
      state = applyInteractiveRevcloudAction(state, { type: "point", point });
    }
    state = applyInteractiveRevcloudAction(state, { type: "reverse" });
    state = applyInteractiveRevcloudAction(state, { type: "close" });
    expect(state).toMatchObject({ direction: "reversed", complete: true, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }] });
    const reversed = prepareRevcloudCommand(documentWithLayer(), revcloudInputFromInteractiveState(state));
    expect(reversed.entity.vertices.every((vertex) => (vertex.bulge ?? 0) < 0)).toBe(true);

    state = applyInteractiveRevcloudAction(state, { type: "undo" });
    expect(state.complete).toBe(false);
    state = applyInteractiveRevcloudAction(state, { type: "undo" });
    expect(state.direction).toBe("normal");

    let freehand = startInteractiveRevcloudCommand({
      mode: "freehand", handle: "13", layerId: "REV", arcLengths: { minimum: 2, maximum: 5 },
    });
    for (const point of [{ x: 0, y: 0 }, { x: 8, y: 1 }, { x: 10, y: 9 }, { x: 1, y: 8 }]) {
      freehand = applyInteractiveRevcloudAction(freehand, { type: "point", point });
    }
    freehand = applyInteractiveRevcloudAction(freehand, { type: "close" });
    expect(prepareRevcloudCommand(documentWithLayer(), revcloudInputFromInteractiveState(freehand)).entity.closed).toBe(true);
  });

  it("auto-closes Rectangular after the opposite corner and can undo it", () => {
    let state = startInteractiveRevcloudCommand({
      mode: "rectangular", handle: "14", layerId: "REV", arcLengths: { minimum: 5, maximum: 10 },
    });
    state = applyInteractiveRevcloudAction(state, { type: "point", point: { x: -10, y: -5 } });
    state = applyInteractiveRevcloudAction(state, { type: "point", point: { x: 20, y: 15 } });
    expect(state.complete).toBe(true);
    expect(revcloudInputFromInteractiveState(state).construction).toEqual({
      mode: "rectangular", firstCorner: { x: -10, y: -5 }, oppositeCorner: { x: 20, y: 15 },
    });
    expect(applyInteractiveRevcloudAction(state, { type: "undo" })).toMatchObject({ complete: false, points: [{ x: -10, y: -5 }] });
  });

  it("converts closed polyline, circle, ellipse and spline objects in place", () => {
    const document = documentWithLayer();
    document.entities.push(
      { kind: "polyline", handle: "P", layerId: "REV", closed: true, vertices: [
        { x: 0, y: 0, bulge: 1 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
      ], appearance: { color: "#00ff00" }, extensionData: { keep: true } },
      { kind: "circle", handle: "C", layerId: "REV", center: { x: 100, y: 100 }, radius: 20 },
      { kind: "ellipse", handle: "E", layerId: "REV", center: { x: 200, y: 100 }, majorAxis: { x: 30, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
      createControlVertexSpline({
        handle: "S", layerId: "REV", closed: true,
        controlPoints: [{ x: 300, y: 100 }, { x: 320, y: 80 }, { x: 340, y: 100 }, { x: 320, y: 120 }], degree: 2,
      }),
    );
    for (const sourceHandle of ["P", "C", "E", "S"]) {
      const prepared = prepareRevcloudCommand(document, {
        command: "REVCLOUD", construction: { mode: "object", sourceHandle }, arcLengths: { minimum: 4, maximum: 10 },
      });
      expect(prepared).toMatchObject({ targetHandles: [sourceHandle], resultHandles: [sourceHandle], entity: { kind: "polyline", handle: sourceHandle, layerId: "REV", closed: true } });
      expect(prepared.entity.vertices.length).toBeGreaterThanOrEqual(3);
      expect(prepared.entity.vertices.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.bulge))).toBe(true);
    }
    const polyline = prepareRevcloudCommand(document, {
      command: "REVCLOUD", construction: { mode: "object", sourceHandle: "P" }, arcLengths: { minimum: 4, maximum: 10 },
    });
    expect(polyline.entity).toMatchObject({ handle: "P", layerId: "REV", appearance: { color: "#00ff00" }, extensionData: { keep: true } });
  });

  it("emits calligraphy widths without changing the revision arc direction", () => {
    const normal = prepareRevcloudCommand(documentWithLayer(), {
      command: "REVCLOUD", handle: "15", layerId: "REV", style: "calligraphy",
      construction: { mode: "polygonal", points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] },
      arcLengths: { minimum: 5, maximum: 10 },
    });
    expect(normal.entity.vertices.every((vertex) => (vertex.startWidth ?? 0) > (vertex.endWidth ?? 0) && (vertex.bulge ?? 0) > 0)).toBe(true);
  });
});
