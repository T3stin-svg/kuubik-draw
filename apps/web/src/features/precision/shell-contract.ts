import type { CadEntity, CadPoint2, CadUnits, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { entityParticipates, type CadLayerPurpose } from "../../../../../packages/cad-core/src/layer-policy.js";
import {
  parseCadPrecisionInput,
  type CadPrecisionInput,
  type CadPrecisionInputOptions,
} from "../../../../../packages/cad-core/src/precision-input.js";
import type { PrecisionRequest, PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import {
  CAD_UNITS_CONTRACT_EXTENSION_KEY,
  createCadUnitsContract,
  normalizeCadUnitsContract,
  readCadUnitsContract,
  type CadAngleFormat,
  type CadUnitsContractV1,
} from "../../../../../packages/cad-core/src/units.js";
import { CadSelectionIndex } from "../../../../../packages/cad-renderer/src/selection-index.js";
import type { CadPickHit } from "../../../../../packages/cad-renderer/src/selection.js";
import {
  CadSnapIndex,
  CadSnapSelectionCycle,
  type CadSnapCandidate,
  type CadSnapCycleReadback,
} from "../../../../../packages/cad-renderer/src/snap.js";
import {
  CadObjectTrack,
  type CadTrackingCandidate,
  type CadTrackingMutationReadback,
  type CadTrackingPoint,
} from "../../../../../packages/cad-renderer/src/tracking.js";
import { LayerVisualShellCommandAdapter, type LayerShellAction, type LayerShellRow } from "../layers/command-adapter.js";
import {
  LayerManagerShellAdapter,
  type LayerManagerShellCommand,
  type LayerManagerShellCommit,
} from "../layers/shell-adapter.js";
import {
  LayerManagerController,
  type LayerManagerCommand,
  type LayerManagerCommit,
  type LayerManagerControllerOptions,
} from "../layers/controller.js";
import {
  PrecisionCommandState,
  PrecisionVisualShellAdapter,
  type PrecisionDispatchResult,
  type PrecisionInputContext,
  type PrecisionSettings,
  type PrecisionState,
  type VisualShellCommandAdapter,
} from "./command-adapter.js";
import { normalizePrecisionUnits, PrecisionFeatureModel, type DynamicInputModel } from "./model.js";
import { PrecisionUnitsFeatureModel } from "./units-contract.js";

export interface PrecisionPointerInput {
  basePoint: CadPoint2;
  cursorPoint: CadPoint2;
  input?: string | CadPrecisionInput;
  referencePoint?: CadPoint2;
  trackingAnglesRad?: readonly number[];
  snapCandidateId?: string;
  snapReferenceHandles?: readonly string[];
}

export interface PrecisionPointerResolution {
  preview: PrecisionResult;
  commit: PrecisionResult;
  dynamicInput: DynamicInputModel;
  request: PrecisionRequest;
  snapCandidateIds: string[];
  selectedSnapCandidateId: string | null;
}

export interface LayerShellIntent {
  action: LayerShellAction;
  rowId: LayerShellRow;
}

export interface PrecisionLayersShellContractOptions {
  settings: PrecisionSettings;
  units: CadUnits;
  unitsContract?: CadUnitsContractV1;
  inputFormat?: Omit<CadPrecisionInputOptions, "documentUnit">;
  initialPrecision?: Partial<PrecisionState>;
  layerController?: LayerManagerControllerOptions;
  onLayerIntent?: (intent: LayerShellIntent) => void;
}

function cloneSettings(settings: PrecisionSettings): PrecisionSettings {
  return {
    ...settings,
    ...(settings.polarAdditionalAnglesRad ? { polarAdditionalAnglesRad: [...settings.polarAdditionalAnglesRad] } : {}),
    ...(settings.gridOrigin ? { gridOrigin: { ...settings.gridOrigin } } : {}),
  };
}

function cloneInputFormat(format: Omit<CadPrecisionInputOptions, "documentUnit"> = {}): Omit<CadPrecisionInputOptions, "documentUnit"> {
  return { ...format };
}

function typedAngleUnit(format: CadAngleFormat): NonNullable<CadPrecisionInputOptions["defaultAngleUnit"]> {
  return format === "radians" ? "rad" : format === "grads" ? "grad" : "deg";
}

/**
 * Immutable pointer frame. Preview, point commit and Dynamic Input all consume
 * the same private request snapshot, even if shell state changes afterwards.
 */
export class PreparedPrecisionPointer {
  readonly #request: PrecisionRequest;
  readonly #unitsContract: CadUnitsContractV1;
  readonly #model: PrecisionFeatureModel;
  readonly #snapCandidateIds: string[];
  readonly #selectedSnapCandidateId: string | null;

  constructor(
    request: PrecisionRequest,
    units: CadUnitsContractV1,
    model: PrecisionFeatureModel,
    snapCandidateIds: readonly string[] = [],
    selectedSnapCandidateId: string | null = null,
  ) {
    this.#request = structuredClone(request);
    this.#unitsContract = normalizeCadUnitsContract(units);
    this.#model = model;
    this.#snapCandidateIds = [...snapCandidateIds];
    this.#selectedSnapCandidateId = selectedSnapCandidateId;
  }

  get request(): PrecisionRequest {
    return structuredClone(this.#request);
  }

  preview(): PrecisionResult {
    return this.#model.preview(this.#request);
  }

  commit(): PrecisionResult {
    return this.#model.commit(this.#request);
  }

  dynamicInput(): DynamicInputModel {
    return this.#model.dynamicInput(this.#request, this.#unitsContract);
  }

  resolve(): PrecisionPointerResolution {
    return {
      preview: this.preview(), commit: this.commit(), dynamicInput: this.dynamicInput(),
      request: this.request, snapCandidateIds: [...this.#snapCandidateIds], selectedSnapCandidateId: this.#selectedSnapCandidateId,
    };
  }
}

/**
 * Complete DOM-free integration boundary for precision, spatial queries and
 * atomic layer state. React may translate events into these typed methods, but
 * it must not reproduce any geometry or layer predicate.
 */
export class PrecisionLayersShellContract {
  readonly precision: PrecisionCommandState;
  readonly unitsModel = new PrecisionUnitsFeatureModel();
  readonly tracking = new CadObjectTrack();
  readonly snapCycle = new CadSnapSelectionCycle();
  readonly layerManager: LayerManagerShellAdapter;
  readonly #precisionModel = new PrecisionFeatureModel();
  readonly #selection = new CadSelectionIndex();
  readonly #snap = new CadSnapIndex();
  readonly #layers: LayerManagerController;
  readonly #adapter: VisualShellCommandAdapter;
  readonly #layerIntents: LayerShellIntent[] = [];
  readonly #unitsContract: CadUnitsContractV1;
  readonly #inputFormat: Omit<CadPrecisionInputOptions, "documentUnit">;
  #layerSnapshot: KDrawDocumentV1["layers"] = [];
  #settings: PrecisionSettings;

  constructor(document: KDrawDocumentV1, options: PrecisionLayersShellContractOptions) {
    this.precision = new PrecisionCommandState(options.initialPrecision ?? {});
    this.#settings = cloneSettings(options.settings);
    const normalizedUnits = normalizePrecisionUnits(options.units);
    const hasStoredContract = document.metadata.extensions?.[CAD_UNITS_CONTRACT_EXTENSION_KEY] !== undefined;
    this.#unitsContract = options.unitsContract
      ? normalizeCadUnitsContract(options.unitsContract)
      : hasStoredContract
        ? readCadUnitsContract(document)
        : createCadUnitsContract(normalizedUnits);
    if (this.#unitsContract.drawingUnit !== normalizedUnits.linear
      || this.#unitsContract.lengthPrecision !== normalizedUnits.displayPrecision
      || this.#unitsContract.anglePrecision !== normalizedUnits.angularPrecision) {
      throw new TypeError("Precision shell units disagree with the document units contract.");
    }
    this.#inputFormat = cloneInputFormat(options.inputFormat);
    this.#layers = options.layerController
      ? new LayerManagerController(document, options.layerController)
      : new LayerManagerController(document);
    this.layerManager = new LayerManagerShellAdapter(this.#layers, { onDocumentChange: () => this.#syncSpatialIndexes() });
    this.#syncSpatialIndexes();
    const precisionAdapter = new PrecisionVisualShellAdapter(this.precision);
    this.#adapter = new LayerVisualShellCommandAdapter(precisionAdapter, (action, rowId) => {
      const intent = { action, rowId };
      this.#layerIntents.push(intent);
      options.onLayerIntent?.(structuredClone(intent));
    });
    // Validate settings through the same command-state conversion used later.
    this.precision.precisionModes(this.#settings);
  }

  get document(): KDrawDocumentV1 {
    return this.#layers.document;
  }

  get commandAdapter(): VisualShellCommandAdapter {
    return this.#adapter;
  }

  get precisionSettings(): PrecisionSettings {
    return cloneSettings(this.#settings);
  }

  get precisionInputFormat(): Omit<CadPrecisionInputOptions, "documentUnit"> {
    return cloneInputFormat(this.#inputFormat);
  }

  get precisionUnitsContract(): CadUnitsContractV1 {
    return structuredClone(this.#unitsContract);
  }

  setPrecisionSettings(settings: PrecisionSettings): void {
    this.precision.precisionModes(settings);
    this.#settings = cloneSettings(settings);
  }

  handlePrecisionKey(key: string, context: PrecisionInputContext = {}): PrecisionDispatchResult {
    return this.precision.handleKey(key, context);
  }

  executePrecisionCommand(input: string): PrecisionDispatchResult {
    return this.precision.executeCommandLine(input);
  }

  takeLayerIntents(): LayerShellIntent[] {
    return this.#layerIntents.splice(0).map((intent) => structuredClone(intent));
  }

  preparePointer(input: PrecisionPointerInput): PreparedPrecisionPointer {
    const precisionState = this.precision.state;
    const layers = this.#layerSnapshot;
    const normalizedInput = input.input === undefined
      ? undefined
      : typeof input.input === "string"
        ? parseCadPrecisionInput(input.input, {
            decimalSeparator: this.#unitsContract.decimalSeparator,
            defaultInputUnit: this.#unitsContract.drawingUnit,
            defaultAngleUnit: typedAngleUnit(this.#unitsContract.angleFormat),
            ...this.#inputFormat,
            documentUnit: this.#unitsContract.drawingUnit,
          })
        : structuredClone(input.input);
    const explicitCoordinate = normalizedInput !== undefined
      && (normalizedInput.kind !== "direct-distance" || normalizedInput.distance === 0);
    const candidateRequest = this.precision.prepareRequest({
      basePoint: { ...input.basePoint },
      cursorPoint: { ...input.cursorPoint },
      ...(normalizedInput === undefined ? {} : { input: normalizedInput }),
      objectSnapCandidates: [],
      trackingCandidates: [],
    }, this.#settings);
    const candidateCursor = explicitCoordinate ? input.cursorPoint : this.#precisionModel.preview(candidateRequest).point;
    const eligibleForSnap = (entity: CadEntity): boolean => entityParticipates(entity, layers, "snap").participates;
    const objectSnapCandidates = precisionState.osnap && !explicitCoordinate
      ? this.#snap.query({
          modes: precisionState.osnapModes,
          cursor: candidateCursor,
          aperture: this.#settings.aperture,
          ...(input.referencePoint ? { referencePoint: input.referencePoint } : {}),
          ...(input.snapReferenceHandles ? { referenceHandles: [...input.snapReferenceHandles] } : {}),
        }, eligibleForSnap)
      : [];
    const requestedCandidateId = input.snapCandidateId ?? this.snapCycle.candidateId;
    const selectedCandidate = requestedCandidateId === null ? undefined : objectSnapCandidates.find((candidate) => candidate.id === requestedCandidateId);
    if (input.snapCandidateId !== undefined && !selectedCandidate) throw new RangeError(`Snap candidate ${input.snapCandidateId} is not available for this pointer frame.`);
    const activeSnapCandidates = selectedCandidate ? [selectedCandidate] : objectSnapCandidates;
    const trackingAngles = input.trackingAnglesRad ?? this.#polarTrackingAngles();
    const trackingCandidates = precisionState.otrack && !explicitCoordinate
      ? trackingAngles
        ? this.tracking.candidates(candidateCursor, this.#settings.aperture, trackingAngles)
        : this.tracking.candidates(candidateCursor, this.#settings.aperture)
      : [];
    const request: PrecisionRequest = this.precision.prepareRequest({
      basePoint: { ...input.basePoint },
      cursorPoint: { ...input.cursorPoint },
      ...(normalizedInput === undefined ? {} : { input: normalizedInput }),
      objectSnapCandidates: activeSnapCandidates.map((candidate) => ({
        point: { ...candidate.point }, kind: candidate.mode, priority: candidate.priority, key: candidate.key,
      })),
      trackingCandidates: trackingCandidates.map((candidate) => ({
        point: { ...candidate.point }, kind: candidate.kind, priority: candidate.priority, key: candidate.key,
      })),
    }, this.#settings);
    return new PreparedPrecisionPointer(
      request, this.#unitsContract, this.#precisionModel,
      objectSnapCandidates.map((candidate) => candidate.id), selectedCandidate?.id ?? null,
    );
  }

  querySnap(cursor: CadPoint2, referencePoint?: CadPoint2, referenceHandles?: readonly string[]): CadSnapCandidate[] {
    const state = this.precision.state;
    if (!state.osnap) return [];
    const layers = this.#layerSnapshot;
    return this.#snap.query({
      modes: state.osnapModes,
      cursor,
      aperture: this.#settings.aperture,
      ...(referencePoint ? { referencePoint } : {}),
      ...(referenceHandles ? { referenceHandles: [...referenceHandles] } : {}),
    }, (entity) => entityParticipates(entity, layers, "snap").participates);
  }

  updateSnapCycle(cursor: CadPoint2, referencePoint?: CadPoint2, referenceHandles?: readonly string[]): CadSnapCycleReadback {
    return this.snapCycle.update(this.querySnap(cursor, referencePoint, referenceHandles));
  }

  cycleSnap(cursor: CadPoint2, step = 1, referencePoint?: CadPoint2, referenceHandles?: readonly string[]): CadSnapCycleReadback {
    return this.snapCycle.cycle(this.querySnap(cursor, referencePoint, referenceHandles), step);
  }

  selectSnapCandidate(cursor: CadPoint2, candidateId: string, referencePoint?: CadPoint2, referenceHandles?: readonly string[]): CadSnapCycleReadback {
    return this.snapCycle.select(this.querySnap(cursor, referencePoint, referenceHandles), candidateId);
  }

  acquireTracking(candidate: CadSnapCandidate, acquiredAt?: number): CadTrackingPoint {
    return acquiredAt === undefined
      ? this.tracking.acquire(candidate.id, candidate.point)
      : this.tracking.acquire(candidate.id, candidate.point, acquiredAt);
  }

  releaseTracking(candidateId: string): CadTrackingMutationReadback {
    return this.tracking.releaseReadback(candidateId);
  }

  clearTracking(): CadTrackingMutationReadback {
    return this.tracking.clearReadback();
  }

  trackingCandidates(cursor: CadPoint2, anglesRad?: readonly number[]): CadTrackingCandidate[] {
    if (!this.precision.enabled("otrack")) return [];
    const angles = anglesRad ?? this.#polarTrackingAngles();
    return angles
      ? this.tracking.candidates(cursor, this.#settings.aperture, angles)
      : this.tracking.candidates(cursor, this.#settings.aperture);
  }

  select(point: CadPoint2, tolerance: number): CadPickHit[] {
    const layers = this.#layerSnapshot;
    return this.#selection.pick(point, tolerance, (entity) => entityParticipates(entity, layers, "select").participates);
  }

  participates(entity: CadEntity, purpose: CadLayerPurpose): boolean {
    return entityParticipates(entity, this.#layerSnapshot, purpose).participates;
  }

  executeLayer(command: LayerManagerCommand): LayerManagerCommit {
    const committed = this.#layers.execute(command);
    this.#syncSpatialIndexes();
    return committed;
  }

  executeLayerCapability(command: LayerManagerShellCommand): LayerManagerShellCommit {
    return this.layerManager.execute(command);
  }

  undoLayer(): LayerManagerCommit | null {
    return this.layerManager.undo();
  }

  redoLayer(): LayerManagerCommit | null {
    return this.layerManager.redo();
  }

  #syncSpatialIndexes(): void {
    const document = this.#layers.document;
    this.#layerSnapshot = structuredClone(document.layers);
    this.#selection.setBlocks(document.blocks);
    this.#selection.setEntities(document.entities);
    this.#snap.setBlocks(document.blocks);
    this.#snap.setEntities(document.entities);
  }

  #polarTrackingAngles(): readonly number[] | undefined {
    if (!this.precision.enabled("polar")) return undefined;
    const increment = this.#settings.polarIncrementRad;
    const angles: number[] = [];
    for (let angle = 0; angle < Math.PI - 1e-14; angle += increment) angles.push(angle);
    angles.push(...(this.#settings.polarAdditionalAnglesRad ?? []));
    return angles;
  }
}
