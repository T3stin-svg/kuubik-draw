import { useEffect, useMemo, useRef, useState } from "react";
import { CadCommandInputError, CadSession, createEmptyDocument, parseCartesianPoint, resolveCadCommand, type EntityChange } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
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
  const [firstCornerInput, setFirstCornerInput] = useState("100,200");
  const [otherCornerInput, setOtherCornerInput] = useState("600,900");

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
      world: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
      widthPx: element.clientWidth,
      heightPx: element.clientHeight,
      devicePixelRatio: ratio,
    }, document.layers);
  }, [document]);

  async function recoverFromStorageConflict(error: unknown): Promise<void> {
    if (!(error instanceof StorageRevisionConflictError)) throw error;
    const stored = await database.loadDocument(document.documentId);
    if (!stored) return;
    const operations = await database.operations(stored.documentId);
    session.current = new CadSession(stored, operations.map((entry) => entry.opId));
    setDocument(stored);
    setStatus(`Teine vaheleht muutis dokumenti; taastatud revision ${stored.revision}`);
  }

  async function addSyntheticLine(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const handle = (document.revision + 16).toString(16).toUpperCase();
      const args = { start: { x: 10, y: 10 + document.revision * 5 }, end: { x: 180, y: 90 } };
      await commitChanges("LINE", args, [{
        type: "put",
        entity: { kind: "line", handle, layerId: "0", start: args.start, end: args.end },
      }], [handle]);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function commitChanges(commandId: string, args: unknown, changes: EntityChange[], resultHandles: string[]): Promise<void> {
    const operation = {
      opId: crypto.randomUUID(),
      baseRevision: document.revision,
      commandId,
      args,
      targetHandles: [],
      resultHandles,
    };
    const candidate = new CadSession(document, (await database.operations(document.documentId)).map((entry) => entry.opId));
    candidate.commit(operation, changes);
    const next = candidate.document;
    await database.commitRevision(next, operation);
    session.current = candidate;
    setDocument(next);
    setStatus(`${commandId} salvestatud, revision ${next.revision}`);
  }

  async function addRectangle(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const command = resolveCadCommand("RECTANG");
      if (!command) throw new Error("RECTANGLE command is missing from the registry.");
      const handle = (document.revision + 16).toString(16).toUpperCase();
      const args = {
        handle,
        layerId: document.currentLayerId,
        firstCorner: parseCartesianPoint(firstCornerInput),
        otherCorner: parseCartesianPoint(otherCornerInput),
      };
      await commitChanges(command.id, args, command.execute(args), [handle]);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) {
        await recoverFromStorageConflict(error);
      } else if (error instanceof CadCommandInputError) {
        setStatus(`RECTANGLE viga: ${error.message}`);
      } else {
        throw error;
      }
    } finally {
      committing.current = false;
    }
  }

  function downloadDxf(): void {
    const exported = exportDxf(document);
    if (exported.report.skipped.length) {
      setStatus(`DXF peatatud: ${exported.report.skipped.length} toetamata objekti`);
      return;
    }
    const url = URL.createObjectURL(new Blob([exported.text], { type: "application/dxf" }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.documentId}-r${document.revision}.dxf`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`DXF eksporditud: ${exported.report.emittedHandles.length} objekti`);
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <strong>Kuubik Draw</strong>
        <span>GPL 2D CAD · eksperimentaalne</span>
      </header>
      <section className="ribbon" aria-label="Joonestustööriistad">
        <button type="button" onClick={() => void addSyntheticLine()}>LINE test</button>
        <label className="coordinate-input">
          <span>Esimene nurk</span>
          <input aria-label="Esimene nurk" value={firstCornerInput} onChange={(event) => setFirstCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>Teine nurk</span>
          <input aria-label="Teine nurk" value={otherCornerInput} onChange={(event) => setOtherCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <button type="button" onClick={() => void addRectangle()}>RECTANGLE</button>
        <button type="button" onClick={downloadDxf} disabled={document.entities.length === 0}>DXF eksport</button>
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
