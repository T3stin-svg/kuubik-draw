import {
  prepareBoundaryCommand,
  prepareRegionCommand,
  type BoundaryCommandInput,
  type RegionCommandInput,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { AtomicCommandAdapter, PreparedAtomicCommand } from "./atomic-command-workflow.js";

export const boundaryCommandAdapter: AtomicCommandAdapter<BoundaryCommandInput> = {
  prepare(document: KDrawDocumentV1, input: BoundaryCommandInput): PreparedAtomicCommand {
    const prepared = prepareBoundaryCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...prepared.targetHandles],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};

export const regionCommandAdapter: AtomicCommandAdapter<RegionCommandInput> = {
  prepare(document: KDrawDocumentV1, input: RegionCommandInput): PreparedAtomicCommand {
    const prepared = prepareRegionCommand(document, input);
    return {
      commandId: prepared.commandId,
      changes: structuredClone(prepared.changes),
      targetHandles: [...prepared.targetHandles],
      resultHandles: [...prepared.resultHandles],
      operationArgs: structuredClone(input),
    };
  },
};
