import { CadSession, type CadChange, type CommittedOperation } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";

export class CommandEngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandEngineInputError";
  }
}

export interface CommandOptionDefinition {
  id: string;
  aliases?: readonly string[];
}

export interface CommandInvocation {
  commandId: string;
  invokedAs: string;
  options: string[];
  arguments: string[];
  raw: string;
}

export interface PreparedEngineCommand {
  commandId: string;
  changes: CadChange[];
  targetHandles: string[];
  resultHandles: string[];
  operationArgs: unknown;
}

export interface CommandDefinition {
  id: string;
  aliases?: readonly string[];
  options?: readonly CommandOptionDefinition[];
  prepare(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand;
}

export type CommandExecutionResult =
  | { kind: "commit"; invocation: CommandInvocation; committed: CommittedOperation }
  | { kind: "undo"; committed: CommittedOperation | null }
  | { kind: "redo"; committed: CommittedOperation | null }
  | { kind: "cancel" };

function normalizeName(value: string): string {
  return value.trim().replace(/^[_.]+/u, "").toLocaleUpperCase();
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  for (const character of input.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "\"" || character === "'") quote = character;
    else if (/\s/u.test(character)) {
      if (current) { tokens.push(current); current = ""; }
    } else current += character;
  }
  if (quote) throw new CommandEngineInputError("Command line contains an unterminated quote.");
  if (current) tokens.push(current);
  return tokens;
}

export function parseAliasFile(input: string): Map<string, string> {
  const aliases = new Map<string, string>();
  input.split(/\r?\n/u).forEach((line, lineIndex) => {
    const content = line.split(";", 1)[0]!.trim();
    if (!content) return;
    const match = /^([^,]+),\s*\*?([^\s,]+)$/u.exec(content);
    if (!match) throw new CommandEngineInputError(`Alias line ${lineIndex + 1} must use ALIAS, *COMMAND format.`);
    const alias = normalizeName(match[1]!); const commandId = normalizeName(match[2]!);
    if (!alias || !commandId) throw new CommandEngineInputError(`Alias line ${lineIndex + 1} is empty.`);
    const existing = aliases.get(alias);
    if (existing && existing !== commandId) throw new CommandEngineInputError(`Alias ${alias} maps to both ${existing} and ${commandId}.`);
    aliases.set(alias, commandId);
  });
  return aliases;
}

export class CommandRegistry {
  readonly #definitions = new Map<string, CommandDefinition>();
  readonly #names = new Map<string, string>();

