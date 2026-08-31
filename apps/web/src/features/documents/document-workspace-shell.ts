import { RevisionConflictError, type CadChange } from "@kuubik/cad-core";
import type { Viewport2D } from "@kuubik/cad-renderer";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  DocumentLiveOrchestrator,
  type DocumentLiveReadback,
  type OpenLiveDocumentInput,
  type OpenLiveDocumentResult,
} from "./document-live-orchestrator.js";

const MAX_ALIAS_BYTES = 1024 * 1024;
const ALIAS_PATTERN = /^[A-Z0-9_$-]{1,32}$/u;

export type DocumentWorkspaceCapabilityStatus = "candidate";

export interface DocumentWorkspaceCapability {
  rows: readonly string[];
  status: DocumentWorkspaceCapabilityStatus;
  reason: string;
}

export const DOCUMENT_WORKSPACE_CAPABILITIES: Readonly<Record<string, DocumentWorkspaceCapability>> = Object.freeze({
  multiDocument: Object.freeze({ rows: ["F-128"], status: "candidate", reason: "DOM-independent tab/session isolation with real-Chromium IndexedDB read-back; visible App wiring and owned AutoCAD comparison remain open." }),
  undoRedo: Object.freeze({ rows: ["F-129"], status: "candidate", reason: "Per-document atomic history, undo marks and SHA-bound crash recovery are enabled; owned AutoCAD history comparison remains open." }),
  aliases: Object.freeze({ rows: ["F-130"], status: "candidate", reason: "PGP-like import/export and deterministic precedence are enabled; visible keyboard routing and owned AutoCAD PGP comparison remain open." }),
});

export interface AliasCommandDefinition {
  id: string;
  aliases?: readonly string[];
}

export interface AliasConflictReadback {
  alias: string;
  previousCommandId: string;
  incomingCommandId: string;
  previousSource: "built-in" | "imported";
  resolution: "incoming-wins";
  line: number;
}

export interface AliasResolution {
  requested: string;
  commandId: string;
  source: "canonical" | "imported" | "built-in";
}

export interface AliasImportReadback {
  mappingCount: number;
  conflicts: AliasConflictReadback[];
  canonicalText: string;
  byteLength: number;
  sha256: string;
}

export interface PgpAliasMappingReadback {
  canonicalCommands: string[];
  builtInAliases: Record<string, string>;
  importedAliases: Record<string, string>;
  canonicalText: string;
  byteLength: number;
}

function normalizeCommandName(value: string): string {
  return value.trim().replace(/^[_.]+/u, "").toLocaleUpperCase("en-US");
}

function assertAliasName(value: string, context: string): string {
  const alias = normalizeCommandName(value);
  if (!ALIAS_PATTERN.test(alias)) throw new TypeError(`${context} alias ${JSON.stringify(value)} must match ${ALIAS_PATTERN.source}.`);
  return alias;
}

function decodeAliasInput(input: string | Uint8Array): { text: string; byteLength: number } {
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    if (bytes.byteLength > MAX_ALIAS_BYTES) throw new RangeError(`Alias file exceeds ${MAX_ALIAS_BYTES} bytes.`);
    return { text: input, byteLength: bytes.byteLength };
  }
  if (input.byteLength > MAX_ALIAS_BYTES) throw new RangeError(`Alias file exceeds ${MAX_ALIAS_BYTES} bytes.`);
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(input), byteLength: input.byteLength };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sortedRecord(mapping: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...mapping.entries()].sort(([first], [second]) => first.localeCompare(second)));
}

export class PgpAliasMapping {
  readonly #canonical = new Set<string>();
  readonly #builtIn = new Map<string, string>();
  #imported = new Map<string, string>();

