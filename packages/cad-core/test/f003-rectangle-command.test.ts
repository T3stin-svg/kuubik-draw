import type { CadPoint2, CadPolyline } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareRectangleCommand, type RectangleCommandInput } from "../src/rectangle-command.js";
import { CadSession } from "../src/transaction.js";

function signedArea(vertices: CadPoint2[]): number {
  return vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function signedBulgedArea(polyline: CadPolyline): number {
  let area = signedArea(polyline.vertices);
  for (let index = 0; index < polyline.vertices.length; index += 1) {
    const start = polyline.vertices[index]!;
    const end = polyline.vertices[(index + 1) % polyline.vertices.length]!;
    const bulge = start.bulge ?? 0;
    if (Math.abs(bulge) <= 1e-12) continue;
    const theta = 4 * Math.atan(bulge);
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
    area += Math.sign(theta) * radius ** 2 / 2 * (Math.abs(theta) - Math.sin(Math.abs(theta)));
  }
  return area;
}

describe("F-003 RECTANGLE extended command matrix", () => {
  it("matches the Area/Chamfer/Width/Thickness golden with exact properties", () => {
    const prepared = prepareRectangleCommand({
      command: "RECTANGLE",
      handle: "A0",
      layerId: "A-GEOM",
      construction: {
        mode: "area",
        firstCorner: { x: 0, y: 0 },
        area: 5_000,
        knownDimension: { axis: "length", value: 100 },
      },
      chamfer: { firstDistance: 10, secondDistance: 5 },
      width: 2,
      elevation: 0,
      thickness: -4,
      appearance: { color: "#ff0000", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5 },
      extensionData: { rowId: "F-003" },
    });
    expect(prepared.normalized).toEqual({
      firstCorner: { x: 0, y: 0 },
      length: 100,
      width: 50,
      rotationRad: 0,
      direction: { length: 1, width: 1 },
      clockwise: false,
      chamfer: { firstDistance: 10, secondDistance: 5 },
      filletRadius: 0,
      polylineWidth: 2,
      elevation: 0,
      thickness: -4,
    });
    expect(prepared.entity).toEqual({
      kind: "polyline",
      handle: "A0",
      layerId: "A-GEOM",
      closed: true,
      vertices: [
        { x: 10, y: 0, startWidth: 2, endWidth: 2 },
        { x: 90, y: 0, startWidth: 2, endWidth: 2 },
        { x: 100, y: 5, startWidth: 2, endWidth: 2 },
        { x: 100, y: 45, startWidth: 2, endWidth: 2 },
        { x: 90, y: 50, startWidth: 2, endWidth: 2 },
        { x: 10, y: 50, startWidth: 2, endWidth: 2 },
        { x: 0, y: 45, startWidth: 2, endWidth: 2 },
        { x: 0, y: 5, startWidth: 2, endWidth: 2 },
      ],
      appearance: { color: "#ff0000", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.5, thickness: -4 },
      extensionData: { rowId: "F-003" },
    });
    expect(prepared.entities).toEqual([prepared.entity]);
    expect(prepared.changes).toEqual([{ type: "put", entity: prepared.entity }]);
    expect(prepared.resultHandles).toEqual(["A0"]);
  });

  it("constructs Dimensions in all quadrants and normalizes rotation", () => {
    const prepared = prepareRectangleCommand({
      command: "RECTANGLE",
      handle: "10",
      layerId: "0",
      construction: {
        mode: "dimensions",
        firstCorner: { x: 100, y: 200 },
        length: 100,
        width: 50,
        direction: { length: 1, width: -1 },
      },
      rotationRad: -3 * Math.PI / 2,
    });
    expect(prepared.normalized.rotationRad).toBeCloseTo(Math.PI / 2, 12);
    expect(prepared.normalized.clockwise).toBe(true);
    expect(prepared.entity.vertices).toEqual([
      { x: 100, y: 200 },
      { x: expect.closeTo(100, 12), y: 300 },
      { x: 150, y: expect.closeTo(300, 12) },
      { x: 150, y: expect.closeTo(200, 12) },
    ]);
    expect(signedArea(prepared.entity.vertices)).toBeCloseTo(-5_000, 9);
  });

  it("projects the opposite Corners point onto rotated local axes", () => {
    const rotationRad = Math.PI / 6;
    const firstCorner = { x: 25, y: -40 };
    const otherCorner = {
      x: firstCorner.x + Math.cos(rotationRad) * 120 - Math.sin(rotationRad) * 30,
      y: firstCorner.y + Math.sin(rotationRad) * 120 + Math.cos(rotationRad) * 30,
    };
    const prepared = prepareRectangleCommand({
      command: "RECTANGLE",
      handle: "11",
      layerId: "0",
      construction: { mode: "corners", firstCorner, otherCorner },
      rotationRad,
    });
    expect(prepared.normalized).toMatchObject({ length: expect.closeTo(120, 12), width: expect.closeTo(30, 12), clockwise: false });
    expect(prepared.entity.vertices[2]).toEqual({ x: expect.closeTo(otherCorner.x, 12), y: expect.closeTo(otherCorner.y, 12) });
  });

  it("creates signed quarter-circle fillets for counterclockwise and clockwise rectangles", () => {
    for (const direction of [{ length: 1, width: 1 }, { length: 1, width: -1 }] as const) {
      const prepared = prepareRectangleCommand({
        command: "RECTANGLE",
        handle: direction.width === 1 ? "20" : "21",
        layerId: "0",
        construction: { mode: "dimensions", firstCorner: { x: 0, y: 0 }, length: 100, width: 50, direction },
        filletRadius: 10,
      });
      const polyline = prepared.entity;
      expect(polyline.vertices).toHaveLength(8);
      const bulges = polyline.vertices.map((point) => point.bulge).filter((value): value is number => value !== undefined);
      expect(bulges).toHaveLength(4);
      for (const bulge of bulges) {
        expect(bulge).toBeCloseTo(direction.width * Math.tan(Math.PI / 8), 12);
      }
      expect(Math.sign(signedArea(polyline.vertices))).toBe(direction.width);
    }
  });

  it("uses identical preparation for preview and one atomic Commit/Undo/Redo", () => {
    const input: RectangleCommandInput = {
      command: "RECTANGLE",
      handle: "30",
      layerId: "0",
      construction: { mode: "dimensions", firstCorner: { x: 10, y: 20 }, length: 500, width: 250 },
      rotationRad: Math.PI / 4,
      filletRadius: 25,
      width: 3,
    };
    const preview = prepareRectangleCommand(input);
    const commit = prepareRectangleCommand(input);
    expect(commit).toEqual(preview);

    const session = new CadSession(createEmptyDocument({ documentId: "F-003-atomic" }));
    session.commit({
      opId: "F-003:1",
      baseRevision: 0,
      commandId: "RECTANGLE",
      args: input,
      targetHandles: [],
      resultHandles: commit.resultHandles,
    }, commit.changes, "2026-08-31T18:30:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(1);
    session.undo("2026-08-31T18:30:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T18:30:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });

  it("preserves area, orientation and quarter-arc bulges across 64 deterministic variants", () => {
    for (let index = 0; index < 64; index += 1) {
      const direction = { length: index % 2 === 0 ? 1 : -1, width: index % 4 < 2 ? 1 : -1 } as const;
      const length = 20 + index;
      const width = 10 + index / 2;
      const rotationRad = index * Math.PI / 37;
      const prepared = prepareRectangleCommand({
        command: "RECTANGLE",
        handle: `R${index}`,
        layerId: "0",
        construction: { mode: "area", firstCorner: { x: index, y: -index }, area: length * width, knownDimension: { axis: index % 2 === 0 ? "length" : "width", value: index % 2 === 0 ? length : width }, direction },
        rotationRad,
        filletRadius: 1,
      });
      const entity = prepared.entity as CadPolyline;
      expect(Math.abs(signedBulgedArea(entity))).toBeCloseTo(length * width - (4 - Math.PI), 8);
      expect(prepared.normalized.clockwise).toBe(direction.length * direction.width < 0);
      expect(prepared.normalized.rotationRad).toBeGreaterThanOrEqual(0);
      expect(prepared.normalized.rotationRad).toBeLessThan(TWO_PI);
      expect(entity.handle).toBe(`R${index}`);
    }
  });
});

const TWO_PI = Math.PI * 2;
