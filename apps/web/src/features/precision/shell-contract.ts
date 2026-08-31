import type { CadEntity, CadPoint2, CadUnits, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { entityParticipates, type CadLayerPurpose } from "../../../../../packages/cad-core/src/layer-policy.js";
import type { CadPrecisionInput } from "../../../../../packages/cad-core/src/precision-input.js";
import type { PrecisionRequest, PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import { CadSelectionIndex } from "../../../../../packages/cad-renderer/src/selection-index.js";
import type { CadPickHit } from "../../../../../packages/cad-renderer/src/selection.js";
import { CadSnapIndex, type CadSnapCandidate } from "../../../../../packages/cad-renderer/src/snap.js";
import { CadObjectTrack, type CadTrackingCandidate } from "../../../../../packages/cad-renderer/src/tracking.js";
import { LayerVisualShellCommandAdapter, type LayerShellAction, type LayerShellRow } from "../layers/command-adapter.js";
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
import { PrecisionFeatureModel, type DynamicInputModel } from "./model.js";

export interface PrecisionPointerInput {
  basePoint: CadPoint2;
  cursorPoint: CadPoint2;
  input?: string | CadPrecisionInput;
  referencePoint?: CadPoint2;
  trackingAnglesRad?: readonly number[];
}

export interface PrecisionPointerResolution {
  preview: PrecisionResult;
  commit: PrecisionResult;
  dynamicInput: DynamicInputModel;
}

export interface LayerShellIntent {
  action: LayerShellAction;
  rowId: LayerShellRow;
}

export interface PrecisionLayersShellContractOptions {
  settings: PrecisionSettings;
  units: CadUnits;
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

/**
 * Immutable pointer frame. Preview, point commit and Dynamic Input all consume
 * the same private request snapshot, even if shell state changes afterwards.
 */
export class PreparedPrecisionPointer {
  readonly #request: PrecisionRequest;
  readonly #units: CadUnits;
  readonly #model: PrecisionFeatureModel;

  constructor(request: PrecisionRequest, units: CadUnits, model: PrecisionFeatureModel) {
    this.#request = structuredClone(request);
    this.#units = structuredClone(units);
    this.#model = model;
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
    return this.#model.dynamicInput(this.#request, this.#units);
  }

  resolve(): PrecisionPointerResolution {
    return { preview: this.preview(), commit: this.commit(), dynamicInput: this.dynamicInput() };
  }
}

/**
 * Complete DOM-free integration boundary for precision, spatial queries and
 * atomic layer state. React may translate events into these typed methods, but
 * it must not reproduce any geometry or layer predicate.
 */
export class PrecisionLayersShellContract {
  readonly precision: PrecisionCommandState;
  readonly tracking = new CadObjectTrack();
  readonly #precisionModel = new PrecisionFeatureModel();
  readonly #selection = new CadSelectionIndex();
  readonly #snap = new CadSnapIndex();
  readonly #layers: LayerManagerController;
  readonly #adapter: VisualShellCommandAdapter;
  readonly #layerIntents: LayerShellIntent[] = [];
  readonly #units: CadUnits;
  #settings: PrecisionSettings;

  constructor(document: KDrawDocumentV1, options: PrecisionLayersShellContractOptions) {
    this.precision = new PrecisionCommandState(options.initialPrecision ?? {});
    this.#settings = cloneSettings(options.settings);
    this.#units = structuredClone(options.units);
    this.#layers = options.layerController
      ? new LayerManagerController(document, options.layerController)
      : new LayerManagerController(document);
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
    const layers = this.document.layers;
    const eligibleForSnap = (entity: CadEntity): boolean => entityParticipates(entity, layers, "snap").participates;
    const objectSnapCandidates = precisionState.osnap
      ? this.#snap.query({
          modes: precisionState.osnapModes,
          cursor: input.cursorPoint,
          aperture: this.#settings.aperture,
          ...(input.referencePoint ? { referencePoint: input.referencePoint } : {}),
        }, eligibleForSnap)
      : [];
    const trackingCandidates = precisionState.otrack
      ? input.trackingAnglesRad
        ? this.tracking.candidates(input.cursorPoint, this.#settings.aperture, input.trackingAnglesRad)
        : this.tracking.candidates(input.cursorPoint, this.#settings.aperture)
      : [];
    const request: PrecisionRequest = this.precision.prepareRequest({
      basePoint: { ...input.basePoint },
      cursorPoint: { ...input.cursorPoint },
      ...(input.input === undefined ? {} : { input: typeof input.input === "string" ? input.input : structuredClone(input.input) }),
      objectSnapCandidates: objectSnapCandidates.map((candidate) => ({
        point: { ...candidate.point }, kind: candidate.mode, priority: candidate.priority, key: candidate.key,
      })),
      trackingCandidates: trackingCandidates.map((candidate) => ({
        point: { ...candidate.point }, kind: candidate.kind, priority: candidate.priority, key: candidate.key,
      })),
    }, this.#settings);
    return new PreparedPrecisionPointer(request, this.#units, this.#precisionModel);
  }

  querySnap(cursor: CadPoint2, referencePoint?: CadPoint2): CadSnapCandidate[] {
    const state = this.precision.state;
    if (!state.osnap) return [];
    const layers = this.document.layers;
    return this.#snap.query({
      modes: state.osnapModes,
      cursor,
      aperture: this.#settings.aperture,
      ...(referencePoint ? { referencePoint } : {}),
    }, (entity) => entityParticipates(entity, layers, "snap").participates);
  }

  acquireTracking(candidate: CadSnapCandidate, acquiredAt?: number): void {
    if (acquiredAt === undefined) this.tracking.acquire(candidate.key, candidate.point);
    else this.tracking.acquire(candidate.key, candidate.point, acquiredAt);
  }

  trackingCandidates(cursor: CadPoint2, anglesRad?: readonly number[]): CadTrackingCandidate[] {
    if (!this.precision.enabled("otrack")) return [];
    return anglesRad
      ? this.tracking.candidates(cursor, this.#settings.aperture, anglesRad)
      : this.tracking.candidates(cursor, this.#settings.aperture);
  }

  select(point: CadPoint2, tolerance: number): CadPickHit[] {
    const layers = this.document.layers;
    return this.#selection.pick(point, tolerance, (entity) => entityParticipates(entity, layers, "select").participates);
  }

  participates(entity: CadEntity, purpose: CadLayerPurpose): boolean {
    return entityParticipates(entity, this.document.layers, purpose).participates;
  }

  executeLayer(command: LayerManagerCommand): LayerManagerCommit {
    const committed = this.#layers.execute(command);
    this.#syncSpatialIndexes();
    return committed;
  }

  undoLayer(): LayerManagerCommit | null {
    const committed = this.#layers.undo();
    if (committed) this.#syncSpatialIndexes();
    return committed;
  }

  redoLayer(): LayerManagerCommit | null {
    const committed = this.#layers.redo();
    if (committed) this.#syncSpatialIndexes();
    return committed;
  }

  #syncSpatialIndexes(): void {
    const document = this.#layers.document;
    this.#selection.setBlocks(document.blocks);
    this.#selection.setEntities(document.entities);
    this.#snap.setBlocks(document.blocks);
    this.#snap.setEntities(document.entities);
  }
}
