import { createEmptyDocument } from "@kuubik/cad-core";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator, type DocumentLiveReadback } from "./document-live-orchestrator.js";
import { DocumentWorkspaceShell, PgpAliasMapping, type AliasConflictReadback } from "./document-workspace-shell.js";

const DEFAULT_DATABASE_NAME = "kuubik-draw-document-workspace";
const COMMANDS = [
  { id: "LINE", aliases: ["L"] },
  { id: "CIRCLE", aliases: ["C"] },
  { id: "SCALE", aliases: ["SC"] },
  { id: "LAYOUT", aliases: ["LA"] },
  { id: "ZOOM", aliases: ["Z"] },
] as const;

export interface DocumentWorkspaceHarnessOptions {
  databaseName?: string;
  resetDatabase?: boolean;
}

export interface DocumentWorkspaceHarnessResult {
  ok: true;
  aliases: {
    canonicalText: string;
    sha256: string;
    byteLength: number;
    conflicts: AliasConflictReadback[];
    bitExactRoundtrip: true;
  };
  beforeCrash: DocumentLiveReadback;
  afterReload: DocumentLiveReadback;
  recovery: {
    alphaRevision: number;
    betaRevision: number;
    alphaNextUndo: string | null;
    betaNextUndo: string | null;
    uncleanSessionIds: string[];
  };
  undoRedo: {
    markerUndoRevision: number;
    markerUndoHandles: string[];
    commandUndoRevision: number;
    commandUndoHandles: string[];
    redoRevision: number;
    redoHandles: string[];
  };
  staleRevisionRejected: true;
  finalReadback: DocumentLiveReadback;
}

function document(documentId: string, handle: string) {
  const result = createEmptyDocument({ documentId, now: "2026-08-31T16:30:00.000Z" });
  result.metadata.title = `${documentId}.kdraw`;
  result.entities.push({ kind: "line" as const, handle, layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  return result;
}

async function deleteDatabase(factory: IDBFactory, databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked by an open connection."));
  });
}

function createWorkspace(factory: IDBFactory, databaseName: string, sessionId: string) {
  const database = new KDrawIndexedDb(factory, databaseName);
  const aliases = new PgpAliasMapping(COMMANDS);
  const shell = new DocumentWorkspaceShell(new DocumentLiveOrchestrator(database, sessionId), aliases);
  return { database, aliases, shell };
}

