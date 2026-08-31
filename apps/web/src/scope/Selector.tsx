import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ROW_BY_ID,
  SCOPE_GROUPS,
  SCOPE_ROWS,
  readinessLabel,
  recommendationLabel,
  type ScopeGroup,
} from "./catalog";
import {
  SCOPE_FILE_NAME,
  SCOPE_STORAGE_KEY,
  calculateScopeMetrics,
  createScopeSelection,
  loadLocalScope,
  parseScopeSelection,
  saveLocalScope,
} from "./model";

type FilterMode = "all" | "recommended" | "selected" | "unselected";

function GroupCheckbox({ group, selected, onChange }: {
  group: ScopeGroup;
  selected: ReadonlySet<string>;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const selectedCount = group.rowIds.filter((id) => selected.has(id)).length;
  const checked = selectedCount === group.rowIds.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selectedCount > 0 && !checked;
  }, [checked, selectedCount]);
  return (
    <input
      ref={ref}
      className="scope-checkbox"
      type="checkbox"
      checked={checked}
      aria-label={`Vali kogu grupp ${group.title}`}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

function DownloadIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18h14v3H5z" /></svg>;
}

function UploadIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V4m0 0 4 4m-4-4L8 8M5 17h14v4H5z" /></svg>;
}

export function ScopeSelector() {
  const initial = useMemo(() => loadLocalScope(window.localStorage), []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.selectedRowIds));
  const [notes, setNotes] = useState<Record<string, string>>(initial.localNotes);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<FilterMode>("all");
  const [category, setCategory] = useState("all");
  const [message, setMessage] = useState("Valik salvestub automaatselt ainult sellesse brauserisse.");
  const importRef = useRef<HTMLInputElement>(null);
  const catalogErrors = useMemo(() => {
    const ids = SCOPE_ROWS.map((row) => row.id);
    return ids.length === 133 && new Set(ids).size === 133 ? [] : ["Funktsioonikataloog ei ole terviklik."];
  }, []);
  const metrics = useMemo(() => calculateScopeMetrics(selected), [selected]);
  const categories = useMemo(() => [...new Set(SCOPE_ROWS.map((row) => row.category))].sort(), []);

  useEffect(() => {
    saveLocalScope(window.localStorage, { selectedRowIds: [...selected], localNotes: notes });
  }, [notes, selected]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("et");
    return SCOPE_GROUPS.map((group) => {
      const rows = group.rowIds
        .map((id) => ROW_BY_ID.get(id))
        .filter((row) => row !== undefined)
        .filter((row) => {
          if (mode === "recommended" && group.recommendation !== "recommended" && group.recommendation !== "partial") return false;
          if (mode === "selected" && !selected.has(row.id)) return false;
          if (mode === "unselected" && selected.has(row.id)) return false;
          if (category !== "all" && row.category !== category) return false;
          if (!normalizedQuery) return true;
          return `${row.id} ${row.feature} ${row.category} ${group.title}`.toLocaleLowerCase("et").includes(normalizedQuery);
        });
      return { group, rows };
    }).filter(({ rows }) => rows.length > 0);
  }, [category, mode, query, selected]);

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleGroup(group: ScopeGroup, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of group.rowIds) {
        if (checked) next.add(id); else next.delete(id);
      }
      return next;
    });
  }

  function updateNote(id: string, value: string) {
    setNotes((current) => ({ ...current, [id]: value }));
  }

  function exportSelection() {
    const payload = createScopeSelection(selected, notes);
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = SCOPE_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Eksporditud ${payload.selectedRowIds.length} valitud F-rida.`);
  }

  async function importSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const imported = parseScopeSelection(await file.text());
      setSelected(new Set(imported.selectedRowIds));
      setNotes(imported.localNotes ?? {});
      setMessage(`Imporditud ${imported.selectedRowIds.length} valitud F-rida failist ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Import ebaõnnestus: ${error.message}` : "Import ebaõnnestus.");
    }
  }

  async function copySummary() {
    const lines = [
      "Kuubik Draw — Reio minimaalne scope",
      `Valitud: ${metrics.selected}/133 (${metrics.sharePercent.toFixed(1)}%)`,
      `Hetkeseis valitud scope'is: valmis ${metrics.ready}, osaline ${metrics.partial}, puudu ${metrics.missing}`,
      `Raw ${metrics.rawPercent.toFixed(1)}%, weighted ${metrics.weightedPercent.toFixed(1)}%`,
      "",
      ...SCOPE_GROUPS.flatMap((group) => {
        const ids = group.rowIds.filter((id) => selected.has(id));
        return ids.length ? [`${group.title}: ${ids.join(", ")}`] : [];
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setMessage("Valiku kokkuvõte kopeeriti lõikelauale.");
    } catch {
      setMessage("Lõikelauale kopeerimine ei õnnestunud. Kasuta JSON-eksporti.");
    }
  }

  function resetSelection() {
    if (!window.confirm("Kas eemaldada kõik valikud ja kohalikud märkused? Seda ei saa tagasi võtta.")) return;
    setSelected(new Set());
    setNotes({});
    window.localStorage.removeItem(SCOPE_STORAGE_KEY);
    setMessage("Valik ja märkused nulliti.");
  }

  return (
    <div className="scope-app">
      <a className="skip-link" href="#scope-main">Liigu funktsioonide juurde</a>
      <header className="scope-topbar">
        <div className="brand-mark" aria-hidden="true"><span>K</span></div>
        <div className="brand-copy">
          <strong>KUUBIK DRAW</strong>
          <span>Reio minimaalne 2D CAD</span>
        </div>
        <div className="benchmark-chip">AutoCAD 2024.1.2 · Windows · 2D</div>
      </header>

      <main id="scope-main" className="scope-main">
        <section className="scope-hero" aria-labelledby="scope-title">
          <div>
            <p className="eyebrow">TÖÖVOO VALIK · VERSIOON 1</p>
            <h1 id="scope-title">Vali ainult see, mida sul päriselt vaja on.</h1>
            <p className="hero-copy">Kõik 133 AutoCADi võrdlusrida on siin alles. Märgi vajalikud funktsioonid; ülejäänud jäävad programmis nähtavaks, kuid halliks.</p>
          </div>
          <div className="scope-goal">
            <span className="goal-label">Uus valmimiseesmärk</span>
            <strong>100% sinu valitud ridadest</strong>
            <span>Mitte 100% kogu AutoCADist.</span>
          </div>
        </section>

        {catalogErrors.length > 0 && <div className="error-banner" role="alert">{catalogErrors.join(" ")}</div>}

        <section className="metric-grid" aria-label="Valiku kokkuvõte">
          <article className="metric-card primary">
            <span>Valitud</span>
            <strong data-testid="selected-count">{metrics.selected} / 133</strong>
            <small data-testid="selected-percent">{metrics.sharePercent.toFixed(1)}% AutoCADi auditi ridadest</small>
          </article>
          <article className="metric-card">
            <span>10% orientiir</span>
            <strong>13 rida = 9,8%</strong>
            <small>See ei ole piir — vali ainult tegelik töö.</small>
          </article>
          <article className="metric-card readiness">
            <span>Valitud ridade hetkeseis</span>
            <strong><b className="ready-dot" />{metrics.ready} valmis <b className="partial-dot" />{metrics.partial} osaline <b className="missing-dot" />{metrics.missing} puudu</strong>
            <small>Raw {metrics.rawPercent.toFixed(1)}% · weighted {metrics.weightedPercent.toFixed(1)}%</small>
          </article>
        </section>

        <section className="scope-toolbar" aria-label="Otsing ja filtrid">
          <label className="search-field">
            <span>Otsi funktsiooni või F-ID-d</span>
            <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} type="search" placeholder="Näiteks mõõt, DXF või F-061" />
          </label>
          <label className="category-field">
            <span>Kategooria</span>
            <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
              <option value="all">Kõik kategooriad</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <div className="filter-tabs" role="group" aria-label="Valiku filter">
            {([
              ["all", "Kõik"],
              ["recommended", "Soovitatud"],
              ["selected", "Valitud"],
              ["unselected", "Valimata"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
            ))}
          </div>
        </section>

        <div className="scope-content">
          <section className="group-list" aria-label="AutoCADi funktsioonigrupid">
            {filteredGroups.map(({ group, rows }) => {
              const groupSelected = group.rowIds.filter((id) => selected.has(id)).length;
              return (
                <details className="scope-group" key={group.id} data-group-id={group.id}>
                  <summary>
                    <GroupCheckbox group={group} selected={selected} onChange={(checked) => toggleGroup(group, checked)} />
                    <span className="group-number">{String(group.id).padStart(2, "0")}</span>
                    <span className="group-heading">
                      <strong>{group.title}</strong>
                      <small>{group.description}</small>
                    </span>
                    <span className={`recommendation ${group.recommendation}`}>{recommendationLabel(group.recommendation)}</span>
                    <span className="group-count">{groupSelected}/{group.rowIds.length}</span>
                    <span className="chevron" aria-hidden="true" />
                  </summary>
                  <div className="scope-rows">
                    {rows.map((row) => {
                      const readiness = readinessLabel(row.currentScore);
                      return (
                        <article className={`scope-row ${selected.has(row.id) ? "is-selected" : ""}`} key={row.id} data-row-id={row.id}>
                          <label className="row-choice">
                            <input className="scope-checkbox" type="checkbox" checked={selected.has(row.id)} onChange={(event) => toggleRow(row.id, event.currentTarget.checked)} />
                            <span className="row-id">{row.id}</span>
                            <span className="row-copy">
                              <strong>{row.feature}</strong>
                              <small>{row.category} · kaal {row.weight} · {row.priority} · maht {row.effort}</small>
                            </span>
                          </label>
                          <span className={`readiness ${readiness.toLocaleLowerCase("et")}`}>{readiness}</span>
                          <details className="note-box">
                            <summary>Märkus</summary>
                            <label>
                              <span className="sr-only">Kohalik märkus reale {row.id}</span>
                              <textarea value={notes[row.id] ?? ""} onChange={(event) => updateNote(row.id, event.currentTarget.value)} placeholder="Milleks sa seda vajad? Märkus jääb lokaalseks." rows={2} />
                            </label>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                </details>
              );
            })}
            {filteredGroups.length === 0 && <div className="empty-state"><strong>Sellist funktsiooni ei leitud.</strong><span>Muuda otsingut või filtreid.</span></div>}
          </section>

          <aside className="scope-actions" aria-label="Valiku toimingud">
            <h2>Valikufail</h2>
            <p>Ekspordi JSON siis, kui valik on valmis. Selle põhjal koostame ainult sinu töövoo arendusjärjekorra.</p>
            <button className="action-primary" type="button" onClick={exportSelection}><DownloadIcon />Ekspordi JSON</button>
            <button type="button" onClick={() => importRef.current?.click()}><UploadIcon />Impordi JSON</button>
            <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={importSelection} />
            <button type="button" onClick={copySummary}>Kopeeri valiku kokkuvõte</button>
            <button className="danger-link" type="button" onClick={resetSelection}>Nulli kogu valik…</button>
            <div className="privacy-note">
              <strong>Privaatne vaikimisi</strong>
              <span>Märkusi GitHubi ei saadeta. Need liiguvad ainult sinu eksporditud faili.</span>
            </div>
            <p className="status-message" role="status" aria-live="polite">{message}</p>
          </aside>
        </div>
      </main>
      <footer><span>Kuubik Projekt OÜ</span><span>Valimata käsud: nähtavad, kuid keelatud</span><span>1920 × 1080 · hiir + klaviatuur</span></footer>
    </div>
  );
}
