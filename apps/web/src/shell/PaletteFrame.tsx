import type { ReactNode } from "react";
import { CadIcon } from "../icons/CadIcon.js";

export type PaletteMode = "docked" | "floating" | "auto-hide";

export function PaletteFrame({ mode, onModeChange, children }: { mode: PaletteMode; onModeChange: (mode: PaletteMode) => void; children: ReactNode }) {
  return (
    <aside className="properties-palette" aria-label="Properties palette" data-visual-zone="properties-palette" data-dock={mode}>
      <div className="palette-mode-controls" role="toolbar" aria-label="Paleti asetus">
        <button type="button" aria-label="Doki paletid" aria-pressed={mode === "docked"} onClick={() => onModeChange("docked")}><CadIcon name="pin" /></button>
        <button type="button" aria-label="Ujuta paletid" aria-pressed={mode === "floating"} onClick={() => onModeChange("floating")}><CadIcon name="float" /></button>
        <button type="button" aria-label="Peida paletid automaatselt" aria-pressed={mode === "auto-hide"} onClick={() => onModeChange("auto-hide")}><CadIcon name="autohide" /></button>
      </div>
      {children}
    </aside>
  );
}
