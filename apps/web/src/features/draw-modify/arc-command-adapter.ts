import {
  prepareCompleteArcDocumentCommand,
  type CompleteArcCommandInput,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const arcCommandAdapter: AtomicCommandAdapter<CompleteArcCommandInput> = {
  prepare(document: KDrawDocumentV1, input: CompleteArcCommandInput): PreparedAtomicCommand {
    const prepared = prepareCompleteArcDocumentCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
