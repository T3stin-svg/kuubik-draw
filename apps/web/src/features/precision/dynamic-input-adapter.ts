import type { CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { CommittedOperation } from "@kuubik/cad-core";
import { formatCadLengthWithContract } from "../../../../../packages/cad-core/src/units.js";
import {
  type CoordinateEntryAtomicPlanner,
  type CoordinateEntryCommit,
  type CoordinateEntryContext,
  PrecisionCoordinateEntryAdapter,
} from "./coordinate-entry-adapter.js";
import type { DynamicInputModel } from "./model.js";
import type { PrecisionLayersShellContract } from "./shell-contract.js";

export type DynamicInputEntryMode =
  | "absolute-cartesian"
  | "relative-cartesian"
  | "absolute-polar"
  | "relative-polar"
  | "direct-distance";

export type DynamicInputFieldId = "x" | "y" | "distance" | "angle";

export interface DynamicInputFieldReadback {
  id: DynamicInputFieldId;
  label: "X" | "Y" | "ΔX" | "ΔY" | "Distance" | "Angle";
  displayValue: string;
  draftValue: string;
  editable: boolean;
  active: boolean;
}

export interface DynamicInputOverlayReadback {
  leftCssPx: number;
  topCssPx: number;
  offsetCssPx: CadPoint2;
}

export interface DynamicInputSnapshot {
  visible: boolean;
  status: ReturnType<PrecisionCoordinateEntryAdapter["snapshot"]>["status"];
  entryMode: DynamicInputEntryMode;
  activeField: DynamicInputFieldId;
  fields: readonly DynamicInputFieldReadback[];
  overlay: DynamicInputOverlayReadback;
  result: DynamicInputModel | null;
  rawInput: string | null;
  error: string | null;
  commitReady: boolean;
  revision: number;
}

export interface DynamicInputKeyResult {
  handled: boolean;
  action: "focus-changed" | "cancelled" | "commit-requested" | null;
  snapshot: DynamicInputSnapshot;
}

export interface DynamicInputAdapterOptions {
  offsetCssPx?: CadPoint2;
  initialMode?: DynamicInputEntryMode;
}

const MODE_FIELDS: Readonly<Record<DynamicInputEntryMode, readonly DynamicInputFieldId[]>> = Object.freeze({
  "absolute-cartesian": ["x", "y"],
  "relative-cartesian": ["x", "y"],
  "absolute-polar": ["distance", "angle"],
  "relative-polar": ["distance", "angle"],
  "direct-distance": ["distance"],
});

const FIELD_IDS: readonly DynamicInputFieldId[] = ["x", "y", "distance", "angle"];

function finiteCssPoint(point: CadPoint2, label: string): void {
  if (![point.x, point.y].every(Number.isFinite)) throw new TypeError(`${label} must be finite.`);
}

function fieldLabel(mode: DynamicInputEntryMode, field: DynamicInputFieldId): DynamicInputFieldReadback["label"] {
  if (field === "x") return mode === "relative-cartesian" ? "ΔX" : "X";
  if (field === "y") return mode === "relative-cartesian" ? "ΔY" : "Y";
  return field === "distance" ? "Distance" : "Angle";
}

function inputFromFields(mode: DynamicInputEntryMode, drafts: Readonly<Record<DynamicInputFieldId, string>>): string | null {
  const values = MODE_FIELDS[mode].map((field) => drafts[field].trim());
  if (values.some((value) => value.length === 0)) return null;
  if (mode === "direct-distance") return values[0]!;
  if (mode.endsWith("cartesian")) return `${mode.startsWith("relative") ? "@" : ""}${values[0]};${values[1]}`;
  return `${mode.startsWith("relative") ? "@" : ""}${values[0]}<${values[1]}`;
}

/**
 * DOM-free F-052 interaction contract. The adapter owns only prompt state;
 * every point, formatted value, preview and commit comes from one prepared
 * precision frame and the existing atomic coordinate-entry adapter.
 */
export class PrecisionDynamicInputAdapter {
  readonly #coordinate: PrecisionCoordinateEntryAdapter;
  readonly #shell: PrecisionLayersShellContract;
  readonly #offsetCssPx: CadPoint2;
  #mode: DynamicInputEntryMode;
  #activeField: DynamicInputFieldId;
  #context: CoordinateEntryContext | null = null;
  #cursorCss: CadPoint2 = { x: 0, y: 0 };
  #result: DynamicInputModel | null = null;
  #rawInput: string | null = null;
  #drafts: Record<DynamicInputFieldId, string> = { x: "", y: "", distance: "", angle: "" };

  constructor(
    coordinate: PrecisionCoordinateEntryAdapter,
    shell: PrecisionLayersShellContract,
    options: DynamicInputAdapterOptions = {},
  ) {
    this.#coordinate = coordinate;
    this.#shell = shell;
    this.#offsetCssPx = { ...(options.offsetCssPx ?? { x: 16, y: 18 }) };
    finiteCssPoint(this.#offsetCssPx, "Dynamic Input CSS offset");
    this.#mode = options.initialMode ?? "relative-cartesian";
    this.#activeField = MODE_FIELDS[this.#mode][0]!;
  }

  start(context: CoordinateEntryContext, cursorCss: CadPoint2, mode: DynamicInputEntryMode = this.#mode): DynamicInputSnapshot {
    finiteCssPoint(cursorCss, "Dynamic Input cursor");
    this.#context = structuredClone(context);
    this.#cursorCss = { ...cursorCss };
    this.#mode = mode;
    this.#activeField = MODE_FIELDS[mode][0]!;
    this.#drafts = { x: "", y: "", distance: "", angle: "" };
    this.#rawInput = null;
    this.#coordinate.start(this.#context);
    this.#result = this.#passiveResult();
    return this.snapshot();
  }

  updatePointer(context: CoordinateEntryContext, cursorCss: CadPoint2): DynamicInputSnapshot {
    this.#assertStarted();
    finiteCssPoint(cursorCss, "Dynamic Input cursor");
    this.#context = structuredClone(context);
    this.#cursorCss = { ...cursorCss };
    this.#coordinate.start(this.#context);
    if (this.#rawInput !== null) this.#previewCoordinate(this.#rawInput);
    else this.#result = this.#passiveResult();
    return this.snapshot();
  }

  setEntryMode(mode: DynamicInputEntryMode): DynamicInputSnapshot {
    this.#assertStarted();
    this.#mode = mode;
    this.#activeField = MODE_FIELDS[mode][0]!;
    this.#drafts = { x: "", y: "", distance: "", angle: "" };
    this.#rawInput = null;
    this.#coordinate.start(this.#context!);
    this.#result = this.#passiveResult();
    return this.snapshot();
  }

  editField(field: DynamicInputFieldId, value: string): DynamicInputSnapshot {
    this.#assertEditable();
    if (!MODE_FIELDS[this.#mode].includes(field)) throw new TypeError(`Field ${field} is not editable in ${this.#mode} mode.`);
    if (typeof value !== "string") throw new TypeError("Dynamic Input field value must be a string.");
    this.#drafts[field] = value;
    this.#activeField = field;
    const input = inputFromFields(this.#mode, this.#drafts);
    if (input === null) {
      this.#rawInput = null;
      this.#coordinate.start(this.#context!);
      this.#result = this.#passiveResult();
    } else {
      this.#rawInput = input;
      this.#previewCoordinate(input);
    }
    return this.snapshot();
  }

  previewRaw(input: string): DynamicInputSnapshot {
    this.#assertEditable();
    if (typeof input !== "string" || input.trim().length === 0) throw new TypeError("Dynamic Input text must be non-empty.");
    this.#drafts = { x: "", y: "", distance: "", angle: "" };
    this.#rawInput = input;
    this.#previewCoordinate(input);
    return this.snapshot();
  }

  handleKey(key: string, options: { shiftKey?: boolean; repeat?: boolean } = {}): DynamicInputKeyResult {
    const normalized = key.toUpperCase();
    if (!this.#visible() || options.repeat) return { handled: false, action: null, snapshot: this.snapshot() };
    if (normalized === "ESCAPE" || normalized === "ESC") {
      this.#coordinate.cancel();
      this.#result = null;
      this.#rawInput = null;
      this.#drafts = { x: "", y: "", distance: "", angle: "" };
      return { handled: true, action: "cancelled", snapshot: this.snapshot() };
    }
    if (normalized === "TAB") {
      const fields = MODE_FIELDS[this.#mode];
      const index = fields.indexOf(this.#activeField);
      const step = options.shiftKey ? -1 : 1;
      this.#activeField = fields[((index + step) % fields.length + fields.length) % fields.length]!;
      return { handled: true, action: "focus-changed", snapshot: this.snapshot() };
    }
    if (normalized === "ENTER") {
      const ready = this.#coordinate.snapshot().status === "preview";
      return { handled: ready, action: ready ? "commit-requested" : null, snapshot: this.snapshot() };
    }
    return { handled: false, action: null, snapshot: this.snapshot() };
  }

  cancel(): DynamicInputSnapshot {
    this.#assertStarted();
    this.#coordinate.cancel();
    this.#result = null;
    this.#rawInput = null;
    return this.snapshot();
  }

  commit(plan: CoordinateEntryAtomicPlanner): CoordinateEntryCommit {
    const committed = this.#coordinate.commit(plan);
    this.#result = this.#coordinate.snapshot().dynamicInput;
    return committed;
  }

  get document(): KDrawDocumentV1 { return this.#coordinate.document; }

  undo(): CommittedOperation | null { return this.#coordinate.undo(); }

  redo(): CommittedOperation | null { return this.#coordinate.redo(); }

  snapshot(): DynamicInputSnapshot {
    const coordinate = this.#coordinate.snapshot();
    const result = this.#result;
    const editableFields = MODE_FIELDS[this.#mode];
    const relative = this.#mode === "relative-cartesian";
    const display: Record<DynamicInputFieldId, string> = {
      x: result ? (relative ? formatCadLengthWithContract(result.delta.x, result.unitsContract) : result.x) : "",
      y: result ? (relative ? formatCadLengthWithContract(result.delta.y, result.unitsContract) : result.y) : "",
      distance: result?.distance ?? "",
      angle: result?.angle ?? "",
    };
    return {
      visible: this.#visible(),
      status: coordinate.status,
      entryMode: this.#mode,
      activeField: this.#activeField,
      fields: FIELD_IDS.map((id) => ({
        id,
        label: fieldLabel(this.#mode, id),
        displayValue: display[id],
        draftValue: this.#drafts[id],
        editable: editableFields.includes(id),
        active: id === this.#activeField,
      })),
      overlay: {
        leftCssPx: this.#cursorCss.x + this.#offsetCssPx.x,
        topCssPx: this.#cursorCss.y + this.#offsetCssPx.y,
        offsetCssPx: { ...this.#offsetCssPx },
      },
      result: result ? structuredClone(result) : null,
      rawInput: this.#rawInput,
      error: coordinate.error,
      commitReady: coordinate.status === "preview",
      revision: coordinate.revision,
    };
  }

  #previewCoordinate(input: string): void {
    const coordinate = this.#coordinate.snapshot();
    const snapshot = coordinate.status === "retry"
      ? this.#coordinate.retry(input)
      : this.#coordinate.preview(input);
    this.#result = snapshot.dynamicInput;
  }

  #passiveResult(): DynamicInputModel {
    const prepared = this.#shell.preparePointer(this.#context!);
    const resolved = prepared.resolve();
    if (JSON.stringify(resolved.preview) !== JSON.stringify(resolved.commit)
      || JSON.stringify(resolved.dynamicInput.point) !== JSON.stringify(resolved.commit.point)) {
      throw new TypeError("Dynamic Input pointer preview and commit disagree.");
    }
    return resolved.dynamicInput;
  }

  #visible(): boolean {
    const status = this.#coordinate.snapshot().status;
    return this.#shell.precision.enabled("dynamicInput") && status !== "idle" && status !== "cancelled" && status !== "committed";
  }

  #assertStarted(): void {
    if (!this.#context) throw new TypeError("Dynamic Input must be started first.");
    const status = this.#coordinate.snapshot().status;
    if (status === "cancelled" || status === "committed") throw new TypeError("Dynamic Input operation is no longer active.");
  }

  #assertEditable(): void {
    this.#assertStarted();
    if (!this.#shell.precision.enabled("dynamicInput")) throw new TypeError("Dynamic Input is disabled.");
  }
}
