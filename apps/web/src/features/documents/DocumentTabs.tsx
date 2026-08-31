import type { DocumentTabsReadback } from "./document-tabs.js";

export interface DocumentTabsProps {
  state: DocumentTabsReadback;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
  onNew: () => void;
}

export function DocumentTabs({ state, onActivate, onClose, onNew }: DocumentTabsProps) {
  return (
    <nav className="document-tabs" aria-label="Joonise vahelehed" data-visual-zone="document-tabs">
      <button type="button" className="document-menu" aria-label="Jooniste menüü" data-document-tab="menu">☰</button>
      <button type="button" className="start-tab" data-document-tab="start" disabled={state.tabs.length > 0}>Start</button>
      {state.tabs.map((tab) => {
        const active = tab.documentId === state.activeDocumentId;
        return (
          <span key={tab.documentId} className={`drawing-tab${active ? " active" : ""}`} data-document-id={tab.documentId} data-dirty={tab.dirty || undefined}>
            <button type="button" aria-current={active ? "page" : undefined} onClick={() => onActivate(tab.documentId)}>
              {tab.label}{tab.dirty ? " *" : ""}
            </button>
            <button type="button" aria-label={`Sulge ${tab.label}`} onClick={() => onClose(tab.documentId)}>×</button>
          </span>
        );
      })}
      <button type="button" className="new-drawing-tab" aria-label="Uus joonis" data-document-tab="new" onClick={onNew}>＋</button>
    </nav>
  );
}