  constructor(definitions: readonly AliasCommandDefinition[]) {
    for (const definition of definitions) {
      const commandId = normalizeCommandName(definition.id);
      if (!ALIAS_PATTERN.test(commandId)) throw new TypeError(`Canonical command ${JSON.stringify(definition.id)} is invalid.`);
      if (this.#canonical.has(commandId)) throw new TypeError(`Canonical command ${commandId} is duplicated.`);
      this.#canonical.add(commandId);
    }
    for (const definition of definitions) {
      const commandId = normalizeCommandName(definition.id);
      for (const requested of definition.aliases ?? []) {
        const alias = assertAliasName(requested, "Built-in");
        if (this.#canonical.has(alias) && alias !== commandId) throw new TypeError(`Built-in alias ${alias} cannot replace canonical command ${alias}.`);
        const existing = this.#builtIn.get(alias);
        if (existing && existing !== commandId) throw new TypeError(`Built-in alias ${alias} maps to both ${existing} and ${commandId}.`);
        this.#builtIn.set(alias, commandId);
      }
    }
  }

  resolve(requested: string): AliasResolution {
    const normalized = normalizeCommandName(requested);
    if (!normalized) throw new TypeError("Command name is required.");
    if (this.#canonical.has(normalized)) return { requested: normalized, commandId: normalized, source: "canonical" };
    const imported = this.#imported.get(normalized);
    if (imported) return { requested: normalized, commandId: imported, source: "imported" };
    const builtIn = this.#builtIn.get(normalized);
    if (builtIn) return { requested: normalized, commandId: builtIn, source: "built-in" };
    throw new RangeError(`Unknown command or alias ${normalized}.`);
  }

  async importPgp(input: string | Uint8Array): Promise<AliasImportReadback> {
    const decoded = decodeAliasInput(input);
    const imported = new Map<string, string>();
    const conflicts: AliasConflictReadback[] = [];
    decoded.text.split(/\r?\n/u).forEach((line, index) => {
      const content = line.split(";", 1)[0]!.trim();
      if (!content) return;
      const match = /^([^,]+),\s*\*?([^\s,]+)\s*$/u.exec(content);
      if (!match) throw new TypeError(`Alias line ${index + 1} must use ALIAS, *COMMAND format.`);
      const alias = assertAliasName(match[1]!, `Line ${index + 1}`);
      const commandId = normalizeCommandName(match[2]!);
      if (!this.#canonical.has(commandId)) throw new RangeError(`Alias line ${index + 1} targets unknown command ${commandId}.`);
      if (this.#canonical.has(alias) && alias !== commandId) {
        throw new RangeError(`Alias line ${index + 1} cannot replace canonical command ${alias} with ${commandId}.`);
      }
      const priorImported = imported.get(alias);
      const priorBuiltIn = priorImported ? undefined : this.#builtIn.get(alias);
      const previous = priorImported ?? priorBuiltIn;
      if (previous && previous !== commandId) {
        conflicts.push({
          alias,
          previousCommandId: previous,
          incomingCommandId: commandId,
          previousSource: priorImported ? "imported" : "built-in",
          resolution: "incoming-wins",
          line: index + 1,
        });
      }
      imported.set(alias, commandId);
    });
    this.#imported = imported;
    const bytes = this.exportPgp();
    return {
      mappingCount: imported.size,
      conflicts,
      canonicalText: new TextDecoder().decode(bytes),
      byteLength: bytes.byteLength,
      sha256: await sha256(bytes),
    };
  }

  exportPgp(): Uint8Array {
    const text = [...this.#imported.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([alias, commandId]) => `${alias}, *${commandId}\r\n`)
      .join("");
    return new TextEncoder().encode(text);
  }

  readBack(): PgpAliasMappingReadback {
    const bytes = this.exportPgp();
    return {
      canonicalCommands: [...this.#canonical].sort(),
      builtInAliases: sortedRecord(this.#builtIn),
      importedAliases: sortedRecord(this.#imported),
      canonicalText: new TextDecoder().decode(bytes),
      byteLength: bytes.byteLength,
    };
  }
}

export interface DocumentWorkspaceReadback {
  capabilities: typeof DOCUMENT_WORKSPACE_CAPABILITIES;
  live: DocumentLiveReadback;
  aliases: PgpAliasMappingReadback;
}

function firstCommandToken(raw: string): string {
  const token = raw.trim().split(/\s+/u, 1)[0];
  if (!token) throw new TypeError("Command line is empty.");
  return token;
}

export class DocumentWorkspaceShell {
  constructor(
    readonly live: DocumentLiveOrchestrator,
    readonly aliases: PgpAliasMapping,
  ) {}

  open(input: OpenLiveDocumentInput): Promise<OpenLiveDocumentResult> {
    return this.live.open(input);
  }

  activate(documentId: string): void {
    this.live.activate(documentId);
  }

  setSelection(documentId: string, handles: readonly string[]): void {
    this.live.setSelection(documentId, handles);
  }

  setViewport(documentId: string, viewport: Viewport2D): void {
    this.live.setViewport(documentId, viewport);
  }

  recordCommand(documentId: string, raw: string): AliasResolution {
    const resolution = this.aliases.resolve(firstCommandToken(raw));
    this.live.recordCommand(documentId, raw);
    return resolution;
  }

  async commit(
    documentId: string,
    expectedRevision: number,
    rawCommand: string,
    changes: readonly CadChange[],
    now?: string,
  ): Promise<KDrawDocumentV1> {
    const actualRevision = this.live.document(documentId).revision;
    if (expectedRevision !== actualRevision) throw new RevisionConflictError(expectedRevision, actualRevision);
    const resolution = this.recordCommand(documentId, rawCommand);
    const operation: CadOperation = {
      opId: `workspace:${documentId}:${expectedRevision + 1}:${resolution.commandId}`,
      baseRevision: expectedRevision,
      commandId: resolution.commandId,
      args: { invokedAs: resolution.requested, raw: rawCommand.trim() },
      targetHandles: [],
      resultHandles: changes.flatMap((change) => change.type === "put" ? [change.entity.handle] : []),
    };
    return this.live.commit(documentId, operation, changes, now);
  }

  markUndo(documentId: string, expectedRevision: number, rawCommand: string, now?: string): Promise<KDrawDocumentV1> {
    return this.commit(documentId, expectedRevision, rawCommand, [{ type: "undo-mark" }], now);
  }

  async undo(documentId: string, now?: string): Promise<KDrawDocumentV1 | null> {
    this.live.recordCommand(documentId, "U");
    return this.live.undo(documentId, now);
  }

  async redo(documentId: string, now?: string): Promise<KDrawDocumentV1 | null> {
    this.live.recordCommand(documentId, "REDO");
    return this.live.redo(documentId, now);
  }

  document(documentId: string): KDrawDocumentV1 {
    return this.live.document(documentId);
  }

  readBack(): DocumentWorkspaceReadback {
    return {
      capabilities: DOCUMENT_WORKSPACE_CAPABILITIES,
      live: this.live.readBack(),
      aliases: this.aliases.readBack(),
    };
  }
}
