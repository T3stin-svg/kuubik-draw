import { useEffect, useMemo, useRef, useState } from "react";
import { CadSession, createEmptyDocument } from "@kuubik/cad-core";
import { CadCanvasRenderer } from "@kuubik/cad-renderer";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { KDrawIndexedDb, StorageRevisionConflictError } from "./indexed-db.js";
import "./style.css";

const LOCAL_DOCUMENT_ID = "local";

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const database = useMemo(() => new KDrawIndexedDb(), []);
  const session = useRef(new CadSession(createEmptyDocument({ documentId: LOCAL_DOCUMENT_ID })));
  const committing = useRef(false);
  const [document, setDocument] = useState<KDrawDocumentV1>(session.current.document);
  const [status, setStatus] = useState("Uus kohalik dokument");

  useEffect(() => {
    let active = true;
    void (async () => {
      await database.open();
      const stored = await database.loadDocument(LOCAL_DOCUMENT_ID);
      if (!active || !stored) return;
      const operations = await database.operations(LOCAL_DOCUMENT_ID);
      if (!active) return;
      session.current = new CadSession(stored, operations.map((entry) => entry.opId));
      setDocument(session.current.document);
      setStatus(`Taastatud revision ${stored.revision}`);
    })();
    return () => {
      active = false;
      database.close();
    };
  }, [database]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(element.clientWidth * ratio);
    element.height = Math.round(element.clientHeight * ratio);
    const renderer = new CadCanvasRenderer();
    renderer.setEntities(document.entities);
    renderer.render(context, {
      world: { minX: -10, minY: -10, maxX: 220, maxY: 160 },
      widthPx: element.clientWidth,
      heightPx: element.clientHeight,
      devicePixelRatio: ratio,
    }, document.layers);
  }, [document]);

  async function addSyntheticLine(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
    const handle = (document.revision + 16).toString(16).toUpperCase();
    const operation = {
      opId: crypto.randomUUID(),
      baseRevision: document.revision,
      commandId: "LINE",
      args: { start: { x: 10, y: 10 + document.revision * 5 }, end: { x: 180, y: 90 } },
      targetHandles: [],
      resultHandles: [handle],
    };
    const candidate = new CadSession(document, (await database.operations(document.documentId)).map((entry) => entry.opId));
    candidate.commit(operation, [{
      type: "put",
      entity: { kind: "line", handle, layerId: "0", start: operation.args.start, end: operation.args.end },
    }]);
    const next = candidate.document;
    await database.commitRevision(next, operation);
    session.current = candidate;
    setDocument(next);
    setStatus(`LINE salvestatud, revision ${next.revision}`);
    } catch (error) {
      if (!(error instanceof StorageRevisionConflictError)) throw error;
      const stored = await database.loadDocument(document.documentId);
      if (stored) {
        const operations = await database.operations(stored.documentId);
        session.current = new CadSession(stored, operations.map((entry) => entry.opId));
        setDocument(stored);
        setStatus(`Teine vaheleht muutis dokumenti; taastatud revision ${stored.revision}`);
      }
    } finally {
      committing.current = false;
    }
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <strong>Kuubik Draw</strong>
        <span>GPL 2D CAD · eksperimentaalne</span>
      </header>
      <section className="ribbon" aria-label="Joonestustööriistad">
        <button type="button" onClick={() => void addSyntheticLine()}>LINE test</button>
        <button type="button" disabled>TRIM järgmine</button>
        <span>{document.entities.length} objekti</span>
      </section>
      <section className="drawing-area">
        <canvas ref={canvas} aria-label="Kuubik Draw joonestusala" />
      </section>
      <footer className="statusbar">
        <span>{status}</span>
        <span>MODEL · mm · SNAP</span>
      </footer>
    </main>
  );
}