  constructor(definitions: readonly CommandDefinition[] = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  register(definition: CommandDefinition): void {
    const id = normalizeName(definition.id);
    if (!id) throw new CommandEngineInputError("Command id must not be empty.");
    if (this.#definitions.has(id)) throw new CommandEngineInputError(`Command ${id} is already registered.`);
    this.#definitions.set(id, { ...definition, id });
    this.addName(id, id);
    for (const alias of definition.aliases ?? []) this.addName(alias, id);
  }

  addAliases(aliases: ReadonlyMap<string, string>): void {
    for (const [alias, requestedId] of aliases) {
      const id = normalizeName(requestedId);
      if (!this.#definitions.has(id)) throw new CommandEngineInputError(`Alias ${alias} targets unknown command ${id}.`);
      this.addName(alias, id);
    }
  }

  resolve(name: string): CommandDefinition | null {
    const id = this.#names.get(normalizeName(name));
    return id ? this.#definitions.get(id) ?? null : null;
  }

  complete(prefix: string): string[] {
    const normalized = normalizeName(prefix);
    return [...this.#names.keys()].filter((name) => name.startsWith(normalized)).sort();
  }

  private addName(name: string, id: string): void {
    const normalized = normalizeName(name);
    if (!normalized) throw new CommandEngineInputError(`Command ${id} has an empty alias.`);
    const existing = this.#names.get(normalized);
    if (existing && existing !== id) throw new CommandEngineInputError(`Alias ${normalized} is already assigned to ${existing}.`);
    this.#names.set(normalized, id);
  }
}

function invocationFor(registry: CommandRegistry, raw: string): { definition: CommandDefinition; invocation: CommandInvocation } {
  const tokens = tokenize(raw);
  const invokedAs = tokens.shift();
  if (!invokedAs) throw new CommandEngineInputError("Command line is empty.");
  const definition = registry.resolve(invokedAs);
  if (!definition) throw new CommandEngineInputError(`Unknown command ${invokedAs}.`);
  const optionNames = new Map<string, string>();
  for (const option of definition.options ?? []) {
    const id = normalizeName(option.id); optionNames.set(id, id);
    for (const alias of option.aliases ?? []) optionNames.set(normalizeName(alias), id);
  }
  const options: string[] = [];
  const arguments_: string[] = [];
  for (const token of tokens) {
    if (!token.startsWith("/")) { arguments_.push(token); continue; }
    const requested = normalizeName(token.slice(1));
    const option = optionNames.get(requested);
    if (!option) throw new CommandEngineInputError(`${definition.id} does not support option ${token}.`);
    if (!options.includes(option)) options.push(option);
  }
  return {
    definition,
    invocation: { commandId: definition.id, invokedAs: normalizeName(invokedAs), options, arguments: arguments_, raw: raw.trim() },
  };
}

export class CommandLineEngine {
  readonly #history: string[] = [];
  #historyIndex = 0;
  #lastRepeatable: string | null = null;
  #sequence = 0;
  #buffer = "";

  constructor(readonly session: CadSession, readonly registry: CommandRegistry) {}

  get buffer(): string { return this.#buffer; }
  get history(): readonly string[] { return [...this.#history]; }

  setBuffer(value: string): void {
    this.#buffer = value;
    this.#historyIndex = this.#history.length;
  }

  insertText(value: string): void { this.#buffer += value; }

  preview(raw: string): PreparedEngineCommand {
    const { definition, invocation } = invocationFor(this.registry, raw);
    return structuredClone(definition.prepare(this.session.document, invocation));
  }

  execute(raw: string, now?: string): CommandExecutionResult {
    const requested = raw.trim() || this.#lastRepeatable;
    if (!requested) throw new CommandEngineInputError("There is no previous command to repeat.");
    const tokens = tokenize(requested);
    const builtIn = normalizeName(tokens[0] ?? "");
    if ((builtIn === "U" || builtIn === "UNDO") && tokens.length === 1) {
      this.record(requested, false); return { kind: "undo", committed: this.session.undo(now) };
    }
    if (builtIn === "REDO" && tokens.length === 1) {
      this.record(requested, false); return { kind: "redo", committed: this.session.redo(now) };
    }
    const { definition, invocation } = invocationFor(this.registry, requested);
    const prepared = definition.prepare(this.session.document, invocation);
    if (prepared.commandId !== definition.id) throw new CommandEngineInputError(`Handler for ${definition.id} prepared ${prepared.commandId}.`);
    const operation: CadOperation = {
      opId: `command-line:${++this.#sequence}`,
      baseRevision: this.session.document.revision,
      commandId: prepared.commandId,
      args: structuredClone(prepared.operationArgs),
      targetHandles: [...prepared.targetHandles], resultHandles: [...prepared.resultHandles],
    };
    const committed = this.session.commit(operation, prepared.changes, now);
    this.record(requested, true);
    return { kind: "commit", invocation, committed };
  }

  handleKey(key: string, now?: string): CommandExecutionResult | null {
    if (key === "Escape") { this.#buffer = ""; return { kind: "cancel" }; }
    if (key === "ArrowUp") {
      if (this.#history.length) { this.#historyIndex = Math.max(0, this.#historyIndex - 1); this.#buffer = this.#history[this.#historyIndex]!; }
      return null;
    }
    if (key === "ArrowDown") {
      if (this.#historyIndex < this.#history.length - 1) this.#buffer = this.#history[++this.#historyIndex]!;
      else { this.#historyIndex = this.#history.length; this.#buffer = ""; }
      return null;
    }
    if (key === "Backspace") { this.#buffer = this.#buffer.slice(0, -1); return null; }
    if (key === "Enter" || key === " ") {
      const requested = this.#buffer; this.#buffer = ""; return this.execute(requested, now);
    }
    if (key.length === 1) this.#buffer += key;
    return null;
  }

  private record(raw: string, repeatable: boolean): void {
    this.#history.push(raw.trim()); this.#historyIndex = this.#history.length;
    if (repeatable) this.#lastRepeatable = raw.trim();
  }
}
