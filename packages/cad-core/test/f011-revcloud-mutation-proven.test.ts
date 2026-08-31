import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../src/document.js";
import { prepareRevcloudCommand, RevcloudCommandInputError } from "../src/revcloud-command.js";

describe("F-011 mutation guards", () => {
  it("kills max/min, reverse-sign, lock and object-handle mutants", () => {
    const document = createEmptyDocument({ documentId: "F-011-mutation" });
    document.layers.push(
      { id: "open", name: "OPEN", visible: true, frozen: false, locked: false, plottable: true },
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
    );
    document.entities.push({
      kind: "circle", handle: "C1", layerId: "open", center: { x: 0, y: 0 }, radius: 20,
      appearance: { color: "#123456", lineweightMm: 0.5 }, extensionData: { retained: true },
    });
    expect(() => prepareRevcloudCommand(document, {
      command: "REVCLOUD", handle: "BAD", layerId: "open",
      construction: { mode: "rectangular", firstCorner: { x: 0, y: 0 }, oppositeCorner: { x: 100, y: 50 } },
      arcLengths: { minimum: 10, maximum: 31 },
    })).toThrowError(expect.objectContaining<Partial<RevcloudCommandInputError>>({ code: "ARC_LENGTH_RATIO" }));
    expect(() => prepareRevcloudCommand(document, {
      command: "REVCLOUD", handle: "LOCK", layerId: "locked",
      construction: { mode: "rectangular", firstCorner: { x: 0, y: 0 }, oppositeCorner: { x: 100, y: 50 } },
      arcLengths: { minimum: 10, maximum: 20 },
    })).toThrowError(expect.objectContaining<Partial<RevcloudCommandInputError>>({ code: "LOCKED_LAYER" }));

    const converted = prepareRevcloudCommand(document, {
      command: "REVCLOUD", construction: { mode: "object", sourceHandle: "C1" }, direction: "reversed",
      arcLengths: { minimum: 5, maximum: 10 },
    });
    expect(converted.targetHandles).toEqual(["C1"]);
    expect(converted.resultHandles).toEqual(["C1"]);
    expect(converted.entity).toMatchObject({ handle: "C1", layerId: "open", appearance: { color: "#123456", lineweightMm: 0.5 }, extensionData: { retained: true } });
    expect(converted.entity.vertices.every((vertex) => (vertex.bulge ?? 0) < 0)).toBe(true);
  });
});
