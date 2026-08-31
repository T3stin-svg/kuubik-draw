import { describe, expect, it } from "vitest";
import {
  SCOPE_STORAGE_KEY,
  calculateScopeMetrics,
  createScopeSelection,
  loadLocalScope,
  parseScopeSelection,
  saveLocalScope,
} from "./model";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SCOPE_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    value: () => values.get(SCOPE_STORAGE_KEY),
  };
}

describe("Reio scope selection", () => {
  it("shows 13 rows as 9.8 percent", () => {
    const ids = Array.from({ length: 13 }, (_, index) => `F-${String(index + 1).padStart(3, "0")}`);
    expect(calculateScopeMetrics(ids)).toMatchObject({ selected: 13, denominator: 133, sharePercent: 9.8 });
  });

  it("exports and imports the same sorted selection and local notes", () => {
    const exported = createScopeSelection(["F-133", "F-001", "F-061"], { "F-061": "Kasutan põhimõõtude jaoks." }, "2026-08-31T10:00:00.000Z");
    const imported = parseScopeSelection(JSON.stringify(exported));
    expect(imported).toEqual(exported);
    expect(imported.selectedRowIds).toEqual(["F-001", "F-061", "F-133"]);
  });

  it.each([
    [{ ...createScopeSelection([], {}), schemaVersion: 2 }, "skeemiversioon"],
    [{ ...createScopeSelection([], {}), selectedRowIds: ["F-999"] }, "Tundmatu F-ID"],
    [{ ...createScopeSelection([], {}), selectedRowIds: ["F-001", "F-001"] }, "topelt F-ID"],
  ])("rejects invalid payloads", (payload, expectedMessage) => {
    expect(() => parseScopeSelection(JSON.stringify(payload))).toThrow(expectedMessage);
  });

  it("restores local selections and comments and safely ignores broken storage", () => {
    const storage = memoryStorage();
    saveLocalScope(storage, { selectedRowIds: ["F-010", "F-003"], localNotes: { "F-010": "Vajan." } });
    expect(loadLocalScope(storage)).toEqual({ selectedRowIds: ["F-003", "F-010"], localNotes: { "F-010": "Vajan." } });
    expect(loadLocalScope(memoryStorage("not-json"))).toEqual({ selectedRowIds: [], localNotes: {} });
  });
});
