import type { LivePromptField } from "./runtime-adapter.js";

interface LiveCommandPromptProps {
  commandId: string;
  field: LivePromptField;
  value: string;
  onValueChange: (value: string) => void;
  onNext: () => void;
  onCancel: () => void;
}

function placeholder(field: LivePromptField): string {
  if (field.kind === "point") return "x,y";
  if (field.kind === "points") return "x,y; x,y";
  if (field.kind === "handles") return "A1,B2";
  if (field.kind === "attributes") return "JSON objekt või massiiv";
  if (field.kind === "entities") return "JSON objektide massiiv";
  if (field.kind === "boolean") return "jah / ei";
  return field.required ? "Nõutud väärtus" : "Enter jätab vahele";
}

export function LiveCommandPrompt({ commandId, field, value, onValueChange, onNext, onCancel }: LiveCommandPromptProps) {
  return (
    <section className="live-command-prompt" aria-label={`${commandId} typed prompt`} data-testid="live-command-prompt" data-command={commandId} data-field={field.id} data-kind={field.kind}>
      <span className="live-command-badge">{commandId}</span>
      <label>
        <span>{field.label}{field.required ? " *" : ""}</span>
        {field.choices.length > 0 ? (
          <select autoFocus aria-label={field.label} value={value} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onNext(); }}>
            <option value="">Vali…</option>
            {field.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        ) : (
          <input autoFocus aria-label={field.label} value={value} placeholder={placeholder(field)} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onNext(); if (event.key === "Escape") onCancel(); }} />
        )}
      </label>
      <button type="button" className="live-command-next" onClick={onNext}>{field.required ? "Järgmine" : "Järgmine / jäta vahele"}</button>
      <button type="button" className="live-command-cancel" onClick={onCancel}>Tühista</button>
    </section>
  );
}
