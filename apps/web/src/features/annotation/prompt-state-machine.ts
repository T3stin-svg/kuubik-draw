import type { AnnotationPromptValueKind } from "./model.js";

export type CommandPromptValue = string | number | boolean | { x: number; y: number } | readonly unknown[] | Readonly<Record<string, unknown>>;

export interface CommandPromptSnapshot {
  commandId: string;
  status: "active" | "ready" | "cancelled";
  currentFieldId: string | null;
  currentLabel: string | null;
  currentChoices: readonly string[];
  values: Readonly<Record<string, CommandPromptValue>>;
}

interface PromptPlan {
  commandId: string;
  fields: readonly {
    id: string;
    label: string;
    valueKind: string;
    required: boolean;
    choices?: readonly string[];
  }[];
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Number.isFinite((value as { x?: unknown }).x) && Number.isFinite((value as { y?: unknown }).y);
}

function validValue(kind: AnnotationPromptValueKind | string, value: unknown): boolean {
  if (kind === "point") return isPoint(value);
  if (kind === "points") return Array.isArray(value) && value.length > 0 && value.every(isPoint);
  if (kind === "handles") return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
  if (kind === "string") return typeof value === "string" && value.length > 0;
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "select") return typeof value === "string" && value.length > 0;
  if (kind === "attributes") return typeof value === "object" && value !== null
    && (!Array.isArray(value) || value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item)));
  if (kind === "entities") return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
  return false;
}

export class CommandPromptStateMachine {
  readonly #plan: PromptPlan;
  #fieldIndex = 0;
  #status: CommandPromptSnapshot["status"] = "active";
  #values: Record<string, CommandPromptValue> = {};

  constructor(plan: PromptPlan) {
    this.#plan = structuredClone(plan);
    if (!this.#plan.commandId.trim() || !this.#plan.fields.length) throw new TypeError("Prompt plan requires a command and at least one field.");
  }

  get snapshot(): CommandPromptSnapshot {
    const field = this.#status === "active" ? this.#plan.fields[this.#fieldIndex] : undefined;
    return {
      commandId: this.#plan.commandId,
      status: this.#status,
      currentFieldId: field?.id ?? null,
      currentLabel: field?.label ?? null,
      currentChoices: [...(field?.choices ?? [])],
      values: structuredClone(this.#values),
    };
  }

  answer(value: CommandPromptValue): CommandPromptSnapshot {
    if (this.#status !== "active") throw new RangeError(`Cannot answer a ${this.#status} prompt.`);
    const field = this.#plan.fields[this.#fieldIndex]!;
    if (!validValue(field.valueKind, value)) throw new TypeError(`${field.id} does not accept this value.`);
    if (field.choices?.length && (typeof value !== "string" || !field.choices.includes(value))) throw new RangeError(`${field.id} must be one of: ${field.choices.join(", ")}.`);
    this.#values[field.id] = structuredClone(value);
    this.advance();
    return this.snapshot;
  }

  skip(): CommandPromptSnapshot {
    if (this.#status !== "active") throw new RangeError(`Cannot skip a ${this.#status} prompt.`);
    const field = this.#plan.fields[this.#fieldIndex]!;
    if (field.required) throw new RangeError(`${field.id} is required.`);
    this.advance();
    return this.snapshot;
  }

  cancel(): CommandPromptSnapshot {
    this.#status = "cancelled";
    this.#values = {};
    return this.snapshot;
  }

  repeat(): CommandPromptSnapshot {
    this.#fieldIndex = 0;
    this.#status = "active";
    this.#values = {};
    return this.snapshot;
  }

  private advance(): void {
    this.#fieldIndex += 1;
    if (this.#fieldIndex >= this.#plan.fields.length) this.#status = "ready";
  }
}
