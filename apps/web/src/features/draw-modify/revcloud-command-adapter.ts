import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  prepareRevcloudCommand,
  type RevcloudWorkflowCommandInput,
} from "@kuubik/cad-core";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const revcloudCommandAdapter: AtomicCommandAdapter<RevcloudWorkflowCommandInput> = {
  prepare(document: KDrawDocumentV1, input: RevcloudWorkflowCommandInput): PreparedAtomicCommand {
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