export async function runDocumentWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  options: DocumentWorkspaceHarnessOptions = {},
): Promise<DocumentWorkspaceHarnessResult> {
  const databaseName = options.databaseName?.trim() || DEFAULT_DATABASE_NAME;
  if (options.resetDatabase ?? true) await deleteDatabase(factory, databaseName);
  const crashed = createWorkspace(factory, databaseName, "workspace-crashed");
  const aliasImport = await crashed.aliases.importPgp("L, *LAYOUT\nZZ, *ZOOM\nZZ, *LINE\n");
  const aliasBytes = crashed.aliases.exportPgp();

  await crashed.shell.open({
    documentId: "alpha",
    fallbackDocument: document("alpha", "A0"),
    selectedHandles: ["A0"],
    viewport: { world: { minX: -10, minY: -20, maxX: 30, maxY: 40 }, widthPx: 800, heightPx: 600, devicePixelRatio: 1 },
    recordedAt: "2026-08-31T16:30:01.000Z",
  });
  await crashed.shell.open({
    documentId: "beta",
    fallbackDocument: document("beta", "B0"),
    selectedHandles: ["B0"],
    viewport: { world: { minX: 100, minY: 200, maxX: 500, maxY: 700 }, widthPx: 1200, heightPx: 900, devicePixelRatio: 2 },
    recordedAt: "2026-08-31T16:30:02.000Z",
  });
  await crashed.shell.commit("alpha", 0, "ZZ 0,0 10,0", [{ type: "put", entity: { kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 1 }, end: { x: 10, y: 1 } } }], "2026-08-31T16:30:03.000Z");
  await crashed.shell.markUndo("alpha", 1, "SC 1", "2026-08-31T16:30:04.000Z");
  await crashed.shell.commit("beta", 0, "C 5,5 2", [{ type: "put", entity: { kind: "circle", handle: "B1", layerId: "0", center: { x: 5, y: 5 }, radius: 2 } }], "2026-08-31T16:30:05.000Z");
  crashed.shell.activate("alpha");
  const beforeCrash = crashed.shell.readBack().live;
  crashed.database.close();

  const reloaded = createWorkspace(factory, databaseName, "workspace-reloaded");
  const reimported = await reloaded.aliases.importPgp(aliasBytes);
  const bitExactRoundtrip = new Uint8Array(reloaded.aliases.exportPgp()).every((value, index) => value === aliasBytes[index])
    && reloaded.aliases.exportPgp().byteLength === aliasBytes.byteLength;
  if (!bitExactRoundtrip || reimported.sha256 !== aliasImport.sha256) throw new TypeError("PGP alias export/import changed bytes.");
  const alphaRecovery = await reloaded.shell.open({ documentId: "alpha", recordedAt: "2026-08-31T16:31:00.000Z" });
  const betaRecovery = await reloaded.shell.open({ documentId: "beta", recordedAt: "2026-08-31T16:31:01.000Z" });
  const afterReload = reloaded.shell.readBack().live;
  const alphaSession = afterReload.sessions.documents.find((entry) => entry.documentId === "alpha")!;
  const betaSession = afterReload.sessions.documents.find((entry) => entry.documentId === "beta")!;

  const markerUndo = await reloaded.shell.undo("alpha", "2026-08-31T16:31:02.000Z");
  const commandUndo = await reloaded.shell.undo("alpha", "2026-08-31T16:31:03.000Z");
  const redone = await reloaded.shell.redo("alpha", "2026-08-31T16:31:04.000Z");
  if (!markerUndo || !commandUndo || !redone) throw new TypeError("Recovered Undo/Redo history was unavailable.");
  if (reloaded.shell.document("beta").revision !== 1) throw new TypeError("Alpha history changed beta revision.");
  const beforeStale = reloaded.shell.document("alpha");
  let staleRevisionRejected = false;
  try {
    await reloaded.shell.commit("alpha", 0, "ZZ 1,1 2,2", [{ type: "put", entity: { kind: "line", handle: "STALE", layerId: "0", start: { x: 1, y: 1 }, end: { x: 2, y: 2 } } }]);
  } catch (error) {
    staleRevisionRejected = error instanceof Error && /Revision conflict/u.test(error.message);
  }
  if (!staleRevisionRejected || JSON.stringify(beforeStale) !== JSON.stringify(reloaded.shell.document("alpha"))) {
    throw new TypeError("Stale revision did not fail atomically.");
  }
  const finalReadback = reloaded.shell.readBack().live;
  await reloaded.shell.live.close("alpha", "2026-08-31T16:32:00.000Z");
  await reloaded.shell.live.close("beta", "2026-08-31T16:32:01.000Z");
  reloaded.database.close();

  return {
    ok: true,
    aliases: {
      canonicalText: aliasImport.canonicalText,
      sha256: aliasImport.sha256,
      byteLength: aliasImport.byteLength,
      conflicts: aliasImport.conflicts,
      bitExactRoundtrip: true,
    },
    beforeCrash,
    afterReload,
    recovery: {
      alphaRevision: alphaRecovery.document.revision,
      betaRevision: betaRecovery.document.revision,
      alphaNextUndo: alphaSession.nextUndoCommandId,
      betaNextUndo: betaSession.nextUndoCommandId,
      uncleanSessionIds: alphaRecovery.recovery.uncleanSessionIds,
    },
    undoRedo: {
      markerUndoRevision: markerUndo.revision,
      markerUndoHandles: markerUndo.entities.map((entity) => entity.handle),
      commandUndoRevision: commandUndo.revision,
      commandUndoHandles: commandUndo.entities.map((entity) => entity.handle),
      redoRevision: redone.revision,
      redoHandles: redone.entities.map((entity) => entity.handle),
    },
    staleRevisionRejected: true,
    finalReadback,
  };
}

declare global {
  interface Window {
    runKuubikDocumentWorkspaceHarness?: typeof runDocumentWorkspaceHarness;
  }
}

if (typeof window !== "undefined") window.runKuubikDocumentWorkspaceHarness = runDocumentWorkspaceHarness;
