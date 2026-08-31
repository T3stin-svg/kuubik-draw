import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ArrayCommandInputError,
  prepareArrayCommand,
  prepareArrayPathPropertyUpdate,
  readArrayPathAssociation,
  refreshAssociativePathArrays,
} from "../src/array-commands.js";
import { createEmptyDocument } from "../src/document.js";

function pathDocument() {
  const document = createEmptyDocument({ documentId: "F-032", now: "2026-08-31T00:00:00.000Z" });
  document.layers.push({ id: "OBJECTS", name: "OBJECTS", visible: true, frozen: false, locked: false, plottable: true });
  document.layers.push({ id: "PATHS", name: "PATHS", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "OBJECTS", start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, appearance: { color: "#00aaff" }, extensionData: { source: true } },
    { kind: "line", handle: "20", layerId: "PATHS", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  );
  return document;
}

function putEntities(result: ReturnType<typeof prepareArrayCommand>) {
  return result.changes.map((change) => {
    if (change.type !== "put") throw new Error("Expected put change.");
    return change.entity;
  });
}

describe("F-032 associative ARRAYPATH", () => {
  it("matches the versioned Divide/reverse/row golden and records editable properties", () => {
    const golden = JSON.parse(readFileSync(new URL("./f032-arraypath.golden.json", import.meta.url), "utf8"));
    const prepared = prepareArrayCommand(pathDocument(), {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 3, alignItems: true, tangentDirectionRad: Math.PI,
      pathDirection: "reverse", rows: 2, rowSpacing: 10, associationId: "PATH-GOLDEN",
    });
    const entities = putEntities(prepared);
    const starts = entities.map((entity) => {
      if (entity.kind !== "line") throw new Error("Expected line.");
      return [entity.start.x, entity.start.y].map((value) => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(9)));
    });
    expect({ version: 1, command: prepared.commandId, itemCount: prepared.itemCount, associationId: prepared.associationId, starts }).toEqual(golden);
    expect(prepared.associative).toBe(true);
    expect(entities.every((entity) => readArrayPathAssociation(entity)?.input.rows === 2)).toBe(true);
  });

  it("uses Measure spacing, item cap, Fill Entire Path and tangent-relative alignment", () => {
    const prepared = prepareArrayCommand(pathDocument(), {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "measure", spacing: 30, items: 3, fillEntirePath: false, startOffset: 10,
      alignItems: true, tangentDirectionRad: Math.PI / 2,
    });
    expect(prepared.itemCount).toBe(3);
    expect(putEntities(prepared)).toMatchObject([
      { kind: "line", start: { x: 10, y: 0 }, end: { x: 10, y: 4 } },
      { kind: "line", start: { x: 40, y: 0 }, end: { x: 40, y: 4 } },
      { kind: "line", start: { x: 70, y: 0 }, end: { x: 70, y: 4 } },
    ]);
  });

  it("does not duplicate the seam when dividing a closed path", () => {
    const document = pathDocument();
    document.entities[1] = { kind: "circle", handle: "20", layerId: "PATHS", center: { x: 0, y: 0 }, radius: 10 };
    const prepared = prepareArrayCommand(document, {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 4, alignItems: false,
    });
    const starts = putEntities(prepared).map((entity) => entity.kind === "line" ? entity.start : null);
    expect(starts).toHaveLength(4);
    expect(new Set(starts.map((point) => `${point!.x.toFixed(8)},${point!.y.toFixed(8)}`)).size).toBe(4);
  });

  it("refreshes source/path edits with stable child handles and preserved layer/properties", () => {
    const document = pathDocument();
    const initial = prepareArrayCommand(document, {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 3, alignItems: true, associationId: "STABLE",
    });
    document.entities.push(...putEntities(initial));
    const initialHandles = [...initial.resultHandles];
    document.entities[0] = { ...document.entities[0]!, end: { x: 8, y: 0 }, appearance: { color: "#ff00ff", lineweightMm: 0.7 } };
    document.entities[1] = { ...document.entities[1]!, end: { x: 200, y: 0 } };
    const refreshed = refreshAssociativePathArrays(document, ["10", "20"]);
    expect(refreshed).toMatchObject({ associationIds: ["STABLE"], createdHandles: [], deletedHandles: [], resultHandles: initialHandles });
    const refreshedEntities = refreshed.changes.map((change) => change.type === "put" ? change.entity : null);
    expect(refreshedEntities).toMatchObject([
      { handle: initialHandles[0], layerId: "OBJECTS", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, appearance: { color: "#ff00ff", lineweightMm: 0.7 } },
      { handle: initialHandles[1], layerId: "OBJECTS", start: { x: 100, y: 0 }, end: { x: 108, y: 0 } },
      { handle: initialHandles[2], layerId: "OBJECTS", start: { x: 200, y: 0 }, end: { x: 208, y: 0 } },
    ]);
  });

  it("edits associative Properties while preserving stable handles and adding/deleting only the count delta", () => {
    const document = pathDocument();
    const initial = prepareArrayCommand(document, {
      command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide", items: 3, alignItems: false, associationId: "PROPERTIES",
    });
    document.entities.push(...putEntities(initial));
    const grown = prepareArrayPathPropertyUpdate(document, "PROPERTIES", { items: 5, alignItems: true, rows: 1 });
    expect(grown.resultHandles.slice(0, 3)).toEqual(initial.resultHandles);
    expect(grown.createdHandles).toHaveLength(2);
    expect(grown.deletedHandles).toEqual([]);
    for (const change of grown.changes) {
      if (change.type !== "put") continue;
      const association = readArrayPathAssociation(change.entity);
      expect(association?.input).toMatchObject({ items: 5, alignItems: true, rows: 1 });
    }
    const grownDocument = structuredClone(document);
    for (const change of grown.changes) {
      if (change.type !== "put") continue;
      const index = grownDocument.entities.findIndex((entity) => entity.handle === change.entity.handle);
      if (index >= 0) grownDocument.entities[index] = change.entity;
      else grownDocument.entities.push(change.entity);
    }
    const shrunk = prepareArrayPathPropertyUpdate(grownDocument, "PROPERTIES", { items: 2 });
    expect(shrunk.resultHandles).toEqual(initial.resultHandles.slice(0, 2));
    expect(shrunk.createdHandles).toEqual([]);
    expect(shrunk.deletedHandles).toHaveLength(3);
  });

  it("rejects a duplicate explicit association identity before creating colliding children", () => {
    const document = pathDocument();
    const input = {
      command: "ARRAYPATH" as const, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
      method: "divide" as const, items: 3, alignItems: false, associationId: "UNIQUE",
    };
    const initial = prepareArrayCommand(document, input);
    document.entities.push(...putEntities(initial));
    expect(() => prepareArrayCommand(document, input)).toThrowError(/already exists/u);
  });

  it("is deterministic over a path distribution property matrix", () => {
    for (let items = 2; items <= 32; items += 1) {
      const input = {
        command: "ARRAYPATH" as const, targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20",
        method: "divide" as const, items, alignItems: items % 2 === 0, pathDirection: items % 3 === 0 ? "reverse" as const : "forward" as const,
      };
      const first = prepareArrayCommand(pathDocument(), input);
      expect(prepareArrayCommand(pathDocument(), structuredClone(input))).toEqual(first);
      expect(first.itemCount).toBe(items);
      expect(first.resultHandles).toHaveLength(items);
    }
  });

  it.each([
    ["LAYER_LOCKED", "PATHS", { locked: true }],
    ["LAYER_HIDDEN", "PATHS", { visible: false }],
    ["PATH_COLLISION", "PATHS", {}],
  ] as const)("fails safely with %s for invalid path state", (code, layerId, state) => {
    const document = pathDocument();
    Object.assign(document.layers.find((layer) => layer.id === layerId)!, state);
    try {
      prepareArrayCommand(document, {
        command: "ARRAYPATH", targetHandles: code === "PATH_COLLISION" ? ["10", "20"] : ["10"],
        basePoint: { x: 0, y: 0 }, pathHandle: "20", method: "divide", items: 3, alignItems: true,
      });
      throw new Error("Expected ARRAYPATH failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(ArrayCommandInputError);
      expect((error as ArrayCommandInputError).code).toBe(code);
    }
  });
});
