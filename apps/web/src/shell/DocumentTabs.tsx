import { CadIcon } from "../icons/CadIcon.js";
import type { DocumentTabsReadback } from "../features/documents/document-tabs.js";

interface DocumentTabsProps {
  state: DocumentTabsReadback;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
  onNew: () => void;
}

export function DocumentTabs({ state, onActivate, onClose, onNew }: DocumentTabsProps) {
  return (
    <nav className="document-tabs" aria-label="Joonise vahelehed" data-visual-zone="document-tabs">
      <button type="button" className="document-menu" aria-label="Jooniste menüü" data-document-tab="menu"><CadIcon name="menu" /></button>
      <button type="button" className="start-tab" data-document-tab="start" disabled={state.tabs.length > 0}>Start</button>
      {state.tabs.map((tab) => {
        const active = tab.documentId === state.activeDocumentId;
        return <span key={tab.documentId} className={`drawing-tab-shell${active ? " active" : ""}`} data-document-tab="drawing" data-document-id={tab.documentId} data-dirty={tab.dirty ? "true" : "false"}>
          <button type="button" className="drawing-tab" aria-current={active ? "page" : undefined} onClick={() => onActivate(tab.documentId)}>{tab.label}{tab.dirty ? " *" : ""}</button>
          <button type="button" className="drawing-tab-close" aria-label={`Sulge ${tab.label}`} onClick={() => onClose(tab.documentId)}><CadIcon name="close" /></button>
        </span>;
      })}
      <button type="button" className="new-drawing-tab" aria-label="Uus joonis" data-document-tab="new" onClick={onNew}><CadIcon name="add" /></button>
    </nav>
  );
}
