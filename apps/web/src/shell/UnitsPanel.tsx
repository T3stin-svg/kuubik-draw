import type { CadLinearUnit } from "@kuubik/cad-schema";
import type { CadAngleFormat, CadLengthFormat, CadUnitsContractV1 } from "@kuubik/cad-core";

interface UnitsPanelProps {
  value: CadUnitsContractV1;
  requiresPreserveConfirmation: boolean;
  preserveConfirmed: boolean;
  error: string | null;
  onChange: (value: CadUnitsContractV1) => void;
  onPreserveConfirmed: (value: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const lengthFormats: Array<[CadLengthFormat, string]> = [["decimal", "Decimal"], ["engineering", "Engineering"], ["architectural", "Architectural"], ["fractional", "Fractional"], ["scientific", "Scientific"]];
const angleFormats: Array<[CadAngleFormat, string]> = [["decimal-degrees", "Decimal degrees"], ["dms", "Deg/min/sec"], ["grads", "Grads"], ["radians", "Radians"], ["surveyor", "Surveyor"]];
const units: Array<[CadLinearUnit, string]> = [["unitless", "Unitless"], ["mm", "Millimeters"], ["cm", "Centimeters"], ["m", "Meters"], ["in", "Inches"], ["ft", "Feet"]];

export function UnitsPanel({ value, requiresPreserveConfirmation, preserveConfirmed, error, onChange, onPreserveConfirmed, onCommit, onCancel }: UnitsPanelProps) {
  const update = <Key extends keyof CadUnitsContractV1>(key: Key, next: CadUnitsContractV1[Key]) => onChange({ ...value, [key]: next });
  return (
    <form className="units-panel" aria-label="Drawing units" data-testid="units-panel" onSubmit={(event) => { event.preventDefault(); onCommit(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <header><div><strong>Drawing Units</strong><span>F-053 · dokumenti salvestatav CAD-leping</span></div><button type="button" aria-label="Sulge units" onClick={onCancel}>×</button></header>
      <div className="units-grid">
        <fieldset><legend>Length</legend>
          <label>Type<select autoFocus aria-label="Length format" value={value.lengthFormat} onChange={(event) => update("lengthFormat", event.target.value as CadLengthFormat)}>{lengthFormats.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Precision<input aria-label="Length precision" type="number" min="0" max={value.lengthFormat === "architectural" || value.lengthFormat === "fractional" ? 8 : 15} value={value.lengthPrecision} onChange={(event) => update("lengthPrecision", Number(event.target.value))} /></label>
          <label>Drawing unit<select aria-label="Drawing unit" value={value.drawingUnit} onChange={(event) => update("drawingUnit", event.target.value as CadLinearUnit)}>{units.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Insertion scale<select aria-label="Insertion unit" value={value.insertionUnit} onChange={(event) => update("insertionUnit", event.target.value as CadLinearUnit)}>{units.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Decimal<select aria-label="Decimal separator" value={value.decimalSeparator} onChange={(event) => update("decimalSeparator", event.target.value as "." | ",")}><option value=".">Point</option><option value=",">Comma</option></select></label>
        </fieldset>
        <fieldset><legend>Angle</legend>
          <label>Type<select aria-label="Angle format" value={value.angleFormat} onChange={(event) => update("angleFormat", event.target.value as CadAngleFormat)}>{angleFormats.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Precision<input aria-label="Angle precision" type="number" min="0" max="15" value={value.anglePrecision} onChange={(event) => update("anglePrecision", Number(event.target.value))} /></label>
          <label>Base angle °<input aria-label="Base angle" inputMode="decimal" value={Number((value.baseAngleRad * 180 / Math.PI).toFixed(8))} onChange={(event) => update("baseAngleRad", Number(event.target.value.replace(",", ".")) * Math.PI / 180)} /></label>
          <label className="units-check"><input aria-label="Clockwise angles" type="checkbox" checked={value.clockwise} onChange={(event) => update("clockwise", event.target.checked)} />Clockwise</label>
        </fieldset>
      </div>
      {requiresPreserveConfirmation && <label className="units-preserve"><input aria-label="Preserve existing coordinates" type="checkbox" checked={preserveConfirmed} onChange={(event) => onPreserveConfirmed(event.target.checked)} />Hoia olemasoleva geomeetria koordinaadid muutmata (scale 1:1)</label>}
      <output className={error ? "units-readback is-error" : "units-readback"} aria-live="polite">{error ?? `Näidis: pikkus ${value.lengthFormat}/${value.lengthPrecision} · nurk ${value.angleFormat}/${value.anglePrecision}`}</output>
      <footer><button type="submit" disabled={Boolean(error) || (requiresPreserveConfirmation && !preserveConfirmed)}>OK</button><button type="button" onClick={onCancel}>Cancel</button></footer>
    </form>
  );
}
