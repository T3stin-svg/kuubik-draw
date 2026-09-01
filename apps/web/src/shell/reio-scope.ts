import liteScope from "../../../../scope/kuubik-draw-lite-v1.json";

export const REIO_SCOPE_SOURCE = Object.freeze({
  schemaVersion: liteScope.schemaVersion,
  benchmark: liteScope.benchmark,
  visualProfile: liteScope.visualProfile,
  unselectedMode: liteScope.unselectedMode,
  primaryViewport: Object.freeze({ ...liteScope.primaryViewport }),
});

export const REIO_SELECTED_ROWS: ReadonlySet<string> = new Set(liteScope.selectedRowIds);

export const REIO_SCOPE_ID = "kuubik-draw-lite-v1";
export const REIO_SCOPE_SIZE = REIO_SELECTED_ROWS.size;
export const REIO_SCOPE_LABEL = `LITE V1 · ${REIO_SCOPE_SIZE} funktsiooni`;
export const UNSCOPED_COMMAND_MESSAGE = "Pole Lite v1 töövoos";

export function isInReioScope(rowId: string): boolean {
  return REIO_SELECTED_ROWS.has(rowId);
}
