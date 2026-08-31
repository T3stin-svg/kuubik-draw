import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ArrayCommandInputError, prepareArrayCommand } from "../src/array-commands.js";
import { createEmptyDocument } from "../src/document.js";

function documentWithSource() {
  const document = createEmptyDocument({ documentId: "F-031", now: "2026-08-31T00:00:00.000Z" });
  document.layers.push({ id: "ARRAY", name: "ARRAY", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push({
    kind: "line", handle: "10", layerId: "ARRAY", start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    appearance: { color: "#123456", lineweightMm: 0.35 }, extensionData: { owner: "F-031" },
  });
  return document;
}

function lineSegments(changes: ReturnType<typeof prepareArrayCommand>["changes"]): number[][] {
  return changes.map((change) => {
    if (change.type !== "put" || change.entity.kind !== "line") throw new Error("Expected ARRAY line output.");
    return [change.entity.start.x, change.entity.start.y, change.entity.end.x, change.entity.end.y]
      .map((value) => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(9)));
  });
}

describe("F-031 ARRAY rectangular and polar", () => {
  it("matches the versioned signed-spacing and rotated-axis golden", () => {
    const golden = JSON.parse(readFileSync(new URL("./f031-array.golden.json", import.meta.url), "utf8"));
    const prepared = prepareArrayCommand(documentWithSource(), {
      command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 2, columns: 3,
      rowSpacing: -10, columnSpacing: 20, arrayAngleRad: Math.PI / 2,
    });
    expect({ version: 1, command: prepared.commandId, itemCount: prepared.itemCount, segments: lineSegments(prepared.changes) }).toEqual(golden);
    for (const change of prepared.changes) {
      if (change.type !== "put") throw new Error("Expected put.");
      expect(change.entity).toMatchObject({ layerId: "ARRAY", appearance: { color: "#123456", lineweightMm: 0.35 }, extensionData: { owner: "F-031" } });
    }
  });

  it("supports angle-between, radial rows and Rotate Items", () => {
    const prepared = prepareArrayCommand(documentWithSource(), {
      command: "ARRAYPOLAR", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, center: { x: 0, y: 0 },
      items: 3, angleBetweenRad: Math.PI / 2, rotateItems: true, rows: 2, rowSpacing: 5,
    });
    expect(prepared).toMatchObject({ commandId: "ARRAYPOLAR", itemCount: 6, associative: false });
    expect(prepared.changes).toHaveLength(5);
    expect(lineSegments(prepared.changes)).toEqual([
      [0, 0, 0, 2], [0, 0, -2, 0], [5, 0, 7, 0], [0, 5, 0, 7], [-5, 0, -7, 0],
    ]);
  });

  it("is deterministic across a property matrix of counts, signed spacing and angles", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const rows = seed % 4 + 1;
      const columns = seed % 5 + 1;
      if (rows * columns < 2) continue;
      const input = {
        command: "ARRAYRECT" as const, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows, columns,
        rowSpacing: (seed % 2 ? -1 : 1) * (seed + 0.5), columnSpacing: seed + 3.25, arrayAngleRad: seed * Math.PI / 17,
      };
      const first = prepareArrayCommand(documentWithSource(), input);
      const second = prepareArrayCommand(documentWithSource(), structuredClone(input));
      expect(second).toEqual(first);
      expect(first.changes).toHaveLength(rows * columns - 1);
      expect(new Set(first.createdHandles).size).toBe(first.createdHandles.length);
    }
  });

  it.each([
    ["LAYER_LOCKED", { visible: true, frozen: false, locked: true }],
    ["LAYER_HIDDEN", { visible: false, frozen: false, locked: false }],
    ["LAYER_HIDDEN", { visible: true, frozen: true, locked: false }],
  ] as const)("fails before changes with %s for non-editable source layers", (code, state) => {
    const document = documentWithSource();
    Object.assign(document.layers.find((layer) => layer.id === "ARRAY")!, state);
    try {
      prepareArrayCommand(document, {
        command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 2, columns: 2, rowSpacing: 10, columnSpacing: 10,
      });
      throw new Error("Expected ARRAY failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(ArrayCommandInputError);
      expect((error as ArrayCommandInputError).code).toBe(code);
    }
  });
});
