import { ROW_BY_ID, SCOPE_BENCHMARK, SCOPE_DENOMINATOR, SCOPE_ROWS } from "./catalog";

export const SCOPE_STORAGE_KEY = "kuubik-draw:reio-scope:v1";
export const SCOPE_FILE_NAME = "kuubik-draw-reio-scope-v1.json";

export interface ScopeViewport {
  width: 1920;
  height: 1080;
  input: "mouse-keyboard";
}

export interface ReioScopeSelectionV1 {
  schemaVersion: 1;
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation";
  selectedRowIds: string[];
  visualProfile: "autocad-familiar-clean";
  unselectedMode: "visible-disabled";
  primaryViewport: ScopeViewport;
  exportedAt: string;
  localNotes?: Record<string, string>;
}

export interface LocalScopeState {
  selectedRowIds: string[];
  localNotes: Record<string, string>;
}

export interface ScopeMetrics {
  selected: number;
  denominator: number;
  sharePercent: number;
  ready: number;
  partial: number;
  missing: number;
  rawPercent: number;
  weightedPercent: number;
}

const rowOrder: ReadonlyMap<string, number> = new Map<string, number>(SCOPE_ROWS.map((row, index) => [row.id, index]));

export function sortRowIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => (rowOrder.get(left) ?? Infinity) - (rowOrder.get(right) ?? Infinity));
}

export function calculateScopeMetrics(selectedIds: Iterable<string>): ScopeMetrics {
  const selectedRows = sortRowIds(new Set(selectedIds)).map((id) => ROW_BY_ID.get(id)).filter((row) => row !== undefined);
  const scoreSum = selectedRows.reduce((sum, row) => sum + row.currentScore, 0);
  const weightSum = selectedRows.reduce((sum, row) => sum + row.weight, 0);
  const weightedScoreSum = selectedRows.reduce((sum, row) => sum + row.currentScore * row.weight, 0);
  return {
    selected: selectedRows.length,
    denominator: SCOPE_DENOMINATOR,
    sharePercent: Number(((selectedRows.length / SCOPE_DENOMINATOR) * 100).toFixed(1)),
    ready: selectedRows.filter((row) => row.currentScore === 1).length,
    partial: selectedRows.filter((row) => row.currentScore > 0 && row.currentScore < 1).length,
    missing: selectedRows.filter((row) => row.currentScore === 0).length,
    rawPercent: selectedRows.length ? Number(((scoreSum / selectedRows.length) * 100).toFixed(1)) : 0,
    weightedPercent: weightSum ? Number(((weightedScoreSum / weightSum) * 100).toFixed(1)) : 0,
  };
}

export function createScopeSelection(
  selectedIds: Iterable<string>,
  notes: Record<string, string>,
  exportedAt = new Date().toISOString(),
): ReioScopeSelectionV1 {
  const selectedRowIds = sortRowIds(new Set(selectedIds));
  const localNotes = Object.fromEntries(
    Object.entries(notes)
      .filter(([id, note]) => ROW_BY_ID.has(id) && note.trim().length > 0)
      .sort(([left], [right]) => (rowOrder.get(left) ?? Infinity) - (rowOrder.get(right) ?? Infinity)),
  );
  return {
    schemaVersion: 1,
    benchmark: SCOPE_BENCHMARK as ReioScopeSelectionV1["benchmark"],
    selectedRowIds,
    visualProfile: "autocad-familiar-clean",
    unselectedMode: "visible-disabled",
    primaryViewport: { width: 1920, height: 1080, input: "mouse-keyboard" },
    exportedAt,
    ...(Object.keys(localNotes).length ? { localNotes } : {}),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateScopeSelection(input: unknown): ReioScopeSelectionV1 {
  assert(typeof input === "object" && input !== null && !Array.isArray(input), "Valikufail peab olema JSON-objekt.");
  const value = input as Record<string, unknown>;
  assert(value.schemaVersion === 1, "Toetamata skeemiversioon.");
  assert(value.benchmark === SCOPE_BENCHMARK, "Valikufail kasutab valet AutoCADi etaloni.");
  assert(Array.isArray(value.selectedRowIds), "selectedRowIds peab olema massiiv.");
  assert(value.selectedRowIds.every((id) => typeof id === "string"), "Kõik F-ID-d peavad olema tekstina.");
  const selectedRowIds = value.selectedRowIds as string[];
  assert(new Set(selectedRowIds).size === selectedRowIds.length, "Valikufail sisaldab topelt F-ID-d.");
  const unknownId = selectedRowIds.find((id) => !ROW_BY_ID.has(id));
  assert(!unknownId, `Tundmatu F-ID: ${unknownId}.`);
  assert(value.visualProfile === "autocad-familiar-clean", "Toetamata visuaaliprofiil.");
  assert(value.unselectedMode === "visible-disabled", "Toetamata valimata käskude režiim.");
  assert(typeof value.primaryViewport === "object" && value.primaryViewport !== null, "primaryViewport puudub.");
  const viewport = value.primaryViewport as Record<string, unknown>;
  assert(viewport.width === 1920 && viewport.height === 1080 && viewport.input === "mouse-keyboard", "Vale põhivaate seadistus.");
  assert(typeof value.exportedAt === "string" && Number.isFinite(Date.parse(value.exportedAt)), "exportedAt ei ole korrektne kuupäev.");
  if (value.localNotes !== undefined) {
    assert(typeof value.localNotes === "object" && value.localNotes !== null && !Array.isArray(value.localNotes), "localNotes peab olema objekt.");
    for (const [id, note] of Object.entries(value.localNotes as Record<string, unknown>)) {
      assert(ROW_BY_ID.has(id), `Märkuses on tundmatu F-ID: ${id}.`);
      assert(typeof note === "string", `Märkus ${id} peab olema tekst.`);
    }
  }
  return createScopeSelection(
    selectedRowIds,
    (value.localNotes ?? {}) as Record<string, string>,
    value.exportedAt,
  );
}

export function parseScopeSelection(json: string): ReioScopeSelectionV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Fail ei ole korrektne JSON.");
  }
  return validateScopeSelection(parsed);
}

export function loadLocalScope(storage: Pick<Storage, "getItem">): LocalScopeState {
  const stored = storage.getItem(SCOPE_STORAGE_KEY);
  if (!stored) return { selectedRowIds: [], localNotes: {} };
  try {
    const value = JSON.parse(stored) as Partial<LocalScopeState>;
    const selectedRowIds = Array.isArray(value.selectedRowIds)
      ? sortRowIds(new Set(value.selectedRowIds.filter((id): id is string => typeof id === "string" && ROW_BY_ID.has(id))))
      : [];
    const localNotes = typeof value.localNotes === "object" && value.localNotes !== null
      ? Object.fromEntries(Object.entries(value.localNotes).filter(([id, note]) => ROW_BY_ID.has(id) && typeof note === "string")) as Record<string, string>
      : {};
    return { selectedRowIds, localNotes };
  } catch {
    return { selectedRowIds: [], localNotes: {} };
  }
}

export function saveLocalScope(storage: Pick<Storage, "setItem">, state: LocalScopeState): void {
  storage.setItem(SCOPE_STORAGE_KEY, JSON.stringify({
    selectedRowIds: sortRowIds(new Set(state.selectedRowIds)),
    localNotes: state.localNotes,
  }));
}
