import type { PrecisionToggleId, PrecisionToggleState } from "./runtime-adapter.js";
import { isInReioScope, UNSCOPED_COMMAND_MESSAGE } from "./reio-scope.js";

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
  { mode: "osnap", label: "OSNAP", rowId: "F-048" },
  { mode: "otrack", label: "OTRACK", rowId: "F-051" },
  { mode: "dyn", label: "DYN", rowId: "F-052" },
];

export function StatusBar({ coordinates, precision, precisionSource, activeSpace, onPrecisionToggle }: StatusBarProps) {
  return (
    <footer className="statusbar" data-visual-zone="statusbar" data-precision-source={precisionSource}>
      <span className="coordinate-readout" data-testid="coordinate-readout">{coordinates}</span>
      <span className="status-toggles">
        {CONTROLS.map(({ mode, label, rowId }) => {
          const selected = isInReioScope(rowId);
          return <button
            key={mode}
            type="button"
            className={`status-toggle${precision[mode] && selected ? " active" : ""}`}
            data-status-control={mode}
            data-feature-row={rowId}
            data-scope-selected={selected ? "true" : "false"}
            data-state-reason={selected ? "Valitud sinu töövoogu" : UNSCOPED_COMMAND_MESSAGE}
            aria-label={`${label} precision mode`}
            aria-pressed={selected ? precision[mode] : undefined}
            title={selected ? `${label} · päris precision runtime` : `${label} · ${UNSCOPED_COMMAND_MESSAGE}`}
            disabled={!selected}
            onClick={() => onPrecisionToggle(mode)}
          >{label}</button>;
        })}
        <span className="status-space">{activeSpace} · mm · {precisionSource.toUpperCase()}</span>
      </span>
    </footer>
  );
}
