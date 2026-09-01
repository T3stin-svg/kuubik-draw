import { CadIcon } from "../icons/CadIcon.js";
import type { WorkspacePreset } from "./CadShell.js";
import { REIO_SCOPE_LABEL } from "./reio-scope.js";

interface TitleBarProps {
  documentName: string;
  canUndo: boolean;
  canRedo: boolean;
  workspace: WorkspacePreset;
  storageState: "loading" | "ready" | "recovered" | "recovery";
  onWorkspaceChange: (workspace: WorkspacePreset) => void;
  onOpenDxf: () => void;
  onSaveKDraw: () => void;
  onExportDxf: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const iconButton = (label: string, icon: Parameters<typeof CadIcon>[0]["name"], disabled = true) => (
  <button type="button" aria-label={label} disabled={disabled}><CadIcon name={icon} /></button>
);

export function TitleBar({ documentName, canUndo, canRedo, workspace, storageState, onWorkspaceChange, onOpenDxf, onSaveKDraw, onExportDxf, onUndo, onRedo }: TitleBarProps) {
  return (
    <header className="titlebar" data-visual-zone="titlebar">
      <span className="application-mark" aria-label="Kuubik Draw rakenduse menüü"><CadIcon name="app" /></span>
      <span className="quick-access" aria-label="Kiirpääsuriba">
        {iconButton("Kiirpääsu uus joonis unavailable", "new")}
        <button type="button" aria-label="Kiirpääsu DXF avamine" onClick={onOpenDxf}><CadIcon name="open" /></button>
        <button type="button" aria-label="Kiirpääsu KDraw salvestamine" onClick={onSaveKDraw}><CadIcon name="save" /></button>
        <button type="button" aria-label="Kiirpääsu DXF-väljund" onClick={onExportDxf}><CadIcon name="export" /></button>
        <i aria-hidden="true" />
        <button type="button" aria-label="Kiirpääsu Undo" onClick={onUndo} disabled={!canUndo}><CadIcon name="undo" /></button>
        <button type="button" aria-label="Kiirpääsu Redo" onClick={onRedo} disabled={!canRedo}><CadIcon name="redo" /></button>
        {iconButton("Kiirpääsu printimine unavailable", "print")}
        {iconButton("Kiirpääsuriba seaded unavailable", "settings")}
      </span>
      <label className="workspace-name">
        <span className="sr-only">Tööruum</span>
        <select aria-label="Tööruum" value={workspace} onChange={(event) => onWorkspaceChange(event.target.value as WorkspacePreset)}>
          <option value="drafting">2D Drafting &amp; Annotation</option>
          <option value="focus">Joonestuse fookus</option>
          <option value="review">Kontroll ja omadused</option>
        </select>
      </label>
      <span className="title-display-controls" aria-label="Vaate kiirjuhtelemendid">
        {iconButton("Vaateaken unavailable", "view")}
        {iconButton("Visuaalstiil unavailable", "settings")}
        {iconButton("Vaate jagamine unavailable", "share")}
      </span>
      <strong className="document-title">{documentName} — Kuubik Draw</strong>
      <span className="storage-state" data-storage-state={storageState} role="status" aria-live="polite">
        {storageState === "loading" ? "Joonise laadimine…" : storageState === "recovered" ? "Automaatsalvestus taastatud" : storageState === "recovery" ? "Taastamine vajab tähelepanu" : "Salvestus valmis"}
      </span>
      <span className="product-badge lite-profile-badge" data-testid="lite-profile-badge">{REIO_SCOPE_LABEL}</span>
    </header>
  );
}
