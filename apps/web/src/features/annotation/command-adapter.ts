import {
  createAlignedDimension,
  createAngularDimension,
  createBaselineDimensions,
  createContinuedDimensions,
  createDimensionStyle,
  createHatch,
  createLeader,
  createLinearDimension,
  createMLeader,
  createMText,
  createRadialDimension,
  createText,
  createTextStyle,
  applyDimensionStyle,
  updateDimensionStyle,
  updateTextStyle,
  type CadChange,
  type CadSession,
  type DimensionBaseArgs,
  type HatchArgs,
  type MTextArgs,
  type TextArgs,
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
  | ({ commandId: "MTEXT"; args: MTextArgs } & WithTargets)
  | { commandId: "STYLE"; mode: "create" | "update"; style: CadTextStyle }
  | ({ commandId: "LEADER"; args: LeaderArgs } & WithTargets)
  | ({ commandId: "MLEADER"; args: MLeaderArgs } & WithTargets)
  | ({ commandId: "HATCH"; args: HatchArgs } & WithTargets);

function result(commandId: string, changes: CadChange[], targetHandles: readonly string[], resultHandles: readonly string[], operationArgs: unknown): PreparedAtomicCommand {
  if (!changes.length) throw new RangeError(`${commandId} prepared no document change.`);
  return { commandId, changes, targetHandles: [...targetHandles], resultHandles: [...resultHandles], operationArgs: structuredClone(operationArgs) };
}

export function prepareAnnotationCommand(document: KDrawDocumentV1, input: AnnotationCommandInput): PreparedAtomicCommand {
  const targets = input.commandId === "STYLE" ? [] : input.commandId === "DIMSTYLE" ? (input.mode === "apply" ? input.targetHandles : []) : input.targetHandles ?? [];
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
      const entity = createMText(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "STYLE": {
      const change = input.mode === "create" ? createTextStyle(document, input.style) : updateTextStyle(document, input.style);
      return result(input.commandId, [change], [], [], input);
    }
    case "LEADER": {
      const entity = createLeader(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "MLEADER": {
      const entity = createMLeader(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], targets, [entity.handle], input.args);
    }
    case "HATCH": {
      const entity = createHatch(document, input.args);
      return result(input.commandId, [{ type: "put", entity }], input.targetHandles ?? input.args.boundaryHandles, [entity.handle], input.args);
    }
  }
}

export function createAnnotationCommandAdapter(): AtomicCommandAdapter<AnnotationCommandInput> {
  return { prepare: prepareAnnotationCommand };
}

export function createAnnotationCommandWorkflow(session: CadSession) {
  return createAtomicCommandWorkflow(session, createAnnotationCommandAdapter());
}
