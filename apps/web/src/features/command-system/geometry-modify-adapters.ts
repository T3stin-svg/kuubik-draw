import {
  prepareArrayCommand,
  prepareBoundaryCommand,
  prepareCompleteCircleDocumentCommand,
  prepareGeometryCommand,
  preparePeditCommand,
  prepareRegionCommand,
  prepareSplineCommand,
  quickSelect,
  selectSimilar,
  type ArrayCommandInput,
  type BoundaryCommandInput,
  type CompleteCircleCommandInput,
  type GeometryCommandInput,
  type PeditCommandInput,
  type QuickSelectInput,
  type QuickSelectResult,
  type RegionCommandInput,
  type SelectSimilarCriterion,
  type SplineCommandInput,
} from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import type { PreparedAtomicCommand } from "../draw-modify/atomic-command-workflow.js";
import { previewModifyMatrixCommand, type ModifyMatrixInput } from "../draw-modify/modify-command-matrix.js";
import type { CommandDefinition, CommandInvocation } from "./command-engine.js";

type GeometryInput<Id extends GeometryCommandInput["command"]> = Extract<GeometryCommandInput, { command: Id }>;
type ArrayInput<Id extends ArrayCommandInput["command"]> = Extract<ArrayCommandInput, { command: Id }>;
type MatrixInput<Id extends ModifyMatrixInput["command"]> = Extract<ModifyMatrixInput, { command: Id }>;

export interface GeometryModifyDocumentInputMap {
  LINE: GeometryInput<"LINE">;
  PLINE: GeometryInput<"PLINE">;
  CIRCLE: CompleteCircleCommandInput;
  ARC: GeometryInput<"ARC">;
  POLYGON: GeometryInput<"POLYGON">;
  ELLIPSE: GeometryInput<"ELLIPSE">;
  REVCLOUD: GeometryInput<"REVCLOUD">;
  ARRAYRECT: ArrayInput<"ARRAYRECT">;
  ARRAYPOLAR: ArrayInput<"ARRAYPOLAR">;
  ARRAYPATH: ArrayInput<"ARRAYPATH">;
  PEDIT: PeditCommandInput;
  SPLINE: SplineCommandInput;
  BOUNDARY: BoundaryCommandInput;
  REGION: RegionCommandInput;
  TRIM: MatrixInput<"TRIM">;
  EXTEND: MatrixInput<"EXTEND">;
  FILLET: MatrixInput<"FILLET">;
  STRETCH: MatrixInput<"STRETCH">;
}

export type GeometryModifyDocumentCommandId = keyof GeometryModifyDocumentInputMap;

export type GeometryModifyDocumentRequest = {
  [Id in GeometryModifyDocumentCommandId]: { commandId: Id; input: GeometryModifyDocumentInputMap[Id] }
}[GeometryModifyDocumentCommandId];

export const GEOMETRY_MODIFY_DOCUMENT_COMMAND_IDS = Object.freeze([
  "LINE", "PLINE", "CIRCLE", "ARC", "POLYGON", "ELLIPSE", "REVCLOUD",
  "ARRAYRECT", "ARRAYPOLAR", "ARRAYPATH", "PEDIT", "SPLINE", "BOUNDARY", "REGION",
  "TRIM", "EXTEND", "FILLET", "STRETCH",
] as const satisfies readonly GeometryModifyDocumentCommandId[]);

function atomic(
  commandId: string,
  changes: PreparedAtomicCommand["changes"],
  targetHandles: readonly string[],
  resultHandles: readonly string[],
  operationArgs: unknown,
): PreparedAtomicCommand {
  return {
    commandId,
    changes: structuredClone(changes),
    targetHandles: [...targetHandles],
    resultHandles: [...resultHandles],
    operationArgs: structuredClone(operationArgs),
  };
}

