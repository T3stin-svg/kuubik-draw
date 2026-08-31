import type { CommandDefinition } from "../command-system/command-engine.js";
import { CommandEngineInputError } from "../command-system/command-engine.js";
import { encodeTypedCommandPayload } from "../annotation/command-definition.js";
import { prepareBlockCommand, type BlockCommandInput } from "./command-adapter.js";

export type BlockCommandPlanner = typeof prepareBlockCommand;
export type BlockEngineCommandId = BlockCommandInput["commandId"];

function decodeBlockPayload(raw: string[], expected: BlockEngineCommandId): BlockCommandInput {
  if (raw.length !== 1) throw new CommandEngineInputError(`${expected} requires exactly one typed payload.`);
  try {
    const input = JSON.parse(decodeURIComponent(raw[0]!)) as BlockCommandInput;
    if (input.commandId !== expected) throw new CommandEngineInputError(`${expected} received ${input.commandId}.`);
    return input;
  } catch (error) {
    if (error instanceof CommandEngineInputError) throw error;
    throw new CommandEngineInputError(`${expected} typed payload is invalid.`);
  }
}

export function createBlockCommandDefinitions(planner: BlockCommandPlanner = prepareBlockCommand): readonly CommandDefinition[] {
  return (["BLOCK", "INSERT", "BEDIT", "EXPLODE", "ATTRIB"] as const).map((id) => ({
    id,
    prepare(document, invocation) {
      const input = decodeBlockPayload(invocation.arguments, id);
      return planner(document, input);
    },
  }));
}

export function blockCommandLine(input: BlockCommandInput): string {
  return `${input.commandId} ${encodeTypedCommandPayload(input)}`;
}
