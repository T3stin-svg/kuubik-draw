import type { CadEntity, CadLayer, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { entityParticipates, type CadLayerPurpose } from "../../../../../packages/cad-core/src/layer-policy.js";
import type { CadDrawOrderAction } from "../../../../../packages/cad-core/src/draw-order.js";
import {
  LayerManagerController,
  type LayerManagerCommit,
  type LayerManagerPropertyPatch,
} from "./controller.js";

export const LAYER_MANAGER_CAPABILITY = Object.freeze({
  create: "layers.create",
  current: "layers.current",
  visibility: "layers.visibility",
  freeze: "layers.freeze",
  lock: "layers.lock",
  color: "layers.color",
  linetype: "layers.linetype",
  lineweight: "layers.lineweight",
  transparency: "layers.transparency",
  plot: "layers.plot",
  properties: "layers.properties",
  drawOrder: "layers.draw-order",
} as const);

export type LayerManagerCapability = typeof LAYER_MANAGER_CAPABILITY[keyof typeof LAYER_MANAGER_CAPABILITY];

/**
 * Informational parity ownership only. Runtime dispatch uses capability keys,
 * never feature-row strings. In particular, F-086 remains shared-shell
 * metadata and cannot capture the Block Create command.
 */
export const LAYER_MANAGER_CAPABILITY_ROWS: Readonly<Record<LayerManagerCapability, readonly string[]>> = Object.freeze({
  "layers.create": ["F-072"],
  "layers.current": ["F-073"],
  "layers.lock": ["F-074"],
  "layers.visibility": ["F-075"],
  "layers.freeze": ["F-076"],
  "layers.color": ["F-077"],
  "layers.linetype": ["F-078"],
  "layers.lineweight": ["F-079"],
  "layers.transparency": ["F-080"],
  "layers.plot": ["F-080"],
  "layers.properties": ["F-080"],
  "layers.draw-order": ["F-086"],
});

interface LayerIdsCommand {
  layerIds: readonly string[];
}

export type LayerManagerShellCommand =
  | { capability: "layers.create"; name: string; requestedId?: string }
  | { capability: "layers.current"; layerId: string }
  | ({ capability: "layers.visibility"; visible: boolean } & LayerIdsCommand)
  | ({ capability: "layers.freeze"; frozen: boolean } & LayerIdsCommand)
  | ({ capability: "layers.lock"; locked: boolean } & LayerIdsCommand)
  | ({ capability: "layers.color"; color: string | null; colorMethod?: "aci" | "trueColor" | null; aciIndex?: number | null } & LayerIdsCommand)
  | ({ capability: "layers.linetype"; linetypeId: string | null } & LayerIdsCommand)
  | ({ capability: "layers.lineweight"; lineweightMm: number | null } & LayerIdsCommand)
  | ({ capability: "layers.transparency"; transparency: number | null } & LayerIdsCommand)
  | ({ capability: "layers.plot"; plottable: boolean } & LayerIdsCommand)
  | ({ capability: "layers.properties"; patch: LayerManagerPropertyPatch } & LayerIdsCommand)
  | { capability: "layers.draw-order"; handles: readonly string[]; action: CadDrawOrderAction; referenceHandle?: string };

export interface LayerManagerShellCommit extends LayerManagerCommit {
  capability: LayerManagerCapability;
  affectedLayerIds: string[];
}

export interface LayerManagerShellAdapterOptions {
  onDocumentChange?: (document: KDrawDocumentV1) => void;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** DOM-independent typed adapter from shell capabilities to one atomic controller operation. */
export class LayerManagerShellAdapter {
  readonly #controller: LayerManagerController;
  readonly #onDocumentChange: ((document: KDrawDocumentV1) => void) | undefined;

  constructor(controller: LayerManagerController, options: LayerManagerShellAdapterOptions = {}) {
    this.#controller = controller;
    this.#onDocumentChange = options.onDocumentChange;
  }

  get document(): KDrawDocumentV1 { return this.#controller.document; }
  get canUndo(): boolean { return this.#controller.canUndo; }
  get canRedo(): boolean { return this.#controller.canRedo; }

  canExecute(capability: LayerManagerCapability, context: "model" | "paper"): boolean {
    return capability !== LAYER_MANAGER_CAPABILITY.drawOrder || context === "model";
  }

  execute(command: LayerManagerShellCommand): LayerManagerShellCommit {
    let committed: LayerManagerCommit;
    let affectedLayerIds: string[] = [];
    const priorLayerIds = command.capability === "layers.create"
      ? new Set(this.document.layers.map((layer) => layer.id))
      : undefined;
    switch (command.capability) {
      case "layers.create":
        committed = this.#controller.execute({
          type: "create", name: command.name,
          ...(command.requestedId === undefined ? {} : { requestedId: command.requestedId }),
        });
        affectedLayerIds = committed.document.layers.filter((layer) => !priorLayerIds!.has(layer.id)).map((layer) => layer.id);
        break;
      case "layers.current":
        committed = this.#controller.execute({ type: "current", layerId: command.layerId });
        affectedLayerIds = [command.layerId];
        break;
      case "layers.visibility":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { visible: command.visible } });
        break;
      case "layers.freeze":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { frozen: command.frozen } });
        break;
      case "layers.lock":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { locked: command.locked } });
        break;
      case "layers.color":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({
          type: "batch-properties", layerIds: affectedLayerIds,
          patch: { color: command.color, ...(command.colorMethod === undefined ? {} : { colorMethod: command.colorMethod }), ...(command.aciIndex === undefined ? {} : { aciIndex: command.aciIndex }) },
        });
        break;
      case "layers.linetype":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { linetypeId: command.linetypeId } });
        break;
      case "layers.lineweight":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { lineweightMm: command.lineweightMm } });
        break;
      case "layers.transparency":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { transparency: command.transparency } });
        break;
      case "layers.plot":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: { plottable: command.plottable } });
        break;
      case "layers.properties":
        affectedLayerIds = unique(command.layerIds);
        committed = this.#controller.execute({ type: "batch-properties", layerIds: affectedLayerIds, patch: structuredClone(command.patch) });
        break;
      case "layers.draw-order":
        committed = this.#controller.execute({
          type: "draw-order", handles: [...command.handles], action: command.action,
          ...(command.referenceHandle === undefined ? {} : { referenceHandle: command.referenceHandle }),
        });
        break;
    }
    this.#onDocumentChange?.(committed.document);
    return { ...committed, capability: command.capability, affectedLayerIds };
  }

  undo(): LayerManagerCommit | null {
    const committed = this.#controller.undo();
    if (committed) this.#onDocumentChange?.(committed.document);
    return committed;
  }

  redo(): LayerManagerCommit | null {
    const committed = this.#controller.redo();
    if (committed) this.#onDocumentChange?.(committed.document);
    return committed;
  }

  readLayers(layerIds?: readonly string[]): CadLayer[] {
    const layers = this.document.layers;
    if (layerIds === undefined) return layers;
    const selected = new Set(layerIds);
    return layers.filter((layer) => selected.has(layer.id));
  }

  participates(entity: CadEntity, purpose: CadLayerPurpose): boolean {
    return entityParticipates(entity, this.document.layers, purpose).participates;
  }

  eligibility(purpose: CadLayerPurpose): (entity: CadEntity) => boolean {
    const layers = this.document.layers;
    return (entity) => entityParticipates(entity, layers, purpose).participates;
  }
}
