import { createEmptyDocument } from "@kuubik/cad-core";
import { KDrawIndexedDb, type RecoveryReceipt } from "../../indexed-db.js";
import { DocumentLayoutWorkspace, type DocumentLayoutWorkspaceReadback } from "./document-layout-workspace.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

const DEFAULT_DATABASE_NAME = "kuubik-draw-document-layout-workspace";

export interface DocumentLayoutWorkspaceSeedResult {
  phase: "seed";
  ok: true;
  alphaBeforeCrash: DocumentLayoutWorkspaceReadback;
  betaBeforeCrash: DocumentLayoutWorkspaceReadback;
  operationCounts: { alpha: number; beta: number };
}

export interface DocumentLayoutWorkspaceRecoveryResult {
  phase: "recover";
  ok: true;
  alphaAfterReload: DocumentLayoutWorkspaceReadback;
  betaAfterReload: DocumentLayoutWorkspaceReadback;
  afterUndo: DocumentLayoutWorkspaceReadback;
  afterRedo: DocumentLayoutWorkspaceReadback;
  alphaRecovery: RecoveryReceipt;
  betaRecovery: RecoveryReceipt;
  operationCounts: { alpha: number; beta: number };
  migrationIdempotent: true;
  multiDocumentIsolated: true;
}

export interface DocumentLayoutWorkspaceVerifyResult {
  phase: "verify";
  ok: true;
  alpha: DocumentLayoutWorkspaceReadback;
  beta: DocumentLayoutWorkspaceReadback;
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

function layoutNames(readback: DocumentLayoutWorkspaceReadback): string[] {
  return readback.layouts.map((layout) => layout.name);
}

function exactState(actual: DocumentLayoutWorkspaceReadback, expected: {
  revision: number;
  activeLayoutId: string;
  activeSpace: "model" | "paper";
  tabOrder?: string[];
  nextLayoutSequence?: number;
  nextViewportSequence?: number;
  layoutNames?: string[];
}): void {
  if (actual.revision !== expected.revision
    || actual.activeLayoutId !== expected.activeLayoutId
    || actual.activeSpace !== expected.activeSpace
    || (expected.tabOrder && JSON.stringify(actual.tabOrder) !== JSON.stringify(expected.tabOrder))
    || (expected.nextLayoutSequence !== undefined && actual.nextLayoutSequence !== expected.nextLayoutSequence)
    || (expected.nextViewportSequence !== undefined && actual.nextViewportSequence !== expected.nextViewportSequence)
    || (expected.layoutNames && JSON.stringify(layoutNames(actual)) !== JSON.stringify(expected.layoutNames))) {
    throw new TypeError(`Layout workspace read-back differs from expected state: ${JSON.stringify(actual)}`);
  }
}

async function openPair(factory: IDBFactory, databaseName: string, sessionId: string, fallback: boolean) {
  const database = new KDrawIndexedDb(factory, databaseName);
  const live = new DocumentLiveOrchestrator(database, sessionId);
  const alpha = await live.open({
    documentId: "alpha",
    ...(fallback ? { fallbackDocument: createEmptyDocument({ documentId: "alpha" }) } : {}),
    layoutWorkspace: "migrate",
  });
  const beta = await live.open({
    documentId: "beta",
    ...(fallback ? { fallbackDocument: createEmptyDocument({ documentId: "beta" }) } : {}),
    layoutWorkspace: "migrate",
  });
  return {
    database,
    live,
    alphaOpen: alpha,
    betaOpen: beta,
    alpha: new DocumentLayoutWorkspace(live, "alpha", sessionId),
    beta: new DocumentLayoutWorkspace(live, "beta", sessionId),
  };
}

export async function seedDocumentLayoutWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentLayoutWorkspaceSeedResult> {
  await deleteDatabase(factory, databaseName);
  const opened = await openPair(factory, databaseName, "layout-workspace-crashed", true);
  await opened.alpha.switchLayout("layout-1");
  await opened.alpha.createLayout({ name: "Issue A" });
  await opened.alpha.copyLayout("layout-2");
  await opened.alpha.renameLayout("layout-3", "Issue A Copy");
  await opened.alpha.createLayout({ name: "Temporary" });
  await opened.alpha.deleteLayout("layout-4");
  await opened.alpha.reorderLayout("layout-3", 1);
  await opened.alpha.switchLayout("model");
  await opened.alpha.switchLayout("layout-3");
  await opened.beta.switchLayout("layout-1");
  const alphaBeforeCrash = opened.alpha.readBack();
  const betaBeforeCrash = opened.beta.readBack();
  const operationCounts = {
    alpha: (await opened.database.operations("alpha")).length,
    beta: (await opened.database.operations("beta")).length,
  };
  opened.database.close();
  return { phase: "seed", ok: true, alphaBeforeCrash, betaBeforeCrash, operationCounts };
}

export async function recoverDocumentLayoutWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentLayoutWorkspaceRecoveryResult> {
  const opened = await openPair(factory, databaseName, "layout-workspace-reloaded", false);
  if (opened.alphaOpen.layoutWorkspace?.migrated || opened.betaOpen.layoutWorkspace?.migrated) {
    throw new TypeError("Already migrated layout workspace changed during reload.");
  }
  const alphaAfterReload = opened.alpha.readBack();
  const betaAfterReload = opened.beta.readBack();
  const betaStable = JSON.stringify(betaAfterReload);
  const afterUndo = await opened.alpha.undo();
  const afterRedo = await opened.alpha.redo();
  if (JSON.stringify(opened.beta.readBack()) !== betaStable) {
    throw new TypeError("Alpha Undo/Redo changed beta document state.");
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

export async function verifyDocumentLayoutWorkspaceHarness(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<DocumentLayoutWorkspaceVerifyResult> {
  const opened = await openPair(factory, databaseName, "layout-workspace-verified", false);
  if (opened.alphaOpen.layoutWorkspace?.migrated || opened.betaOpen.layoutWorkspace?.migrated) {
    throw new TypeError("Layout workspace migration was not idempotent on the second reload.");
  }
  const alpha = opened.alpha.readBack();
  const beta = opened.beta.readBack();
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
    __KUUBIK_DOCUMENT_LAYOUT_WORKSPACE_RESULT__?:
      | DocumentLayoutWorkspaceSeedResult
      | DocumentLayoutWorkspaceRecoveryResult
      | DocumentLayoutWorkspaceVerifyResult;
  }
}

export const documentLayoutWorkspaceHarnessAssertions = { exactState };
