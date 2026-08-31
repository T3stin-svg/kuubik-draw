import {
  prepareArrayCommand,
  prepareArrayPathPropertyUpdate,
  refreshAssociativePathArrays,
  type ArrayCommandInput,
  type ArrayPathPropertyPatch,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const arrayCommandAdapter: AtomicCommandAdapter<ArrayCommandInput> = {
  prepare(document: KDrawDocumentV1, input: ArrayCommandInput): PreparedAtomicCommand {
    const prepared = prepareArrayCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...prepared.sourceHandles, ...(input.command === "ARRAYPATH" ? [input.pathHandle] : [])],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};

export interface RefreshArrayPathInput {
  changedHandles: readonly string[];
}

export const refreshArrayPathAdapter: AtomicCommandAdapter<RefreshArrayPathInput> = {
  prepare(document: KDrawDocumentV1, input: RefreshArrayPathInput): PreparedAtomicCommand {
    const prepared = refreshAssociativePathArrays(document, input.changedHandles);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...new Set(input.changedHandles)],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};

export interface ArrayPathPropertyUpdateInput {
  associationId: string;
  patch: ArrayPathPropertyPatch;
}

export const arrayPathPropertyUpdateAdapter: AtomicCommandAdapter<ArrayPathPropertyUpdateInput> = {
  prepare(document: KDrawDocumentV1, input: ArrayPathPropertyUpdateInput): PreparedAtomicCommand {
    const prepared = prepareArrayPathPropertyUpdate(document, input.associationId, input.patch);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [input.associationId],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
