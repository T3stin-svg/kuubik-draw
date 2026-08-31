import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CadIcon } from "../icons/CadIcon.js";

export type PaletteMode = "docked" | "floating" | "auto-hide";

export function PaletteFrame({ mode, onModeChange, children }: { mode: PaletteMode; onModeChange: (mode: PaletteMode) => void; children: ReactNode }) {
  const [width, setWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem("kuubik-draw-palette-width"));
    return Number.isFinite(stored) && stored >= 360 && stored <= 720 ? stored : 460;
  });
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem("kuubik-draw-palette-width", String(width));
    document.documentElement.style.setProperty("--cad-palette-width", `${width}px`);
    return () => { document.documentElement.style.removeProperty("--cad-palette-width"); };
  }, [width]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!dragStart.current) return;
      setWidth(Math.max(360, Math.min(720, dragStart.current.width + event.clientX - dragStart.current.x)));
    };
    const onPointerUp = () => { dragStart.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  return (
    <aside className="properties-palette" aria-label="Properties palette" data-visual-zone="properties-palette" data-dock={mode} data-palette-width={width} style={{ "--cad-palette-width": `${width}px` } as CSSProperties}>
      <div className="palette-mode-controls" role="toolbar" aria-label="Paleti asetus">
        <button type="button" aria-label="Doki paletid" aria-pressed={mode === "docked"} onClick={() => onModeChange("docked")}><CadIcon name="pin" /></button>
        <button type="button" aria-label="Ujuta paletid" aria-pressed={mode === "floating"} onClick={() => onModeChange("floating")}><CadIcon name="float" /></button>
        <button type="button" aria-label="Peida paletid automaatselt" aria-pressed={mode === "auto-hide"} onClick={() => onModeChange("auto-hide")}><CadIcon name="autohide" /></button>
      </div>
      {children}
      {mode !== "auto-hide" && <div
        className="palette-resize-handle"
        role="separator"
        aria-label="Muuda paleti laiust"
        aria-orientation="vertical"
        aria-valuemin={360}
        aria-valuemax={720}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = { x: event.clientX, width }; }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setWidth((current) => Math.max(360, Math.min(720, current + (event.key === "ArrowRight" ? 16 : -16))));
        }}
      />}
    </aside>
  );
}
