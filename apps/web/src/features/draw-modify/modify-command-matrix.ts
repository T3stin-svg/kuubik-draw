import {
  CadSession,
  type CadChange,
  type CommittedOperation,
  type ExtendTargetAction,
  type FilletTrimMode,
  type TrimEdgeMode,
  type TrimMode,
  type TrimProjectMode,
  type TrimTargetAction,
} from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { prepareExtend, prepareFillet, prepareStretch, prepareTrim } from "../../workflows/modify-command.js";

export const MODIFY_COMMAND_MATRIX = Object.freeze({
  TRIM: {
    aliases: ["TR", "TRIM"],
    modes: ["quick", "standard"],
    options: ["Cutting edges", "Fence", "Crossing", "Project", "Edge", "Erase", "Undo"],
  },
  EXTEND: {
    aliases: ["EX", "EXTEND"],
    modes: ["quick", "standard"],
    options: ["Boundary edges", "Fence", "Crossing", "Project", "Edge", "Trim", "Undo"],
  },
  FILLET: {
    aliases: ["F", "FILLET"],
    modes: ["pairs", "polyline"],
    options: ["Radius", "Trim", "Multiple", "Polyline", "Undo"],
  },
  STRETCH: {
    aliases: ["S", "STRETCH"],
    modes: ["crossing-window", "crossing-polygon", "individual"],
    options: ["Crossing", "CP", "Base point", "Displacement", "Undo"],
  },
} as const);

interface TrimMatrixInput {
  command: "TRIM";
  mode: TrimMode;
  cuttingHandlesInput: string;
  targetsInput: string;
  targetAction: TrimTargetAction;
  edgeMode: TrimEdgeMode;
  projectMode: TrimProjectMode;
}

interface ExtendMatrixInput {
  command: "EXTEND";
  mode: TrimMode;
  boundaryHandlesInput: string;
  targetsInput: string;
  targetAction: ExtendTargetAction;
  edgeMode: TrimEdgeMode;
  projectMode: TrimProjectMode;
}

interface FilletMatrixInput {
  command: "FILLET";
  mode: "pairs" | "polyline";
  radiusInput: string;
  pairsInput: string;
  polylineHandlesInput: string;
  trimMode: FilletTrimMode;
  filletPolylineArc?: 0 | 1;
}

interface StretchMatrixInput {
  command: "STRETCH";
  crossingInput: string;
  individualHandles: readonly string[];
  baseInput: string;
  destinationInput: string;
}

export type ModifyMatrixInput = TrimMatrixInput | ExtendMatrixInput | FilletMatrixInput | StretchMatrixInput;

export interface PreparedModifyMatrixCommand {
  commandId: ModifyMatrixInput["command"];
  operationArgs: Readonly<Record<string, unknown>>;
  changes: CadChange[];
  targetHandles: string[];
  resultHandles: string[];
  rejectedCount: number;
}

function prepareMatrix(document: KDrawDocumentV1, input: ModifyMatrixInput): PreparedModifyMatrixCommand {
  switch (input.command) {
    case "TRIM": {
      const prepared = prepareTrim(document, input);
      return {
        commandId: "TRIM",
        operationArgs: prepared.operationArgs,
        changes: prepared.result.changes,
        targetHandles: prepared.result.targetHandles,
        resultHandles: prepared.result.resultHandles,
        rejectedCount: prepared.result.rejected.length,
      };
    }
    case "EXTEND": {
      const prepared = prepareExtend(document, input);
      return {
        commandId: "EXTEND",
        operationArgs: prepared.operationArgs,
        changes: prepared.result.changes,
        targetHandles: prepared.result.targetHandles,
        resultHandles: prepared.result.resultHandles,
        rejectedCount: prepared.result.rejected.length,
      };
    }
    case "FILLET": {
      const prepared = prepareFillet(document, input);
      return {
        commandId: "FILLET",
        operationArgs: prepared.operationArgs,
        changes: prepared.result.changes,
        targetHandles: prepared.result.sourceHandles,
        resultHandles: prepared.result.resultHandles,
        rejectedCount: prepared.result.rejected.length,
      };
    }
    case "STRETCH": {
      const prepared = prepareStretch(document, input);
      return {
        commandId: "STRETCH",
        operationArgs: prepared.operationArgs,
        changes: prepared.result.changes,
        targetHandles: prepared.result.sourceHandles,
        resultHandles: prepared.result.resultHandles,
        rejectedCount: prepared.result.rejected.length,
      };
    }
  }
}

export function previewModifyMatrixCommand(document: KDrawDocumentV1, input: ModifyMatrixInput): PreparedModifyMatrixCommand {
  return structuredClone(prepareMatrix(document, structuredClone(input)));
}

export function commitModifyMatrixCommand(
  session: CadSession,
  input: ModifyMatrixInput,
  opId: string,
  now?: string,
): CommittedOperation {
  if (opId.trim() === "") throw new TypeError("Modify operation id must not be empty.");
  // Commit uses the exact same matrix preparation as preview.
  const prepared = prepareMatrix(session.document, structuredClone(input));
  const operation: CadOperation = {
    opId,
    baseRevision: session.document.revision,
    commandId: prepared.commandId,
    args: structuredClone(prepared.operationArgs),
    targetHandles: [...prepared.targetHandles],
    resultHandles: [...prepared.resultHandles],
  };
  return session.commit(operation, prepared.changes, now);
}

function dropLastSemicolonItem(value: string): string {
  const items = value.split(";").map((item) => item.trim()).filter(Boolean);
  items.pop();
  return items.join("; ");
}

/** Returns the command state before its latest target/selection step without touching the document. */
export function undoLastModifyMatrixStep(input: ModifyMatrixInput): ModifyMatrixInput {
  if (input.command === "TRIM" || input.command === "EXTEND") {
    return { ...structuredClone(input), targetsInput: dropLastSemicolonItem(input.targetsInput) };
  }
  if (input.command === "FILLET") {
    if (input.mode === "pairs") return { ...structuredClone(input), pairsInput: dropLastSemicolonItem(input.pairsInput) };
    const handles = input.polylineHandlesInput.split(/[;,\s]+/u).filter(Boolean);
    handles.pop();
    return { ...structuredClone(input), polylineHandlesInput: handles.join(" ") };
  }
  if (input.individualHandles.length > 0) {
    return { ...structuredClone(input), individualHandles: input.individualHandles.slice(0, -1) };
  }
  const regions = input.crossingInput.split("|").map((item) => item.trim()).filter(Boolean);
  regions.pop();
  return { ...structuredClone(input), crossingInput: regions.join(" | ") };
}
