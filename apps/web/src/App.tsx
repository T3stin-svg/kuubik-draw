import { useEffect, useMemo, useRef, useState } from "react";
import { CadCommandInputError, CadSession, createEmptyDocument, parseCartesianPoint, parseMoveDestination, resolveCadCommand, type CadChange } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
import { CadCanvasRenderer } from "@kuubik/cad-renderer";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
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
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [moveBaseInput, setMoveBaseInput] = useState("100,200");
  const [moveDestinationInput, setMoveDestinationInput] = useState("600,950");
  const [moveAwaitingSelection, setMoveAwaitingSelection] = useState(false);
  const activeLayer = document.layers.find((layer) => layer.id === document.currentLayerId)!;
  const movePreview = useMemo((): { entities: CadEntity[]; delta: { x: number; y: number } } | null => {
    if (selectedHandles.length === 0) return null;
    try {
      const command = resolveCadCommand("MOVE");
      if (!command || command.id !== "MOVE") return null;
      const basePoint = parseCartesianPoint(moveBaseInput);
      const destinationPoint = parseMoveDestination(moveDestinationInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoint });
      return {
        entities: result.changes.flatMap((change) => change.type === "put" ? [change.entity] : []),
        delta: result.delta,
      };
    } catch {
      return null;
    }
  }, [document, moveBaseInput, moveDestinationInput, selectedHandles]);

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
    renderer.setBlocks(document.blocks);
    renderer.setEntities(document.entities);
    renderer.render(context, {
      world: { minX: -500, minY: -500, maxX: 2500, maxY: 2500 },
      widthPx: element.clientWidth,
      heightPx: element.clientHeight,
      devicePixelRatio: ratio,
    }, document.layers, movePreview?.entities ?? null);
  }, [document, movePreview]);

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
        entity: { kind: "line", handle, layerId: document.currentLayerId, start: args.start, end: args.end },
      }], [handle]);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function commitChanges(
    commandId: string,
    args: unknown,
    changes: CadChange[],
    resultHandles: string[],
    targetHandles: string[] = [],
  ): Promise<void> {
    const operation = {
      opId: crypto.randomUUID(),
      baseRevision: document.revision,
      commandId,
      args,
      targetHandles,
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
      if (!command || command.id !== "RECTANGLE") throw new Error("RECTANGLE command is missing from the registry.");
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

  function selectAll(): void {
    const handles = document.entities.map((entity) => entity.handle);
    setSelectedHandles(handles);
    setStatus(moveAwaitingSelection ? `${handles.length} objekti valitud; MOVE: määra baaspunkt ja sihtpunkt` : `${handles.length} objekti valitud`);
  }

  async function moveSelected(): Promise<void> {
    if (committing.current) return;
    if (selectedHandles.length === 0) {
      setMoveAwaitingSelection(true);
      setStatus("MOVE: vali objektid, seejärel kinnita valik ja punktid");
      return;
    }
    committing.current = true;
    try {
      const command = resolveCadCommand("MOVE");
      if (!command || command.id !== "MOVE") throw new Error("MOVE command is missing from the registry.");
      const basePoint = parseCartesianPoint(moveBaseInput);
      const destinationPoint = parseMoveDestination(moveDestinationInput, basePoint);
      const result = command.execute(document, { targetHandles: selectedHandles, basePoint, destinationPoint });
      setMoveAwaitingSelection(false);
      if (result.changes.length === 0) {
        const suffix = result.rejected.length ? `; ${result.rejected.length} lukus, puudu või toetamata` : "";
        setStatus(`MOVE ei muutnud geomeetriat${suffix}`);
        return;
      }
      await commitChanges(command.id, { basePoint, destinationPoint }, result.changes, result.movedHandles, result.movedHandles);
      setSelectedHandles([]);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.movedHandles.length} objekti nihutatud Δ${result.delta.x},${result.delta.y}${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else if (error instanceof CadCommandInputError) setStatus(`MOVE viga: ${error.message}`);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function eraseSelected(): Promise<void> {
    if (committing.current || selectedHandles.length === 0) return;
    committing.current = true;
    try {
      const command = resolveCadCommand("ERASE");
      if (!command || command.id !== "ERASE") throw new Error("ERASE command is missing from the registry.");
      const result = command.execute(document, { targetHandles: selectedHandles });
      setSelectedHandles([]);
      if (result.changes.length === 0) {
        setStatus(`Midagi ei kustutatud (${result.rejected.length} lukus või puudu)`);
        return;
      }
      await commitChanges(command.id, { targetHandles: selectedHandles }, result.changes, [], result.erasedHandles);
      const suffix = result.rejected.length ? `; ${result.rejected.length} jäi muutmata` : "";
      setStatus(`${result.erasedHandles.length} objekti kustutatud${suffix}`);
    } catch (error) {
      if (error instanceof StorageRevisionConflictError) await recoverFromStorageConflict(error);
      else throw error;
    } finally {
      committing.current = false;
    }
  }

  async function undoLast(): Promise<void> {
    if (committing.current || !session.current.canUndo) return;
    committing.current = true;
    try {
      const committed = session.current.undo();
      if (!committed) return;
      const next = session.current.document;
      await database.commitRevision(next, committed.operation);
      setDocument(next);
      setSelectedHandles([]);
      setStatus(`UNDO taastatud, revision ${next.revision}`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function createLayer(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      let sequence = document.layers.length;
      while (document.layers.some((layer) => layer.id === `layer-${sequence}`)) sequence += 1;
      const layer = {
        id: `layer-${sequence}`,
        name: `Layer ${sequence}`,
        visible: true,
        frozen: false,
        locked: false,
        plottable: true,
      };
      await commitChanges("LAYER_NEW", { layerId: layer.id }, [
        { type: "put-layer", layer },
        { type: "set-current-layer", layerId: layer.id },
      ], []);
      setStatus(`${layer.name} loodud ja aktiivne`);
    } catch (error) {
      await recoverFromStorageConflict(error);
    } finally {
      committing.current = false;
    }
  }

  async function toggleActiveLayerLock(): Promise<void> {
    if (committing.current) return;
    committing.current = true;
    try {
      const next = { ...activeLayer, locked: !activeLayer.locked };
      await commitChanges("LAYER_LOCK", { layerId: next.id, locked: next.locked }, [{ type: "put-layer", layer: next }], []);
      setStatus(`${next.name} ${next.locked ? "lukustatud" : "avatud"}`);
    } catch (error) {
      await recoverFromStorageConflict(error);
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
        <button type="button" onClick={() => void addSyntheticLine()} disabled={activeLayer.locked}>LINE test</button>
        <label className="coordinate-input">
          <span>Esimene nurk</span>
          <input aria-label="Esimene nurk" value={firstCornerInput} onChange={(event) => setFirstCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>Teine nurk</span>
          <input aria-label="Teine nurk" value={otherCornerInput} onChange={(event) => setOtherCornerInput(event.target.value)} placeholder="x,y" />
        </label>
        <button type="button" onClick={() => void addRectangle()} disabled={activeLayer.locked}>RECTANGLE</button>
        <button type="button" onClick={() => void createLayer()}>Uus kiht</button>
        <button type="button" onClick={() => void toggleActiveLayerLock()}>{activeLayer.locked ? "Ava aktiivne" : "Lukusta aktiivne"}</button>
        <button type="button" onClick={selectAll} disabled={document.entities.length === 0}>Vali kõik</button>
        <label className="coordinate-input">
          <span>MOVE baaspunkt</span>
          <input aria-label="MOVE baaspunkt" value={moveBaseInput} onChange={(event) => setMoveBaseInput(event.target.value)} placeholder="x,y" />
        </label>
        <label className="coordinate-input">
          <span>MOVE sihtpunkt</span>
          <input aria-label="MOVE sihtpunkt" value={moveDestinationInput} onChange={(event) => setMoveDestinationInput(event.target.value)} placeholder="x,y või @dx,dy" />
        </label>
        <button type="button" onClick={() => void moveSelected()}>MOVE</button>
        <button type="button" onClick={() => void eraseSelected()} disabled={selectedHandles.length === 0}>ERASE</button>
        <button type="button" onClick={() => void undoLast()} disabled={!session.current.canUndo}>UNDO</button>
        <button type="button" onClick={downloadDxf}>DXF eksport</button>
        <button type="button" disabled>TRIM järgmine</button>
        <span>{document.entities.length} objekti · {selectedHandles.length} valitud · {activeLayer.name}{activeLayer.locked ? " 🔒" : ""}</span>
        {movePreview && <span data-testid="move-preview">MOVE eelvaade: {movePreview.entities.length} · Δ{movePreview.delta.x},{movePreview.delta.y}</span>}
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
