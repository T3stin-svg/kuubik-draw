import { CadIcon } from "../icons/CadIcon.js";

interface CommandLineProps {
  status: string;
  activeCommand: string | null;
  input: string;
  historyOpen: boolean;
  history: readonly string[];
  documentName: string;
  aliasCount: number;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onHistoryNavigate: (direction: -1 | 1) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onAliasImport: (file: File) => void;
  onAliasExport: () => void;
}

export function CommandLine({ status, activeCommand, input, historyOpen, history, documentName, aliasCount, onInputChange, onSubmit, onCancel, onHistoryNavigate, onHistoryOpenChange, onAliasImport, onAliasExport }: CommandLineProps) {
  return (
    <section className="command-line" aria-label="Käsurida" data-visual-zone="command-line">
      {historyOpen && (
        <section className="command-history-window" role="dialog" aria-modal="true" aria-labelledby="command-text-window-title" data-testid="command-text-window">
          <header className="command-text-titlebar">
            <span className="command-text-app-icon" aria-hidden="true"><CadIcon name="app" /></span>
            <span id="command-text-window-title">Kuubik Text Window — {documentName}</span>
            <button type="button" aria-label="Sulge Kuubik Text Window" onClick={() => onHistoryOpenChange(false)}><CadIcon name="close" /></button>
          </header>
          <nav className="command-text-menubar" aria-label="Käsuajaloo menüü">
            <span>Edit</span>
            <label className="command-alias-import">
              Import PGP
              <input type="file" accept=".pgp,text/plain" aria-label="Import PGP aliases" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) onAliasImport(file);
                event.currentTarget.value = "";
              }} />
            </label>
            <button type="button" onClick={onAliasExport}>Export PGP</button>
            <output data-testid="pgp-alias-count">{aliasCount} custom alias{aliasCount === 1 ? "" : "es"}</output>
          </nav>
          <div className="command-text-log" role="log" aria-label="Käsuajalugu" tabIndex={0}>
            <div>Kuubik command utilities loaded.</div>
            {history.map((entry, index) => <div key={`${index}-${entry}`}>Command: {entry}</div>)}
          </div>
          <div className="command-text-prompt">Command:</div>
        </section>
      )}
      <div className="command-history" role="status" aria-live="polite">{status}</div>
      <form className="command-prompt" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <button type="button" className="command-history-toggle" aria-label={historyOpen ? "Sulge käsuajalugu" : "Ava käsuajalugu"} aria-expanded={historyOpen} onClick={() => onHistoryOpenChange(!historyOpen)}><CadIcon name={historyOpen ? "chevronDown" : "chevronUp"} /></button>
        <label htmlFor="cad-command-input">Command:</label>
        <input
          id="cad-command-input"
          aria-label="Command input"
          autoComplete="off"
          spellCheck={false}
          value={input}
          data-runtime-adapter="command-engine"
          data-active-command={activeCommand ?? ""}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onCancel(); }
            else if (event.key === "ArrowUp") { event.preventDefault(); onHistoryNavigate(-1); }
            else if (event.key === "ArrowDown") { event.preventDefault(); onHistoryNavigate(1); }
          }}
        />
        <button type="submit" className="command-submit" aria-label="Käivita käsk">Enter</button>
        {!input && <span className="command-caret" aria-hidden="true" />}
      </form>
    </section>
  );
}
