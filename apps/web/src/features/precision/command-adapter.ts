import type { CadPoint2 } from "@kuubik/cad-schema";
import type { CadOsnapMode } from "../../../../../packages/cad-renderer/src/snap.js";
import type { PrecisionModes, PrecisionRequest } from "../../../../../packages/cad-core/src/precision.js";

export type PrecisionToggle = "ortho" | "polar" | "grid" | "snap" | "osnap" | "otrack" | "dynamicInput";
export type PrecisionShellRow = "F-045" | "F-046" | "F-047" | "F-049" | "F-050" | "F-051" | "F-052";

export interface PrecisionToggleShortcut {
  key: "F3" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
  command: "OSNAP" | "GRID" | "ORTHO" | "SNAP" | "POLAR" | "OTRACK" | "DYNMODE";
  toggle: PrecisionToggle;
  rowIds: readonly PrecisionShellRow[];
}

/** One authoritative shortcut/command/capability contract for shell wiring. */
export const PRECISION_TOGGLE_SHORTCUTS: readonly PrecisionToggleShortcut[] = Object.freeze([
  { key: "F3", command: "OSNAP", toggle: "osnap", rowIds: ["F-049", "F-050"] },
  { key: "F7", command: "GRID", toggle: "grid", rowIds: ["F-047"] },
  { key: "F8", command: "ORTHO", toggle: "ortho", rowIds: ["F-045"] },
  { key: "F9", command: "SNAP", toggle: "snap", rowIds: ["F-047"] },
  { key: "F10", command: "POLAR", toggle: "polar", rowIds: ["F-046"] },
  { key: "F11", command: "OTRACK", toggle: "otrack", rowIds: ["F-051"] },
  { key: "F12", command: "DYNMODE", toggle: "dynamicInput", rowIds: ["F-052"] },
]);

export interface PrecisionState {
  ortho: boolean;
  polar: boolean;
  grid: boolean;
  snap: boolean;
  osnap: boolean;
  otrack: boolean;
  dynamicInput: boolean;
  osnapModes: readonly CadOsnapMode[];
}

export interface PrecisionSettings {
  polarIncrementRad: number;
  polarAdditionalAnglesRad?: readonly number[];
  gridSpacingX: number;
  gridSpacingY: number;
  gridOrigin?: CadPoint2;
  aperture: number;
}

export interface PrecisionInputContext {
  /** Keyboard accelerators must never consume text-entry keystrokes. */
  editableTarget?: boolean;
  repeat?: boolean;
}

export interface PrecisionDispatchResult {
  handled: boolean;
  changed: boolean;
  state: PrecisionState;
  command?: string;
  message?: string;
}

export interface VisualShellCommandAdapter {
  canExecute(rowId: string, context: "model" | "paper"): boolean;
  execute(rowId: string): void;
  precisionMode(rowId: PrecisionShellRow): boolean;
  setPrecisionMode(rowId: PrecisionShellRow, enabled: boolean): void;
}

const DEFAULT_OSNAP_MODES: readonly CadOsnapMode[] = Object.freeze([
  "endpoint", "midpoint", "center", "quadrant", "intersection", "extension", "insertion",
  "perpendicular", "tangent", "nearest", "geometricCenter", "parallel",
]);

const KEY_TOGGLES = Object.freeze(Object.fromEntries(
  PRECISION_TOGGLE_SHORTCUTS.map(({ key, toggle }) => [key, toggle]),
)) as Readonly<Record<string, PrecisionToggle>>;

const COMMAND_TOGGLES = Object.freeze({
  ...Object.fromEntries(PRECISION_TOGGLE_SHORTCUTS.map(({ command, toggle }) => [command, toggle])),
  DYN: "dynamicInput",
}) as Readonly<Record<string, PrecisionToggle>>;

