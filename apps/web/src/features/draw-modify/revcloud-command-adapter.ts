import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  prepareRevcloudCommand,
  type RevcloudCommandInput,
} from "../../../../../packages/cad-core/src/revcloud-command.js";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const revcloudCommandAdapter: AtomicCommandAdapter<RevcloudCommandInput> = {
  prepare(document: KDrawDocumentV1, input: RevcloudCommandInput): PreparedAtomicCommand {
    const prepared = prepareRevcloudCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...prepared.targetHandles],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
