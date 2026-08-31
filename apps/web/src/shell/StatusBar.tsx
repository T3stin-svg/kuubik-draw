import type { PrecisionToggleId, PrecisionToggleState } from "./runtime-adapter.js";

interface StatusBarProps {
  coordinates: string;
  precision: PrecisionToggleState;
  precisionSource: string;
  activeSpace: string;
  onPrecisionToggle: (mode: PrecisionToggleId) => void;
}

const CONTROLS: ReadonlyArray<{ mode: PrecisionToggleId; label: string; rowId: string }> = [
  { mode: "grid", label: "GRID", rowId: "F-047" },
  { mode: "ortho", label: "ORTHO", rowId: "F-045" },
  { mode: "osnap", label: "OSNAP", rowId: "F-049" },
  { mode: "otrack", label: "OTRACK", rowId: "F-050" },
  { mode: "dyn", label: "DYN", rowId: "F-052" },
];

export function StatusBar({ coordinates, precision, precisionSource, activeSpace, onPrecisionToggle }: StatusBarProps) {
  return (
    <footer className="statusbar" data-visual-zone="statusbar" data-precision-source={precisionSource}>
      <span className="coordinate-readout" data-testid="coordinate-readout">{coordinates}</span>
      <span className="status-toggles">
        {CONTROLS.map(({ mode, label, rowId }) => <button
          key={mode}
          type="button"
          className={`status-toggle${precision[mode] ? " active" : ""}`}
          data-status-control={mode}
          data-feature-row={rowId}
          data-scope-selected="true"
          aria-label={`${label} precision mode`}
          aria-pressed={precision[mode]}
          title={`${label} · päris precision runtime`}
          onClick={() => onPrecisionToggle(mode)}
        >{label}</button>)}
        <span className="status-space">{activeSpace} · mm · {precisionSource.toUpperCase()}</span>
      </span>
    </footer>
  );
}
