import { describe, expect, it } from "vitest";
import { ArrayCommandInputError, prepareArrayCommand } from "../src/array-commands.js";
import { createEmptyDocument } from "../src/document.js";

function documentForMutation() {
  const document = createEmptyDocument({ documentId: "F-031-F-032-mutation" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  );
  return document;
}

describe("F-031/F-032 mutation resistance", () => {
  it.each([
    { name: "zero row count", input: { command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 0, columns: 2, rowSpacing: 10, columnSpacing: 10 } },
    { name: "overlapping columns", input: { command: "ARRAYRECT", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, rows: 1, columns: 2, rowSpacing: 0, columnSpacing: 0 } },
    { name: "two polar angle modes", input: { command: "ARRAYPOLAR", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, center: { x: 0, y: 0 }, items: 3, fillAngleRad: 3, angleBetweenRad: 1, rotateItems: true } },
    { name: "oversized polar fill", input: { command: "ARRAYPOLAR", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, center: { x: 0, y: 0 }, items: 3, fillAngleRad: Math.PI * 2 + 0.01, rotateItems: true } },
    { name: "non-fitting Measure count", input: { command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20", method: "measure", spacing: 60, items: 3, fillEntirePath: false, alignItems: false } },
    { name: "zero path row spacing", input: { command: "ARRAYPATH", targetHandles: ["10"], basePoint: { x: 0, y: 0 }, pathHandle: "20", method: "divide", items: 3, rows: 2, rowSpacing: 0, alignItems: false } },
  ])("kills $name before any change plan exists", ({ input }) => {
    expect(() => prepareArrayCommand(documentForMutation(), input as Parameters<typeof prepareArrayCommand>[1])).toThrow(ArrayCommandInputError);
  });
});
