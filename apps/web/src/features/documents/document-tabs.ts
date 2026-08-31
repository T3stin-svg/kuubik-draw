import { assertKDrawDocumentV1, type KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface DocumentTab {
  documentId: string;
  label: string;
  sourceFileName: string | null;
  document: KDrawDocumentV1;
  activeLayoutId: string;
  persistedRevision: number;
}

export interface DocumentTabsState {
  tabs: DocumentTab[];
  activeDocumentId: string | null;
}

export interface DocumentTabsReadback {
  activeDocumentId: string | null;
  tabOrder: string[];
  tabs: Array<{
    documentId: string;
    label: string;
    revision: number;
    persistedRevision: number;
    dirty: boolean;
    activeLayoutId: string;
  }>;
}

export interface CloseDocumentTabResult {
  state: DocumentTabsState;
  closed: boolean;
  requiresDiscardConfirmation: boolean;
}

function cloneTab(tab: DocumentTab): DocumentTab {
  return structuredClone(tab);
}

function documentTitle(document: KDrawDocumentV1, sourceFileName: string | null): string {
  const fileLeaf = sourceFileName?.replaceAll("\\", "/").split("/").at(-1)?.trim();
  return fileLeaf || document.metadata.title?.trim() || `${document.documentId}.kdraw`;
}

function uniqueLabel(base: string, tabs: readonly DocumentTab[], documentId: string): string {
  const used = new Set(tabs.filter((tab) => tab.documentId !== documentId).map((tab) => tab.label.toLocaleUpperCase("en-US")));
  if (!used.has(base.toLocaleUpperCase("en-US"))) return base;
  let suffix = 2;
  while (used.has(`${base} (${suffix})`.toLocaleUpperCase("en-US"))) suffix += 1;
  return `${base} (${suffix})`;
}

function assertLayout(document: KDrawDocumentV1, activeLayoutId: string): void {
  if (!document.layouts.some((layout) => layout.id === activeLayoutId)) throw new RangeError(`Document ${document.documentId} has no layout ${activeLayoutId}.`);
}

function normalized(state: DocumentTabsState): DocumentTabsState {
  const documentIds = state.tabs.map((tab) => tab.documentId);
  if (new Set(documentIds).size !== documentIds.length) throw new TypeError("Document tabs require unique document ids.");
  for (const tab of state.tabs) {
    assertKDrawDocumentV1(tab.document);
    if (tab.document.documentId !== tab.documentId) throw new TypeError(`Document tab ${tab.documentId} contains document ${tab.document.documentId}.`);
    assertLayout(tab.document, tab.activeLayoutId);
    if (!Number.isSafeInteger(tab.persistedRevision) || tab.persistedRevision < 0 || tab.persistedRevision > tab.document.revision) {
      throw new RangeError(`Document tab ${tab.documentId} has invalid persisted revision ${tab.persistedRevision}.`);
    }
  }
  if (state.activeDocumentId !== null && !documentIds.includes(state.activeDocumentId)) throw new RangeError(`Active document ${state.activeDocumentId} is not open.`);
  if (state.tabs.length > 0 && state.activeDocumentId === null) throw new TypeError("A non-empty document tab set requires an active document.");
  if (state.tabs.length === 0 && state.activeDocumentId !== null) throw new TypeError("An empty document tab set cannot have an active document.");
  return { tabs: state.tabs.map(cloneTab), activeDocumentId: state.activeDocumentId };
}

export function createDocumentTabsState(): DocumentTabsState {
  return { tabs: [], activeDocumentId: null };
}

export function openDocumentTab(state: DocumentTabsState, input: {
  document: KDrawDocumentV1;
  sourceFileName?: string | null;
  activeLayoutId?: string;
  persistedRevision?: number;
}): DocumentTabsState {
  const current = normalized(state);
  assertKDrawDocumentV1(input.document);
  const existing = current.tabs.find((tab) => tab.documentId === input.document.documentId);
  if (existing) return { tabs: current.tabs, activeDocumentId: existing.documentId };
  const activeLayoutId = input.activeLayoutId ?? "model";
  assertLayout(input.document, activeLayoutId);
  const sourceFileName = input.sourceFileName?.trim() || null;
  const label = uniqueLabel(documentTitle(input.document, sourceFileName), current.tabs, input.document.documentId);
  const tab: DocumentTab = {
    documentId: input.document.documentId,
    label,
    sourceFileName,
    document: structuredClone(input.document),
    activeLayoutId,
    persistedRevision: input.persistedRevision ?? input.document.revision,
  };
  return normalized({ tabs: [...current.tabs, tab], activeDocumentId: tab.documentId });
}

export function activateDocumentTab(state: DocumentTabsState, documentId: string): DocumentTabsState {
  const current = normalized(state);
  if (!current.tabs.some((tab) => tab.documentId === documentId)) throw new RangeError(`Cannot activate unopened document ${documentId}.`);
  return { tabs: current.tabs, activeDocumentId: documentId };
}

export function updateDocumentTab(state: DocumentTabsState, input: {
  document: KDrawDocumentV1;
  activeLayoutId?: string;
}): DocumentTabsState {
  const current = normalized(state);
  assertKDrawDocumentV1(input.document);
  const index = current.tabs.findIndex((tab) => tab.documentId === input.document.documentId);
  if (index < 0) throw new RangeError(`Cannot update unopened document ${input.document.documentId}.`);
  const previous = current.tabs[index]!;
  if (input.document.revision < previous.document.revision) throw new RangeError("Document tab revision cannot move backwards.");
  const activeLayoutId = input.activeLayoutId ?? previous.activeLayoutId;
  assertLayout(input.document, activeLayoutId);
  const tabs = current.tabs.map((tab, tabIndex) => tabIndex === index ? {
    ...tab,
    document: structuredClone(input.document),
    activeLayoutId,
  } : tab);
  return normalized({ tabs, activeDocumentId: current.activeDocumentId });
}

export function markDocumentTabPersisted(state: DocumentTabsState, documentId: string, revision: number): DocumentTabsState {
  const current = normalized(state);
  const tab = current.tabs.find((candidate) => candidate.documentId === documentId);
  if (!tab) throw new RangeError(`Cannot mark unopened document ${documentId} saved.`);
  if (revision !== tab.document.revision) throw new RangeError(`Persisted revision ${revision} does not match current revision ${tab.document.revision}.`);
  return normalized({
    tabs: current.tabs.map((candidate) => candidate.documentId === documentId ? { ...candidate, persistedRevision: revision } : candidate),
    activeDocumentId: current.activeDocumentId,
  });
}

export function setDocumentTabLayout(state: DocumentTabsState, documentId: string, activeLayoutId: string): DocumentTabsState {
  const current = normalized(state);
  const tab = current.tabs.find((candidate) => candidate.documentId === documentId);
  if (!tab) throw new RangeError(`Cannot update unopened document ${documentId}.`);
  assertLayout(tab.document, activeLayoutId);
  return normalized({
    tabs: current.tabs.map((candidate) => candidate.documentId === documentId ? { ...candidate, activeLayoutId } : candidate),
    activeDocumentId: current.activeDocumentId,
  });
}

export function reorderDocumentTab(state: DocumentTabsState, documentId: string, targetIndex: number): DocumentTabsState {
  const current = normalized(state);
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= current.tabs.length) throw new RangeError(`Document tab target index ${targetIndex} is outside the open tab range.`);
  const sourceIndex = current.tabs.findIndex((tab) => tab.documentId === documentId);
  if (sourceIndex < 0) throw new RangeError(`Cannot reorder unopened document ${documentId}.`);
  const tabs = [...current.tabs];
  const [tab] = tabs.splice(sourceIndex, 1);
  tabs.splice(targetIndex, 0, tab!);
  return normalized({ tabs, activeDocumentId: current.activeDocumentId });
}

