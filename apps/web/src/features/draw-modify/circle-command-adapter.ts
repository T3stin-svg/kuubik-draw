import {
  prepareCompleteCircleDocumentCommand,
  type CompleteCircleCommandInput,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const circleCommandAdapter: AtomicCommandAdapter<CompleteCircleCommandInput> = {
  prepare(document: KDrawDocumentV1, input: CompleteCircleCommandInput): PreparedAtomicCommand {
    const prepared = prepareCompleteCircleDocumentCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
