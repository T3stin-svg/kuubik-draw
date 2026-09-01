import { describe, expect, it } from "vitest";
import liteScope from "../../../../scope/kuubik-draw-lite-v1.json";
import {
  isInReioScope,
  REIO_SCOPE_SOURCE,
  REIO_SELECTED_ROWS,
  UNSCOPED_COMMAND_MESSAGE,
} from "./reio-scope.js";

const EXPECTED_ROWS = [
  "F-001", "F-002", "F-004", "F-015", "F-016", "F-017", "F-021", "F-022", "F-041", "F-048",
  "F-061", "F-072", "F-073", "F-076", "F-078", "F-106", "F-109", "F-110", "F-129", "F-133",
];

describe("Kuubik Draw Lite v1 capability profile", () => {
  it("uses exactly 20 unique audit rows from the checked-in profile", () => {
    expect(liteScope.selectedRowIds).toEqual(EXPECTED_ROWS);
    expect(new Set(liteScope.selectedRowIds).size).toBe(20);
    expect([...REIO_SELECTED_ROWS]).toEqual(EXPECTED_ROWS);
    expect(((REIO_SELECTED_ROWS.size / 133) * 100).toFixed(1)).toBe("15.0");
  });

  it("keeps the required vertical workflow and excludes out-of-scope rows", () => {
    for (const rowId of ["F-001", "F-022", "F-061", "F-072", "F-106", "F-110", "F-129", "F-133"]) {
      expect(isInReioScope(rowId), `${rowId} should be enabled`).toBe(true);
    }
    for (const rowId of ["F-003", "F-112", "F-114"]) {
      expect(isInReioScope(rowId), `${rowId} should be disabled`).toBe(false);
    }
  });

  it("locks the Lite shell metadata and disabled explanation", () => {
    expect(REIO_SCOPE_SOURCE).toEqual({
      schemaVersion: 1,
      benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
      visualProfile: "autocad-familiar-clean",
      unselectedMode: "visible-disabled",
      primaryViewport: { width: 1920, height: 1080, input: "mouse-keyboard" },
    });
    expect(UNSCOPED_COMMAND_MESSAGE).toBe("Pole Lite v1 töövoos");
  });
});
