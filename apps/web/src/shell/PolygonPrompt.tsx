import type { VisualPolygonMode, VisualPolygonOrientation } from "./runtime-adapter.js";

export interface PolygonFormState {
  sides: string;
  mode: VisualPolygonMode;
  center: string;
  size: string;
  first: string;
  second: string;
  rotationDeg: string;
  rotationInput: "radius-point" | "numeric";
  orientation: VisualPolygonOrientation;
}

interface PolygonPromptProps {
  value: PolygonFormState;
  previewValid: boolean;
  normalizedSummary: string;
  error: string | null;
  onChange: (value: PolygonFormState) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function PolygonPrompt({ value, previewValid, normalizedSummary, error, onChange, onCommit, onCancel }: PolygonPromptProps) {
  const update = <Key extends keyof PolygonFormState>(key: Key, next: PolygonFormState[Key]) => onChange({ ...value, [key]: next });
  return (
    <form
      className="polygon-prompt"
      aria-label="POLYGON typed options"
      data-testid="polygon-prompt"
      data-preview-valid={previewValid ? "true" : "false"}
      onSubmit={(event) => { event.preventDefault(); onCommit(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
    >
      <header><strong>POLYGON</strong><span>F-006 · typed preview</span></header>
      <div className="polygon-prompt-grid">
        <label>Külgi<input autoFocus aria-label="Polygon sides" inputMode="numeric" value={value.sides} onChange={(event) => update("sides", event.target.value)} /></label>
        <label>Meetod<select aria-label="Polygon construction mode" value={value.mode} onChange={(event) => update("mode", event.target.value as VisualPolygonMode)}>
          <option value="center-inscribed">Inscribed (I)</option>
          <option value="center-circumscribed">Circumscribed (C)</option>
          <option value="edge">Edge (E)</option>
        </select></label>
        {value.mode === "edge" ? <>
          <label>Esimene punkt<input aria-label="Polygon first edge point" value={value.first} onChange={(event) => update("first", event.target.value)} /></label>
          <label>Teine punkt<input aria-label="Polygon second edge point" value={value.second} onChange={(event) => update("second", event.target.value)} /></label>
        </> : <>
          <label>Keskpunkt<input aria-label="Polygon center" value={value.center} onChange={(event) => update("center", event.target.value)} /></label>
          <label>{value.mode === "center-inscribed" ? "Raadius" : "Apoteem"}<input aria-label="Polygon size" inputMode="decimal" value={value.size} onChange={(event) => update("size", event.target.value)} /></label>
          <label>Pööre °<input aria-label="Polygon rotation degrees" inputMode="decimal" value={value.rotationDeg} onChange={(event) => update("rotationDeg", event.target.value)} /></label>
          <label>Sisestus<select aria-label="Polygon rotation input" value={value.rotationInput} onChange={(event) => update("rotationInput", event.target.value as PolygonFormState["rotationInput"])}>
            <option value="radius-point">Radius point</option><option value="numeric">Numeric</option>
          </select></label>
        </>}
        <label>Suund<select aria-label="Polygon orientation" value={value.orientation} onChange={(event) => update("orientation", event.target.value as VisualPolygonOrientation)}>
          <option value="counter-clockwise">CCW</option><option value="clockwise">CW</option>
        </select></label>
      </div>
      <output className={error ? "polygon-preview-readback is-error" : "polygon-preview-readback"} aria-live="polite" data-testid="polygon-preview-readback">
        {error ?? normalizedSummary}
      </output>
      <footer><button type="submit" disabled={!previewValid}>Rakenda</button><button type="button" onClick={onCancel}>Tühista</button></footer>
    </form>
  );
}
