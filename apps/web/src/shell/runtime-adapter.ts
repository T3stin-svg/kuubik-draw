import {
  allocateEntityHandles,
  parseCartesianPoint,
  prepareGeometryCommand,
  resolveCadCommand,
  type CadSession,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  CommandEngineInputError,
  CommandLineEngine,
  CommandRegistry,
  type CommandInvocation,
  type PreparedEngineCommand,
} from "../features/command-system/command-engine.js";
import { prepareAnnotationCommand } from "../features/annotation/command-adapter.js";
import { createAnnotationAction, type AnnotationAction, type AnnotationCommandId } from "../features/annotation/model.js";
import { createBlockAction, type BlockAction, type BlockCommandId } from "../features/blocks/model.js";
import { LayerManagerController, type LayerManagerCommand, type LayerManagerPlan } from "../features/layers/controller.js";
import { PrecisionCommandState, type PrecisionDispatchResult } from "../features/precision/command-adapter.js";
import { PrecisionFeatureModel } from "../features/precision/model.js";

export type PrecisionToggleId = "grid" | "ortho" | "osnap" | "otrack" | "dyn";

export interface PrecisionToggleState {
  grid: boolean;
  ortho: boolean;
  osnap: boolean;
  otrack: boolean;
  dyn: boolean;
}

const RUNTIME_ROWS = new Set([
  "F-001", "F-002", "F-003", "F-004", "F-005",
  "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022", "F-024", "F-027", "F-030",
  "F-045", "F-047", "F-049", "F-050", "F-052",
  "F-057", "F-059",
  "F-072", "F-073", "F-074",
  "F-097", "F-098", "F-122", "F-127", "F-131", "F-132",
]);

function requirePointArguments(invocation: CommandInvocation, count: number): ReturnType<typeof parseCartesianPoint>[] {
  if (invocation.arguments.length !== count) {
    throw new CommandEngineInputError(`${invocation.commandId} expects ${count} coordinate arguments.`);
  }
  return invocation.arguments.map((argument) => parseCartesianPoint(argument));
}

function prepareLine(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  const points = requirePointArguments(invocation, 2);
  const handles = allocateEntityHandles(document, 1);
  const prepared = prepareGeometryCommand({
    command: "LINE",
    handles,
    layerId: document.currentLayerId,
    points,
  });
  return {
    commandId: prepared.commandId,
    changes: prepared.changes,
    targetHandles: [],
    resultHandles: prepared.resultHandles,
    operationArgs: { points, layerId: document.currentLayerId },
  };
}

function prepareRectangle(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  const [firstCorner, otherCorner] = requirePointArguments(invocation, 2);
  const command = resolveCadCommand("RECTANG");
  if (!command || command.id !== "RECTANGLE") throw new CommandEngineInputError("RECTANGLE runtime adapter is unavailable.");
  const handle = allocateEntityHandles(document, 1)[0]!;
  const args = { handle, layerId: document.currentLayerId, firstCorner: firstCorner!, otherCorner: otherCorner! };
  return {
    commandId: command.id,
    changes: command.execute(args),
    targetHandles: [],
    resultHandles: [handle],
    operationArgs: args,
  };
}

function requireFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CommandEngineInputError(`${label} must be a finite number.`);
  return parsed;
}

function preparedGeometry(document: KDrawDocumentV1, input: Parameters<typeof prepareGeometryCommand>[0]): PreparedEngineCommand {
  const prepared = prepareGeometryCommand(input);
  return {
    commandId: prepared.commandId,
    changes: prepared.changes,
    targetHandles: [],
    resultHandles: prepared.resultHandles,
    operationArgs: input,
  };
}

function preparePline(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  if (invocation.arguments.length < 2) throw new CommandEngineInputError("PLINE expects at least two coordinate arguments.");
  return preparedGeometry(document, {
    command: "PLINE",
    handle: allocateEntityHandles(document, 1)[0]!,
    layerId: document.currentLayerId,
    vertices: invocation.arguments.map((argument) => parseCartesianPoint(argument)),
  });
}

function prepareCircle(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  if (invocation.arguments.length !== 2) throw new CommandEngineInputError("CIRCLE expects a center point and radius.");
  return preparedGeometry(document, {
    command: "CIRCLE",
    handle: allocateEntityHandles(document, 1)[0]!,
    layerId: document.currentLayerId,
    construction: {
      mode: "center-radius",
      center: parseCartesianPoint(invocation.arguments[0]!),
      radius: requireFiniteNumber(invocation.arguments[1]!, "Circle radius"),
    },
  });
}

function prepareArc(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  const [start, point, end] = requirePointArguments(invocation, 3);
  return preparedGeometry(document, {
    command: "ARC",
    handle: allocateEntityHandles(document, 1)[0]!,
    layerId: document.currentLayerId,
    construction: { mode: "3p", start: start!, point: point!, end: end! },
  });
}

