import type { VisualEllipseConstructionMode, VisualEllipseFormState } from "./runtime-adapter.js";

interface EllipsePromptProps {
  value: VisualEllipseFormState;
  previewValid: boolean;
  normalizedSummary: string;
  error: string | null;
  onChange: (value: VisualEllipseFormState) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function EllipsePrompt({ value, previewValid, normalizedSummary, error, onChange, onCommit, onCancel }: EllipsePromptProps) {
  const update = <Key extends keyof VisualEllipseFormState>(key: Key, next: VisualEllipseFormState[Key]) => onChange({ ...value, [key]: next });
  return (
    <form
      className="typed-cad-prompt ellipse-prompt"
      aria-label="ELLIPSE typed options"
      data-testid="ellipse-prompt"
      data-preview-valid={previewValid ? "true" : "false"}
      onSubmit={(event) => { event.preventDefault(); onCommit(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
    >
      <header><strong>ELLIPSE</strong><span>F-007 · typed preview → atomic commit → read-back</span></header>
      <div className="typed-cad-prompt-grid">
        <label>Meetod<select autoFocus aria-label="Ellipse construction mode" value={value.constructionMode} onChange={(event) => update("constructionMode", event.target.value as VisualEllipseConstructionMode)}>
          <option value="center-major-minor">Center, axis, end</option>
          <option value="axis-endpoints">Axis endpoints</option>
        </select></label>
        {value.constructionMode === "center-major-minor" ? <>
          <label>Keskpunkt<input aria-label="Ellipse center" value={value.center} onChange={(event) => update("center", event.target.value)} /></label>
          <label>Peatelje lõpp<input aria-label="Ellipse major axis end" value={value.majorAxisEnd} onChange={(event) => update("majorAxisEnd", event.target.value)} /></label>
          <label>Pool-kõrvaltelg<input aria-label="Ellipse minor distance" inputMode="decimal" value={value.minorDistance} onChange={(event) => update("minorDistance", event.target.value)} /></label>
        </> : <>
          <label>Telje algus<input aria-label="Ellipse first axis end" value={value.firstAxisEnd} onChange={(event) => update("firstAxisEnd", event.target.value)} /></label>
          <label>Telje lõpp<input aria-label="Ellipse second axis end" value={value.secondAxisEnd} onChange={(event) => update("secondAxisEnd", event.target.value)} /></label>
          <label>Teine pooltelg<input aria-label="Ellipse other axis distance" inputMode="decimal" value={value.otherAxisDistance} onChange={(event) => update("otherAxisDistance", event.target.value)} /></label>
        </>}
        <label>Kuju<select aria-label="Ellipse shape" value={value.shape} onChange={(event) => update("shape", event.target.value as VisualEllipseFormState["shape"])}>
          <option value="full">Full ellipse</option><option value="arc">Elliptical arc</option>
        </select></label>
        {value.shape === "arc" && <>
          <label>Algus °<input aria-label="Ellipse start angle" inputMode="decimal" value={value.startAngleDeg} onChange={(event) => update("startAngleDeg", event.target.value)} /></label>
          <label>Lõpp °<input aria-label="Ellipse end angle" inputMode="decimal" value={value.endAngleDeg} onChange={(event) => update("endAngleDeg", event.target.value)} /></label>
          <label>Suund<select aria-label="Ellipse arc direction" value={value.direction} onChange={(event) => update("direction", event.target.value as VisualEllipseFormState["direction"])}>
            <option value="counter-clockwise">CCW</option><option value="clockwise">CW</option>
          </select></label>
        </>}
      </div>
      <output className={error ? "typed-cad-readback is-error" : "typed-cad-readback"} aria-live="polite" data-testid="ellipse-preview-readback">{error ?? normalizedSummary}</output>
      <footer><button type="submit" disabled={!previewValid}>Rakenda</button><button type="button" onClick={onCancel}>Tühista</button></footer>
    </form>
  );
}
