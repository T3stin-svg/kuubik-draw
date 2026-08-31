import { describe, expect, it } from "vitest";
import { SCOPE_GROUPS, SCOPE_ROWS, validateCatalog } from "./catalog";

describe("Reio scope catalog", () => {
  it("contains all 133 audit rows exactly once across 27 groups", () => {
    const expected = Array.from({ length: 133 }, (_, index) => `F-${String(index + 1).padStart(3, "0")}`);
    const grouped = SCOPE_GROUPS.flatMap((group) => group.rowIds);
    expect(SCOPE_GROUPS).toHaveLength(27);
    expect(SCOPE_ROWS).toHaveLength(133);
    expect(new Set(grouped).size).toBe(133);
    expect([...grouped].sort()).toEqual(expected);
    expect(SCOPE_ROWS.map((row) => row.id).sort()).toEqual(expected);
    expect(validateCatalog()).toEqual([]);
  });

  it("starts without any implicit recommendation selection", () => {
    expect(SCOPE_GROUPS.some((group) => group.rowIds.length === 0)).toBe(false);
    expect(SCOPE_GROUPS.filter((group) => group.recommendation === "recommended").length).toBeGreaterThan(0);
  });
});