function prepareMText(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  if (invocation.arguments.length < 3) throw new CommandEngineInputError('MTEXT expects position, height and text, for example MTEXT 40,40 5 "Kuubik märkus".');
  const prepared = prepareAnnotationCommand(document, {
    commandId: "MTEXT",
    args: {
      handle: allocateEntityHandles(document, 1)[0]!,
      layerId: document.currentLayerId,
      position: parseCartesianPoint(invocation.arguments[0]!),
      height: requireFiniteNumber(invocation.arguments[1]!, "Text height"),
      width: 80,
      text: invocation.arguments.slice(2).join(" "),
    },
  });
  return { ...prepared, operationArgs: prepared.operationArgs };
}

function prepareLeader(document: KDrawDocumentV1, invocation: CommandInvocation): PreparedEngineCommand {
  if (invocation.arguments.length < 2) throw new CommandEngineInputError('LEADER expects two points and optional text, for example LEADER 0,0 40,20 "Märkus".');
  const prepared = prepareAnnotationCommand(document, {
    commandId: "LEADER",
    args: {
      handle: allocateEntityHandles(document, 1)[0]!,
      layerId: document.currentLayerId,
      vertices: [parseCartesianPoint(invocation.arguments[0]!), parseCartesianPoint(invocation.arguments[1]!)],
      ...(invocation.arguments.length > 2 ? { text: invocation.arguments.slice(2).join(" ") } : {}),
    },
  });
  return { ...prepared, operationArgs: prepared.operationArgs };
}

function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry([
    { id: "LINE", aliases: ["L"], prepare: prepareLine },
    { id: "PLINE", aliases: ["PL"], prepare: preparePline },
    { id: "RECTANGLE", aliases: ["REC", "RECTANG"], prepare: prepareRectangle },
    { id: "CIRCLE", aliases: ["C"], prepare: prepareCircle },
    { id: "ARC", aliases: ["A"], prepare: prepareArc },
    { id: "MTEXT", aliases: ["MT"], prepare: prepareMText },
    { id: "LEADER", aliases: ["LE"], prepare: prepareLeader },
  ]);
}

/** Typed boundary between the visual shell and already-integrated deterministic feature modules. */
export class VisualShellRuntimeAdapter {
  readonly commandRegistry = createCommandRegistry();
  readonly precision = new PrecisionFeatureModel();
  readonly precisionCommands = new PrecisionCommandState({ grid: true, osnap: true, otrack: true, dynamicInput: true });

  canExecute(rowId: string): boolean {
    return RUNTIME_ROWS.has(rowId);
  }

  commandEngine(session: CadSession): CommandLineEngine {
    return new CommandLineEngine(session, this.commandRegistry);
  }

  precisionState(): PrecisionToggleState {
    const state = this.precisionCommands.state;
    return { grid: state.grid, ortho: state.ortho, osnap: state.osnap, otrack: state.otrack, dyn: state.dynamicInput };
  }

  togglePrecision(mode: PrecisionToggleId): PrecisionDispatchResult {
    const mapped = mode === "dyn" ? "dynamicInput" : mode;
    const changed = this.precisionCommands.toggle(mapped);
    return { handled: true, changed, state: this.precisionCommands.state, command: mode.toUpperCase(), message: `${mode} ${this.precisionCommands.enabled(mapped) ? "ON" : "OFF"}` };
  }

  handlePrecisionKey(key: string, editableTarget: boolean, repeat: boolean): PrecisionDispatchResult {
    return this.precisionCommands.handleKey(key, { editableTarget, repeat });
  }

  executePrecisionCommand(input: string): PrecisionDispatchResult {
    return this.precisionCommands.executeCommandLine(input);
  }

  preparePrecisionRequest(request: Parameters<PrecisionCommandState["prepareRequest"]>[0]): Parameters<PrecisionCommandState["prepareRequest"]>[0] {
    return this.precisionCommands.prepareRequest(request, {
      polarIncrementRad: Math.PI / 2,
      gridSpacingX: 25,
      gridSpacingY: 25,
      gridOrigin: { x: 0, y: 0 },
      aperture: 12,
    });
  }

  layerPlan(document: KDrawDocumentV1, command: LayerManagerCommand): LayerManagerPlan {
    return new LayerManagerController(document, { opIdPrefix: "visual-shell-layer" }).plan(command);
  }

  annotation(commandId: AnnotationCommandId, selectedHandles: readonly string[]): AnnotationAction {
    return createAnnotationAction(commandId, selectedHandles);
  }

  block(commandId: BlockCommandId, selectedHandles: readonly string[]): BlockAction {
    return createBlockAction(commandId, selectedHandles);
  }
}
