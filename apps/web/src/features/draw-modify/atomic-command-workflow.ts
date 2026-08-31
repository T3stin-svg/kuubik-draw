import { CadSession, type CadChange, type CommittedOperation } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface PreparedAtomicCommand {
  commandId: string;
  changes: CadChange[];
  targetHandles: string[];
  resultHandles: string[];
  operationArgs: unknown;
}

export interface AtomicCommandAdapter<Input> {
  prepare(document: KDrawDocumentV1, input: Input): PreparedAtomicCommand;
}

export function createAtomicCommandWorkflow<Input>(session: CadSession, adapter: AtomicCommandAdapter<Input>) {
  return {
    session,
    preview(input: Input): PreparedAtomicCommand {
      return structuredClone(adapter.prepare(session.document, structuredClone(input)));
    },
    commit(input: Input, opId: string, now?: string): CommittedOperation {
      if (opId.trim() === "") throw new TypeError("Operation id must not be empty.");
      const prepared = adapter.prepare(session.document, structuredClone(input));
      const operation: CadOperation = {
        opId,
        baseRevision: session.document.revision,
        commandId: prepared.commandId,
        args: structuredClone(prepared.operationArgs),
        targetHandles: [...prepared.targetHandles],
        resultHandles: [...prepared.resultHandles],
      };
      return session.commit(operation, prepared.changes, now);
    },
    undo(now?: string): CommittedOperation | null {
      return session.undo(now);
    },
    redo(now?: string): CommittedOperation | null {
      return session.redo(now);
    },
  };
}
