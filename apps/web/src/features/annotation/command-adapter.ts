import {
  createAlignedDimension,
  createAngularDimension,
  createBaselineDimensions,
  createContinuedDimensions,
  createDimensionStyle,
  createHatch,
  editHatch,
  createLeader,
  createLinearDimension,
  createMLeader,
  createMText,
  createRadialDimension,
  createText,
  createTextStyle,
  applyTextStyle,
  editLeader,
  editMText,
  createTable,
  createTableStyle,
  applyDimensionStyle,
  editTable,
  updateDimensionStyle,
  updateTextStyle,
  updateTableStyle,
  type CadChange,
  type CadSession,
  type DimensionBaseArgs,
  type HatchArgs,
  type HatchEditPatch,
  type MTextArgs,
  type MTextEditPatch,
  type TextArgs,
  type LeaderEditPatch,
  type MLeaderEditPatch,
  type CreateTableArgs,
  type TableEditOperation,
  type TableStyle,
} from "@kuubik/cad-core";
import type { CadDimensionStyle, CadTextStyle, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createAtomicCommandWorkflow, type AtomicCommandAdapter, type PreparedAtomicCommand } from "../draw-modify/atomic-command-workflow.js";

type AngularArgs = Parameters<typeof createAngularDimension>[1];
type RadialArgs = Parameters<typeof createRadialDimension>[1];
type ContinueArgs = Parameters<typeof createContinuedDimensions>[1];
type BaselineArgs = Parameters<typeof createBaselineDimensions>[1];
type LeaderArgs = Parameters<typeof createLeader>[1];
type MLeaderArgs = Parameters<typeof createMLeader>[1];

interface WithTargets { targetHandles?: string[] }

export type AnnotationCommandInput =
  | ({ commandId: "DIMLINEAR"; args: DimensionBaseArgs & { axis: "horizontal" | "vertical" } } & WithTargets)
  | ({ commandId: "DIMALIGNED"; args: DimensionBaseArgs } & WithTargets)
  | ({ commandId: "DIMANGULAR"; args: AngularArgs } & WithTargets)
  | ({ commandId: "DIMRADIUS"; args: RadialArgs } & WithTargets)
  | ({ commandId: "DIMDIAMETER"; args: RadialArgs } & WithTargets)
  | ({ commandId: "DIMCONTINUE"; args: ContinueArgs } & WithTargets)
  | ({ commandId: "DIMBASELINE"; args: BaselineArgs } & WithTargets)
  | { commandId: "DIMSTYLE"; mode: "create" | "update"; style: CadDimensionStyle }
  | { commandId: "DIMSTYLE"; mode: "apply"; styleId: string; targetHandles: string[] }
  | ({ commandId: "TEXT"; args: TextArgs } & WithTargets)
  | ({ commandId: "MTEXT"; mode?: "create"; args: MTextArgs } & WithTargets)
  | { commandId: "MTEXT"; mode: "edit"; handle: string; patch: MTextEditPatch }
  | { commandId: "STYLE"; mode: "create" | "update"; style: CadTextStyle }
  | { commandId: "STYLE"; mode: "apply"; styleId: string; targetHandles: string[] }
  | ({ commandId: "LEADER"; mode?: "create"; args: LeaderArgs } & WithTargets)
  | { commandId: "LEADER"; mode: "edit"; handle: string; patch: LeaderEditPatch }
  | ({ commandId: "MLEADER"; mode?: "create"; args: MLeaderArgs } & WithTargets)
  | { commandId: "MLEADER"; mode: "edit"; handle: string; patch: MLeaderEditPatch }
  | ({ commandId: "HATCH"; mode?: "create"; args: HatchArgs } & WithTargets)
  | { commandId: "HATCH"; mode: "edit"; handle: string; patch: HatchEditPatch }
  | { commandId: "TABLE"; mode: "create"; args: CreateTableArgs }
  | { commandId: "TABLE"; mode: "edit"; handle: string; operations: TableEditOperation[] }
  | { commandId: "TABLE"; mode: "style-create" | "style-update"; style: TableStyle };