const OSNAP_ALIASES: Readonly<Record<string, CadOsnapMode>> = Object.freeze({
  END: "endpoint", ENDPOINT: "endpoint",
  MID: "midpoint", MIDPOINT: "midpoint",
  CEN: "center", CENTER: "center",
  QUA: "quadrant", QUADRANT: "quadrant",
  INT: "intersection", INTERSECTION: "intersection",
  EXT: "extension", EXTENSION: "extension",
  INS: "insertion", INSERTION: "insertion",
  PER: "perpendicular", PERPENDICULAR: "perpendicular",
  TAN: "tangent", TANGENT: "tangent",
  NEA: "nearest", NEAREST: "nearest",
  GCE: "geometricCenter", GCEN: "geometricCenter", GEOMETRICCENTER: "geometricCenter",
  PAR: "parallel", PARALLEL: "parallel",
});

const SHELL_ROWS: Readonly<Record<PrecisionShellRow, PrecisionToggle>> = Object.freeze({
  "F-045": "ortho",
  "F-046": "polar",
  "F-047": "grid",
  "F-049": "osnap",
  "F-050": "osnap",
  "F-051": "otrack",
  "F-052": "dynamicInput",
});

function cloneState(state: PrecisionState): PrecisionState {
  return { ...state, osnapModes: [...state.osnapModes] };
}

function uniqueOsnapModes(modes: readonly CadOsnapMode[]): CadOsnapMode[] {
  return [...new Set(modes)].sort((first, second) => DEFAULT_OSNAP_MODES.indexOf(first) - DEFAULT_OSNAP_MODES.indexOf(second));
}

function validSettings(settings: PrecisionSettings): void {
  const values = [settings.polarIncrementRad, settings.gridSpacingX, settings.gridSpacingY, settings.aperture];
  if (!values.every(Number.isFinite) || settings.polarIncrementRad <= 0 || settings.polarIncrementRad > Math.PI * 2
    || settings.gridSpacingX <= 0 || settings.gridSpacingY <= 0 || settings.aperture < 0) {
    throw new TypeError("Precision settings must use finite positive increments and a non-negative aperture.");
  }
  if (settings.polarAdditionalAnglesRad?.some((angle) => !Number.isFinite(angle))) throw new TypeError("Additional polar angles must be finite.");
  if (settings.gridOrigin && ![settings.gridOrigin.x, settings.gridOrigin.y].every(Number.isFinite)) throw new TypeError("Grid origin must be finite.");
}

export class PrecisionCommandState {
  #state: PrecisionState;

