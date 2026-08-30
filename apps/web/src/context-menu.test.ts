import { describe, expect, it } from "vitest";
import { clampCadContextMenuPosition } from "./context-menu.js";

describe("AutoCAD-style drawing context-menu placement", () => {
  it("keeps the menu at the pointer when it already fits", () => {
    expect(clampCadContextMenuPosition(
      { x: 600, y: 300 },
      { width: 200, height: 371 },
      { width: 1920, height: 793 },
    )).toEqual({ x: 600, y: 300 });
  });

  it("clamps every edge with the same fixed inset", () => {
    expect(clampCadContextMenuPosition(
      { x: 1900, y: 780 },
      { width: 200, height: 371 },
      { width: 1920, height: 793 },
    )).toEqual({ x: 1716, y: 418 });
    expect(clampCadContextMenuPosition(
      { x: -20, y: -40 },
      { width: 200, height: 371 },
      { width: 1920, height: 793 },
    )).toEqual({ x: 4, y: 4 });
  });

  it("fails closed for invalid measurements", () => {
    expect(() => clampCadContextMenuPosition(
      { x: Number.NaN, y: 10 },
      { width: 200, height: 371 },
      { width: 1920, height: 793 },
    )).toThrow("Context-menu anchor must be finite");
    expect(() => clampCadContextMenuPosition(
      { x: 10, y: 10 },
      { width: -1, height: 371 },
      { width: 1920, height: 793 },
    )).toThrow("Context-menu width");
  });
});