function result(commandId: string, changes: CadChange[], targetHandles: readonly string[], resultHandles: readonly string[], operationArgs: unknown): PreparedAtomicCommand {
  if (!changes.length) throw new RangeError(`${commandId} prepared no document change.`);
  return { commandId, changes, targetHandles: [...targetHandles], resultHandles: [...resultHandles], operationArgs: structuredClone(operationArgs) };
}

export function prepareAnnotationCommand(document: KDrawDocumentV1, input: AnnotationCommandInput): PreparedAtomicCommand {
  const targets = input.commandId === "TABLE" ? [] : input.commandId === "STYLE" ? (input.mode === "apply" ? input.targetHandles : []) : input.commandId === "DIMSTYLE" ? (input.mode === "apply" ? input.targetHandles : []) : "targetHandles" in input ? input.targetHandles ?? [] : [];
  switch (input.commandId) {
    case "DIMLINEAR": {
      const entity = createLinearDimension(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "DIMALIGNED": {
      const entity = createAlignedDimension(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "DIMANGULAR": {
      const entity = createAngularDimension(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "DIMRADIUS": {
      const entity = createRadialDimension(document, { ...input.args, diameter: false });
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "DIMDIAMETER": {
      const entity = createRadialDimension(document, { ...input.args, diameter: true });
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "DIMCONTINUE": {
      const entities = createContinuedDimensions(document, input.args);
      return result(input.commandId, entities.map((entity) => ({ type: "put", entity })), targets, entities.map((entity) => entity.handle), input.args);
    }
    case "DIMBASELINE": {
      const entities = createBaselineDimensions(document, input.args);
      return result(input.commandId, entities.map((entity) => ({ type: "put", entity })), targets, entities.map((entity) => entity.handle), input.args);
    }
    case "DIMSTYLE": {
      if (input.mode === "apply") {
        const changes = applyDimensionStyle(document, input.styleId, input.targetHandles);
        return result(input.commandId, changes, input.targetHandles, input.targetHandles, input);
      }
      const change = input.mode === "create" ? createDimensionStyle(document, input.style) : updateDimensionStyle(document, input.style);
      return result(input.commandId, [change], [], [], input);
    }
    case "TEXT": {
      const entity = createText(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "MTEXT": {
      if (input.mode === "edit") {
        const change = editMText(document, input.handle, input.patch);
        return result(input.commandId, [change], [input.handle], [input.handle], input);
      }
      const entity = createMText(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "STYLE": {
      if (input.mode === "apply") {
        const changes = applyTextStyle(document, input.styleId, input.targetHandles);
        return result(input.commandId, changes, input.targetHandles, input.targetHandles, input);
      }
      const change = input.mode === "create" ? createTextStyle(document, input.style) : updateTextStyle(document, input.style);
      return result(input.commandId, [change], [], [], input);
    }
    case "LEADER": {
      if (input.mode === "edit") {
        const change = editLeader(document, input.handle, input.patch);
        return result(input.commandId, [change], [input.handle], [input.handle], input);
      }
      const entity = createLeader(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "MLEADER": {
      if (input.mode === "edit") {
        const change = editLeader(document, input.handle, input.patch);
        return result(input.commandId, [change], [input.handle], [input.handle], input);
      }
      const entity = createMLeader(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "HATCH": {
      if (input.mode === "edit") {
        const change = editHatch(document, input.handle, input.patch);
        return result(input.commandId, [change], [input.handle], [input.handle], input);
      }
      const entity = createHatch(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], input.targetHandles ?? input.args.boundaryHandles, [entity.handle], input.args);
    }
    case "TABLE": {
      if (input.mode === "create") {
        const entity = createTable(document, input.args);
        return result(input.commandId, [{ type: "put", entity }], [], [entity.handle], input.args);
      }
      if (input.mode === "edit") {
        const change = editTable(document, input.handle, input.operations);
        return result(input.commandId, [change], [input.handle], [input.handle], input);
      }
      const change = input.mode === "style-create" ? createTableStyle(document, input.style) : updateTableStyle(document, input.style);
      return result(input.commandId, [change], [], [], input);
    }
  }
}

export function createAnnotationCommandAdapter(): AtomicCommandAdapter<AnnotationCommandInput> {
  return { prepare: prepareAnnotationCommand };
}

export function createAnnotationCommandWorkflow(session: CadSession) {
  return createAtomicCommandWorkflow(session, createAnnotationCommandAdapter());
}
