import type { CommandDefinition, CommandInvocation, PreparedEngineCommand } from "../command-system/command-engine.js";
import { CommandEngineInputError } from "../command-system/command-engine.js";
import { prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";

export type AnnotationCommandPlanner = typeof prepareAnnotationCommand;
export type AnnotationEngineCommandId = "TEXT" | "MTEXT" | "LEADER" | "MLEADER" | "DIM" | "STYLE" | "HATCH" | "TABLE";

const DIMENSION_OPTIONS = Object.freeze({
  LINEAR: "DIMLINEAR",
  ALIGNED: "DIMALIGNED",
  ANGULAR: "DIMANGULAR",
  RADIUS: "DIMRADIUS",
  DIAMETER: "DIMDIAMETER",
  CONTINUE: "DIMCONTINUE",
  BASELINE: "DIMBASELINE",
  STYLE: "DIMSTYLE",
} satisfies Record<string, AnnotationCommandInput["commandId"]>);

export function encodeTypedCommandPayload(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

function decodeTypedCommandPayload<T>(invocation: CommandInvocation): T {
  if (invocation.arguments.length !== 1) throw new CommandEngineInputError(`${invocation.commandId} requires exactly one typed payload.`);
  try {
    return JSON.parse(decodeURIComponent(invocation.arguments[0]!)) as T;
  } catch {
    throw new CommandEngineInputError(`${invocation.commandId} typed payload is invalid.`);
  }
}

function normalizePrepared(engineCommandId: AnnotationEngineCommandId, input: AnnotationCommandInput, prepared: PreparedEngineCommand): PreparedEngineCommand {
  return {
    ...prepared,
    commandId: engineCommandId,
    operationArgs: { typedCommandId: input.commandId, input: structuredClone(input) },
  };
}

function directDefinition(id: Exclude<AnnotationEngineCommandId, "DIM">, expectedInputId: AnnotationCommandInput["commandId"], planner: AnnotationCommandPlanner): CommandDefinition {
  return {
    id,
    prepare(document, invocation) {
      const input = decodeTypedCommandPayload<AnnotationCommandInput>(invocation);
      if (input.commandId !== expectedInputId) throw new CommandEngineInputError(`${id} received ${input.commandId}.`);
      return normalizePrepared(id, input, planner(document, input));
    },
  };
}

export function createAnnotationCommandDefinitions(planner: AnnotationCommandPlanner = prepareAnnotationCommand): readonly CommandDefinition[] {
  return [
    directDefinition("TEXT", "TEXT", planner),
    directDefinition("MTEXT", "MTEXT", planner),
    directDefinition("LEADER", "LEADER", planner),
    directDefinition("MLEADER", "MLEADER", planner),
    {
      id: "DIM",
      options: Object.entries(DIMENSION_OPTIONS).map(([id]) => ({ id })),
      prepare(document, invocation) {
        if (invocation.options.length !== 1) throw new CommandEngineInputError("DIM requires exactly one dimension option.");
        const expected = DIMENSION_OPTIONS[invocation.options[0]! as keyof typeof DIMENSION_OPTIONS];
        const input = decodeTypedCommandPayload<AnnotationCommandInput>(invocation);
        if (!expected || input.commandId !== expected) throw new CommandEngineInputError(`DIM option does not match ${input.commandId}.`);
        return normalizePrepared("DIM", input, planner(document, input));
      },
    },
    directDefinition("STYLE", "STYLE", planner),
    directDefinition("HATCH", "HATCH", planner),
    directDefinition("TABLE", "TABLE", planner),
  ];
}

export function annotationCommandLine(input: AnnotationCommandInput): string {
  if (input.commandId.startsWith("DIM")) {
    const option = Object.entries(DIMENSION_OPTIONS).find(([, commandId]) => commandId === input.commandId)?.[0];
    if (!option) throw new CommandEngineInputError(`Unsupported DIM command ${input.commandId}.`);
    return `DIM /${option} ${encodeTypedCommandPayload(input)}`;
  }
  return `${input.commandId} ${encodeTypedCommandPayload(input)}`;
}
