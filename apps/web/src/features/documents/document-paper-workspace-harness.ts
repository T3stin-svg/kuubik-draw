import { DEFAULT_PAGE_SETUP, createEmptyDocument } from "@kuubik/cad-core";
import type { CadPageSetup } from "@kuubik/cad-schema";
import { KDrawIndexedDb, type RecoveryReceipt } from "../../indexed-db.js";
import { DocumentLayoutWorkspace } from "./document-layout-workspace.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentPaperWorkspace, type DocumentPaperWorkspaceReadback } from "./document-paper-workspace.js";

const DEFAULT_DATABASE_NAME = "kuubik-draw-document-paper-workspace";

export interface DocumentPaperWorkspaceSeedResult {
  phase: "seed";
  ok: true;
  alphaBeforeCrash: DocumentPaperWorkspaceReadback;
  betaBeforeCrash: DocumentPaperWorkspaceReadback;
  operationCounts: { alpha: number; beta: number };
}

export interface DocumentPaperWorkspaceRecoveryResult {
  phase: "recover";
  ok: true;
  alphaAfterReload: DocumentPaperWorkspaceReadback;
  betaAfterReload: DocumentPaperWorkspaceReadback;
  afterUndo: DocumentPaperWorkspaceReadback;
  afterRedo: DocumentPaperWorkspaceReadback;
  alphaRecovery: RecoveryReceipt;
  betaRecovery: RecoveryReceipt;
  operationCounts: { alpha: number; beta: number };
  migrationIdempotent: true;
  multiDocumentIsolated: true;
}

export interface DocumentPaperWorkspaceVerifyResult {
  phase: "verify";
  ok: true;
  alpha: DocumentPaperWorkspaceReadback;
  beta: DocumentPaperWorkspaceReadback;
  operationCounts: { alpha: number; beta: number };
  migrationIdempotent: true;
}

async function deleteDatabase(factory: IDBFactory, databaseName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked by an open connection."));
  });
}

async function openPair(factory: IDBFactory, databaseName: string, sessionId: string, fallback: boolean) {
  const database = new KDrawIndexedDb(factory, databaseName);
  const live = new DocumentLiveOrchestrator(database, sessionId);
  const alphaOpen = await live.open({
    documentId: "alpha",
    ...(fallback ? { fallbackDocument: createEmptyDocument({ documentId: "alpha" }) } : {}),
    paperWorkspace: "migrate",
  });
  const betaOpen = await live.open({
    documentId: "beta",
    ...(fallback ? { fallbackDocument: createEmptyDocument({ documentId: "beta" }) } : {}),
    paperWorkspace: "migrate",
  });
  return {
    database,
    live,
    alphaOpen,
    betaOpen,
    alphaPaper: new DocumentPaperWorkspace(live, "alpha", sessionId),
    betaPaper: new DocumentPaperWorkspace(live, "beta", sessionId),
    alphaLayouts: new DocumentLayoutWorkspace(live, "alpha", `${sessionId}-layout`),
  };
}

export async function seedDocumentPaperWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentPaperWorkspaceSeedResult> {
  await deleteDatabase(factory, databaseName);
  const opened = await openPair(factory, databaseName, "paper-workspace-crashed", true);
  const a3Portrait: CadPageSetup = { ...structuredClone(DEFAULT_PAGE_SETUP), mediaName: "ISO_A3", orientation: "portrait" };
  const a4Portrait: CadPageSetup = { ...structuredClone(DEFAULT_PAGE_SETUP), mediaName: "ISO_A4", orientation: "portrait" };
  await opened.alphaPaper.setPageSetup("layout-1", a3Portrait);
  await opened.alphaPaper.switchLayout("layout-1");
  await opened.alphaLayouts.createLayout({ name: "SECOND" });
  await opened.alphaPaper.setPageSetup("layout-2", a4Portrait);
  await opened.alphaPaper.switchLayout("model");
  await opened.alphaPaper.switchLayout("layout-2");
  await opened.betaPaper.switchLayout("layout-1");
  const alphaBeforeCrash = opened.alphaPaper.readBack();
  const betaBeforeCrash = opened.betaPaper.readBack();
  const operationCounts = {
    alpha: (await opened.database.operations("alpha")).length,
    beta: (await opened.database.operations("beta")).length,
  };
  opened.database.close();
  return { phase: "seed", ok: true, alphaBeforeCrash, betaBeforeCrash, operationCounts };
}

export async function recoverDocumentPaperWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentPaperWorkspaceRecoveryResult> {
  const opened = await openPair(factory, databaseName, "paper-workspace-reloaded", false);
  if (opened.alphaOpen.layoutWorkspace?.migrated || opened.betaOpen.layoutWorkspace?.migrated
    || opened.alphaOpen.paperWorkspace?.migrated || opened.betaOpen.paperWorkspace?.migrated) {
    throw new TypeError("Already migrated paper workspace changed during reload.");
  }
  const alphaAfterReload = opened.alphaPaper.readBack();
  const betaAfterReload = opened.betaPaper.readBack();
  const betaStable = JSON.stringify(betaAfterReload);
  const afterUndo = await opened.alphaPaper.undo();
  const afterRedo = await opened.alphaPaper.redo();
  if (JSON.stringify(opened.betaPaper.readBack()) !== betaStable) {
    throw new TypeError("Alpha paper Undo/Redo changed beta document state.");
  }
  const operationCounts = {
    alpha: (await opened.database.operations("alpha")).length,
    beta: (await opened.database.operations("beta")).length,
  };
  await opened.live.close("alpha");
  await opened.live.close("beta");
  opened.database.close();
  return {
    phase: "recover",
    ok: true,
    alphaAfterReload,
    betaAfterReload,
    afterUndo,
    afterRedo,
    alphaRecovery: opened.alphaOpen.recovery.receipt,
    betaRecovery: opened.betaOpen.recovery.receipt,
    operationCounts,
    migrationIdempotent: true,
    multiDocumentIsolated: true,
  };
}

export async function verifyDocumentPaperWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentPaperWorkspaceVerifyResult> {
  const opened = await openPair(factory, databaseName, "paper-workspace-verified", false);
  if (opened.alphaOpen.paperWorkspace?.migrated || opened.betaOpen.paperWorkspace?.migrated) {
    throw new TypeError("Paper workspace migration was not idempotent on the second reload.");
  }
  const alpha = opened.alphaPaper.readBack();
  const beta = opened.betaPaper.readBack();
  const operationCounts = {
    alpha: (await opened.database.operations("alpha")).length,
    beta: (await opened.database.operations("beta")).length,
  };
  await opened.live.close("alpha");
  await opened.live.close("beta");
  opened.database.close();
  return { phase: "verify", ok: true, alpha, beta, operationCounts, migrationIdempotent: true };
}

declare global {
  interface Window {
    __KUUBIK_DOCUMENT_PAPER_WORKSPACE_RESULT__?:
      | DocumentPaperWorkspaceSeedResult
      | DocumentPaperWorkspaceRecoveryResult
      | DocumentPaperWorkspaceVerifyResult;
  }
}
