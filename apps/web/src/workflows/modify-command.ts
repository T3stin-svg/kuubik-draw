import {
  parseCadHandleList,
  parseBreakTargetPicks,
  parseCartesianPoint,
  parseChamferAngle,
  parseChamferDistance,
  parseChamferPairPicks,
  parseCopyDestinations,
  parseExtendTargetPicks,
  parseFilletPairPicks,
  parseFilletRadius,
  parseLengthenTargetPicks,
  parseMoveDestination,
  parseOffsetDistance,
  parseOffsetPlacementPoints,
  parseReferenceAngleInput,
  parseRotationAngleInput,
  parseScaleFactorInput,
  parseScaleLengthInput,
  parseStretchRegions,
  parseTrimTargetPicks,
  resolveCadCommand,
  CadCommandInputError,
  type AlignCommandResult,
  type CadChange,
  type BreakCommandResult,
  type ChamferCommandResult,
  type ChamferTrimMode,
  type CopyCommandResult,
  type ExtendCommandResult,
  type ExtendTargetAction,
  type FilletCommandResult,
  type FilletTrimMode,
  type MirrorCommandResult,
  type MatchPropertiesResult,
  type MatchPropertiesSettings,
  type LengthenCommandResult,
  type LengthenMeasurement,
  type LengthenMode,
  type MoveCommandResult,
  type OffsetCommandResult,
  type OffsetGeometryMode,
  type OffsetLayerMode,
  type RotateAngleSpec,
  type RotateCommandResult,
  type ScaleCommandResult,
  type ScaleFactorSpec,
  type StretchCommandResult,
  type TrimCommandResult,
  type TrimEdgeMode,
  type TrimMode,
  type TrimProjectMode,
  type TrimTargetAction,
} from "@kuubik/cad-core";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface PreparedModifyCommand<TResult> {
  commandId: "MOVE" | "COPY" | "ROTATE" | "SCALE" | "MIRROR" | "OFFSET" | "TRIM" | "EXTEND" | "FILLET" | "CHAMFER" | "BREAK" | "STRETCH" | "LENGTHEN" | "ALIGN" | "MATCHPROP";
  operationArgs: Readonly<Record<string, unknown>>;
  result: TResult;
}

export function prepareAlign(document: KDrawDocumentV1, input: {
  targetHandles: readonly string[];
  firstSourceInput: string;
  firstDestinationInput: string;
  secondSourceInput?: string;
  secondDestinationInput?: string;
  scaleToFit: boolean;
}): PreparedModifyCommand<AlignCommandResult> {
  const command = resolveCadCommand("ALIGN");
  if (!command || command.id !== "ALIGN") throw new Error("ALIGN command is missing from the registry.");
  const first = {
    sourcePoint: parseCartesianPoint(input.firstSourceInput),
    destinationPoint: parseCartesianPoint(input.firstDestinationInput),
  };
  const secondSource = input.secondSourceInput?.trim() ?? "";
  const secondDestination = input.secondDestinationInput?.trim() ?? "";
  if ((secondSource.length === 0) !== (secondDestination.length === 0)) {
    throw new CadCommandInputError("ALIGN second source and destination points must be supplied together.");
  }
  const pointPairs = secondSource.length > 0
    ? [first, { sourcePoint: parseCartesianPoint(secondSource), destinationPoint: parseCartesianPoint(secondDestination) }] as const
    : [first] as const;
  const result = command.execute(document, { targetHandles: input.targetHandles, pointPairs, scaleToFit: input.scaleToFit });
  return {
    commandId: command.id,
    operationArgs: {
      targetHandles: [...input.targetHandles],
      pointPairs,
      pointPairCount: result.pointPairCount,
      scaleToFit: result.scaleToFit,
      angleRad: result.angleRad,
      scaleFactor: result.scaleFactor,
      translation: result.translation,
      noChangeHandles: result.noChangeHandles,
    },
    result,
  };
}

