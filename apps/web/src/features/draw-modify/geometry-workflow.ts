import { CadSession, type CadChange, type CommittedOperation } from "@kuubik/cad-core";
import type { CadEntity, CadOperation } from "@kuubik/cad-schema";

export interface GeometryPreparation {
  commandId: string;
  entities: CadEntity[];
  changes: CadChange[];
  resultHandles: string[];
}

export interface GeometryCommandAdapter<Input> {
  prepare(input: Input): GeometryPreparation;
}

export interface GeometryWorkflow<Input> {
  preview(input: Input): GeometryPreparation;
  commit(input: Input, opId: string, now?: string): CommittedOperation;
  undo(now?: string): CommittedOperation | null;
  redo(now?: string): CommittedOperation | null;
  readonly session: CadSession;
}

function stablePreparation(prepared: GeometryPreparation): GeometryPreparation {
  return structuredClone(prepared);
}

export function createGeometryWorkflow<Input>(session: CadSession, adapter: GeometryCommandAdapter<Input>): GeometryWorkflow<Input> {
  return {
    session,
    preview(input) {
      return stablePreparation(adapter.prepare(structuredClone(input)));
    },
    commit(input, opId, now) {
      if (opId.trim() === "") throw new TypeError("Geometry operation id must not be empty.");
      // Preview and commit intentionally call the same preparation function. No
      // canvas-only approximation is allowed to become document geometry.
      const prepared = stablePreparation(adapter.prepare(structuredClone(input)));
      const operation: CadOperation = {
        opId,
        baseRevision: session.document.revision,
        commandId: prepared.commandId,
        args: structuredClone(input),
        targetHandles: [],
        resultHandles: [...prepared.resultHandles],
      };
      return session.commit(operation, prepared.changes, now);
    },
    undo(now) {
      return session.undo(now);
    },
    redo(now) {
      return session.redo(now);
    },
  };
}