export function closeDocumentTab(state: DocumentTabsState, documentId: string, discardUnsaved = false): CloseDocumentTabResult {
  const current = normalized(state);
  const index = current.tabs.findIndex((tab) => tab.documentId === documentId);
  if (index < 0) throw new RangeError(`Cannot close unopened document ${documentId}.`);
  const tab = current.tabs[index]!;
  if (tab.document.revision !== tab.persistedRevision && !discardUnsaved) {
    return { state: current, closed: false, requiresDiscardConfirmation: true };
  }
  const tabs = current.tabs.filter((candidate) => candidate.documentId !== documentId);
  const activeDocumentId = current.activeDocumentId === documentId
    ? tabs[index]?.documentId ?? tabs[index - 1]?.documentId ?? null
    : current.activeDocumentId;
  return { state: normalized({ tabs, activeDocumentId }), closed: true, requiresDiscardConfirmation: false };
}

export function readBackDocumentTabs(state: DocumentTabsState): DocumentTabsReadback {
  const current = normalized(state);
  return {
    activeDocumentId: current.activeDocumentId,
    tabOrder: current.tabs.map((tab) => tab.documentId),
    tabs: current.tabs.map((tab) => ({
      documentId: tab.documentId,
      label: tab.label,
      revision: tab.document.revision,
      persistedRevision: tab.persistedRevision,
      dirty: tab.document.revision !== tab.persistedRevision,
      activeLayoutId: tab.activeLayoutId,
    })),
  };
}