export function prepareLengthen(document: KDrawDocumentV1, input: {
  mode: LengthenMode;
  measurement: LengthenMeasurement;
  valueInput: string;
  targetsInput: string;
}): PreparedModifyCommand<LengthenCommandResult> {
  const command = resolveCadCommand("LENGTHEN");
  if (!command || command.id !== "LENGTHEN") throw new Error("LENGTHEN command is missing from the registry.");
  const targets = parseLengthenTargetPicks(input.targetsInput, input.mode);
  let value: number | undefined;
  if (input.mode !== "dynamic") {
    value = Number(input.valueInput.trim().replace(",", "."));
    if (!Number.isFinite(value)) throw new CadCommandInputError("LENGTHEN value must be finite.");
  }
  const args = {
    mode: input.mode,
    measurement: input.measurement,
    ...(value === undefined ? {} : { value }),
    targets,
  };
  const result = command.execute(document, args);
  return {
    commandId: command.id,
    operationArgs: { ...args, steps: result.steps, multiple: result.multiple },
    result,
  };
}

export function prepareMatchProperties(document: KDrawDocumentV1, input: {
  sourceHandle: string;
  targetHandles: readonly string[];
  settings?: Partial<MatchPropertiesSettings>;
}): PreparedModifyCommand<MatchPropertiesResult> {
  const command = resolveCadCommand("MATCHPROP");
  if (!command || command.id !== "MATCHPROP") throw new Error("MATCHPROP command is missing from the registry.");
  const result = command.execute(document, input);
  return {
    commandId: command.id,
    operationArgs: { sourceHandle: result.sourceHandle, targetHandles: result.targetHandles, settings: result.settings },
    result,
  };
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

export function prepareChamfer(document: KDrawDocumentV1, input: {
  mode: "pairs" | "polyline";
  method: "distance" | "angle";
  firstDistanceInput: string;
  secondDistanceInput: string;
  angleInput: string;
  pairsInput: string;
  polylineHandlesInput: string;
  trimMode: ChamferTrimMode;
}): PreparedModifyCommand<ChamferCommandResult> {
  const command = resolveCadCommand("CHAMFER");
  if (!command || command.id !== "CHAMFER") throw new Error("CHAMFER command is missing from the registry.");
  const firstDistance = parseChamferDistance(input.firstDistanceInput, "CHAMFER first distance");
  const specification = input.method === "distance"
    ? { method: "distance" as const, firstDistance, secondDistance: parseChamferDistance(input.secondDistanceInput, "CHAMFER second distance") }
    : { method: "angle" as const, firstDistance, angleDeg: parseChamferAngle(input.angleInput) };
  const args = input.mode === "pairs"
    ? { mode: "pairs" as const, specification, trimMode: input.trimMode, pairs: parseChamferPairPicks(input.pairsInput) }
    : { mode: "polyline" as const, specification, trimMode: input.trimMode, polylineHandles: parseCadHandleList(input.polylineHandlesInput) };
  const result = command.execute(document, args);
  return {
    commandId: command.id,
    operationArgs: { ...args, steps: result.steps, multiple: result.multiple },
    result,
  };
}

export function prepareBreak(document: KDrawDocumentV1, input: {
  targetsInput: string;
}): PreparedModifyCommand<BreakCommandResult> {
  const command = resolveCadCommand("BREAK");
  if (!command || command.id !== "BREAK") throw new Error("BREAK command is missing from the registry.");
  const targets = parseBreakTargetPicks(input.targetsInput);
  const result = command.execute(document, { targets });
  return {
    commandId: command.id,
    operationArgs: { targets, steps: result.steps, multiple: result.multiple },
    result,
  };
}

export function prepareStretch(document: KDrawDocumentV1, input: {
  crossingInput: string;
  individualHandles: readonly string[];
  baseInput: string;
  destinationInput: string;
}): PreparedModifyCommand<StretchCommandResult> {
  const command = resolveCadCommand("STRETCH");
  if (!command || command.id !== "STRETCH") throw new Error("STRETCH command is missing from the registry.");
  const regions = parseStretchRegions(input.crossingInput);
  const basePoint = parseCartesianPoint(input.baseInput);
  const destinationPoint = parseMoveDestination(input.destinationInput, basePoint);
  const result = command.execute(document, { regions, individualHandles: input.individualHandles, basePoint, destinationPoint });
  return {
    commandId: command.id,
    operationArgs: { regions, basePoint, destinationPoint, delta: result.delta, steps: result.steps },
    result,
  };
}
