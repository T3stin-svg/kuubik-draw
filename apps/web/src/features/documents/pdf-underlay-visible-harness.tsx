import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { createEmptyDocument, planSetLayerToggle, resolvePdfUnderlayLayerState } from "@kuubik/cad-core";
import { renderPdfUnderlayPageSvg, type PdfUnderlayPlacementCandidate, type PreparedPdfUnderlay } from "@kuubik/cad-print";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { PdfUnderlayAttachPanel } from "./PdfUnderlayAttachPanel.js";
import { PdfUnderlayView } from "./PdfUnderlayView.js";
import { PdfUnderlayWorkspace, type PdfUnderlayWorkspaceReadback } from "./pdf-underlay-workspace.js";

const DOCUMENT_ID = "f115-visible";
const LAYER_ID = "pdf-reference";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: DOCUMENT_ID, now: "2026-09-01T08:00:00.000Z" });
  document.metadata.title = "F-115 visible PDF underlay harness";
  document.layers.push({ id: LAYER_ID, name: "PDF-REFERENCE", visible: true, frozen: false, locked: false, plottable: true });
  return document;
}

function operation(live: DocumentLiveOrchestrator, commandId: string, args: unknown): CadOperation {
  const baseRevision = live.document(DOCUMENT_ID).revision;
  return { opId: `f115-visible:${baseRevision + 1}:${commandId}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("F-115 harness database delete was blocked."));
  });
}

function Harness() {
  const [ready, setReady] = useState(false);
  const [readback, setReadback] = useState<PdfUnderlayWorkspaceReadback | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Avan F-115 tööruumi…");
  const liveRef = useRef<DocumentLiveOrchestrator | null>(null);
  const workspaceRef = useRef<PdfUnderlayWorkspace | null>(null);

  async function refresh(): Promise<void> {
    const workspace = workspaceRef.current!;
    const next = await workspace.readBack();
    setReadback(next);
    if (next.placements.length === 0) { setSourceUrl(null); return; }
    const stored = await liveRef.current!.readPdf(DOCUMENT_ID, next.placements[0]!.placement.id);
    const rendered = renderPdfUnderlayPageSvg(stored.bytes, next.placements[0]!.placement.pageNumber);
    setSourceUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(new Blob([rendered.svg], { type: "image/svg+xml" }));
    });
  }

  useEffect(() => {
    void (async () => {
      const query = new URLSearchParams(location.search);
      const databaseName = query.get("db")?.trim() || "kuubik-draw-f115-visible";
      if (query.get("reset") === "1") await deleteDatabase(databaseName);
      const database = new KDrawIndexedDb(indexedDB, databaseName);
      const live = new DocumentLiveOrchestrator(database, `f115-browser-${crypto.randomUUID()}`);
      await live.open({ documentId: DOCUMENT_ID, fallbackDocument: fixture(), sourceFileName: "f115-visible.kdraw" });
      liveRef.current = live;
      workspaceRef.current = new PdfUnderlayWorkspace(live, DOCUMENT_ID, "f115-visible");
      await refresh();
      setReady(true);
      setMessage("F-115 tööruum valmis.");
    })().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    try { await action(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  async function attach(prepared: PreparedPdfUnderlay, placement: PdfUnderlayPlacementCandidate): Promise<void> {
    const live = liveRef.current!;
    await live.attachPdf(DOCUMENT_ID, operation(live, "PDFATTACH", { placementId: placement.id }), prepared, placement);
    await refresh();
    setMessage("PDFATTACH kinnitati ja loeti IndexedDB-st tagasi.");
  }

  async function layerToggle(property: "visible" | "locked" | "frozen", value: boolean): Promise<void> {
    const live = liveRef.current!;
    const plan = planSetLayerToggle(live.document(DOCUMENT_ID), LAYER_ID, property, value);
    await live.commit(DOCUMENT_ID, operation(live, plan.commandId, plan.args), plan.changes);
  }

  const first = readback?.placements[0];
  const layerVisible = first?.layer.rendered ?? false;

  return <main style={{ minHeight: "100vh", background: "#09121a", color: "#f7fbff", padding: 24, fontFamily: "system-ui, sans-serif" }}>
    <h1>F-115 PDF underlay</h1>
    {!ready && <p>{message}</p>}
    {ready && !first && <PdfUnderlayAttachPanel attachmentId="f115-pdf-v1" placementId="f115-underlay" currentLayerId={LAYER_ID} onAttach={attach} />}
    {ready && first && <>
      <section aria-label="PDF underlay controls" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <button onClick={() => void run(() => workspaceRef.current!.update(first.placement.id, { fadePercent: 40 }), "Fade 40% salvestatud.")}>Fade 40%</button>
        <button onClick={() => void run(() => workspaceRef.current!.update(first.placement.id, { clipBoundary: null }), "Clip eemaldatud.")}>Eemalda clip</button>
        <button onClick={() => void run(() => workspaceRef.current!.undo(), "Undo kinnitatud.")}>Undo</button>
        <button onClick={() => void run(() => workspaceRef.current!.redo(), "Redo kinnitatud.")}>Redo</button>
        <button onClick={() => void run(() => layerToggle("locked", true), "PDF kiht lukustatud.")}>Lukusta kiht</button>
        <button onClick={() => void run(() => workspaceRef.current!.update(first.placement.id, { opacity: 0.2 }), "Opacity muudetud.")}>Muuda lukus</button>
        <button onClick={() => void run(() => layerToggle("locked", false), "PDF kiht avatud.")}>Ava kiht</button>
        <button onClick={() => void run(() => layerToggle("visible", false), "PDF kiht välja lülitatud.")}>Kiht off</button>
        <button onClick={() => void run(() => layerToggle("visible", true), "PDF kiht sisse lülitatud.")}>Kiht on</button>
        <button onClick={() => void run(() => layerToggle("frozen", true), "PDF kiht külmutatud.")}>Freeze</button>
        <button onClick={() => void run(() => layerToggle("frozen", false), "PDF kiht sulatatud.")}>Thaw</button>
      </section>
      <section data-testid="pdf-canvas" data-layer-rendered={layerVisible} style={{ position: "relative", width: 900, height: 620, overflow: "hidden", background: "#203142", border: "1px solid #6b879d" }}>
        {sourceUrl && <PdfUnderlayView sourceUrl={sourceUrl} placement={first.placement} pixelsPerMm={2} layerVisible={layerVisible} />}
        <svg aria-label="Editable CAD geometry" width="900" height="620" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}><path d="M20 580 L850 30" stroke="#ff4b4b" strokeWidth="3" fill="none" /></svg>
      </section>
    </>}
    <p role="status" data-testid="harness-status">{message}</p>
    <pre data-testid="pdf-readback" style={{ whiteSpace: "pre-wrap", background: "#101a24", padding: 12 }}>{JSON.stringify(readback, null, 2)}</pre>
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new TypeError("F-115 visible harness root is missing.");
createRoot(root).render(<Harness />);
