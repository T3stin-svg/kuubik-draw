import { preparePeditCommand, type PeditCommandInput } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const peditCommandAdapter: AtomicCommandAdapter<PeditCommandInput> = {
  prepare(document: KDrawDocumentV1, input: PeditCommandInput): PreparedAtomicCommand {
    const prepared = preparePeditCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...prepared.sourceHandles],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