  constructor(initial: Partial<PrecisionState> = {}) {
    this.#state = {
      ortho: false,
      polar: false,
      grid: true,
      snap: false,
      osnap: false,
      otrack: false,
      dynamicInput: false,
      ...initial,
      osnapModes: uniqueOsnapModes(initial.osnapModes ?? DEFAULT_OSNAP_MODES),
    };
  }

  get state(): PrecisionState {
    return cloneState(this.#state);
  }

  enabled(toggle: PrecisionToggle): boolean {
    return this.#state[toggle] as boolean;
  }

  set(toggle: PrecisionToggle, enabled: boolean): boolean {
    if (typeof enabled !== "boolean") throw new TypeError("Precision mode state must be boolean.");
    if (this.#state[toggle] === enabled) return false;
    this.#state = { ...this.#state, [toggle]: enabled };
    return true;
  }

  toggle(toggle: PrecisionToggle): boolean {
    return this.set(toggle, !this.enabled(toggle));
  }

  setOsnapModes(modes: readonly CadOsnapMode[]): boolean {
    const next = uniqueOsnapModes(modes);
    if (next.length === 0) throw new TypeError("At least one OSNAP mode is required.");
    const changed = next.join("|") !== this.#state.osnapModes.join("|") || !this.#state.osnap;
    if (changed) this.#state = { ...this.#state, osnap: true, osnapModes: next };
    return changed;
  }

  handleKey(key: string, context: PrecisionInputContext = {}): PrecisionDispatchResult {
    const normalized = key.toUpperCase();
    const mode = KEY_TOGGLES[normalized];
    if (!mode || context.editableTarget || context.repeat) return { handled: false, changed: false, state: this.state };
    const changed = this.toggle(mode);
    return { handled: true, changed, state: this.state, command: normalized, message: `${mode} ${this.enabled(mode) ? "ON" : "OFF"}` };
  }

  executeCommandLine(input: string): PrecisionDispatchResult {
    const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const command = tokens[0];
    if (!command) return { handled: false, changed: false, state: this.state };
    const mode = COMMAND_TOGGLES[command];
    if (!mode) return { handled: false, changed: false, state: this.state };
    if (command === "OSNAP" && tokens.length > 1 && !["ON", "OFF", "1", "0", "TOGGLE"].includes(tokens[1]!)) {
      const names = tokens.slice(1).join("").split(",").filter(Boolean);
      const osnapModes = names.map((name) => OSNAP_ALIASES[name]);
      if (osnapModes.length === 0 || osnapModes.some((candidate) => candidate === undefined)) {
        return { handled: true, changed: false, state: this.state, command, message: "Invalid OSNAP mode list" };
      }
      const changed = this.setOsnapModes(osnapModes as CadOsnapMode[]);
      return { handled: true, changed, state: this.state, command, message: `osnap ${this.#state.osnapModes.join(",")}` };
    }
    if (tokens.length > 2) return { handled: true, changed: false, state: this.state, command, message: "Invalid precision command arguments" };
    const argument = tokens[1] ?? "TOGGLE";
    const next = argument === "ON" || argument === "1" ? true : argument === "OFF" || argument === "0" ? false : argument === "TOGGLE" ? !this.enabled(mode) : null;
    if (next === null) return { handled: true, changed: false, state: this.state, command, message: "Expected ON, OFF, 1, 0 or TOGGLE" };
    const changed = this.set(mode, next);
    return { handled: true, changed, state: this.state, command, message: `${mode} ${next ? "ON" : "OFF"}` };
  }

  precisionModes(settings: PrecisionSettings): PrecisionModes {
    validSettings(settings);
    return {
      ...(this.#state.ortho ? { ortho: true } : {}),
      ...(this.#state.polar ? { polar: { incrementRad: settings.polarIncrementRad, ...(settings.polarAdditionalAnglesRad ? { additionalAnglesRad: settings.polarAdditionalAnglesRad } : {}) } } : {}),
      ...(this.#state.snap ? { grid: { spacingX: settings.gridSpacingX, spacingY: settings.gridSpacingY, ...(settings.gridOrigin ? { origin: settings.gridOrigin } : {}) } } : {}),
      aperture: this.#state.osnap || this.#state.otrack ? settings.aperture : 0,
    };
  }

  prepareRequest(request: PrecisionRequest, settings: PrecisionSettings): PrecisionRequest {
    return {
      ...request,
      modes: this.precisionModes(settings),
      objectSnapCandidates: this.#state.osnap ? (request.objectSnapCandidates ?? []) : [],
      trackingCandidates: this.#state.otrack ? (request.trackingCandidates ?? []) : [],
    };
  }
}

export class PrecisionVisualShellAdapter implements VisualShellCommandAdapter {
  constructor(
    readonly precision: PrecisionCommandState,
    private readonly delegate?: Pick<VisualShellCommandAdapter, "canExecute" | "execute">,
  ) {}

  canExecute(rowId: string, context: "model" | "paper"): boolean {
    return Object.hasOwn(SHELL_ROWS, rowId) || (this.delegate?.canExecute(rowId, context) ?? false);
  }

  execute(rowId: string): void {
    if (Object.hasOwn(SHELL_ROWS, rowId)) {
      this.precision.toggle(SHELL_ROWS[rowId as PrecisionShellRow]);
      return;
    }
    this.delegate?.execute(rowId);
  }

  precisionMode(rowId: PrecisionShellRow): boolean {
    return this.precision.enabled(SHELL_ROWS[rowId]);
  }

  setPrecisionMode(rowId: PrecisionShellRow, enabled: boolean): void {
    this.precision.set(SHELL_ROWS[rowId], enabled);
  }
}
