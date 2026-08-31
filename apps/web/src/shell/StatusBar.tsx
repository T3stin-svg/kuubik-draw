interface StatusBarProps {
  coordinates: string;
  gridEnabled: boolean;
  activeSpace: string;
  onGridToggle: () => void;
}

export function StatusBar({ coordinates, gridEnabled, activeSpace, onGridToggle }: StatusBarProps) {
  return (
    <footer className="statusbar" data-visual-zone="statusbar">
      <span className="coordinate-readout" data-testid="coordinate-readout">{coordinates}</span>
      <span className="status-toggles">
        <button type="button" className={`status-toggle${gridEnabled ? " active" : ""}`} data-status-control="grid" aria-label="Grid display" aria-pressed={gridEnabled} onClick={onGridToggle}>GRID</button>
        <button type="button" className="status-toggle" data-status-control="ortho" data-feature-row="F-045" data-scope-selected="true" aria-label="ORTHO unavailable" disabled title="Valitud sinu töövoogu · funktsiooniliides pole veel ühendatud">ORTHO</button>
        <button type="button" className="status-toggle" data-status-control="osnap" data-feature-row="F-049" data-scope-selected="true" aria-label="OSNAP unavailable" disabled title="Valitud sinu töövoogu · funktsiooniliides pole veel ühendatud">OSNAP</button>
        <button type="button" className="status-toggle" data-status-control="otrack" data-feature-row="F-050" data-scope-selected="true" aria-label="OTRACK unavailable" disabled title="Valitud sinu töövoogu · funktsiooniliides pole veel ühendatud">OTRACK</button>
        <button type="button" className="status-toggle" data-status-control="dyn" data-feature-row="F-052" data-scope-selected="true" aria-label="Dynamic Input unavailable" disabled title="Valitud sinu töövoogu · funktsiooniliides pole veel ühendatud">DYN</button>
        <span className="status-space">{activeSpace} · mm · SNAP</span>
      </span>
    </footer>
  );
}
