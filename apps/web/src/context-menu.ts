export interface CadContextMenuPoint {
  x: number;
  y: number;
}

export interface CadContextMenuSize {
  width: number;
  height: number;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number.`);
  return value;
}

/** Keeps the fixed-size CAD context menu inside its drawing-area viewport. */
export function clampCadContextMenuPosition(
  anchor: CadContextMenuPoint,
  menu: CadContextMenuSize,
  viewport: CadContextMenuSize,
  margin = 4,
): CadContextMenuPoint {
  const safeMargin = finiteNonNegative(margin, "Context-menu margin");
  const menuWidth = finiteNonNegative(menu.width, "Context-menu width");
  const menuHeight = finiteNonNegative(menu.height, "Context-menu height");
  const viewportWidth = finiteNonNegative(viewport.width, "Viewport width");
  const viewportHeight = finiteNonNegative(viewport.height, "Viewport height");
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new RangeError("Context-menu anchor must be finite.");

  const maximumX = Math.max(safeMargin, viewportWidth - menuWidth - safeMargin);
  const maximumY = Math.max(safeMargin, viewportHeight - menuHeight - safeMargin);
  return {
    x: Math.min(Math.max(anchor.x, safeMargin), maximumX),
    y: Math.min(Math.max(anchor.y, safeMargin), maximumY),
  };
}