export function prepareGeometryModifyDocumentCommand(
  document: KDrawDocumentV1,
  request: GeometryModifyDocumentRequest,
): PreparedAtomicCommand {
  switch (request.commandId) {
    case "CIRCLE": {
      const prepared = prepareCompleteCircleDocumentCommand(document, request.input);
      return atomic(prepared.commandId, prepared.changes, [], prepared.resultHandles, request.input);
    }
    case "LINE": case "PLINE": case "ARC": case "POLYGON": case "ELLIPSE": case "REVCLOUD": {
      const prepared = prepareGeometryCommand(request.input);
      if (prepared.commandId !== request.commandId) throw new TypeError(`${request.commandId} adapter prepared ${prepared.commandId}.`);
      return atomic(prepared.commandId, prepared.changes, [], prepared.resultHandles, request.input);
    }
    case "ARRAYRECT": case "ARRAYPOLAR": case "ARRAYPATH": {
      const prepared = prepareArrayCommand(document, request.input);
      if (prepared.commandId !== request.commandId) throw new TypeError(`${request.commandId} adapter prepared ${prepared.commandId}.`);
      return atomic(prepared.commandId, prepared.changes, prepared.sourceHandles, prepared.resultHandles, request.input);
    }
    case "PEDIT": {
      const prepared = preparePeditCommand(document, request.input);
      return atomic("PEDIT", prepared.changes, prepared.sourceHandles, prepared.resultHandles, request.input);
    }
    case "SPLINE": {
      const prepared = prepareSplineCommand(document, request.input);
      return atomic("SPLINE", prepared.changes, prepared.targetHandles, prepared.resultHandles, request.input);
    }
    case "BOUNDARY": {
      const prepared = prepareBoundaryCommand(document, request.input);
      return atomic("BOUNDARY", prepared.changes, prepared.targetHandles, prepared.resultHandles, request.input);
    }
    case "REGION": {
      const prepared = prepareRegionCommand(document, request.input);
      return atomic("REGION", prepared.changes, prepared.targetHandles, prepared.resultHandles, request.input);
    }
    case "TRIM": case "EXTEND": case "FILLET": case "STRETCH": {
      const prepared = previewModifyMatrixCommand(document, request.input);
      if (prepared.commandId !== request.commandId) throw new TypeError(`${request.commandId} adapter prepared ${prepared.commandId}.`);
      return atomic(prepared.commandId, prepared.changes, prepared.targetHandles, prepared.resultHandles, prepared.operationArgs);
    }
  }
}

export interface GeometryModifySelectionInputMap {
  QSELECT: QuickSelectInput;
  SELECTSIMILAR: {
    sourceHandle: string;
    criteria: readonly SelectSimilarCriterion[];
    currentSelection?: readonly string[];
    append?: boolean;
  };
}

export type GeometryModifySelectionRequest = {
  [Id in keyof GeometryModifySelectionInputMap]: { commandId: Id; input: GeometryModifySelectionInputMap[Id] }
}[keyof GeometryModifySelectionInputMap];

export function prepareGeometryModifySelectionCommand(
  document: KDrawDocumentV1,
  request: GeometryModifySelectionRequest,
): { commandId: GeometryModifySelectionRequest["commandId"]; result: QuickSelectResult } {
  if (request.commandId === "QSELECT") return { commandId: "QSELECT", result: quickSelect(document, request.input) };
  return {
    commandId: "SELECTSIMILAR",
    result: selectSimilar(
      document,
      request.input.sourceHandle,
      request.input.criteria,
      request.input.currentSelection ?? [],
      request.input.append ?? false,
    ),
  };
}

export type GeometryModifyInvocationParsers = {
  [Id in GeometryModifyDocumentCommandId]: (invocation: CommandInvocation) => GeometryModifyDocumentInputMap[Id]
};

function option(id: string, aliases: readonly string[] = []) {
  return { id, aliases };
}

