import type { CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  type CadChange,
  type CadSession,
  type CommittedOperation,
} from "../../../../../packages/cad-core/src/transaction.js";
import type { PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import type { CadPrecisionInput } from "../../../../../packages/cad-core/src/precision-input.js";
import type { PrecisionPointerInput, PrecisionPointerResolution, PreparedPrecisionPointer } from "./shell-contract.js";

export type CoordinateEntryStatus = "idle" | "active" | "retry" | "preview" | "committed" | "cancelled";

export interface CoordinateEntryContext extends Omit<PrecisionPointerInput, "input"> {}

export interface CoordinateEntrySnapshot {
  status: CoordinateEntryStatus;
  input: string | CadPrecisionInput | null;
  preview: PrecisionResult | null;
  error: string | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface CoordinateEntryAtomicPlan {
  commandId: string;
  args?: Record<string, unknown>;
  changes: readonly CadChange[];
  targetHandles?: readonly string[];
  resultHandles?: readonly string[];
}

export interface CoordinateEntryCommit {
  preview: PrecisionResult;
  pointCommit: PrecisionResult;
  committed: CommittedOperation;
  document: KDrawDocumentV1;
}

export interface CoordinateEntryAdapterOptions {
  opIdPrefix?: string;
  now?: () => string;
  onDocumentChange?: (document: KDrawDocumentV1) => void;
}

type PointerFactory = (input: PrecisionPointerInput) => PreparedPrecisionPointer;
type AtomicPlanner = (point: CadPoint2, result: PrecisionResult, document: KDrawDocumentV1) => CoordinateEntryAtomicPlan;

function inputClone(input: string | CadPrecisionInput | null): string | CadPrecisionInput | null {
  return typeof input === "string" || input === null ? input : structuredClone(input);
}

/**
 * Browser-ready F-041/F-042/F-044 prompt adapter. A valid preview is cached as
 * one immutable pointer frame and that exact frame is the only commit source.
 */
export class PrecisionCoordinateEntryAdapter {
  readonly #session: CadSession;
  readonly #preparePointer: PointerFactory;
  readonly #opIdPrefix: string;
  readonly #now: () => string;
  readonly #onDocumentChange: ((document: KDrawDocumentV1) => void) | undefined;
  #sequence = 0;
  #status: CoordinateEntryStatus = "idle";
  #context: CoordinateEntryContext | null = null;
  #input: string | CadPrecisionInput | null = null;
  #prepared: PreparedPrecisionPointer | null = null;
  #resolution: PrecisionPointerResolution | null = null;
  #error: string | null = null;

  constructor(session: CadSession, preparePointer: PointerFactory, options: CoordinateEntryAdapterOptions = {}) {
    this.#session = session;
    this.#preparePointer = preparePointer;
    this.#opIdPrefix = options.opIdPrefix ?? "precision-coordinate";
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#onDocumentChange = options.onDocumentChange;
  }

  get document(): KDrawDocumentV1 { return this.#session.document; }

  snapshot(): CoordinateEntrySnapshot {
    return {
      status: this.#status,
      input: inputClone(this.#input),
      preview: this.#resolution ? structuredClone(this.#resolution.preview) : null,
      error: this.#error,
      revision: this.document.revision,
      canUndo: this.#session.canUndo,
      canRedo: this.#session.canRedo,
    };
  }

  start(context: CoordinateEntryContext): CoordinateEntrySnapshot {
    this.#context = structuredClone(context);
    this.#input = null;
    this.#prepared = null;
    this.#resolution = null;
    this.#error = null;
    this.#status = "active";
    return this.snapshot();
  }

  preview(input: string | CadPrecisionInput): CoordinateEntrySnapshot {
    if (!this.#context || this.#status === "cancelled" || this.#status === "committed") {
      throw new TypeError("Coordinate entry must be started before preview.");
    }
    this.#input = inputClone(input);
    this.#prepared = null;
    this.#resolution = null;
    this.#error = null;
    try {
      const prepared = this.#preparePointer({ ...structuredClone(this.#context), input: inputClone(input)! });
      const resolution = prepared.resolve();
      if (JSON.stringify(resolution.preview) !== JSON.stringify(resolution.commit)) {
        throw new TypeError("Coordinate preview and point commit disagree.");
      }
      this.#prepared = prepared;
      this.#resolution = resolution;
      this.#status = "preview";
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      this.#status = "retry";
    }
    return this.snapshot();
  }

  retry(input: string | CadPrecisionInput): CoordinateEntrySnapshot {
    if (this.#status !== "retry") throw new TypeError("Coordinate entry is not waiting for retry.");
    return this.preview(input);
  }

  cancel(): CoordinateEntrySnapshot {
    if (this.#status === "committed") throw new TypeError("A committed coordinate entry cannot be cancelled.");
    this.#input = null;
    this.#prepared = null;
    this.#resolution = null;
    this.#error = null;
    this.#status = "cancelled";
    return this.snapshot();
  }

  commit(plan: AtomicPlanner): CoordinateEntryCommit {
    if (this.#status !== "preview" || !this.#prepared || !this.#resolution) {
      throw new TypeError("Coordinate entry requires a valid preview before commit.");
    }
    const pointCommit = this.#prepared.commit();
    const preview = this.#resolution.preview;
    if (JSON.stringify(preview) !== JSON.stringify(pointCommit)) {
      throw new TypeError("Coordinate preview and point commit disagree.");
    }
    const planned = plan(structuredClone(pointCommit.point), structuredClone(pointCommit), this.document);
    const operation = {
      opId: `${this.#opIdPrefix}:${this.document.revision}:${++this.#sequence}`,
      baseRevision: this.document.revision,
      commandId: planned.commandId,
      args: { ...(planned.args ?? {}), point: structuredClone(pointCommit.point) },
      targetHandles: [...(planned.targetHandles ?? [])],
      resultHandles: [...(planned.resultHandles ?? [])],
    };
    const committed = this.#session.commit(operation, planned.changes, this.#now());
    this.#status = "committed";
    this.#onDocumentChange?.(this.document);
    return { preview: structuredClone(preview), pointCommit, committed, document: this.document };
  }

  undo(): CommittedOperation | null {
    const committed = this.#session.undo(this.#now());
    if (committed) this.#onDocumentChange?.(this.document);
    return committed;
  }

  redo(): CommittedOperation | null {
    const committed = this.#session.redo(this.#now());
    if (committed) this.#onDocumentChange?.(this.document);
    return committed;
  }
}
