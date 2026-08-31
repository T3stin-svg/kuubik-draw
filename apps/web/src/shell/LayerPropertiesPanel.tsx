import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createCadLayerPropertyIndex, resolveCadEntityLayerProperties, type CadDrawOrderAction, type CadLayerAppearancePatch, type CadLayerToggle } from "@kuubik/cad-core";
import type { CadEntity, CadLayer, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { CadIcon } from "../icons/CadIcon.js";

export type LayerOperationState = "idle" | "loading" | "error" | "recovered";

interface LayerPropertiesPanelProps {
  document: KDrawDocumentV1;
  selectedHandles: readonly string[];
  primarySelectedEntity: CadEntity | null;
  modelSpaceEditing: boolean;
  filter: string;
  operationState: LayerOperationState;
  operationMessage: string;
  featureAvailable: (rowId: string) => boolean;
  onFilterChange: (value: string) => void;
  onCreate: () => Promise<void>;
  onRename: (layerId: string, name: string) => Promise<void>;
  onDelete: (layerId: string) => Promise<void>;
  onCurrent: (layerId: string) => Promise<void>;
  onToggle: (layerId: string, property: CadLayerToggle, value: boolean) => Promise<void>;
  onAppearance: (layerId: string, patch: CadLayerAppearancePatch) => Promise<void>;
  onDrawOrder: (action: CadDrawOrderAction) => Promise<void>;
}

const LINEWEIGHTS = [0.05, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1] as const;
const COLORS = [
  ["#ffffff", "White"], ["#ff0000", "Red"], ["#ffff00", "Yellow"], ["#00ff00", "Green"],
  ["#00ffff", "Cyan"], ["#0000ff", "Blue"], ["#ff00ff", "Magenta"], ["#7f8c98", "Gray"],
] as const;

function layerDeleteReason(document: KDrawDocumentV1, layer: CadLayer): string | null {
  if (layer.name === "0") return "Layer 0 on süsteemikiht";
  if (layer.name.toLocaleLowerCase("en-US") === "defpoints") return "Defpoints on süsteemikiht";
  if (document.currentLayerId === layer.id) return "Aktiivset kihti ei saa kustutada";
  let references = document.entities.filter((entity) => entity.layerId === layer.id).length;
  references += document.blocks.flatMap((block) => block.entities).filter((entity) => entity.layerId === layer.id).length;
  references += document.layouts.flatMap((layout) => layout.entities ?? []).filter((entity) => entity.layerId === layer.id).length;
  references += document.layouts.flatMap((layout) => layout.viewports).filter((viewport) => Object.hasOwn(viewport.layerOverrides ?? {}, layer.id)).length;
  return references > 0 ? `Kihti kasutab ${references} objekti või vaateava` : null;
}

function effectiveLabel(source: "entity" | "layer" | "default", value: string): string {
  return source === "entity" ? value : `ByLayer → ${value}`;
}

function propertyValue(value: number | null, suffix: string): string {
  return value === null ? "Default" : `${value}${suffix}`;
}

export function LayerPropertiesPanel({
  document,
  selectedHandles,
  primarySelectedEntity,
  modelSpaceEditing,
  filter,
  operationState,
  operationMessage,
  featureAvailable,
  onFilterChange,
  onCreate,
  onRename,
  onDelete,
  onCurrent,
  onToggle,
  onAppearance,
  onDrawOrder,
}: LayerPropertiesPanelProps) {
  const activeLayer = document.layers.find((layer) => layer.id === document.currentLayerId)!;
  const [selectedLayerId, setSelectedLayerId] = useState(activeLayer.id);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleLayers = document.layers.filter((layer) => layer.name.toLocaleLowerCase().includes(normalizedFilter));
  const selectedLayer = document.layers.find((layer) => layer.id === selectedLayerId) ?? activeLayer;
  const selectedDeleteReason = layerDeleteReason(document, selectedLayer);
  const busy = operationState === "loading";

  useEffect(() => {
    if (!document.layers.some((layer) => layer.id === selectedLayerId)) setSelectedLayerId(document.currentLayerId);
  }, [document.currentLayerId, document.layers, selectedLayerId]);

  const resolved = useMemo(() => {
    if (!primarySelectedEntity) return null;
    return resolveCadEntityLayerProperties(primarySelectedEntity, createCadLayerPropertyIndex(document.layers, document.linetypes));
  }, [document.layers, document.linetypes, primarySelectedEntity]);

  function focusRow(layerId: string): void {
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layerId)}"]`)?.focus());
  }

  function moveSelection(step: -1 | 1): void {
    if (visibleLayers.length === 0) return;
    const currentIndex = Math.max(0, visibleLayers.findIndex((layer) => layer.id === selectedLayer.id));
    const next = visibleLayers[Math.max(0, Math.min(visibleLayers.length - 1, currentIndex + step))]!;
    setSelectedLayerId(next.id);
    focusRow(next.id);
  }

  function beginRename(layer: CadLayer): void {
    if (layer.name === "0" || layer.name.toLocaleLowerCase("en-US") === "defpoints") return;
    setSelectedLayerId(layer.id);
    setRenameValue(layer.name);
    setRenamingLayerId(layer.id);
  }

  async function commitRename(): Promise<void> {
    if (!renamingLayerId) return;
    const nextName = renameValue.trim();
    if (!nextName) return;
    await onRename(renamingLayerId, nextName);
    setRenamingLayerId(null);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, layer: CadLayer): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = visibleLayers[event.key === "Home" ? 0 : visibleLayers.length - 1];
      if (next) { setSelectedLayerId(next.id); focusRow(next.id); }
    } else if (event.key === "Enter" && layer.id !== activeLayer.id && layer.visible && !layer.frozen) {
      event.preventDefault();
      void onCurrent(layer.id);
    } else if (event.key === "F2") {
      event.preventDefault();
      beginRename(layer);
    } else if (event.key === "Delete" && !layerDeleteReason(document, layer)) {
      event.preventDefault();
      void onDelete(layer.id);
    }
  }

  return <>
    <section className="layer-manager" aria-label="Layer Properties Manager" aria-busy={busy} data-operation-state={operationState}>
      <header><strong>LAYER PROPERTIES MANAGER</strong><CadIcon name="close" /></header>
      <div className="layer-current">
        <span>Current layer: <strong>{activeLayer.name}</strong></span>
        <label>Search for layer<input aria-label="Search for layer" value={filter} onChange={(event) => onFilterChange(event.target.value)} /></label>
      </div>
      <div className="layer-toolbar" role="toolbar" aria-label="Layer tools">
        <button type="button" aria-label="Loo uus kiht" disabled={busy || !featureAvailable("F-072")} data-feature-row="F-072" onClick={() => void onCreate()}><CadIcon name="add" /></button>
        <button type="button" aria-label="Nimeta valitud kiht ümber" disabled={busy || selectedLayer.name === "0" || selectedLayer.name.toLocaleLowerCase("en-US") === "defpoints"} data-feature-row="F-072" onClick={() => beginRename(selectedLayer)}><CadIcon name="edit" /></button>
        <button type="button" aria-label="Kustuta valitud kiht" disabled={busy || selectedDeleteReason !== null} title={selectedDeleteReason ?? "Kustuta valitud kiht"} data-feature-row="F-072" onClick={() => void onDelete(selectedLayer.id)}><CadIcon name="remove" /></button>
        <button type="button" aria-label="Tee valitud kiht aktiivseks" disabled={busy || selectedLayer.id === activeLayer.id || !selectedLayer.visible || selectedLayer.frozen} data-feature-row="F-072" onClick={() => void onCurrent(selectedLayer.id)}><CadIcon name="current" /></button>
        <i aria-hidden="true" />
        <button type="button" aria-label="Too valitud objektid ette" disabled={busy || !modelSpaceEditing || selectedHandles.length === 0 || !featureAvailable("F-086")} data-feature-row="F-086" data-scope-selected="true" title={selectedHandles.length === 0 ? "Vali objektid; draw-order on fail-closed" : "DRAWORDER: Bring to Front"} onClick={() => void onDrawOrder("front")}><CadIcon name="chevronUp" /></button>
        <button type="button" aria-label="Saada valitud objektid taha" disabled={busy || !modelSpaceEditing || selectedHandles.length === 0 || !featureAvailable("F-086")} data-feature-row="F-086" data-scope-selected="true" title={selectedHandles.length === 0 ? "Vali objektid; draw-order on fail-closed" : "DRAWORDER: Send to Back"} onClick={() => void onDrawOrder("back")}><CadIcon name="chevronDown" /></button>
      </div>
      <div className="layer-manager-body">
        <aside className="layer-filter-rail" aria-label="Layer filters">
          <strong>Filters</strong>
          <button type="button" className="active"><CadIcon name="layer" />All</button>
          <button type="button"><CadIcon name="layer" />All Used Layers</button>
          <label><input type="checkbox" /> Invert filter</label>
        </aside>
        <div className="layer-grid" role="table" aria-label="Kihtide loend" ref={gridRef}>
          <div className="layer-grid-header" role="row"><span>Status</span><span>Name</span><span>On</span><span>Freeze</span><span>Lock</span><span>Plot</span><span>Color</span><span>Linetype</span><span>Lineweight</span><span>Transparency</span></div>
          {visibleLayers.map((layer) => {
            const isSelected = layer.id === selectedLayer.id;
            const isCurrent = layer.id === activeLayer.id;
            return <div
              className={`layer-grid-row${isSelected ? " active" : ""}${isCurrent ? " is-current" : ""}`}
              role="row"
              tabIndex={isSelected ? 0 : -1}
              aria-selected={isSelected}
              key={layer.id}
              data-layer-id={layer.id}
              data-current={isCurrent}
              onClick={() => setSelectedLayerId(layer.id)}
              onDoubleClick={() => beginRename(layer)}
              onKeyDown={(event) => onRowKeyDown(event, layer)}
            >
              <span><button type="button" aria-label={`Tee ${layer.name} aktiivseks`} disabled={busy || isCurrent || !layer.visible || layer.frozen} onClick={() => void onCurrent(layer.id)}>{isCurrent ? <CadIcon name="current" /> : <CadIcon name="layer" />}</button></span>
              <span>{renamingLayerId === layer.id
                ? <input className="layer-name-editor" aria-label={`${layer.name} uus nimi`} value={renameValue} autoFocus onChange={(event) => setRenameValue(event.target.value)} onBlur={() => void commitRename()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitRename(); } else if (event.key === "Escape") { event.preventDefault(); setRenamingLayerId(null); } }} />
                : layer.name}</span>
              <span><button type="button" aria-label={`${layer.name} nähtavus`} aria-pressed={layer.visible} disabled={busy || !featureAvailable("F-073")} data-feature-row="F-073" onClick={() => void onToggle(layer.id, "visible", !layer.visible)}><CadIcon name={layer.visible ? "visible" : "hidden"} /></button></span>
              <span><button type="button" aria-label={`${layer.name} külmutus`} aria-pressed={layer.frozen} disabled={busy || isCurrent || !featureAvailable("F-075")} data-feature-row="F-075" title={isCurrent ? "Aktiivset kihti ei saa külmutada" : "Freeze / thaw"} onClick={() => void onToggle(layer.id, "frozen", !layer.frozen)}><CadIcon name={layer.frozen ? "freeze" : "unfreeze"} /></button></span>
              <span><button type="button" aria-label={`${layer.name} lukustus`} aria-pressed={layer.locked} disabled={busy || !featureAvailable("F-074")} data-feature-row="F-074" onClick={() => void onToggle(layer.id, "locked", !layer.locked)}><CadIcon name="lock" className={layer.locked ? "is-on" : "is-off"} /></button></span>
              <span><button type="button" aria-label={`${layer.name} plot`} aria-pressed={layer.plottable} disabled={busy || !featureAvailable("F-079") || layer.name.toLocaleLowerCase("en-US") === "defpoints"} data-feature-row="F-079" onClick={() => void onToggle(layer.id, "plottable", !layer.plottable)}><CadIcon name={layer.plottable ? "plot" : "unplot"} /></button></span>
              <span className="layer-color-cell"><i className="layer-color-swatch" style={{ background: layer.appearance?.color ?? "#ffffff" }} /><select aria-label={`${layer.name} värv`} value={layer.appearance?.color ?? ""} disabled={busy || !featureAvailable("F-076")} data-feature-row="F-076" onChange={(event) => void onAppearance(layer.id, { color: event.target.value || null, colorMethod: event.target.value ? "trueColor" : null, aciIndex: null })}><option value="">ByLayer</option>{COLORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span>
              <span><select aria-label={`${layer.name} joonetüüp`} value={layer.appearance?.linetypeId ?? ""} disabled={busy || !featureAvailable("F-077")} data-feature-row="F-077" onChange={(event) => void onAppearance(layer.id, { linetypeId: event.target.value || null })}><option value="">ByLayer</option>{document.linetypes.map((linetype) => <option key={linetype.id} value={linetype.id}>{linetype.name}</option>)}</select></span>
              <span><select aria-label={`${layer.name} joonepaksus`} value={layer.appearance?.lineweightMm ?? ""} disabled={busy || !featureAvailable("F-078")} data-feature-row="F-078" onChange={(event) => void onAppearance(layer.id, { lineweightMm: event.target.value === "" ? null : Number(event.target.value) })}><option value="">Default</option>{LINEWEIGHTS.map((value) => <option key={value} value={value}>{value.toFixed(2)} mm</option>)}</select></span>
              <span><select aria-label={`${layer.name} läbipaistvus`} value={layer.appearance?.transparency ?? ""} disabled={busy || !featureAvailable("F-080")} data-feature-row="F-080" data-scope-selected="true" title="F-080 typed core connection" onChange={(event) => void onAppearance(layer.id, { transparency: event.target.value === "" ? null : Number(event.target.value) })}><option value="">ByLayer</option>{[0, 25, 50, 75, 90].map((value) => <option key={value} value={value}>{value}%</option>)}</select></span>
            </div>;
          })}
          {visibleLayers.length === 0 && <div className="layer-grid-empty">No matching layers</div>}
        </div>
      </div>
      <footer className="layer-manager-summary">
        <span>All: {visibleLayers.length} layers displayed of {document.layers.length} total layers</span>
        <output aria-live="polite" data-testid="layer-operation-readback" data-state={operationState}>{operationMessage || "Typed layer adapter valmis"}</output>
      </footer>
    </section>
    <header>
      <strong>PROPERTIES</strong>
      <span>{selectedHandles.length === 0 ? "No selection" : `${selectedHandles.length} selected`}</span>
    </header>
    <div className="properties-selection-summary">{selectedHandles.length === 0 ? "No selection" : selectedHandles.length === 1 ? primarySelectedEntity?.kind.toUpperCase() ?? "Object" : `All (${selectedHandles.length})`}</div>
    <section>
      <h2>General</h2>
      <dl>
        <div><dt>Color</dt><dd data-property-source={resolved?.sources.color ?? "none"} data-effective-value={resolved?.color ?? "default"}>{resolved ? effectiveLabel(resolved.sources.color, resolved.color ?? "Default") : "ByLayer"}</dd></div>
        <div><dt>Layer</dt><dd data-effective-value={primarySelectedEntity?.layerId ?? activeLayer.id}>{primarySelectedEntity ? document.layers.find((layer) => layer.id === primarySelectedEntity.layerId)?.name ?? activeLayer.name : activeLayer.name}</dd></div>
        <div><dt>Linetype</dt><dd data-property-source={resolved?.sources.linetype ?? "none"} data-effective-value={resolved?.linetypeId ?? "continuous"}>{resolved ? effectiveLabel(resolved.sources.linetype, resolved.linetypeId ?? "Continuous") : "ByLayer"}</dd></div>
        <div><dt>Linetype scale</dt><dd data-property-source={resolved?.sources.linetypeScale ?? "none"} data-effective-value={resolved?.linetypeScale ?? 1}>{resolved ? effectiveLabel(resolved.sources.linetypeScale, String(resolved.linetypeScale)) : "1"}</dd></div>
        <div><dt>Plot style</dt><dd>{primarySelectedEntity?.appearance?.plotStyleId ?? "ByColor"}</dd></div>
        <div><dt>Lineweight</dt><dd data-property-source={resolved?.sources.lineweight ?? "none"} data-effective-value={resolved?.lineweightMm ?? "default"}>{resolved ? effectiveLabel(resolved.sources.lineweight, propertyValue(resolved.lineweightMm, " mm")) : "ByLayer"}</dd></div>
        <div><dt>Transparency</dt><dd data-property-source={resolved?.sources.transparency ?? "none"} data-effective-value={resolved?.transparency ?? "default"}>{resolved ? effectiveLabel(resolved.sources.transparency, propertyValue(resolved.transparency, "%")) : "ByLayer"}</dd></div>
        <div><dt>Hyperlink</dt><dd>—</dd></div>
        <div><dt>Thickness</dt><dd>{primarySelectedEntity?.appearance?.thickness ?? 0}</dd></div>
      </dl>
    </section>
    <section>
      <h2>3D Visualization</h2>
      <dl><div><dt>Material</dt><dd>{primarySelectedEntity?.appearance?.materialId ?? "ByLayer"}</dd></div></dl>
    </section>
    <section><h2>Plot style</h2></section>
    <section><h2>View</h2></section>
    <section><h2>Data</h2></section>
  </>;
}