export function createGeometryModifyCommandDefinitions(parsers: GeometryModifyInvocationParsers): CommandDefinition[] {
  return [
    { id: "LINE", aliases: ["L"], options: [option("CLOSE", ["C"]), option("UNDO", ["U"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "LINE", input: parsers.LINE(invocation) }) },
    { id: "PLINE", aliases: ["PL"], options: [option("ARC", ["A"]), option("LINE", ["L"]), option("CLOSE", ["C"]), option("UNDO", ["U"]), option("WIDTH", ["W"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "PLINE", input: parsers.PLINE(invocation) }) },
    { id: "CIRCLE", aliases: ["C"], options: [option("2P"), option("3P"), option("TTR"), option("TTT"), option("DIAMETER", ["D"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "CIRCLE", input: parsers.CIRCLE(invocation) }) },
    { id: "ARC", aliases: ["A"], options: [option("CENTER", ["C"]), option("END", ["E"]), option("ANGLE", ["A"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "ARC", input: parsers.ARC(invocation) }) },
    { id: "POLYGON", aliases: ["POL"], options: [option("EDGE", ["E"]), option("INSCRIBED", ["I"]), option("CIRCUMSCRIBED", ["C"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "POLYGON", input: parsers.POLYGON(invocation) }) },
    { id: "ELLIPSE", aliases: ["EL"], options: [option("ARC", ["A"]), option("CENTER", ["C"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "ELLIPSE", input: parsers.ELLIPSE(invocation) }) },
    { id: "REVCLOUD", options: [option("ARCLENGTH", ["A"]), option("OBJECT", ["O"]), option("STYLE", ["S"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "REVCLOUD", input: parsers.REVCLOUD(invocation) }) },
    { id: "ARRAYRECT", aliases: ["ARRAY"], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "ARRAYRECT", input: parsers.ARRAYRECT(invocation) }) },
    { id: "ARRAYPOLAR", prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "ARRAYPOLAR", input: parsers.ARRAYPOLAR(invocation) }) },
    { id: "ARRAYPATH", prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "ARRAYPATH", input: parsers.ARRAYPATH(invocation) }) },
    { id: "PEDIT", aliases: ["PE"], options: [option("CLOSE", ["C"]), option("JOIN", ["J"]), option("WIDTH", ["W"]), option("REVERSE", ["R"]), option("DECURVE", ["D"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "PEDIT", input: parsers.PEDIT(invocation) }) },
    { id: "SPLINE", aliases: ["SPL"], options: [option("METHOD", ["M"]), option("KNOTS", ["K"]), option("OBJECT", ["O"]), option("TOLERANCE", ["T"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "SPLINE", input: parsers.SPLINE(invocation) }) },
    { id: "BOUNDARY", aliases: ["BO", "BPOLY"], options: [option("ISLAND", ["I"]), option("REGION", ["R"]), option("POLYLINE", ["P"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "BOUNDARY", input: parsers.BOUNDARY(invocation) }) },
    { id: "REGION", aliases: ["REG"], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "REGION", input: parsers.REGION(invocation) }) },
    { id: "TRIM", aliases: ["TR"], options: [option("QUICK", ["Q"]), option("STANDARD", ["S"]), option("EDGE", ["E"]), option("PROJECT", ["P"]), option("ERASE", ["R"]), option("UNDO", ["U"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "TRIM", input: parsers.TRIM(invocation) }) },
    { id: "EXTEND", aliases: ["EX"], options: [option("QUICK", ["Q"]), option("STANDARD", ["S"]), option("EDGE", ["E"]), option("PROJECT", ["P"]), option("TRIM", ["T"]), option("UNDO", ["U"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "EXTEND", input: parsers.EXTEND(invocation) }) },
    { id: "FILLET", aliases: ["F"], options: [option("RADIUS", ["R"]), option("TRIM", ["T"]), option("MULTIPLE", ["M"]), option("POLYLINE", ["P"]), option("UNDO", ["U"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "FILLET", input: parsers.FILLET(invocation) }) },
    { id: "STRETCH", aliases: ["S"], options: [option("CROSSING", ["C"]), option("CP"), option("DISPLACEMENT", ["D"]), option("UNDO", ["U"])], prepare: (document, invocation) => prepareGeometryModifyDocumentCommand(document, { commandId: "STRETCH", input: parsers.STRETCH(invocation) }) },
  ];
}
