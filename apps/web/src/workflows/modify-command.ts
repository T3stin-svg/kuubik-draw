import {
  parseCadHandleList,
  parseCartesianPoint,
  parseCopyDestinations,
  parseExtendTargetPicks,
  parseFilletPairPicks,
  parseFilletRadius,
  parseMoveDestination,
  parseOffsetDistance,
  parseOffsetPlacementPoints,
  parseReferenceAngleInput,
  parseRotationAngleInput,
  parseScaleFactorInput,
  parseScaleLengthInput,
  parseTrimTargetPicks,
  resolveCadCommand,
  type CadChange,
  type CopyCommandResult,
  type ExtendCommandResult,
  type ExtendTargetAction,
  type FilletCommandResult,
  type FilletTrimMode,
  type MirrorCommandResult,
  type MoveCommandResult,
  type OffsetCommandResult,
  type OffsetGeometryMode,
  type OffsetLayerMode,
  type RotateAngleSpec,
  type RotateCommandResult,
  type ScaleCommandResult,
  type ScaleFactorSpec,
  type TrimCommandResult,
  type TrimEdgeMode,
  type TrimMode,
  type TrimProjectMode,
  type TrimTargetAction,
} from "@kuubik/cad-core";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface PreparedModifyCommand<TResult> {
  commandId: "MOVE" | "COPY" | "ROTATE" | "SCALE" | "MIRROR" | "OFFSET" | "TRIM" | "EXTEND" | "FILLET";
  operationArgs: Readonly<Record<string, unknown>>;
  result: TResult;
}

export function putEntities(changes: readonly CadChange[]): CadEntity[] {
  return changes.flatMap((change) => change.type === "put" ? [change.entity] : []);
}

function rotateAngleSpec(
  mode: "relative" | "reference",
  basePoint: { x: number; y: number },
  angleInput: string,
  referenceInput: string,
  newAngleInput: string,
): RotateAngleSpec {
  return mode === "relative"
    ? { mode, angleDeg: parseRotationAngleInput(angleInput, basePoint) }
    : {
        mode,
        referenceAngleDeg: parseReferenceAngleInput(referenceInput, basePoint),
        newAngleDeg: parseRotationAngleInput(newAngleInput, basePoint),
      };
}

function scaleFactorSpec(
  mode: "factor" | "reference",
  basePoint: { x: number; y: number },
  factorInput: string,
  referenceInput: string,
  newLengthInput: string,
): ScaleFactorSpec {
  return mode === "factor"
    ? { mode, factor: parseScaleFactorInput(factorInput, basePoint) }
    : {
        mode,
        referenceLength: parseScaleLengthInput(referenceInput, basePoint),
        newLength: parseScaleLengthInput(newLengthInput, basePoint),
      };
}

export function prepareMove(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  baseInput: string;
  destinationInput: string;
}): PreparedModifyCommand<MoveCommandResult> {
  const command = resolveCadCommand("MOVE");
  if (!command || command.id !== "MOVE") throw new Error("MOVE command is missing from the registry.");
  const basePoint = parseCartesianPoint(input.baseInput);
  const destinationPoint = parseMoveDestination(input.destinationInput, basePoint);
  const result = command.execute(document, { targetHandles: input.targetHandles, basePoint, destinationPoint });
  return { commandId: command.id, operationArgs: { basePoint, destinationPoint }, result };
}

export function prepareCopy(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  baseInput: string;
  destinationsInput: string;
}): PreparedModifyCommand<CopyCommandResult> {
  const command = resolveCadCommand("COPY");
  if (!command || command.id !== "COPY") throw new Error("COPY command is missing from the registry.");
  const basePoint = parseCartesianPoint(input.baseInput);
  const destinationPoints = parseCopyDestinations(input.destinationsInput, basePoint);
  const result = command.execute(document, { targetHandles: input.targetHandles, basePoint, destinationPoints });
  return { commandId: command.id, operationArgs: { basePoint, destinationPoints }, result };
}

export function prepareRotate(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  baseInput: string;
  mode: "relative" | "reference";
  angleInput: string;
  referenceInput: string;
  newAngleInput: string;
}): PreparedModifyCommand<RotateCommandResult> {
  const command = resolveCadCommand("ROTATE");
  if (!command || command.id !== "ROTATE") throw new Error("ROTATE command is missing from the registry.");
  const basePoint = parseCartesianPoint(input.baseInput);
  const angle = rotateAngleSpec(input.mode, basePoint, input.angleInput, input.referenceInput, input.newAngleInput);
  const result = command.execute(document, { targetHandles: input.targetHandles, basePoint, angle });
  return { commandId: command.id, operationArgs: { basePoint, angle, deltaAngleDeg: result.deltaAngleDeg }, result };
}

export function prepareScale(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  baseInput: string;
  mode: "factor" | "reference";
  factorInput: string;
  referenceInput: string;
  newLengthInput: string;
  copy: boolean;
}): PreparedModifyCommand<ScaleCommandResult> {
  const command = resolveCadCommand("SCALE");
  if (!command || command.id !== "SCALE") throw new Error("SCALE command is missing from the registry.");
  const basePoint = parseCartesianPoint(input.baseInput);
  const scale = scaleFactorSpec(input.mode, basePoint, input.factorInput, input.referenceInput, input.newLengthInput);
  const result = command.execute(document, { targetHandles: input.targetHandles, basePoint, scale, copy: input.copy });
  return { commandId: command.id, operationArgs: { basePoint, scale, factor: result.factor, copy: result.copy }, result };
}

