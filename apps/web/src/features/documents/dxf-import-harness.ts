import { createEmptyDocument } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { importDxfIntoLiveDocument } from "./dxf-import-transaction.js";

const DATABASE_NAME = "kuubik-f110-browser";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked."));
  });
}

function sourceBytes(): Uint8Array {
  const source = createEmptyDocument({ documentId: "source", units: "cm" });
  source.blocks.push({ id: "symbol", name: "SYMBOL", basePoint: { x: 0, y: 0 }, entities: [{ kind: "circle", handle: "C0", layerId: "0", center: { x: 1, y: 1 }, radius: 1 }] });
  source.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } },
    { kind: "blockRef", handle: "20", layerId: "0", blockId: "symbol", insertion: { x: 20, y: 10 }, scale: { x: 2, y: 1 }, rotationRad: 0.25 },
  );
  return exportDxf(source).bytes;
}

export async function runF110DxfImportHarness(): Promise<Record<string, unknown>> {
  await deleteDatabase(DATABASE_NAME);
  const database = new KDrawIndexedDb(indexedDB, DATABASE_NAME);
  const target = createEmptyDocument({ documentId: "browser-drawing", units: "mm" });
  target.entities.push({ kind: "line", handle: "OLD", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
  const live = new DocumentLiveOrchestrator(database, "f110-browser-crashed");
  await live.open({ documentId: target.documentId, fallbackDocument: target });
  const imported = await importDxfIntoLiveDocument(live, {
    documentId: target.documentId,
    bytes: sourceBytes(),
    operationId: "f110-browser-dxfin",
    fileName: "browser-source.dxf",
    now: "2026-08-31T22:00:00.000Z",
  });
  const undone = await live.undo(target.documentId, "2026-08-31T22:00:01.000Z");
  const redone = await live.redo(target.documentId, "2026-08-31T22:00:02.000Z");
  if (!undone || !redone) throw new Error("F-110 Undo/Redo did not commit.");
  const recoveredLive = new DocumentLiveOrchestrator(database, "f110-browser-recovered");
  const recovered = await recoveredLive.open({ documentId: target.documentId });
  const operations = await database.operations(target.documentId);
  const result = {
    status: "passed",
    importRevision: imported.document.revision,
    undoRevision: undone.revision,
    redoRevision: redone.revision,
    recoveredRevision: recovered.document.revision,
    sourceUnits: imported.readback.sourceUnits,
    targetUnits: imported.readback.targetUnits,
    insertionScale: imported.readback.insertionScale,
    handles: [...recovered.document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle)), ...recovered.document.entities.map((entity) => entity.handle)],
    operationCommands: operations.map((item) => item.operation.commandId),
    recoverySource: recovered.recovery.source,
    uncleanSessionIds: recovered.recovery.uncleanSessionIds,
  };
  database.close();
  return result;
}

declare global {
  interface Window { runF110DxfImportHarness?: typeof runF110DxfImportHarness; }
}
if (typeof window !== "undefined") window.runF110DxfImportHarness = runF110DxfImportHarness;

const status = document.querySelector<HTMLElement>("[data-status]");
const output = document.querySelector<HTMLElement>("[data-output]");
if (status && output) {
  runF110DxfImportHarness().then((result) => {
    status.textContent = result.status === "passed" ? "läbitud" : "ebaõnnestus";
    output.textContent = JSON.stringify(result, null, 2);
  }).catch((error) => {
    status.textContent = "ebaõnnestus";
    output.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  });
}
