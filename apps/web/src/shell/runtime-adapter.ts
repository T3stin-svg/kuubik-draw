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
import { createAnnotationAction, type AnnotationAction, type AnnotationCommandId } from "../features/annotation/model.js";
import { createBlockAction, type BlockAction, type BlockCommandId } from "../features/blocks/model.js";
import { LayerFeatureModel } from "../features/layers/model.js";
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
  "F-001", "F-003",
  "F-016", "F-017", "F-018", "F-019", "F-020", "F-021", "F-022", "F-024", "F-027", "F-030",
  "F-045", "F-047", "F-049", "F-050", "F-052",
  "F-057", "F-059", "F-061", "F-067",
  "F-072", "F-073", "F-074",
  "F-086", "F-087", "F-088", "F-090", "F-091",
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

function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry([
    { id: "LINE", aliases: ["L"], prepare: prepareLine },
    { id: "RECTANGLE", aliases: ["REC", "RECTANG"], prepare: prepareRectangle },
  ]);
}

/** Typed boundary between the visual shell and already-integrated deterministic feature modules. */
export class VisualShellRuntimeAdapter {
  readonly commandRegistry = createCommandRegistry();
  readonly precision = new PrecisionFeatureModel();

  canExecute(rowId: string): boolean {
    return RUNTIME_ROWS.has(rowId);
  }

  commandEngine(session: CadSession): CommandLineEngine {
    return new CommandLineEngine(session, this.commandRegistry);
  }

  layers(document: KDrawDocumentV1): LayerFeatureModel {
    return new LayerFeatureModel(document);
  }

  annotation(commandId: AnnotationCommandId, selectedHandles: readonly string[]): AnnotationAction {
    return createAnnotationAction(commandId, selectedHandles);
  }

  block(commandId: BlockCommandId, selectedHandles: readonly string[]): BlockAction {
    return createBlockAction(commandId, selectedHandles);
  }
}