export function prepareMirror(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  firstPointInput: string;
  secondPointInput: string;
  eraseSource: boolean;
}): PreparedModifyCommand<MirrorCommandResult> {
  const command = resolveCadCommand("MIRROR");
  if (!command || command.id !== "MIRROR") throw new Error("MIRROR command is missing from the registry.");
  const axisStart = parseCartesianPoint(input.firstPointInput);
  const axisEnd = parseCartesianPoint(input.secondPointInput);
  const result = command.execute(document, { targetHandles: input.targetHandles, axisStart, axisEnd, eraseSource: input.eraseSource });
  return { commandId: command.id, operationArgs: { axisStart, axisEnd, eraseSource: result.eraseSource, mirrtext: 0 }, result };
}

export function prepareOffset(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  mode: OffsetGeometryMode;
  distanceInput: string;
  placementInput: string;
  multiple: boolean;
  eraseSource: boolean;
  layerMode: OffsetLayerMode;
}): PreparedModifyCommand<OffsetCommandResult> {
  const command = resolveCadCommand("OFFSET");
  if (!command || command.id !== "OFFSET") throw new Error("OFFSET command is missing from the registry.");
  const placementPoints = parseOffsetPlacementPoints(input.placementInput);
  const distance = input.mode === "distance" ? parseOffsetDistance(input.distanceInput) : undefined;
  const result = command.execute(document, {
    targetHandles: input.targetHandles,
    mode: input.mode,
    ...(distance === undefined ? {} : { distance }),
    placementPoints,
    multiple: input.multiple,
    eraseSource: input.eraseSource,
    layerMode: input.layerMode,
  });
  return {
    commandId: command.id,
    operationArgs: {
      mode: result.mode,
      distance: distance ?? null,
      placementPoints,
      multiple: result.multiple,
      eraseSource: result.eraseSource,
      layerMode: result.layerMode,
      steps: result.steps,
    },
    result,
  };
}

export function prepareTrim(document: KDrawDocumentV1, input: {
  mode: TrimMode;
  cuttingHandlesInput: string;
  targetsInput: string;
  targetAction: TrimTargetAction;
  edgeMode: TrimEdgeMode;
  projectMode: TrimProjectMode;
}): PreparedModifyCommand<TrimCommandResult> {
  const command = resolveCadCommand("TRIM");
  if (!command || command.id !== "TRIM") throw new Error("TRIM command is missing from the registry.");
  const cuttingEdgeHandles = parseCadHandleList(input.cuttingHandlesInput);
  const targets = parseTrimTargetPicks(input.targetsInput, input.targetAction);
  const result = command.execute(document, {
    mode: input.mode,
    cuttingEdgeHandles,
    targets,
    edgeMode: input.edgeMode,
    projectMode: input.projectMode,
  });
  return {
    commandId: command.id,
    operationArgs: {
      mode: result.mode,
      cuttingEdgeHandles,
      targets,
      edgeMode: result.edgeMode,
      projectMode: result.projectMode,
      steps: result.steps,
    },
    result,
  };
}

export function prepareExtend(document: KDrawDocumentV1, input: {
  mode: TrimMode;
  boundaryHandlesInput: string;
  targetsInput: string;
  targetAction: ExtendTargetAction;
  edgeMode: TrimEdgeMode;
  projectMode: TrimProjectMode;
}): PreparedModifyCommand<ExtendCommandResult> {
  const command = resolveCadCommand("EXTEND");
  if (!command || command.id !== "EXTEND") throw new Error("EXTEND command is missing from the registry.");
  const boundaryEdgeHandles = input.mode === "quick" ? [] : parseCadHandleList(input.boundaryHandlesInput);
  const targets = parseExtendTargetPicks(input.targetsInput, input.targetAction);
  const result = command.execute(document, {
    mode: input.mode,
    boundaryEdgeHandles,
    targets,
    edgeMode: input.edgeMode,
    projectMode: input.projectMode,
  });
  return {
    commandId: command.id,
    operationArgs: {
      mode: result.mode,
      boundaryEdgeHandles,
      targets,
      edgeMode: result.edgeMode,
      projectMode: result.projectMode,
      steps: result.steps,
    },
    result,
  };
}

export function prepareFillet(document: KDrawDocumentV1, input: {
  mode: "pairs" | "polyline";
  radiusInput: string;
  pairsInput: string;
  polylineHandlesInput: string;
  trimMode: FilletTrimMode;
  filletPolylineArc?: 0 | 1;
}): PreparedModifyCommand<FilletCommandResult> {
  const command = resolveCadCommand("FILLET");
  if (!command || command.id !== "FILLET") throw new Error("FILLET command is missing from the registry.");
  const radius = parseFilletRadius(input.radiusInput);
  const args = input.mode === "pairs"
    ? { mode: "pairs" as const, radius, trimMode: input.trimMode, pairs: parseFilletPairPicks(input.pairsInput) }
    : { mode: "polyline" as const, radius, trimMode: input.trimMode, filletPolylineArc: input.filletPolylineArc ?? 1, polylineHandles: parseCadHandleList(input.polylineHandlesInput) };
  const result = command.execute(document, args);
  return {
    commandId: command.id,
    operationArgs: {
      ...args,
      steps: result.steps,
      multiple: result.multiple,
    },
    result,
  };
}
